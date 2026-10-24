import { addDays } from "date-fns";
import { describe, expect, it } from "vitest";

import {
  clampClockDueAt,
  fastForward,
  FAST_FORWARD_DAYS,
  isFollowUpDue,
  MAX_FOLLOW_UP_DAYS,
  scheduleFollowUp,
  simNow,
} from "./clock";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("simNow", () => {
  it("shifts the injected now forward by sim_offset_days", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const result = simNow({ sim_offset_days: 14 }, now);
    expect(result.getTime()).toBe(now.getTime() + 14 * DAY_MS);
  });

  it("returns now unchanged when the offset is zero", () => {
    const now = new Date("2026-01-01T12:00:00.000Z");
    expect(simNow({ sim_offset_days: 0 }, now).getTime()).toBe(now.getTime());
  });
});

describe("fastForward", () => {
  it("adds exactly 14 days to the offset", () => {
    expect(fastForward(0)).toBe(FAST_FORWARD_DAYS);
    expect(fastForward(14)).toBe(28);
  });
});

describe("clampClockDueAt / scheduleFollowUp", () => {
  const openDate = new Date("2026-01-01T00:00:00.000Z");
  // Calendar-aware upper bound (matches the module, which uses date-fns addDays
  // rather than raw ms math, so it stays correct across DST boundaries).
  const upper = addDays(openDate, MAX_FOLLOW_UP_DAYS);

  it("keeps a value inside the window", () => {
    const result = scheduleFollowUp(openDate, 7);
    expect(result.getTime()).toBe(addDays(openDate, 7).getTime());
  });

  it("clamps a negative request up to the open date", () => {
    expect(scheduleFollowUp(openDate, -5).getTime()).toBe(openDate.getTime());
  });

  it("clamps a request beyond 90 days down to the upper bound", () => {
    expect(scheduleFollowUp(openDate, 200).getTime()).toBe(upper.getTime());
  });

  it("clampClockDueAt never returns outside [openDate, openDate + 90 days]", () => {
    const tooEarly = new Date(openDate.getTime() - 1000 * DAY_MS);
    const tooLate = new Date(openDate.getTime() + 1000 * DAY_MS);
    expect(clampClockDueAt(openDate, tooEarly).getTime()).toBe(openDate.getTime());
    expect(clampClockDueAt(openDate, tooLate).getTime()).toBe(upper.getTime());
  });
});

describe("isFollowUpDue", () => {
  const due = new Date("2026-02-01T00:00:00.000Z");

  it("is true only when simNow is strictly later than the due date", () => {
    expect(isFollowUpDue(due, new Date(due.getTime() + 1))).toBe(true);
    expect(isFollowUpDue(due, new Date(due.getTime()))).toBe(false);
    expect(isFollowUpDue(due, new Date(due.getTime() - 1))).toBe(false);
  });
});
