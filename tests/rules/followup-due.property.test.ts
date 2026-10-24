import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { isFollowUpDue, simNow } from "@/lib/rules/clock";

/**
 * Property 6: Follow-up due equivalence.
 *
 * For all clocks and non-negative simulated-time offsets, a follow-up is due if
 * and only if the current time plus the simulated offset is strictly later than
 * `clock_due_at`, and not due otherwise.
 *
 * Invariant:
 *   isFollowUpDue(dueDate, simNow({ sim_offset_days: offset }, now))
 *     === (simNow(...) > dueDate)
 *
 * Validates: Requirements 21.6, 8.4, 8.7
 */
describe("Feature: threshold, Property 6: Follow-up due equivalence", () => {
  it("marks a follow-up due iff the simulated instant is strictly later than the due date", () => {
    fc.assert(
      fc.property(
        fc.date(),
        fc.date(),
        // Non-negative offset bounded to a reasonable range (0..3650 days).
        fc.nat({ max: 3650 }),
        (dueDate, now, offset) => {
          const sim = simNow({ sim_offset_days: offset }, now);
          const expected = sim.getTime() > dueDate.getTime();
          expect(isFollowUpDue(dueDate, sim)).toBe(expected);
        },
      ),
      { numRuns: 200 },
    );
  });
});
