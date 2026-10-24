import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export interface BackLinkProps {
  /** Where the link goes. Defaults to the resident home hub. */
  href?: string;
  /** Visible, plain-language label. Defaults to "Back to home". */
  children?: React.ReactNode;
}

/**
 * A simple, accessible back link for resident screens (ui-design.md). Real
 * anchor, ≥44px target, visible focus via the global focus ring, icon paired
 * with text (never icon alone). Placed at the top of a screen.
 */
export default function BackLink({ href = "/home", children = "Back to home" }: BackLinkProps) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-[44px] items-center gap-2 text-[18px] text-accent underline underline-offset-4"
    >
      <ArrowLeft aria-hidden="true" className="h-5 w-5 shrink-0" />
      <span>{children}</span>
    </Link>
  );
}
