import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "danger";

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Action-named label, e.g. "Take photo", "Approve draft". No arrows. */
  children: ReactNode;
  variant?: ButtonVariant;
  /** Full-width bottom-of-screen primary action. */
  fullWidth?: boolean;
  /** Loading keeps the width and swaps to a present-tense label. */
  loading?: boolean;
  loadingLabel?: string;
  /** A text reason shown near the control when disabled (never opacity alone). */
  disabledReason?: string;
}

const BASE =
  "inline-flex items-center justify-center rounded-[14px] px-6 font-bold " +
  "text-[18px] transition-colors duration-100 " +
  "disabled:cursor-not-allowed";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-accent text-on-accent hover:brightness-110 active:brightness-95",
  secondary:
    "border border-accent text-accent bg-surface hover:bg-bg active:brightness-95",
  danger: "bg-danger text-on-accent hover:brightness-110 active:brightness-95",
};

/**
 * The app's action control. Always a real <button>. Primary is 56px tall and
 * usually full-width at the bottom of the screen; all variants meet the 44px
 * minimum target. Disabled renders a text reason next to the control rather
 * than signalling with opacity alone (ui-design.md).
 */
export default function Button({
  children,
  variant = "primary",
  fullWidth = false,
  loading = false,
  loadingLabel,
  disabledReason,
  type = "button",
  disabled,
  className = "",
  ...rest
}: ButtonProps) {
  const isDisabled = disabled || loading;
  const height =
    variant === "primary" ? "min-h-[56px]" : "min-h-[44px]";
  const width = fullWidth ? "w-full" : "";
  const label = loading ? loadingLabel ?? "Working" : children;

  return (
    <span className={fullWidth ? "block w-full" : "inline-block"}>
      <button
        type={type}
        disabled={isDisabled}
        aria-busy={loading || undefined}
        className={[BASE, VARIANTS[variant], height, width, className]
          .filter(Boolean)
          .join(" ")}
        {...rest}
      >
        {label}
      </button>
      {isDisabled && disabledReason ? (
        <span className="mt-1 block text-[16px] text-muted">
          {disabledReason}
        </span>
      ) : null}
    </span>
  );
}
