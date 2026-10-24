import type { ReactNode } from "react";

export interface ProcessStep {
  /** One plain sentence describing the step. */
  sentence: string;
  /** Optional data chips, e.g. "3 open reports within 75 m". */
  chips?: string[];
  state?: "finished" | "current" | "upcoming";
}

export interface ProcessTraceProps {
  steps: ProcessStep[];
  label?: string;
}

/**
 * A process list (USWDS pattern) for the Case Agent trace: a numbered vertical
 * sequence. Each step has a numbered circle marker, one sentence, and optional
 * data chips. The current step's marker is filled with --tactile; finished
 * steps use --accent. No side bars (ui-design.md).
 */
export default function ProcessTrace({ steps, label }: ProcessTraceProps) {
  return (
    <ol aria-label={label} className="flex flex-col gap-4">
      {steps.map((step, index) => {
        const state = step.state ?? "upcoming";
        const marker =
          state === "current"
            ? "bg-tactile text-ink"
            : state === "finished"
              ? "bg-accent text-on-accent"
              : "bg-surface text-ink border border-control-border";
        return (
          <li key={index} className="flex items-start gap-3">
            <span
              aria-hidden="true"
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full font-bold ${marker}`}
            >
              {index + 1}
            </span>
            <div className="pt-1">
              <p className="text-ink">{step.sentence}</p>
              {step.chips && step.chips.length > 0 ? (
                <ul className="mt-2 flex flex-wrap gap-2">
                  {step.chips.map((chip) => (
                    <li
                      key={chip}
                      className="rounded-full border border-control-border px-3 py-1 text-[16px] text-ink"
                    >
                      {chip}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export type { ReactNode as ProcessTraceNode };
