import type { ReactNode } from "react";

export type StatusTone = "neutral" | "accent" | "success" | "danger";

export interface StatusChipProps {
  /** Plain-text status. Meaning is carried by icon + text, never color alone. */
  children: ReactNode;
  /** Required icon (inline SVG or lucide-react) so color is never the only cue. */
  icon: ReactNode;
  tone?: StatusTone;
}

const TONE_TEXT: Record<StatusTone, string> = {
  neutral: "text-ink",
  accent: "text-accent",
  success: "text-success",
  danger: "text-danger",
};

/**
 * A small status indicator: icon plus text. Color only reinforces the icon and
 * label; it is never the sole signal (ui-design.md).
 */
export default function StatusChip({
  children,
  icon,
  tone = "neutral",
}: StatusChipProps) {
  return (
    <span
      className={`inline-flex items-center gap-2 text-[16px] ${TONE_TEXT[tone]}`}
    >
      <span aria-hidden="true" className="inline-flex">
        {icon}
      </span>
      <span>{children}</span>
    </span>
  );
}
