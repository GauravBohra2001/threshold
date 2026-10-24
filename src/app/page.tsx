import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentHouseholdId } from "@/lib/auth/household";

// Reads the household cookie at request time; opt out of prerender so the
// cookie access does not block the prerendered shell (Next 16 Cache Components).
export const instant = false;

/**
 * Threshold entry screen (ui-design.md).
 *
 * If a household cookie exists, send the resident straight to their home
 * screen. Otherwise show a one-sentence welcome, a primary "Set up your
 * household" action, and a secondary link into Judge Mode for the demo.
 *
 * Server component: it reads the HTTP-only household cookie on the server and
 * never exposes it to the browser.
 */
export default async function EntryPage() {
  const householdId = await getCurrentHouseholdId();
  if (householdId) {
    redirect("/home");
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col px-5 py-8">
      <h1 className="text-[28px]">Threshold</h1>
      <p className="mt-4 text-ink">
        Every barrier you hit becomes a record that is routed to the right
        office and tracked until someone answers.
      </p>

      <div className="mt-auto flex flex-col gap-4 pt-8">
        <Link
          href="/home"
          className="inline-flex min-h-[56px] w-full items-center justify-center rounded-[14px] bg-accent px-6 font-bold text-on-accent"
        >
          Set up your household
        </Link>
        <Link href="/judge" className="text-accent underline">
          See the demo (Judge Mode)
        </Link>
      </div>
    </main>
  );
}
