/**
 * Unit tests for the Case Agent loop (src/lib/agent/loop.ts).
 *
 * Azure (the chat client), the database (persistence), and the tool table are
 * all injected as fakes, so no live call is ever made. The behaviors asserted
 * map to the task's requirements:
 *  - a run that reaches `draft_ready` (Req 5.4);
 *  - the 8-step cap → `escalated` with a plain-language trace note (Req 5.5);
 *  - a tool timeout → plain-language trace note, friendly fallback, and the run
 *    continues within the remaining budget (Req 5.6, 22.2, 22.3);
 *  - the trace is persisted to the database after EVERY step (user requirement:
 *    checkpoint each step so a mid-run timeout never loses the whole run).
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  runCaseAgent,
  MAX_TOOL_STEPS,
  TOOL_TIMEOUT_MS,
  type ChatClient,
  type ChatCompletion,
  type ChatToolCall,
  type CasePersistence,
  type ToolSpec,
  type TerminalStatus,
} from "@/lib/agent/loop";
import type { TraceStep } from "@/lib/agent/trace";

const BASE_INPUT = {
  caseId: "case-1",
  photoDataUrl: "data:image/jpeg;base64,abc",
  lat: 42.3,
  lng: -71.07,
  openedAt: new Date("2025-02-01T00:00:00.000Z"),
};

/** Build an assistant message that requests a single tool call. */
function toolCallCompletion(name: string, args: Record<string, unknown> = {}): ChatCompletion {
  const toolCall: ChatToolCall = {
    id: `call-${name}`,
    type: "function",
    function: { name, arguments: JSON.stringify(args) },
  };
  return {
    choices: [{ message: { role: "assistant", content: null, tool_calls: [toolCall] } }],
  };
}

/** A chat client that returns a scripted sequence of completions, in order. */
function scriptedChat(sequence: ChatCompletion[]): ChatClient {
  let i = 0;
  return {
    create: vi.fn(async () => {
      const next = sequence[Math.min(i, sequence.length - 1)];
      i += 1;
      return next;
    }),
  };
}

/** A persistence spy that records every checkpoint it is asked to write. */
function recordingPersist(): {
  persist: CasePersistence;
  calls: Array<{ trace: TraceStep[]; status: string; route: string | null }>;
} {
  const calls: Array<{ trace: TraceStep[]; status: string; route: string | null }> = [];
  const persist: CasePersistence = vi.fn<CasePersistence>(async (_caseId, patch) => {
    // Clone the trace so later mutations cannot retroactively change a snapshot.
    calls.push({
      trace: patch.trace.map((s) => ({ ...s })),
      status: patch.status,
      route: patch.route,
    });
  });
  return { persist, calls };
}

/**
 * Build a minimal tool table for tests: an investigative `classify_photo`, a
 * terminal `request_approval` (→ draft_ready), and whatever extras are passed.
 */
function testTools(extra: ToolSpec[] = []): ToolSpec[] {
  const classify: ToolSpec = {
    name: "classify_photo",
    description: "classify",
    parameters: { type: "object", properties: {} },
    external: true,
    run: () => ({
      input_summary: "Looked at the photo.",
      observation_summary: "It is a blocked sidewalk.",
      observation: { barrier_type: "blocked_sidewalk" },
    }),
  };
  const approve: ToolSpec = {
    name: "request_approval",
    description: "approve",
    parameters: { type: "object", properties: { draft: { type: "string" } } },
    external: false,
    terminal: "draft_ready",
    run: () => ({
      input_summary: "Asked the resident to approve the draft.",
      observation_summary: "Paused for approval.",
      observation: { paused: true },
    }),
  };
  return [classify, approve, ...extra];
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("runCaseAgent — reaching a terminal state", () => {
  it("ends in draft_ready when the model calls request_approval (Req 5.4)", async () => {
    const chat = scriptedChat([
      toolCallCompletion("classify_photo"),
      toolCallCompletion("request_approval", { draft: "Please repair the sidewalk." }),
    ]);
    const { persist, calls } = recordingPersist();

    const result = await runCaseAgent(BASE_INPUT, {
      chat,
      persist,
      tools: testTools(),
      now: () => new Date("2025-02-01T00:00:00.000Z"),
    });

    expect(result.status).toBe<TerminalStatus>("draft_ready");
    // Exactly two steps were taken and recorded.
    expect(result.trace).toHaveLength(2);
    expect(result.trace[0].tool).toBe("classify_photo");
    expect(result.trace[1].tool).toBe("request_approval");
    // The final persisted checkpoint carries the terminal status.
    expect(calls.at(-1)?.status).toBe("draft_ready");
  });

  it("persists the trace after every step, growing by one each time", async () => {
    const chat = scriptedChat([
      toolCallCompletion("classify_photo"),
      toolCallCompletion("request_approval", { draft: "draft" }),
    ]);
    const { persist, calls } = recordingPersist();

    await runCaseAgent(BASE_INPUT, {
      chat,
      persist,
      tools: testTools(),
      now: () => new Date("2025-02-01T00:00:00.000Z"),
    });

    // One persist per step; each checkpoint has one more step than the last,
    // with strictly increasing step indices. A mid-run cutoff would therefore
    // leave a saved partial trace.
    expect(calls).toHaveLength(2);
    expect(calls[0].trace.map((s) => s.step)).toEqual([1]);
    expect(calls[1].trace.map((s) => s.step)).toEqual([1, 2]);
    expect(persist).toHaveBeenCalledTimes(2);
  });
});

describe("runCaseAgent — 8-step cap (Req 5.5)", () => {
  it("ends escalated with a plain-language note when no terminal tool is called", async () => {
    // The model always calls the investigative tool, never a terminal one.
    const chat = scriptedChat([toolCallCompletion("classify_photo")]);
    const { persist, calls } = recordingPersist();

    const result = await runCaseAgent(BASE_INPUT, {
      chat,
      persist,
      tools: testTools(),
      now: () => new Date("2025-02-01T00:00:00.000Z"),
    });

    expect(result.status).toBe<TerminalStatus>("escalated");
    // 8 tool steps + 1 appended cap note.
    expect(result.trace).toHaveLength(MAX_TOOL_STEPS + 1);
    const note = result.trace.at(-1)!;
    expect(note.tool).toBe("system");
    expect(note.observation_summary.toLowerCase()).toContain("steps");
    // No stack trace / internals leaked into the note.
    expect(note.observation_summary).not.toMatch(/error|stack|\bundefined\b|\{/i);
    // The escalation was checkpointed to the database.
    expect(calls.at(-1)?.status).toBe("escalated");
  });
});

describe("runCaseAgent — tool timeout (Req 5.6)", () => {
  it("records a plain-language note on timeout and continues to a terminal state", async () => {
    vi.useFakeTimers();

    // An external tool whose promise never resolves — it will be timed out.
    const slow: ToolSpec = {
      name: "search_nearby_311",
      description: "slow",
      parameters: { type: "object", properties: {} },
      external: true,
      run: () =>
        new Promise(() => {
          /* never resolves */
        }),
    };

    const chat = scriptedChat([
      toolCallCompletion("classify_photo"),
      toolCallCompletion("search_nearby_311"),
      toolCallCompletion("request_approval", { draft: "draft" }),
    ]);
    const { persist, calls } = recordingPersist();

    const pending = runCaseAgent(BASE_INPUT, {
      chat,
      persist,
      tools: testTools([slow]),
      now: () => new Date("2025-02-01T00:00:00.000Z"),
    });

    // Drive every pending timer (the chat races + the one real tool timeout)
    // until the run settles.
    await vi.runAllTimersAsync();
    const result = await pending;

    expect(result.status).toBe<TerminalStatus>("draft_ready");

    // The timed-out step is recorded with a friendly, stack-trace-free note and
    // the run continued past it (three steps total).
    const timedOut = result.trace.find((s) => s.tool === "search_nearby_311");
    expect(timedOut).toBeDefined();
    expect(timedOut!.observation_summary).not.toMatch(/error|stack|\{/i);
    expect(timedOut!.observation_summary.length).toBeGreaterThan(0);
    expect(result.trace.map((s) => s.tool)).toEqual([
      "classify_photo",
      "search_nearby_311",
      "request_approval",
    ]);
    // Each step, including the timed-out one, was checkpointed.
    expect(calls).toHaveLength(3);
  });

  it(`uses a ${TOOL_TIMEOUT_MS}ms deadline for external tools`, () => {
    // Guard against an accidental change to the per-call timeout (Req 5.6).
    expect(TOOL_TIMEOUT_MS).toBe(10_000);
  });
});

describe("runCaseAgent — unavailable assistant", () => {
  it("ends escalated with a plain-language note when the chat client is null", async () => {
    const { persist, calls } = recordingPersist();

    const result = await runCaseAgent(BASE_INPUT, {
      // Force the unavailable path without touching Azure env.
      chat: null as unknown as ChatClient,
      persist,
      tools: testTools(),
      now: () => new Date("2025-02-01T00:00:00.000Z"),
    });

    expect(result.status).toBe<TerminalStatus>("escalated");
    expect(result.trace).toHaveLength(1);
    expect(result.trace[0].observation_summary).not.toMatch(/error|stack|\{/i);
    expect(calls).toHaveLength(1);
  });
});
