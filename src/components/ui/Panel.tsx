import type { ReactNode } from "react";

export interface PanelProps {
  title: string;
  /** Confirmation detail. No buttons inside a panel (GOV.UK pattern). */
  children?: ReactNode;
}

/**
 * A confirmation panel shown after an action completes (GOV.UK pattern). It
 * states what happened and carries no actions of its own (ui-design.md).
 */
export default function Panel({ title, children }: PanelProps) {
  return (
    <section className="rounded-[18px] border border-accent bg-surface p-6 text-center">
      <h2 className="text-[28px] text-accent">{title}</h2>
      {children ? <div className="mt-3 text-ink">{children}</div> : null}
    </section>
  );
}
