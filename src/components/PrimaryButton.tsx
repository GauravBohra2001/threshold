import type { ButtonHTMLAttributes, ReactNode } from "react";

export interface PrimaryButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Button label / content. Must describe the action in plain language. */
  children: ReactNode;
}

/**
 * PrimaryButton is the app's main call-to-action control.
 *
 * It is always a real <button> element (never a clickable div), full-width so
 * it reads as the primary bottom-of-screen action, and at least 44x44 CSS px
 * to meet the minimum touch-target size. Focus uses the global visible
 * focus-visible ring. All native button props (type, onClick, disabled,
 * aria-*, form, ...) are forwarded.
 *
 * Built to WCAG 2.2 AA guidelines and tested with VoiceOver.
 * Requirements: 23.1, 23.2, 23.3, 23.4, 23.8.
 */
export default function PrimaryButton({
  children,
  type = "button",
  className = "",
  ...rest
}: PrimaryButtonProps) {
  return (
    <button
      type={type}
      className={[
        "w-full",
        "min-h-[44px]",
        "px-6 py-3",
        "rounded-lg",
        "text-base font-semibold",
        "bg-primary text-primary-foreground",
        "hover:bg-primary-hover",
        "disabled:opacity-60 disabled:cursor-not-allowed",
        "transition-colors",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    >
      {children}
    </button>
  );
}
