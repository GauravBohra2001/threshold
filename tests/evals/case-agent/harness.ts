/**
 * Eval harness: run a single task as isolated trials against fixture 311 data.
 *
 * Determinism (why a scripted chat client): the real agent drives Azure OpenAI,
 * which is non-deterministic, so a replayed live model would make the eval
 * flaky and would require a network call. Instead each trial is driven by a
 * SCRIPTED ChatClient that returns a fixed tool-call sequence (task.script).
 * That sequence encodes the intended agent behavior for the task. The graders
 * then check the resulting OUTCOMES (final route + status, approval before
 * ready, no leaked address, stated counts), never the order of tool calls, so
 * the eval measures the agent's wiring and outcome guarantees reproducibly and
 * fully offline (Req 9.1, 9.3, 9.4).
 *
 * Fixtures only (Req 9.1): `search_nearby_311` is wired to the real tool with a
 * fixture `searchNearbyOpen` injected, so the real privacy guard and distance
 * filter run but NO live Boston 311 call happens. `classify_photo` returns the
 * task's scripted classification instead of calling Azure. All other tools use
 * their real implementations (real drafting, real approval gate).
 *
 * Isolation (Req 9.3): every trial builds a fresh tool table, a fresh scripted
 * chat client, and a no-op persistence, so no state leaks between trials.
 *
 * Requirements: 9.1, 9.3, 9.4
 */

import {
  runCaseAgent,
  type ChatClient,
  type ChatCompletion,
  type ChatToolCall,
  type CasePersistence,
  type ToolSpec,
  type RunResult,
} from "@/lib/agent/loop";
import type { ClientResult, NearbyReport } from "@/lib/data/boston311";
import {
  searchNearby311,
  draftFiling,
  requestApproval,
  scheduleFollowup,
  askUser,
  notifyCaregiver,
  type DraftFacts,
} from "@/lib/agent/tools";
import type { Route } from "@/lib/rules/routing";

import { FIXTURE_ORIGIN, type FixtureReport } from "./fixtures";
import type { EvalTask, ScriptedCall } from "./tasks";

/** A fixed, reproducible instant for every trial (keeps age/overdue stable). */
export const FIXTURE_NOW = new Date("2025-10-01T00:00:00.000Z");

/** Everything one trial records for grading and for the written transcript. */
export interface TrialRecord {
  taskId: string;
  trial: number;
  result: RunResult;
  /** What the (faked) search_nearby_311 tool actually returned (for grading). */
  nearbyObservation:
    | { ok: true; open_count: number; oldest_open_age_days: number; overdue_count: number }
    | { ok: false; error: string }
    | null;
  /** Whether request_approval was called before anything reached draft_ready. */
  approvalBeforeReady: boolean;
  /** The real draft text the draft_filing tool produced, if any. */
  draftText: string | null;
  /** Full serialized text of every output surface, used by the privacy grader. */
  outputText: string;
}

function str(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  return typeof v === "string" ? v : "";
}

function num(args: Record<string, unknown>, key: string, fallback: number): number {
  const v = args[key];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/**
 * A scripted chat client: issues the task's fixed tool-call sequence, one tool
 * call per chat turn, in order. After the sequence is exhausted it repeats the
 * last call (the loop will already have hit a terminal tool by then).
 */
function scriptedChat(script: ScriptedCall[]): ChatClient {
  let i = 0;
  return {
    create: async (): Promise<ChatCompletion> => {
      const call = script[Math.min(i, script.length - 1)];
      i += 1;
      const toolCall: ChatToolCall = {
        id: `call-${call.tool}-${i}`,
        type: "function",
        function: { name: call.tool, arguments: JSON.stringify(call.args ?? {}) },
      };
      return {
        choices: [{ message: { role: "assistant", content: null, tool_calls: [toolCall] } }],
      };
    },
  };
}

/**
 * Build a fixture-backed `searchNearbyOpen` that returns the task's synthetic
 * reports (as aggregate-safe `NearbyReport`s, i.e. WITHOUT the private
 * `full_address`/`neighborhood`/`on_time` fields). The real `searchNearby311`
 * tool then runs the real distance filter and privacy guard over them.
 */
function fixtureSearchNearbyOpen(reports: FixtureReport[]) {
  return async (): Promise<ClientResult<NearbyReport[]>> => {
    const data: NearbyReport[] = reports.map((r) => ({
      case_id: r.case_id,
      service_name: r.service_name,
      open_date: r.open_date,
      case_status: r.case_status,
      target_close_date: r.target_close_date,
      latitude: r.latitude,
      longitude: r.longitude,
    }));
    return { ok: true, data };
  };
}

/**
 * Build a fresh tool table for one trial. `classify_photo` returns the task's
 * scripted classification; `search_nearby_311` uses the real tool with fixture
 * data injected; every other tool uses its real implementation. A mutable
 * `captured` object records the nearby observation for the grader.
 */
function buildTools(
  task: EvalTask,
  captured: { nearby: TrialRecord["nearbyObservation"]; draftText: string | null },
): ToolSpec[] {
  const classify: ToolSpec = {
    name: "classify_photo",
    description: "Classify the barrier photo (scripted in evals).",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    external: true,
    run: () => ({
      input_summary: "Looked at the photo to identify the barrier.",
      observation_summary: `Identified a ${task.classify.barrier_type.replace(/_/g, " ")} (confidence ${Math.round(
        task.classify.confidence * 100,
      )}%).`,
      observation: task.classify,
    }),
  };

  const searchNearby: ToolSpec = {
    name: "search_nearby_311",
    description: "Count open 311 reports near the barrier (fixture data in evals).",
    parameters: {
      type: "object",
      properties: {
        radius_m: { type: "number" },
        service_names: { type: "array", items: { type: "string" } },
      },
      additionalProperties: false,
    },
    external: true,
    run: async (args) => {
      const radius = num(args, "radius_m", 75);
      const serviceNames = Array.isArray(args.service_names)
        ? (args.service_names as unknown[]).filter((s): s is string => typeof s === "string")
        : undefined;
      const r = await searchNearby311(
        FIXTURE_ORIGIN.lat,
        FIXTURE_ORIGIN.lng,
        radius,
        serviceNames,
        { searchNearbyOpen: fixtureSearchNearbyOpen(task.reports) },
        FIXTURE_NOW,
      );
      captured.nearby = r;
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
  };

  const draft: ToolSpec = {
    name: "draft_filing",
    description: "Write a plain-language draft for the chosen route (real impl).",
    parameters: {
      type: "object",
      properties: {
        route: { type: "string" },
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
      // Record the real draft text so the next turn's request_approval can carry
      // it (as a real agent would) and the graders can inspect it.
      captured.draftText = r.draft_text;
      return {
        input_summary: `Drafted a filing for ${route.replace(/_/g, " ")}.`,
        observation_summary: "Prepared a draft for the resident to review.",
        observation: r,
        route,
      };
    },
  };

  const approval: ToolSpec = {
    name: "request_approval",
    description: "Stop and show the draft for approval. Nothing is auto-submitted.",
    parameters: {
      type: "object",
      properties: { draft: { type: "string" } },
      required: ["draft"],
      additionalProperties: false,
    },
    external: false,
    terminal: "draft_ready",
    run: (args) => {
      // A real agent passes the draft it just produced. The scripted call uses
      // a "placeholder" sentinel; substitute the real draft text captured from
      // the draft_filing step so the approval prompt carries the true draft.
      const scripted = str(args, "draft");
      const draft = scripted === "placeholder" && captured.draftText ? captured.draftText : scripted;
      const r = requestApproval(draft);
      return {
        input_summary: "Asked the resident to review and approve the draft.",
        observation_summary: "Paused for the resident to approve or edit the draft.",
        observation: r,
      };
    },
  };

  const schedule: ToolSpec = {
    name: "schedule_followup",
    description: "Set a follow-up date in days from open (real impl).",
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
  };

  const notify: ToolSpec = {
    name: "notify_caregiver",
    description: "Record an in-app notice for the caregiver (never a call).",
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
  };

  const ask: ToolSpec = {
    name: "ask_user",
    description: "Stop and ask the resident a question when unsure (real impl).",
    parameters: {
      type: "object",
      properties: { question: { type: "string" } },
      required: ["question"],
      additionalProperties: false,
    },
    external: false,
    terminal: "asked_user",
    run: (args) => {
      const r = askUser(str(args, "question"));
      return {
        input_summary: "Asked the resident a question.",
        observation_summary: "Paused with a question for the resident.",
        observation: r,
      };
    },
  };

  return [classify, searchNearby, draft, approval, schedule, notify, ask];
}

/**
 * Serialize every output surface of a run into one text blob for the privacy
 * grader: the whole trace (summaries + reasoning), the final status/route, and
 * the captured nearby observation. If any synthetic address can leak, it leaks
 * into one of these.
 */
function serializeOutput(record: Omit<TrialRecord, "outputText">): string {
  return JSON.stringify({
    result: record.result,
    nearby: record.nearbyObservation,
    draftText: record.draftText,
  });
}

/** Run one isolated trial of a task and return its record. */
export async function runTrial(task: EvalTask, trial: number): Promise<TrialRecord> {
  const captured: { nearby: TrialRecord["nearbyObservation"]; draftText: string | null } = {
    nearby: null,
    draftText: null,
  };
  const tools = buildTools(task, captured);

  // No-op persistence: the eval never touches a database (Req 9.1). We also use
  // it to detect whether anything reached draft_ready BEFORE request_approval
  // was recorded — the approval-gate grader (Req 7, 9.4).
  let sawApproval = false;
  let readyBeforeApproval = false;
  const persist: CasePersistence = async (_caseId, patch) => {
    const lastTool = patch.trace.at(-1)?.tool;
    if (lastTool === "request_approval") sawApproval = true;
    if (patch.status === "draft_ready" && !sawApproval) readyBeforeApproval = true;
  };

  const result = await runCaseAgent(
    {
      caseId: `${task.id}-trial-${trial}`,
      photoDataUrl: "data:image/jpeg;base64,ZmFrZQ==",
      lat: FIXTURE_ORIGIN.lat,
      lng: FIXTURE_ORIGIN.lng,
      userMessage: task.userMessage,
      openedAt: new Date("2025-09-25T00:00:00.000Z"),
    },
    {
      chat: scriptedChat(task.script),
      tools,
      persist,
      now: () => FIXTURE_NOW,
    },
  );

  const partial: Omit<TrialRecord, "outputText"> = {
    taskId: task.id,
    trial,
    result,
    nearbyObservation: captured.nearby,
    approvalBeforeReady: result.status === "draft_ready" ? !readyBeforeApproval : true,
    draftText: captured.draftText,
  };

  return { ...partial, outputText: serializeOutput(partial) };
}
