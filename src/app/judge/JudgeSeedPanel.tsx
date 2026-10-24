"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import LiveRegion from "@/components/LiveRegion";
import PrimaryButton from "@/components/PrimaryButton";

/**
 * Client-side Judge Mode seed panel.
 *
 * On mount it calls `GET /api/judge/seed`, which idempotently seeds (or reuses)
 * the fictional demo household "Maria" and returns a summary. The panel shows
 * the demo-data label prominently (Req 20.1), displays the stored caregiver
 * demo number (never placing a call — Req 20.2), and when the number is not
 * configured shows a plain-language fallback (Req 20.4). Seeding is idempotent,
 * so re-triggering does not change counts (Req 20.3).
 *
 * This is the P1 Judge entry scaffold: it seeds and links into the resident
 * flow. Replay buttons and fast-forward are later tasks (24.1 / 25.1 / 17.1).
 *
 * Requirements: 20.1, 20.2, 20.3, 20.4
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

  // Perform the seed fetch and resolve to the next status. Pure of setState so
  // the effect does not update state synchronously (it awaits the network).
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
      const result = (await res.json()) as SeedResult;
      return { state: "ready", result };
    } catch {
      return { state: "error", message: GENERIC_ERROR };
    }
  }, []);

  // Seed on mount. The effect only sets state after the async fetch resolves,
  // and bails out if the component unmounted meanwhile.
  useEffect(() => {
    let active = true;
    void fetchSeed().then((next) => {
      if (active) {
        setStatus(next);
      }
    });
    return () => {
      active = false;
    };
  }, [fetchSeed]);

  // Retry handler (an event handler, so it may set the loading state directly).
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
    <section
      aria-labelledby="judge-seed-heading"
      className="flex flex-col gap-6"
    >
      <h2 id="judge-seed-heading" className="text-2xl font-semibold">
        Demo household
      </h2>

      <LiveRegion politeness="polite">{announcement}</LiveRegion>

      {status.state === "loading" && (
        <p className="text-lg">Loading demo data…</p>
      )}

      {status.state === "error" && (
        <div className="flex flex-col gap-4">
          <p className="text-lg">{status.message}</p>
          <PrimaryButton onClick={retry}>Try again</PrimaryButton>
        </div>
      )}

      {status.state === "ready" && (
        <div className="flex flex-col gap-4">
          <dl className="flex flex-col gap-2 text-lg">
            <div className="flex flex-col">
              <dt className="font-semibold">Resident</dt>
              <dd>
                {status.result.resident_name} ({status.result.neighborhood})
              </dd>
            </div>
            <div className="flex flex-col">
              <dt className="font-semibold">Caregiver demo number</dt>
              <dd>
                {status.result.caregiver_number_missing ? (
                  <span>
                    The caregiver demo number is not configured. No call will be
                    placed.
                  </span>
                ) : (
                  <span>{status.result.caregiver_phone}</span>
                )}
              </dd>
            </div>
            <div className="flex flex-col">
              <dt className="font-semibold">Proof Vault items</dt>
              <dd>{status.result.vault_item_count}</dd>
            </div>
          </dl>

          <p className="text-base">
            No calls are placed while loading the demo. The number above is only
            stored and shown.
          </p>

          <Link
            href="/vault"
            className="inline-flex min-h-[44px] w-full items-center justify-center rounded-lg bg-primary px-6 py-3 text-base font-semibold text-primary-foreground hover:bg-primary-hover"
          >
            Open Maria&apos;s Proof Vault
          </Link>
        </div>
      )}
    </section>
  );
}
