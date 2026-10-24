import type { ReactNode } from "react";

export type Politeness = "polite" | "assertive";

export interface LiveRegionProps {
  /**
   * The message to announce. When this changes, assistive technology reads the
   * new content. An empty value announces nothing.
   */
  children?: ReactNode;
  /**
   * How urgently screen readers interrupt: "polite" waits for a pause (use for
   * routine updates such as trace steps or vault saves), "assertive"
   * interrupts (use for alerts such as check-in status). Defaults to "polite".
   */
  politeness?: Politeness;
  /**
   * Whether the whole region is announced on change (true) or only the changed
   * parts. Defaults to true so complete status sentences are read.
   */
  atomic?: boolean;
  /** Optional id so a control can reference this region. */
  id?: string;
}

/**
 * LiveRegion is an aria-live announcer. It renders an always-present region
 * whose text changes are announced by VoiceOver / TalkBack without moving
 * focus. The region exists in the DOM at mount time (empty) so updates are
 * reliably announced.
 *
 * Use politeness="polite" for non-alert updates (Req 23.9) and
 * politeness="assertive" for alerts such as check-in status (Req 23.10). The
 * region is visually hidden but remains in the accessibility tree.
 *
 * Built to WCAG 2.2 AA guidelines and tested with VoiceOver.
 */
export default function LiveRegion({
  children,
  politeness = "polite",
  atomic = true,
  id,
}: LiveRegionProps) {
  return (
    <div
      id={id}
      className="sr-only"
      role="status"
      aria-live={politeness}
      aria-atomic={atomic}
    >
      {children}
    </div>
  );
}
