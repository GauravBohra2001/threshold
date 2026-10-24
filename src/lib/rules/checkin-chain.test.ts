import { describe, expect, it } from "vitest";

import {
  LIVE_TIMEOUT_MS,
  MIN_LIVE_CALL_GAP_MS,
  REPLAY_TIMEOUT_MS,
  isTerminal,
  mayPlaceLiveCall,
  nextState,
  outcomeFor,
  timeoutMs,
  type ChainState,
} from "./checkin-chain";

describe("timeoutMs", () => {
  it("is 90s live and 15s replay", () => {
    expect(timeoutMs("live")).toBe(90_000);
    expect(timeoutMs("replay")).toBe(15_000);
    expect(LIVE_TIMEOUT_MS).toBe(90_000);
    expect(REPLAY_TIMEOUT_MS).toBe(15_000);
  });
});

describe("nextState transition table", () => {
  it("SENT + RESIDENT_ANSWERED -> ANSWERED (no call)", () => {
    expect(nextState("SENT", { type: "RESIDENT_ANSWERED" }, "live")).toBe("ANSWERED");
  });

  it("SENT + TIMEOUT -> CALL_CAREGIVER", () => {
    expect(nextState("SENT", { type: "TIMEOUT" }, "live")).toBe("CALL_CAREGIVER");
  });

  it("CALL_CAREGIVER + CAREGIVER_CONFIRMED -> RESOLVED", () => {
    expect(nextState("CALL_CAREGIVER", { type: "CAREGIVER_CONFIRMED" }, "live")).toBe(
      "RESOLVED",
    );
  });

  it("CALL_CAREGIVER + CALL_FAILED -> ADVISE_911 (no retry)", () => {
    expect(nextState("CALL_CAREGIVER", { type: "CALL_FAILED" }, "live")).toBe("ADVISE_911");
  });

  it("CALL_CAREGIVER + TIMEOUT -> ADVISE_911", () => {
    expect(nextState("CALL_CAREGIVER", { type: "TIMEOUT" }, "live")).toBe("ADVISE_911");
  });

  it("does not skip a step: SENT never jumps straight to RESOLVED or ADVISE_911", () => {
    expect(nextState("SENT", { type: "CAREGIVER_CONFIRMED" }, "live")).toBe("SENT");
    expect(nextState("SENT", { type: "CALL_FAILED" }, "live")).toBe("SENT");
  });

  it("terminal states are unchanged by any event", () => {
    const terminals: ChainState[] = ["ANSWERED", "RESOLVED", "ADVISE_911"];
    const events = [
      { type: "RESIDENT_ANSWERED" },
      { type: "CAREGIVER_CONFIRMED" },
      { type: "CALL_FAILED" },
      { type: "TIMEOUT" },
    ] as const;
    for (const state of terminals) {
      for (const event of events) {
        expect(nextState(state, event, "replay")).toBe(state);
      }
    }
  });

  it("mode does not change the transition graph", () => {
    expect(nextState("SENT", { type: "TIMEOUT" }, "live")).toBe(
      nextState("SENT", { type: "TIMEOUT" }, "replay"),
    );
  });
});

describe("isTerminal", () => {
  it("flags ANSWERED, RESOLVED, ADVISE_911 as terminal", () => {
    expect(isTerminal("ANSWERED")).toBe(true);
    expect(isTerminal("RESOLVED")).toBe(true);
    expect(isTerminal("ADVISE_911")).toBe(true);
    expect(isTerminal("SENT")).toBe(false);
    expect(isTerminal("CALL_CAREGIVER")).toBe(false);
  });
});

describe("outcomeFor", () => {
  it("maps states to the recorded outcome", () => {
    expect(outcomeFor("ANSWERED")).toBe("answered");
    expect(outcomeFor("CALL_CAREGIVER")).toBe("caregiver_called");
    expect(outcomeFor("RESOLVED")).toBe("caregiver_called");
    expect(outcomeFor("ADVISE_911")).toBe("advise_911");
    expect(outcomeFor("SENT")).toBeNull();
  });
});

describe("mayPlaceLiveCall", () => {
  const now = new Date("2026-02-01T00:00:00.000Z");

  it("is false whenever live calling is not allowed", () => {
    expect(mayPlaceLiveCall(false, null, now)).toBe(false);
    expect(mayPlaceLiveCall(false, new Date(0), now)).toBe(false);
  });

  it("allows a call when no prior call exists and live is allowed", () => {
    expect(mayPlaceLiveCall(true, null, now)).toBe(true);
  });

  it("allows a call only after at least 2 minutes have elapsed", () => {
    const justUnder = new Date(now.getTime() - (MIN_LIVE_CALL_GAP_MS - 1));
    const exactly = new Date(now.getTime() - MIN_LIVE_CALL_GAP_MS);
    const over = new Date(now.getTime() - (MIN_LIVE_CALL_GAP_MS + 1));
    expect(mayPlaceLiveCall(true, justUnder, now)).toBe(false);
    expect(mayPlaceLiveCall(true, exactly, now)).toBe(true);
    expect(mayPlaceLiveCall(true, over, now)).toBe(true);
  });
});
