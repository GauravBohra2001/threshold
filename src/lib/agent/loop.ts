// src/lib/agent/loop.ts
//
// Case Agent run orchestration (Req 5).
//
// This module drives an Azure OpenAI chat-completions run with function
// calling. It is a real agent: it picks its next tool from what it observes,
// the path differs per case, and it stops to ask when unsure. The ten tools in
// `src/lib/agent/tools.ts` are exposed to the model; the loop executes whichever
// the model calls, appends a plain-language trace step, and persists that step
// to `cases.trace` BEFORE continuing.
//
// Guarantees enforced here:
//  - At most 8 tool steps per run (Req 5.4). Reaching the cap before a terminal
//    state ends the run `escalated` with a plain-language trace note (Req 5.5).
//  - Every run ends in exactly one of: draft_ready | waiting | asked_user |
//    escalated | resolved (Req 5.4).
//  - Each external (I/O) tool call has a 10s timeout. On timeout the loop
//    appends a plain-language trace note, surfaces a friendly fallback (never a
//    stack trace), and continues within the remaining step budget (Req 5.6,
//    22.2, 22.3).
//  - Each step is persisted to the database AS IT HAPPENS, so a mid-run route
//    timeout leaves a partial, saved trace rather than losing the whole run.
//    The 60s route maxDuration lives on the route handler (task 15.1), not here;
//    this loop checkpoints after every step so it is safe to be cut off.
//
// The loop is dependency-injected: the chat client, the database writer, the
// clock, and the tool table are all overridable, so tests run with Azure, the
// db, and the tools mocked and no live call is ever made. Production callers
// omit the deps and get the real Azure + Supabase wiring.

import "server-only";
import { AzureOpenAI } from "openai";

import {
  appendStep,
  type TraceStep,
} from "@/lib/agent/trace";
import {
  classifyPhoto,
  searchNearby311,
  neighborhoodOnTimeRatePct,
  lookupRight,
  draftFiling,
  requestApproval,
  scheduleFollowup,
  checkCaseStatus,
  notifyCaregiver,
  askUser,
  type DraftFacts,
} from "@/lib/agent/tools";
import { db as defaultDb } from "@/lib/data/supabase";
import type { Route } from "@/lib/rules/routing";

/** Case status values, matching the `cases.status` CHECK constraint. */
export type CaseStatus =
  | "investigating"
  | "draft_ready"
  | "waiting"
  | "asked_user"
  | "escalated"
  | "resolved";

/** The terminal states a run may end in (Req 5.4). */
export type TerminalStatus = Exclude<CaseStatus, "investigating">;

/** Hard cap on tool steps per run (Req 5.4). */
export const MAX_TOOL_STEPS = 8;

/** Per-tool-call timeout in milliseconds (Req 5.6). */
export const TOOL_TIMEOUT_MS = 10_000;

/** Friendly, stack-trace-free fallback used when a tool call times out. */
const TIMEOUT_FALLBACK =
  "That step took too long, so I moved on without it.";

// ---------------------------------------------------------------------------
// Injectable collaborators
// ---------------------------------------------------------------------------

/**
 * One function the model may call. The model sends a JSON `arguments` string;
 * the loop parses it and hands the parsed object to `run`. `external` marks a
 * tool that performs I/O and must therefore be run under the 10s timeout.
 * `control` marks a tool that ends the run (and the terminal state it maps to).
 */
export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema for the tool's parameters, sent to the model. */
  parameters: Record<string, unknown>;
  /** Whether the tool performs I/O (and is therefore subject to the timeout). */
  external: boolean;
  /**
   * When set, calling this tool ends the run in the given terminal state.
   * Control-flow tools (request_approval, ask_user, schedule_followup, …) use
   * this; investigative tools leave it undefined and the loop continues.
   */
  terminal?: TerminalStatus;
  /**
   * Execute the tool with parsed arguments and the run context. Returns an
   * observation (any JSON-serializable value) plus the plain-language summaries
   * the trace records. May also propose a route / clock_due_at update.
   */
  run: (
    args: Record<string, unknown>,
    ctx: RunContext,
  ) => Promise<ToolOutcome> | ToolOutcome;
}

/** What a tool reports back to the loop after running. */
export interface ToolOutcome {
  /** Plain-language summary of what the tool was asked to do. */
  input_summary: string;
  /** Plain-language summary of what the tool returned. */
  observation_summary: string;
  /** The raw observation handed back to the model as the tool result. */
  observation: unknown;
  /** A route the tool decided on, surfaced on the case. */
  route?: Route;
  /** A clock due date (ISO 8601) the tool set, surfaced on the case. */
  clockDueAt?: string;
  /** The full draft text produced by draft_filing, persisted for approval. */
  draftText?: string;
}

/** Immutable per-run context shared with every tool. */
export interface RunContext {
  caseId: string;
  photoDataUrl: string;
  lat: number;
  lng: number;
  userMessage?: string;
  openedAt: Date;
  now: () => Date;
}

/** A single message in the chat transcript (structural; SDK-compatible). */
export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_call_id?: string;
  tool_calls?: ChatToolCall[];
}

/** A tool call the model requested. */
export interface ChatToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

/** The slice of a chat-completion response the loop reads. */
export interface ChatCompletion {
  choices: Array<{
    message: {
      role: "assistant";
      content: string | null;
      tool_calls?: ChatToolCall[] | null;
    };
  }>;
}

/**
 * Narrow structural interface for the chat client. Production uses an
 * `AzureOpenAI` client (built the same way as `src/lib/data/azure.ts`); tests
 * inject a fake. The loop only depends on this one method.
 */
export interface ChatClient {
  create(request: {
    messages: ChatMessage[];
    tools: Array<{ type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } }>;
    /** Never `max_tokens`. Azure gpt-5.x uses `max_completion_tokens`. */
    max_completion_tokens: number;
  }): Promise<ChatCompletion>;
}

/** The database update the loop performs after every step (checkpoint). */
export interface CasePersistence {
  (
    caseId: string,
    patch: {
      trace: TraceStep[];
      status: CaseStatus;
      route: Route | null;
      clock_due_at: string | null;
      draft_text: string | null;
    },
  ): Promise<void>;
}

/** Everything the loop needs that touches the outside world. */
export interface RunDeps {
  chat: ChatClient;
  tools: ToolSpec[];
  persist: CasePersistence;
  now: () => Date;
}

/** Input to a Case Agent run (design.md P2 a). */
export interface RunInput {
  caseId: string;
  photoDataUrl: string;
  lat: number;
  lng: number;
  /** e.g. "just submit it" — still routed through the approval gate (Req 7). */
  userMessage?: string;
  /** Case open date, used to clamp follow-up dates. Defaults to now. */
  openedAt?: Date;
}

/** Result of a run (design.md P2 a). */
export interface RunResult {
  status: TerminalStatus;
  route: Route | null;
  trace: TraceStep[];
}

// ---------------------------------------------------------------------------
// Default tool table — wires the ten tools in tools.ts to the loop
// ---------------------------------------------------------------------------

function str(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  return typeof v === "string" ? v : "";
}

function num(args: Record<string, unknown>, key: string, fallback: number): number {
  const v = args[key];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/**
 * Build the default tool table. Investigative tools return observations and the
 * loop continues; control-flow tools carry a `terminal` status so the loop stops
 * with the right final state. `request_approval` → draft_ready, `ask_user` →
 * asked_user, `schedule_followup` → waiting, `notify_caregiver`/escalate →
 * escalated, and an explicit `resolve_case` → resolved.
 */
export function defaultTools(): ToolSpec[] {
  return [
    {
      name: "classify_photo",
      description:
        "Classify the barrier photo into blocked_sidewalk, broken_sidewalk, missing_curb_ramp, or other.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      external: true,
      run: async (_args, ctx) => {
        const r = await classifyPhoto(ctx.photoDataUrl);
        return {
          input_summary: "Looked at the photo to identify the barrier.",
          observation_summary: `Identified a ${r.barrier_type.replace(/_/g, " ")} (confidence ${Math.round(
            r.confidence * 100,
          )}%).`,
          observation: r,
        };
      },
    },
    {
      name: "search_nearby_311",
      description:
        "Count open Boston 311 reports near the barrier. Returns only aggregate counts, never an address.",
      parameters: {
        type: "object",
        properties: {
          radius_m: { type: "number" },
          service_names: { type: "array", items: { type: "string" } },
        },
        additionalProperties: false,
      },
      external: true,
      run: async (args, ctx) => {
        const radius = num(args, "radius_m", 75);
        const serviceNames = Array.isArray(args.service_names)
          ? (args.service_names as unknown[]).filter((s): s is string => typeof s === "string")
          : undefined;
        const r = await searchNearby311(
          ctx.lat,
          ctx.lng,
          radius,
          serviceNames,
          undefined,
          ctx.now(),
        );
        if (!r.ok) {
          return {
            input_summary: "Checked for nearby open reports.",
            observation_summary: r.error,
            observation: r,
          };
        }
        return {
          input_summary: "Checked for nearby open reports.",
          observation_summary: `Found ${r.open_count} open report${
            r.open_count === 1 ? "" : "s"
          } nearby, ${r.overdue_count} overdue, oldest ${r.oldest_open_age_days} day${
            r.oldest_open_age_days === 1 ? "" : "s"
          } old.`,
          observation: r,
        };
      },
    },
    {
      name: "neighborhood_on_time_rate",
      description:
        "Live on-time percentage for a 311 service in a neighborhood over the last 90 days.",
      parameters: {
        type: "object",
        properties: {
          neighborhood: { type: "string" },
          service_name: { type: "string" },
        },
        required: ["neighborhood", "service_name"],
        additionalProperties: false,
      },
      external: true,
      run: async (args) => {
        const r = await neighborhoodOnTimeRatePct(
          str(args, "neighborhood"),
          str(args, "service_name"),
        );
        if (!r.ok) {
          return {
            input_summary: "Checked the neighborhood on-time rate.",
            observation_summary: r.error,
            observation: r,
          };
        }
        return {
          input_summary: "Checked the neighborhood on-time rate.",
          observation_summary:
            r.on_time_pct === null
              ? "There is not enough recent data to show an on-time rate."
              : `About ${r.on_time_pct}% of these are closed on time.`,
          observation: r,
        };
      },
    },
    {
      name: "lookup_right",
      description: "Look up rights-library entries for a topic, with source URLs.",
      parameters: {
        type: "object",
        properties: { topic: { type: "string" } },
        required: ["topic"],
        additionalProperties: false,
      },
      external: false,
      run: (args) => {
        const topic = str(args, "topic");
        const r = lookupRight(topic);
        return {
          input_summary: `Looked up rights about "${topic}".`,
          observation_summary:
            r.entries.length === 0
              ? "No matching right was found in the rights library."
              : `Found ${r.entries.length} matching right${r.entries.length === 1 ? "" : "s"}.`,
          observation: r,
        };
      },
    },
    {
      name: "draft_filing",
      description: "Write a plain-language draft for the chosen route. Does not submit anything.",
      parameters: {
        type: "object",
        properties: {
          route: {
            type: "string",
            enum: [
              "311_sidewalk_repair",
              "311_blocked_sidewalk",
              "escalation_disabilities_commission",
              "ada_curb_ramp_form",
              "ada_grievance",
            ],
          },
          facts: { type: "object", additionalProperties: true },
        },
        required: ["route"],
        additionalProperties: false,
      },
      external: false,
      run: (args) => {
        const route = str(args, "route") as Route;
        const facts = (args.facts ?? {}) as DraftFacts;
        const r = draftFiling(route, facts);
        return {
          input_summary: `Drafted a filing for ${route.replace(/_/g, " ")}.`,
          observation_summary: "Prepared a draft for the resident to review.",
          observation: r,
          route,
          draftText: r.draft_text,
        };
      },
    },
    {
      name: "request_approval",
      description:
        "Stop and show the draft to the resident for approval. Nothing is submitted automatically.",
      parameters: {
        type: "object",
        properties: { draft: { type: "string" } },
        required: ["draft"],
        additionalProperties: false,
      },
      external: false,
      terminal: "draft_ready",
      run: (args) => {
        const draft = str(args, "draft");
        const r = requestApproval(draft);
        return {
          input_summary: "Asked the resident to review and approve the draft.",
          observation_summary: "Paused for the resident to approve or edit the draft.",
          observation: r,
        };
      },
    },
    {
      name: "schedule_followup",
      description:
        "Set a follow-up date, in days from when the case opened (clamped to 0..90 days).",
      parameters: {
        type: "object",
        properties: { days: { type: "number" } },
        required: ["days"],
        additionalProperties: false,
      },
      external: false,
      terminal: "waiting",
      run: (args, ctx) => {
        const days = num(args, "days", 0);
        const r = scheduleFollowup(days, ctx.openedAt);
        return {
          input_summary: `Set a follow-up about ${days} day${days === 1 ? "" : "s"} out.`,
          observation_summary: "Scheduled a follow-up and set the case to waiting.",
          observation: r,
          clockDueAt: r.clock_due_at,
        };
      },
    },
    {
      name: "check_case_status",
      description: "Look up a city case's status in the 311 dataset by case id.",
      parameters: {
        type: "object",
        properties: { city_case_id: { type: "string" } },
        required: ["city_case_id"],
        additionalProperties: false,
      },
      external: true,
      run: async (args) => {
        const id = str(args, "city_case_id");
        // No by-id client is wired here; report that the lookup is unavailable
        // rather than inventing a status. The route handler can inject one later.
        const r = await checkCaseStatus(id, {
          lookupStatus: async () => ({
            ok: false,
            error: "The city case status could not be checked right now.",
          }),
        });
        return {
          input_summary: `Checked the status of city case ${id || "(none)"}.`,
          observation_summary: r.ok ? `City case status: ${r.status}.` : r.error,
          observation: r,
        };
      },
    },
    {
      name: "notify_caregiver",
      description: "Record an in-app notice for the caregiver. Never places a phone call.",
      parameters: {
        type: "object",
        properties: { message: { type: "string" } },
        required: ["message"],
        additionalProperties: false,
      },
      external: false,
      terminal: "escalated",
      run: (args) => {
        notifyCaregiver(str(args, "message"));
        return {
          input_summary: "Left an in-app notice for the caregiver.",
          observation_summary: "Escalated by notifying the caregiver in the app.",
          observation: { ok: true },
        };
      },
    },
    {
      name: "ask_user",
      description: "Stop and ask the resident a question when unsure.",
      parameters: {
        type: "object",
        properties: { question: { type: "string" } },
        required: ["question"],
        additionalProperties: false,
      },
      external: false,
      terminal: "asked_user",
      run: (args) => {
        const question = str(args, "question");
        const r = askUser(question);
        return {
          input_summary: "Asked the resident a question.",
          observation_summary: "Paused with a question for the resident.",
          observation: r,
        };
      },
    },
    {
      name: "resolve_case",
      description: "Mark the case resolved when nothing further is needed.",
      parameters: {
        type: "object",
        properties: { reason: { type: "string" } },
        additionalProperties: false,
      },
      external: false,
      terminal: "resolved",
      run: (args) => {
        const reason = str(args, "reason");
        return {
          input_summary: "Closed out the case.",
          observation_summary: reason ? `Resolved: ${reason}` : "Marked the case resolved.",
          observation: { ok: true },
        };
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// Default chat client (Azure) + default persistence (Supabase)
// ---------------------------------------------------------------------------

let cachedAzure: AzureOpenAI | null = null;

/**
 * Build the default Azure chat client, mirroring `src/lib/data/azure.ts`: the
 * endpoint is the base URL only, the deployment name comes from
 * AZURE_OPENAI_DEPLOYMENT, and requests use `max_completion_tokens`. Returns
 * null when configuration is missing so the loop can fall back gracefully.
 */
function defaultChatClient(): ChatClient | null {
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const apiKey = process.env.AZURE_OPENAI_API_KEY;
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION;
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT;
  if (!endpoint || !apiKey || !apiVersion || !deployment) return null;

  if (!cachedAzure) {
    cachedAzure = new AzureOpenAI({ endpoint, apiKey, apiVersion, deployment, maxRetries: 0 });
  }
  const client = cachedAzure;

  return {
    async create(request) {
      const completion = await client.chat.completions.create({
        model: deployment,
        max_completion_tokens: request.max_completion_tokens,
        tools: request.tools,
        messages: request.messages as never,
      });
      return completion as unknown as ChatCompletion;
    },
  };
}

/**
 * Default persistence: checkpoint the case row after every step. Writes the
 * whole trace plus the current status/route/clock so a mid-run timeout leaves a
 * saved partial trace.
 */
const defaultPersist: CasePersistence = async (caseId, patch) => {
  await defaultDb("cases")
    .update({
      trace: patch.trace,
      status: patch.status,
      route: patch.route,
      clock_due_at: patch.clock_due_at,
      draft_text: patch.draft_text,
    })
    .eq("id", caseId);
};

// ---------------------------------------------------------------------------
// Timeout wrapper
// ---------------------------------------------------------------------------

/** Sentinel distinguishing a timed-out tool call from a real result. */
const TIMED_OUT = Symbol("tool-timed-out");

/**
 * Race a tool call against a 10s deadline. Resolves to {@link TIMED_OUT} on
 * timeout rather than throwing, so the loop can record a trace note and
 * continue (Req 5.6). The injected `now`-independent timer uses setTimeout so
 * fake timers in tests can drive it.
 */
async function withTimeout<T>(
  work: Promise<T> | T,
  timeoutMs: number,
): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), timeoutMs);
  });
  try {
    return await Promise.race([Promise.resolve(work), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = [
  "You are Threshold, an AI assistant helping a disabled Boston resident report",
  "an accessibility barrier. You are not the City of Boston and you give no legal",
  "advice. Investigate using the tools, then draft a filing and ask the resident",
  "to approve it. Routing: a blocked or broken sidewalk goes to Boston 311, but if",
  "two or more open reports already exist nearby, escalate to the Disabilities",
  "Commission instead of filing a duplicate. A missing curb ramp goes to the ADA",
  "Curb Ramp form. A city service that denied access because of disability goes to",
  "an ADA grievance. Never promise an outcome. Nothing is submitted without the",
  "resident's approval: always end a drafted filing with request_approval. If the",
  "photo is unclear, call ask_user. Keep every step to one tool call.",
].join(" ");

// ---------------------------------------------------------------------------
// The loop
// ---------------------------------------------------------------------------

/**
 * Append a trace step and persist the checkpoint. Returns the new trace so the
 * caller keeps working with the latest array.
 */
async function recordStep(
  trace: TraceStep[],
  input: { tool: string; input_summary: string; observation_summary: string; reasoning_note: string },
  status: CaseStatus,
  route: Route | null,
  clockDueAt: string | null,
  draftText: string | null,
  deps: RunDeps,
  caseId: string,
): Promise<TraceStep[]> {
  const next = appendStep(trace, input, deps.now());
  await deps.persist(caseId, {
    trace: next,
    status,
    route,
    clock_due_at: clockDueAt,
    draft_text: draftText,
  });
  return next;
}

/**
 * Run the Case Agent for one case. Drives Azure function-calling for up to 8
 * tool steps, persisting the trace after each step, and ends in exactly one
 * terminal state.
 *
 * Dependency injection: pass `deps` in tests to mock the chat client, the tool
 * table, the persistence writer, and the clock. Production callers omit `deps`
 * and get the real Azure + Supabase wiring; if Azure is not configured the run
 * ends `escalated` with a plain-language note rather than throwing.
 */
export async function runCaseAgent(
  input: RunInput,
  deps?: Partial<RunDeps>,
): Promise<RunResult> {
  const now = deps?.now ?? (() => new Date());
  const tools = deps?.tools ?? defaultTools();
  const persist = deps?.persist ?? defaultPersist;
  // Respect an explicitly provided chat dep even when it is null (the caller is
  // forcing the unavailable path); only fall back to Azure when `chat` was not
  // provided at all.
  const chat =
    deps && "chat" in deps ? (deps.chat ?? null) : defaultChatClient();

  const resolvedDeps: RunDeps = { chat: chat as ChatClient, tools, persist, now };

  const ctx: RunContext = {
    caseId: input.caseId,
    photoDataUrl: input.photoDataUrl,
    lat: input.lat,
    lng: input.lng,
    userMessage: input.userMessage,
    openedAt: input.openedAt ?? now(),
    now,
  };

  let trace: TraceStep[] = [];
  let route: Route | null = null;
  let clockDueAt: string | null = null;
  let draftText: string | null = null;

  const toolByName = new Map(tools.map((t) => [t.name, t]));

  // If the chat client is unavailable (misconfigured Azure), end escalated with
  // a plain-language note rather than crash (Req 22.2, 22.3).
  if (!chat) {
    trace = await recordStep(
      trace,
      {
        tool: "system",
        input_summary: "Tried to start the investigation.",
        observation_summary: "The assistant is not available right now.",
        reasoning_note:
          "Escalated so a person can help, because the assistant could not start.",
      },
      "escalated",
      route,
      clockDueAt,
      draftText,
      resolvedDeps,
      input.caseId,
    );
    return { status: "escalated", route, trace };
  }

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: [
        "A resident reported an accessibility barrier.",
        input.userMessage ? `They said: "${input.userMessage}".` : "",
        "Investigate with the tools and prepare a draft for their approval.",
      ]
        .filter(Boolean)
        .join(" "),
    },
  ];

  const toolDefs = tools.map((t) => ({
    type: "function" as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));

  for (let step = 0; step < MAX_TOOL_STEPS; step++) {
    // Ask the model for its next move. A chat failure is itself an external
    // call: record a note and keep going within the remaining budget.
    let completion: ChatCompletion | typeof TIMED_OUT;
    try {
      completion = await withTimeout(
        resolvedDeps.chat.create({
          messages,
          tools: toolDefs,
          max_completion_tokens: 700,
        }),
        TOOL_TIMEOUT_MS,
      );
    } catch {
      completion = TIMED_OUT;
    }

    if (completion === TIMED_OUT) {
      trace = await recordStep(
        trace,
        {
          tool: "assistant",
          input_summary: "Asked the assistant for the next step.",
          observation_summary: TIMEOUT_FALLBACK,
          reasoning_note: "The assistant was slow to respond; continuing.",
        },
        "investigating",
        route,
        clockDueAt,
        draftText,
        resolvedDeps,
        input.caseId,
      );
      continue;
    }

    const choice = completion.choices?.[0]?.message;
    const toolCall = choice?.tool_calls?.[0];

    // No tool call means the model is done talking without choosing a terminal
    // tool. Treat it as unsure and ask the resident (a terminal state), using
    // whatever text it returned as the question.
    if (!toolCall) {
      const question =
        (choice?.content && choice.content.trim()) ||
        "I need a bit more information to continue. Can you tell me more about the barrier?";
      trace = await recordStep(
        trace,
        {
          tool: "ask_user",
          input_summary: "Asked the resident a question.",
          observation_summary: "Paused with a question for the resident.",
          reasoning_note: "The assistant did not choose a next tool, so I asked the resident.",
        },
        "asked_user",
        route,
        clockDueAt,
        draftText,
        resolvedDeps,
        input.caseId,
      );
      void question;
      return { status: "asked_user", route, trace };
    }

    const spec = toolByName.get(toolCall.function.name);

    // Record the assistant's tool-call turn in the transcript.
    messages.push({
      role: "assistant",
      content: choice?.content ?? null,
      tool_calls: [toolCall],
    });

    if (!spec) {
      // The model asked for a tool we do not have. Note it and let it try again
      // within the remaining budget.
      const note = `I could not use "${toolCall.function.name}", so I skipped it.`;
      messages.push({ role: "tool", tool_call_id: toolCall.id, content: note });
      trace = await recordStep(
        trace,
        {
          tool: toolCall.function.name,
          input_summary: "Tried to use a tool that is not available.",
          observation_summary: note,
          reasoning_note: "Skipped an unknown tool and continued.",
        },
        "investigating",
        route,
        clockDueAt,
        draftText,
        resolvedDeps,
        input.caseId,
      );
      continue;
    }

    // Parse arguments defensively; bad JSON becomes empty args.
    let args: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(toolCall.function.arguments || "{}");
      if (parsed && typeof parsed === "object") args = parsed as Record<string, unknown>;
    } catch {
      args = {};
    }

    // Execute the tool, under the 10s timeout when it performs I/O.
    let outcome: ToolOutcome | typeof TIMED_OUT;
    if (spec.external) {
      outcome = await withTimeout(spec.run(args, ctx), TOOL_TIMEOUT_MS);
    } else {
      // Non-I/O tools are synchronous-ish; still await in case of a promise.
      outcome = await Promise.resolve(spec.run(args, ctx));
    }

    if (outcome === TIMED_OUT) {
      // Friendly, stack-trace-free fallback; continue within the budget (Req 5.6).
      messages.push({ role: "tool", tool_call_id: toolCall.id, content: TIMEOUT_FALLBACK });
      trace = await recordStep(
        trace,
        {
          tool: spec.name,
          input_summary: `Ran ${spec.name.replace(/_/g, " ")}.`,
          observation_summary: TIMEOUT_FALLBACK,
          reasoning_note: "The step timed out; I recorded it and moved on.",
        },
        "investigating",
        route,
        clockDueAt,
        draftText,
        resolvedDeps,
        input.caseId,
      );
      continue;
    }

    // Apply any route / clock / draft the tool decided on.
    if (outcome.route) route = outcome.route;
    if (outcome.clockDueAt) clockDueAt = outcome.clockDueAt;
    if (outcome.draftText) draftText = outcome.draftText;

    const status: CaseStatus = spec.terminal ?? "investigating";

    trace = await recordStep(
      trace,
      {
        tool: spec.name,
        input_summary: outcome.input_summary,
        observation_summary: outcome.observation_summary,
        reasoning_note: spec.terminal
          ? `Ended the run in state ${spec.terminal}.`
          : "Recorded the result and decided the next step.",
      },
      status,
      route,
      clockDueAt,
      draftText,
      resolvedDeps,
      input.caseId,
    );

    // A control-flow tool ends the run in its terminal state.
    if (spec.terminal) {
      return { status: spec.terminal, route, trace };
    }

    // Feed the observation back to the model for its next decision.
    messages.push({
      role: "tool",
      tool_call_id: toolCall.id,
      content: JSON.stringify(outcome.observation ?? {}),
    });
  }

  // Step cap reached with no terminal state: end escalated with a plain-language
  // note (Req 5.5).
  trace = await recordStep(
    trace,
    {
      tool: "system",
      input_summary: "Reached the maximum number of steps.",
      observation_summary:
        "I took the most steps I am allowed and could not finish on my own.",
      reasoning_note:
        "Escalated so a person can take over, because the step limit was reached.",
    },
    "escalated",
    route,
    clockDueAt,
    draftText,
    resolvedDeps,
    input.caseId,
  );
  return { status: "escalated", route, trace };
}
