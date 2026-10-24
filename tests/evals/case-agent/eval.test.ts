/**
 * Thin executor for the Case Agent eval runner.
 *
 * `npm run eval` invokes this file through vitest, which is the only offline
 * TypeScript runner installed and which applies the `@` and `server-only`
 * module aliases from vitest.config.mts (so the server-only agent loop imports
 * without a live bundle). All of the real work — running 36 trials, printing
 * per-task results + overall success rate + pass^3, and writing transcripts to
 * tests/evals/results/ — lives in run-eval.ts's `main()`, which reads as a
 * standalone runner. This file just executes it and asserts the outcome gate.
 *
 * Requirements: 9.1, 9.2, 9.3, 9.4, 9.5
 */

import { describe, it, expect } from "vitest";

import { main } from "./run-eval";

describe("Case Agent evaluation suite (fixture 311 data, no live calls)", () => {
  it("passes every task across all 3 trials (pass^3 = 100%)", async () => {
    const summary = await main({ write: true });

    // The suite must exercise exactly 12 tasks x 3 trials = 36 trials (Req 9.2, 9.3).
    expect(summary.tasks).toHaveLength(12);
    expect(summary.totalTrials).toBe(36);

    // Every trial should pass: correct route+status, no leaked synthetic
    // address, approval before ready, and stated counts matching tool output.
    expect(summary.passedTrials).toBe(36);
    expect(summary.successRate).toBe(1);
    expect(summary.passCubed).toBe(1);
  }, 30_000);
});
