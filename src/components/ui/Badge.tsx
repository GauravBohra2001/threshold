import type { ReactNode } from "react";

/** Honesty labels only (ui-design.md). Identical everywhere they appear. */
export type BadgeKind =
  | "replay"
  | "simulated-time"
  | "demo-data"
  | "simulated-call";

const LABELS: Record<BadgeKind, string> = {
  replay: "Replay",
  "simulated-time": "Simulated time",
  "demo-data": "Demo data, fictional people",
  "simulated-call": "Simulated call (demo mode)",
};

export interface BadgeProps {
  kind: BadgeKind;
  /** Optional leading icon (inline SVG or lucide-react). Decorative. */
  icon?: ReactNode;
}

/**
 * An honesty badge: sentence case, 1px --control-border outline, small icon
 * plus text. Used only for the four labeled disclosures (replay, simulated
 * time, demo data, simulated call).
 */
export default function Badge({ kind, icon }: BadgeProps) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-control-border px-3 py-1 text-[16px] text-ink">
      {icon ? (
        <span aria-hidden="true" className="inline-flex">
          {icon}
        </span>
      ) : null}
      <span>{LABELS[kind]}</span>
    </span>
  );
}
