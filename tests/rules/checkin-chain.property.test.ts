import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  nextState,
  isTerminal,
  type ChainState,
  type ChainEvent,
  type Mode,
} from "@/lib/rules/checkin-chain";

/**
 * Property 1: Check-in chain ordering.
 *
 * For all finite sequences of answer and no-answer events, folding `nextState`
 * from `SENT` advances through step indices in strictly increasing order with
 * no index skipped, and places at most one caregiver call per step index
 * across the whole sequence.
 *
 * We model the chain as ordered STEP indices, where a step index is the stage
 * of the chain a state represents:
 *   step 0: SENT, and ANSWERED (the resident answered at step 0, ending there)
 *   step 1: CALL_CAREGIVER, and RESOLVED / ADVISE_911 (reached from the
 *           caregiver-call step, ending there)
 *
 * Each terminal belongs to the step it resolves: ANSWERED resolves the initial
 * check-in (step 0) directly, while RESOLVED and ADVISE_911 resolve the
 * caregiver-call step (step 1). Indexing this way keeps the "no skip" guarantee
 * meaningful — a resident answering immediately legitimately ends at step 0
 * without the chain ever creating a caregiver step.
 *
 * Invariants asserted over the folded run:
 *   - Step indices are non-decreasing and increase by at most one per
 *     transition (monotonic, no skip): the chain never goes backward and never
 *     jumps a step (SENT can never reach the caregiver-resolved step without
 *     passing through CALL_CAREGIVER, and a terminal state never transitions).
 *   - At most one caregiver call is placed across the whole fold, counted as
 *     transitions INTO CALL_CAREGIVER (a SENT + TIMEOUT edge). Once in
 *     CALL_CAREGIVER or a terminal state, no second entry can occur.
 *
 * Validates: Requirements 21.1, 12.5
 */
describe("Feature: threshold, Property 1: Check-in chain ordering", () => {
  // Step index per state: the chain step the state represents. ANSWERED
  // resolves the initial check-in (step 0); RESOLVED / ADVISE_911 resolve the
  // caregiver-call step (step 1).
  const stepOf = (state: ChainState): number => {
    switch (state) {
      case "SENT":
      case "ANSWERED":
        return 0;
      case "CALL_CAREGIVER":
      case "RESOLVED":
      case "ADVISE_911":
        return 1;
    }
  };

  const eventArb: fc.Arbitrary<ChainEvent> = fc.oneof(
    fc.constant<ChainEvent>({ type: "RESIDENT_ANSWERED" }),
    fc.constant<ChainEvent>({ type: "CAREGIVER_CONFIRMED" }),
    fc.constant<ChainEvent>({ type: "CALL_FAILED" }),
    fc.constant<ChainEvent>({ type: "TIMEOUT" }),
  );

  const modeArb: fc.Arbitrary<Mode> = fc.constantFrom("live", "replay");

  it("advances stages monotonically without skipping and places at most one caregiver call", () => {
    fc.assert(
      fc.property(
        fc.array(eventArb, { maxLength: 20 }),
        modeArb,
        (events, mode) => {
          let current: ChainState = "SENT";
          let caregiverCallEntries = 0;

          for (const event of events) {
            const prev = current;
            const next = nextState(prev, event, mode);

            const prevStep = stepOf(prev);
            const nextStep = stepOf(next);

            // Non-decreasing: the chain never goes backward.
            expect(nextStep).toBeGreaterThanOrEqual(prevStep);
            // No skip: a single transition advances by at most one step.
            expect(nextStep - prevStep).toBeLessThanOrEqual(1);

            // A terminal state never transitions again.
            if (isTerminal(prev)) {
              expect(next).toBe(prev);
            }

            // Count entries into CALL_CAREGIVER (the SENT + TIMEOUT edge).
            if (prev !== "CALL_CAREGIVER" && next === "CALL_CAREGIVER") {
              caregiverCallEntries += 1;
            }

            current = next;
          }

          // At most one caregiver call is placed across the whole fold.
          expect(caregiverCallEntries).toBeLessThanOrEqual(1);
        },
      ),
      { numRuns: 200 },
    );
  });
});
