import type { ReactNode } from "react";

export interface SummaryRow {
  key: string;
  value: ReactNode;
}

export interface SummaryListProps {
  rows: SummaryRow[];
  /** Accessible name for the list, e.g. "Claim summary". */
  label?: string;
}

/**
 * A key/value review list (GOV.UK summary list). Rows sit directly on the page
 * separated by --line dividers; no card nesting (ui-design.md).
 */
export default function SummaryList({ rows, label }: SummaryListProps) {
  return (
    <dl aria-label={label} className="border-t border-line">
      {rows.map((row) => (
        <div
          key={row.key}
          className="flex flex-col gap-1 border-b border-line py-3 sm:flex-row sm:gap-4"
        >
          <dt className="font-bold text-ink sm:w-2/5">{row.key}</dt>
          <dd className="text-ink sm:w-3/5">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}
