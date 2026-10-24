"use client";

import { useEffect, useRef, useState } from "react";

import LiveRegion from "@/components/LiveRegion";
import ProcessTrace, { type ProcessStep } from "@/components/ui/ProcessTrace";
import type { TraceStep } from "@/lib/agent/trace";

/**
 * TraceView renders a Case Agent run as the hero "Case Agent trace" screen
 * (ui-design.md, hero screen 1): a photo thumbnail at the top, then the
 * ProcessTrace streaming the agent's steps as one plain sentence each with
 * optional data chips.
 *
 * Each trace step becomes one ProcessStep. The step markers reflect progress:
 * while the run is still working, the last step shown is the "current" step
 * (filled with --tactile) and the earlier steps are "finished" (--accent);
 * once the run is done, every step is "finished".
 *
 * Newly appended steps are announced within 3 seconds via a polite aria-live
 * region (Req 5.3): whenever the step count grows, this component announces
 * the latest step's sentence so VoiceOver / TalkBack reads it without moving
 * focus. The announcement updates synchronously on render, so it is available
 * to assistive tech as soon as the new step paints, well inside 3 seconds.
 *
 * This is a presentational, reusable component: the case detail page (task
 * 16.2) owns fetching/polling the case and passes the current trace array plus
 * the photo thumbnail. It renders the trace only; the approval card and the
 * BOS:311 handoff are owned by the case detail page.
 *
 * Built to WCAG 2.2 AA guidelines and tested with VoiceOver.
 * Requirements: 5.3, 23.9.
 */

export interface TraceViewProps {
  /** The case trace, in step order (TraceStep from the agent). */
  trace: readonly TraceStep[];
  /** Signed thumbnail URL for the barrier photo, or null when unavailable. */
  photoUrl: string | null;
  /** Alt text for the photo thumbnail (plain language). */
  photoAlt: string;
  /**
   * Whether the agent run is still working. When true the latest step is
   * marked "current"; when false every step is "finished". Defaults to false.
   */
  working?: boolean;
  /** Optional accessible label for the process list. */
  label?: string;
}

/** Build the one-sentence summary shown for a step (plain language). */
function stepSentence(step: TraceStep): string {
  const parts = [step.input_summary, step.observation_summary].filter(
    (part) => typeof part === "string" && part.trim().length > 0,
  );
  const sentence = parts.join(" ").trim();
  return sentence.length > 0 ? sentence : `Ran ${step.tool}.`;
}

/**
 * Derive the optional data chips for a step. The reasoning note is shown as a
 * chip when present so the "why" stays visible without a second sentence.
 */
function stepChips(step: TraceStep): string[] | undefined {
  const note = step.reasoning_note?.trim();
  return note && note.length > 0 ? [note] : undefined;
}

export default function TraceView({
  trace,
  photoUrl,
  photoAlt,
  working = false,
  label = "What the assistant did",
}: TraceViewProps) {
  // The latest step's sentence, announced politely whenever a new step lands.
  const [announcement, setAnnouncement] = useState("");
  const lastCountRef = useRef(0);

  useEffect(() => {
    if (trace.length > lastCountRef.current) {
      const latest = trace[trace.length - 1];
      setAnnouncement(`Step ${latest.step}. ${stepSentence(latest)}`);
    }
    lastCountRef.current = trace.length;
  }, [trace]);

  const steps: ProcessStep[] = [...trace]
    .sort((a, b) => a.step - b.step)
    .map((step, index, sorted) => {
      const isLast = index === sorted.length - 1;
      const state: ProcessStep["state"] =
        working && isLast ? "current" : "finished";
      return {
        sentence: stepSentence(step),
        chips: stepChips(step),
        state,
      };
    });

  return (
    <section aria-label={label} className="flex flex-col gap-6">
      {/* Newly appended steps are announced within 3s (Req 5.3). */}
      <LiveRegion politeness="polite">{announcement}</LiveRegion>

      {photoUrl ? (
        <>
          {/* Short-lived signed URL; not a stable asset. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={photoUrl}
            alt={photoAlt}
            className="h-40 w-full rounded-[12px] border border-line object-cover"
          />
        </>
      ) : (
        <div
          role="img"
          aria-label={photoAlt}
          className="flex h-40 w-full items-center justify-center rounded-[12px] border border-line bg-bg px-3 text-center text-muted"
        >
          <span className="text-[16px]">Photo not available</span>
        </div>
      )}

      {steps.length > 0 ? (
        <ProcessTrace steps={steps} label={label} />
      ) : (
        <p className="text-muted">
          {working
            ? "Looking into your report now."
            : "No steps to show yet."}
        </p>
      )}
    </section>
  );
}
