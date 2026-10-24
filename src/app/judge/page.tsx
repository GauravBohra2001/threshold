import type { Metadata } from "next";

import JudgeSeedPanel from "./JudgeSeedPanel";

/**
 * Judge Mode entry screen (`/judge`).
 *
 * This is the P1 scaffold: it prominently shows "Demo data, fictional people."
 * (Req 20.1) and seeds (or reuses) the fictional demo household via the
 * client panel, which calls `GET /api/judge/seed`. Seeding is idempotent so
 * repeat visits do not change counts (Req 20.3); the caregiver demo number is
 * only stored and displayed and no call is placed (Req 20.2, 20.4).
 *
 * Replay buttons ("February 2026 blizzard", "Leominster flood") and the
 * "Fast-forward 14 days" control are later tasks (24.1 / 25.1 / 17.1) and are
 * intentionally not built here.
 *
 * Requirements: 20.1, 20.2, 20.3, 20.4
 */

export const metadata: Metadata = {
  title: "Judge Mode — Threshold",
};

export default function JudgePage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-5 py-10">
      <header className="flex flex-col gap-3">
        <h1 className="text-3xl font-semibold">Judge Mode</h1>
        <p
          className="rounded-lg bg-amber-100 px-4 py-3 text-lg font-semibold text-amber-950 dark:bg-amber-950 dark:text-amber-100"
          role="note"
        >
          Demo data, fictional people.
        </p>
        <p className="text-lg">
          This loads a seeded household so you can walk through Threshold. The
          people shown are fictional.
        </p>
      </header>

      <JudgeSeedPanel />
    </main>
  );
}
