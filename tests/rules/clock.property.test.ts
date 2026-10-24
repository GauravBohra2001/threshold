import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { addDays } from "date-fns";
import {
  scheduleFollowUp,
  clampClockDueAt,
  MAX_FOLLOW_UP_DAYS,
} from "@/lib/rules/clock";

/**
 * Property 5: Clock lower-bound.
 *
 * For every open date and every day offset (including negatives and values
 * greater than 90), the scheduled follow-up instant `clock_due_at` must stay
 * within the closed window `[openDate, openDate + 90 days]`.
 *
 * Validates: Requirements 21.5, 8.1, 8.2
 * Feature: threshold, Property 5: Clock lower-bound
 */
describe("Feature: threshold, Property 5: Clock lower-bound", () => {
  // Sane open-date range: keeps dates well away from the Date epoch edges so
  // addDays(openDate, 90) never overflows into an Invalid Date.
  const openDateArb = fc.date({
    min: new Date("2000-01-01T00:00:00.000Z"),
    max: new Date("2100-01-01T00:00:00.000Z"),
    // fast-check can still emit an Invalid Date (NaN) within a bounded range
    // unless opted out. The clock operates on real dates, so exclude NaN.
    noInvalidDate: true,
  });

  // Day offsets include negatives and values far above the 90-day cap.
  const dayOffsetArb = fc.integer({ min: -1000, max: 1000 });

  it("scheduleFollowUp stays within [openDate, openDate + 90 days] for any offset", () => {
    fc.assert(
      fc.property(openDateArb, dayOffsetArb, (openDate, days) => {
        const due = scheduleFollowUp(openDate, days);
        const lower = openDate.getTime();
        const upper = addDays(openDate, MAX_FOLLOW_UP_DAYS).getTime();

        expect(due.getTime()).toBeGreaterThanOrEqual(lower);
        expect(due.getTime()).toBeLessThanOrEqual(upper);
      }),
      { numRuns: 200 },
    );
  });

  it("clampClockDueAt stays within [openDate, openDate + 90 days] for any requested instant", () => {
    fc.assert(
      fc.property(
        openDateArb,
        fc.date({
          min: new Date("1990-01-01T00:00:00.000Z"),
          max: new Date("2110-01-01T00:00:00.000Z"),
          noInvalidDate: true,
        }),
        (openDate, requested) => {
          const due = clampClockDueAt(openDate, requested);
          const lower = openDate.getTime();
          const upper = addDays(openDate, MAX_FOLLOW_UP_DAYS).getTime();

          expect(due.getTime()).toBeGreaterThanOrEqual(lower);
          expect(due.getTime()).toBeLessThanOrEqual(upper);
        },
      ),
      { numRuns: 200 },
    );
  });
});
