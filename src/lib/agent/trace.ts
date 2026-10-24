/**
 * Case Agent trace: the ordered record of every tool step a run takes.
 *
 * Pure/deterministic helpers only. The sole impurity is the default `now` in
 * {@link appendStep}, which is injectable so callers in route handlers pass the
 * wall clock while tests pass a fixed instant. No `server-only`.
 *
 * Each step is appended to `cases.trace` (a jsonb array) and rendered to the
 * resident in plain language. Step indices are 1-based and strictly increasing.
 *
 * Requirements: 5.3
 */

/** One step in a Case Agent run's trace (the exact shape stored in jsonb). */
export interface TraceStep {
  /** 1-based, strictly increasing position within the run's trace. */
  step: number;
  /** The tool the agent invoked at this step. */
  tool: string;
  /** Plain-language summary of what the tool was asked to do. */
  input_summary: string;
  /** Plain-language summary of what the tool returned. */
  observation_summary: string;
  /** Why the agent chose this step. */
  reasoning_note: string;
  /** ISO 8601 timestamp of when the step was recorded. */
  at: string;
}

/**
 * The caller-supplied part of a step: everything except the auto-assigned
 * `step` index and `at` timestamp.
 */
export type TraceStepInput = Omit<TraceStep, 'step' | 'at'>;

/**
 * Append a step to an existing trace, returning a NEW array (the input is not
 * mutated). The appended step is assigned:
 *  - `step`: one greater than the current highest `step` in the trace, so the
 *    index is always 1-based and strictly increasing even if the array was
 *    built out of order;
 *  - `at`: the ISO 8601 string of `now`.
 *
 * `now` is injected (defaulting to the real clock only at the call site) so the
 * function stays deterministic and testable.
 */
export function appendStep(
  trace: readonly TraceStep[],
  input: TraceStepInput,
  now: Date = new Date(),
): TraceStep[] {
  const highest = trace.reduce((max, s) => (s.step > max ? s.step : max), 0);
  const next: TraceStep = {
    step: highest + 1,
    tool: input.tool,
    input_summary: input.input_summary,
    observation_summary: input.observation_summary,
    reasoning_note: input.reasoning_note,
    at: now.toISOString(),
  };
  return [...trace, next];
}

/**
 * Render a single step as a plain-language block for display. Lines are kept
 * short and labeled so a screen reader announces them clearly.
 */
export function formatStep(step: TraceStep): string {
  return [
    `Step ${step.step}: ${step.tool}`,
    `What I did: ${step.input_summary}`,
    `What I found: ${step.observation_summary}`,
    `Why: ${step.reasoning_note}`,
  ].join('\n');
}

/**
 * Render a whole trace as plain language, in step order, with a blank line
 * between steps. An empty trace renders a readable placeholder.
 */
export function formatTrace(trace: readonly TraceStep[]): string {
  if (trace.length === 0) return 'No steps yet.';
  return [...trace]
    .sort((a, b) => a.step - b.step)
    .map(formatStep)
    .join('\n\n');
}
