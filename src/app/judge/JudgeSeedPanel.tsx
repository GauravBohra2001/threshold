"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import LiveRegion from "@/components/LiveRegion";
import Button from "@/components/ui/Button";
import SummaryList from "@/components/ui/SummaryList";

/**
 * Client-side Judge Mode seed panel (ui-design.md).
 *
 * Calls GET /api/judge/seed on mount; the endpoint idempotently seeds or reuses
 * the fictional demo household "Maria" (Req 20.3). Shows the stored caregiver
 * demo number without placing a call (Req 20.2), with a plain-language fallback
 * when it is not configured (Req 20.4). Replays and fast-forward are later
 * tasks.
 */

interface SeedResult {
  household_id: string;
  resident_name: string;
  neighborhood: string;
  caregiver_phone: string | null;
  caregiver_number_missing: boolean;
  vault_item_count: number;
  created: boolean;
}

type Status =
  | { state: "loading" }
  | { state: "ready"; result: SeedResult }
  | { state: "error"; message: string };

const GENERIC_ERROR =
  "We couldn't load the demo data right now. Please try again in a moment.";

export default function JudgeSeedPanel() {
  const [status, setStatus] = useState<Status>({ state: "loading" });

  const fetchSeed = useCallback(async (): Promise<Status> => {
    try {
      const res = await fetch("/api/judge/seed", {
        method: "GET",
        cache: "no-store",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { message?: string }
          | null;
        return { state: "error", message: body?.message ?? GENERIC_ERROR };
      }
      return { state: "ready", result: (await res.json()) as SeedResult };
    } catch {
      return { state: "error", message: GENERIC_ERROR };
    }
  }, []);

  useEffect(() => {
    let active = true;
    void fetchSeed().then((next) => {
      if (active) setStatus(next);
    });
    return () => {
      active = false;
    };
  }, [fetchSeed]);

  const retry = useCallback(() => {
    setStatus({ state: "loading" });
    void fetchSeed().then(setStatus);
  }, [fetchSeed]);

  const announcement =
    status.state === "loading"
      ? "Loading demo data."
      : status.state === "error"
        ? status.message
        : `Demo data ready for ${status.result.resident_name} in ${status.result.neighborhood}.`;

  return (
    <section aria-labelledby="judge-seed-heading" className="flex flex-col gap-6">
      <h2 id="judge-seed-heading" className="text-[22px]">
        Demo household
      </h2>

      <LiveRegion politeness="polite">{announcement}</LiveRegion>

      {status.state === "loading" ? <p>Loading demo data</p> : null}

      {status.state === "error" ? (
        <div className="flex flex-col gap-4">
          <p>{status.message}</p>
          <Button variant="secondary" onClick={retry}>
            Try again
          </Button>
        </div>
      ) : null}

      {status.state === "ready" ? (
        <div className="flex flex-col gap-4">
          <SummaryList
            label="Demo household"
            rows={[
              {
                key: "Resident",
                value: `${status.result.resident_name} (${status.result.neighborhood})`,
              },
              {
                key: "Caregiver demo number",
                value: status.result.caregiver_number_missing
                  ? "Not configured. No call will be placed."
                  : status.result.caregiver_phone,
              },
              {
                key: "Evidence photos",
                value: String(status.result.vault_item_count),
              },
            ]}
          />
          <p className="text-[16px] text-muted">
            No calls are placed while loading the demo. The number above is only
            stored and shown.
          </p>
          <Link
            href="/vault"
            className="inline-flex min-h-[56px] w-full items-center justify-center rounded-[14px] bg-accent px-6 font-bold text-on-accent"
          >
            Open Maria&apos;s evidence
          </Link>
        </div>
      ) : null}
    </section>
  );
}
