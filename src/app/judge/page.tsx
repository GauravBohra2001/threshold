import type { Metadata } from "next";

import Badge from "@/components/ui/Badge";
import JudgeReplayPanel from "./JudgeReplayPanel";
import JudgeSeedPanel from "./JudgeSeedPanel";

/**
 * Judge Mode entry screen (`/judge`), ui-design.md.
 *
 * Shows the "Demo data, fictional people" honesty Badge and seeds (or reuses)
 * the fictional demo household via the client panel, then offers the labeled
 * blizzard replay and the "Fast-forward 14 days (simulated)" control via the
 * replay panel (Req 20.5, 20.8, 20.9, 20.10).
 */

export const metadata: Metadata = {
  title: "Judge Mode — Threshold",
};

export default function JudgePage() {
  return (
    <main className="mx-auto flex w-full max-w-[480px] flex-col gap-6 px-5 py-8">
      <header className="flex flex-col gap-3">
        <h1 className="text-[28px]">Judge Mode</h1>
        <Badge kind="demo-data" />
        <p className="text-ink">
          This loads a seeded household so you can walk through Threshold. The
          people shown are fictional.
        </p>
      </header>

      <JudgeSeedPanel />

      <JudgeReplayPanel />
    </main>
  );
}
