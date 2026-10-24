import { ExternalLink } from "lucide-react";

import type { RightEntry } from "@/lib/rights/library";

export interface RightsStatementProps {
  /** A single Rights_Library entry. Only library entries are ever rendered. */
  entry: RightEntry;
  /** Position in the deck, 1-based, for a readable "x of y" label. */
  index: number;
  /** Total number of rights in the deck. */
  total: number;
}

/**
 * The inverted Rights Card statement (ui-design.md hero screen "Rights Card").
 *
 * Renders exactly one Rights_Library entry: its plain statement at 28px
 * minimum, an "applies when" note, and the source URL as an activatable link
 * below. The whole card is inverted (--ink background, --surface text) with a
 * tactile strip on the top edge so it can be held up to shelter staff. It shows
 * only the fields of the passed entry; it never invents a statement or number
 * (Req 14.2). Text is >=18px and the inverted ink/surface pairing meets the
 * >=4.5:1 contrast baseline in both modes (Req 14.1, 23.5).
 *
 * Built to WCAG 2.2 AA guidelines and tested with VoiceOver.
 */
export default function RightsStatement({
  entry,
  index,
  total,
}: RightsStatementProps) {
  return (
    <article className="overflow-hidden rounded-[18px] bg-ink text-surface">
      <div className="tactile-strip" aria-hidden="true" />
      <div className="flex flex-col gap-4 p-6">
        <p className="text-[16px] text-surface">
          Right {index} of {total}
        </p>
        <h2 className="text-[28px] leading-[1.2] text-surface">
          {entry.plain_statement}
        </h2>
        <p className="text-[18px] text-surface">{entry.applies_when}</p>
        <a
          href={entry.source_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-[44px] items-center gap-2 text-[18px] text-surface underline underline-offset-4"
        >
          <ExternalLink aria-hidden="true" className="h-5 w-5 shrink-0" />
          <span>View the source</span>
        </a>
      </div>
    </article>
  );
}
