"use client";

import { FastForward, Snowflake } from "lucide-react";
import { useCallback, useState } from "react";

import LiveRegion from "@/components/LiveRegion";
import Badge from "@/components/ui/Badge";
import Banner from "@/components/ui/Banner";
import Button from "@/components/ui/Button";
import SummaryList from "@/components/ui/SummaryList";
import Panel from "@/components/ui/Panel";
import {
  ANSWER_HELP_LABEL,
  ANSWER_YES_LABEL,
  CHECKIN_QUESTION,
  deriveCheckInView,
  type CheckinResponse,
} from "@/app/(resident)/home/checkin-view";

/**
 * Judge Mode replay + fast-forward panel (ui-design.md, Req 20.5, 20.8, 20.9,
 * 20.10, 23.1).
 *
 * This client component mounts below the seed panel on `/judge` and offers the
 * two labeled demo controls:
 *
 * - **February 2026 blizzard replay** — POSTs to `/api/judge/replay/blizzard`
 *   (route 24.1). The response carries `label: "Replay"` and a `facts` object.
 *   We render the "Replay" honesty Badge and only the three allowed facts, each
 *   attributed to the Mass.gov press release dated April 9, 2026. No statistic
 *   is invented here: every fact shown comes straight from the response
 *   (Req 20.5, 20.9, 20.10).
 *
 * - **Fast-forward 14 days (simulated)** — POSTs to `/api/judge/fast-forward`
 *   (route 17.1). We show the "Simulated time" honesty Badge and report what
 *   happened (e.g. how many due follow-ups were triggered) from the response
 *   (Req 20.8). The field shapes are read defensively so the panel degrades to
 *   a plain summary sentence when a count is not provided.
 *
 * Every external call has a friendly fallback and never shows a stack trace.
 * Status changes are announced through a polite aria-live region (Req 23.1).
 *
 * The Leominster flood replay is a later task (30.1) and is intentionally
 * omitted here.
 *
 * Built to WCAG 2.2 AA guidelines and tested with VoiceOver.
 */

const GENERIC_ERROR =
  "We couldn't run that right now. Please try again in a moment.";

/** Facts allowed on screen for the blizzard replay (Req 20.5, 20.10). */
interface BlizzardFacts {
  dates: string;
  snowfall: string;
  outages: string;
  source: string;
}

interface BlizzardReplayResult {
  label: string;
  facts: BlizzardFacts;
  alertId: string | null;
  alertHeadline: string;
}

type BlizzardState =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "ready"; result: BlizzardReplayResult }
  | { state: "error"; message: string };

type FastForwardState =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "ready"; summary: string; simOffsetDays: number | null }
  | { state: "error"; message: string };

/** Narrows an unknown JSON value to a string, else null. */
function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Narrows an unknown JSON value to a non-negative integer, else null. */
function asCount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.trunc(value)
    : null;
}

/**
 * Reads the blizzard response into the shape the panel renders. Returns null
 * when the response is missing the label or the required facts, so the caller
 * can fall back to the friendly error instead of showing a half-filled card.
 */
function readBlizzard(body: unknown): BlizzardReplayResult | null {
  if (typeof body !== "object" || body === null) return null;
  const record = body as Record<string, unknown>;
  const label = asString(record.label);
  const rawFacts = record.facts;
  if (label === null || typeof rawFacts !== "object" || rawFacts === null) {
    return null;
  }
  const facts = rawFacts as Record<string, unknown>;
  const dates = asString(facts.dates);
  const snowfall = asString(facts.snowfall);
  const outages = asString(facts.outages);
  const source = asString(facts.source);
  if (dates === null || snowfall === null || outages === null || source === null) {
    return null;
  }
  const alert =
    typeof record.alert === "object" && record.alert !== null
      ? (record.alert as Record<string, unknown>)
      : {};
  return {
    label,
    facts: { dates, snowfall, outages, source },
    alertId: asString(alert.id),
    alertHeadline: asString(alert.headline) ?? "February 2026 blizzard",
  };
}

/**
 * Builds the plain-language "what happened" sentence for a fast-forward
 * response. Prefers a `message` from the server; otherwise summarizes a
 * triggered-follow-up count when present; otherwise states that the clock
 * advanced. Also surfaces the new simulated offset when the server returns one.
 */
function readFastForward(body: unknown): {
  summary: string;
  simOffsetDays: number | null;
} {
  const record =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>)
      : {};

  const simOffsetDays = asCount(record.sim_offset_days);

  const message = asString(record.message);
  if (message !== null) {
    return { summary: message, simOffsetDays };
  }

  const triggered =
    asCount(record.triggered) ??
    asCount(record.followups_triggered) ??
    (Array.isArray(record.followups) ? record.followups.length : null);

  if (triggered !== null) {
    const summary =
      triggered === 0
        ? "Simulated time moved ahead 14 days. No case follow-ups were due."
        : triggered === 1
          ? "Simulated time moved ahead 14 days. 1 case follow-up came due and was checked."
          : `Simulated time moved ahead 14 days. ${triggered} case follow-ups came due and were checked.`;
    return { summary, simOffsetDays };
  }

  return {
    summary: "Simulated time moved ahead 14 days.",
    simOffsetDays,
  };
}

/** Pulls a friendly server message out of an error body, else a default. */
async function errorMessage(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as
    | { message?: unknown }
    | null;
  return asString(body?.message) ?? GENERIC_ERROR;
}


/**
 * The resident check-in panel + caregiver status, shown side by side for the
 * replay demo. The resident sees "Are you okay?" with two answer buttons; a
 * clearly labeled "Simulate no answer (demo)" advances the chain so the
 * caregiver call is placed (a real Twilio call when ALLOW_LIVE_CALLS is true,
 * otherwise the labeled simulated call). The caregiver column reflects the
 * same check-in response.
 */
function CheckinChainDemo({
  checkin,
  busy,
  error,
  onAnswer,
  onSimulateNoAnswer,
}: {
  checkin: CheckinResponse;
  busy: boolean;
  error: string;
  onAnswer: () => void;
  onSimulateNoAnswer: () => void;
}) {
  const view = deriveCheckInView(checkin);
  const atStart = checkin.state === "SENT";

  return (
    <div className="mt-2 flex flex-col gap-6 lg:flex-row">
      {/* Resident column */}
      <section
        aria-label="Maria, resident"
        className="flex-1 rounded-[18px] border border-line bg-surface p-4"
      >
        <p className="text-[16px] font-bold text-muted">Maria, resident</p>
        <LiveRegion politeness={view.politeness}>{view.announcement}</LiveRegion>
        {atStart ? (
          <>
            <h3 className="mt-3 text-[22px]">{CHECKIN_QUESTION}</h3>
            <div className="mt-4 flex flex-col gap-3">
              <Button fullWidth variant="primary" loading={busy} loadingLabel="Sending" onClick={onAnswer}>
                {ANSWER_YES_LABEL}
              </Button>
              <Button fullWidth variant="secondary" loading={busy} loadingLabel="Sending" onClick={onAnswer}>
                {ANSWER_HELP_LABEL}
              </Button>
              <Button
                fullWidth
                variant="secondary"
                loading={busy}
                loadingLabel="Advancing"
                onClick={onSimulateNoAnswer}
              >
                Simulate no answer (demo)
              </Button>
            </div>
          </>
        ) : (
          <div className="mt-3">
            <Panel title={view.heading}>
              <p>{view.detail}</p>
            </Panel>
          </div>
        )}
        {error ? (
          <Banner title="Check-in unavailable" alert>
            {error}
          </Banner>
        ) : null}
      </section>

      {/* Caregiver column */}
      <section
        aria-label="Ana, caregiver"
        className="flex-1 rounded-[18px] border border-line bg-surface p-4"
      >
        <p className="text-[16px] font-bold text-muted">Ana, caregiver</p>
        <div className="mt-3 flex flex-col gap-3">
          {checkin.simulated_call ? (
            <Badge kind="simulated-call" />
          ) : null}
          <p className="text-[22px] font-bold text-ink">
            {checkin.state === "ANSWERED"
              ? "Maria checked in"
              : checkin.state === "CALL_CAREGIVER"
                ? "Maria hasn't answered. Calling you now."
                : checkin.state === "ADVISE_911"
                  ? "Call 911 if this is an emergency."
                  : "Waiting for Maria to answer."}
          </p>
        </div>
      </section>
    </div>
  );
}

export default function JudgeReplayPanel() {
  const [blizzard, setBlizzard] = useState<BlizzardState>({ state: "idle" });
  const [fastForward, setFastForward] = useState<FastForwardState>({
    state: "idle",
  });

  // Check-in chain state driven by the blizzard replay (task: wire the replay
  // to the check-in chain). Starts null; becomes the latest /api/checkin view.
  const [checkin, setCheckin] = useState<CheckinResponse | null>(null);
  const [checkinBusy, setCheckinBusy] = useState(false);
  const [checkinError, setCheckinError] = useState("");

  const postCheckin = useCallback(
    async (body: Record<string, unknown>) => {
      setCheckinBusy(true);
      setCheckinError("");
      try {
        const res = await fetch("/api/checkin", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          setCheckinError(await errorMessage(res));
          return;
        }
        setCheckin((await res.json()) as CheckinResponse);
      } catch {
        setCheckinError(GENERIC_ERROR);
      } finally {
        setCheckinBusy(false);
      }
    },
    [],
  );

  const startCheckin = useCallback(() => {
    if (blizzard.state !== "ready") return;
    const { alertId, alertHeadline } = blizzard.result;
    void postCheckin({
      alert_id: alertId ?? "blizzard-2026-02-22",
      alert_headline: alertHeadline,
      is_replay: true,
    });
  }, [blizzard, postCheckin]);

  const simulateNoAnswer = useCallback(() => {
    if (!checkin) return;
    void postCheckin({
      alert_id: checkin.alert_id,
      is_replay: true,
      event: "timeout",
    });
  }, [checkin, postCheckin]);

  const runBlizzard = useCallback(async () => {
    setBlizzard({ state: "loading" });
    try {
      const res = await fetch("/api/judge/replay/blizzard", {
        method: "POST",
        cache: "no-store",
      });
      if (!res.ok) {
        setBlizzard({ state: "error", message: await errorMessage(res) });
        return;
      }
      const result = readBlizzard(await res.json());
      if (result === null) {
        setBlizzard({ state: "error", message: GENERIC_ERROR });
        return;
      }
      setBlizzard({ state: "ready", result });
    } catch {
      setBlizzard({ state: "error", message: GENERIC_ERROR });
    }
  }, []);

  const runFastForward = useCallback(async () => {
    setFastForward({ state: "loading" });
    try {
      const res = await fetch("/api/judge/fast-forward", {
        method: "POST",
        cache: "no-store",
      });
      if (!res.ok) {
        setFastForward({ state: "error", message: await errorMessage(res) });
        return;
      }
      const { summary, simOffsetDays } = readFastForward(await res.json());
      setFastForward({ state: "ready", summary, simOffsetDays });
    } catch {
      setFastForward({ state: "error", message: GENERIC_ERROR });
    }
  }, []);

  const blizzardAnnouncement =
    blizzard.state === "loading"
      ? "Loading the February 2026 blizzard replay."
      : blizzard.state === "error"
        ? blizzard.message
        : blizzard.state === "ready"
          ? "Blizzard replay loaded. Showing the labeled replay facts."
          : "";

  const fastForwardAnnouncement =
    fastForward.state === "loading"
      ? "Moving simulated time ahead 14 days."
      : fastForward.state === "error"
        ? fastForward.message
        : fastForward.state === "ready"
          ? fastForward.summary
          : "";

  return (
    <section
      aria-labelledby="judge-replay-heading"
      className="flex flex-col gap-6"
    >
      <h2 id="judge-replay-heading" className="text-[22px]">
        Replays and simulated time
      </h2>

      <LiveRegion politeness="polite">
        {blizzardAnnouncement || fastForwardAnnouncement}
      </LiveRegion>

      {/* February 2026 blizzard replay (Req 20.5, 20.9, 20.10). */}
      <div className="flex flex-col gap-4">
        <p className="text-ink">
          Replay the February 2026 blizzard to walk through the check-in chain
          and Rights Card.
        </p>

        <Button
          variant="secondary"
          fullWidth
          loading={blizzard.state === "loading"}
          loadingLabel="Loading replay"
          onClick={() => void runBlizzard()}
        >
          <span className="inline-flex items-center gap-2">
            <Snowflake aria-hidden="true" size={20} />
            February 2026 blizzard replay
          </span>
        </Button>

        {blizzard.state === "error" ? (
          <Banner title="Replay unavailable" alert>
            {blizzard.message}
          </Banner>
        ) : null}

        {blizzard.state === "ready" ? (
          <div className="flex flex-col gap-3">
            <Badge
              kind="replay"
              icon={<Snowflake aria-hidden="true" size={16} />}
            />
            <SummaryList
              label="February 2026 blizzard, replay facts"
              rows={[
                { key: "When", value: blizzard.result.facts.dates },
                { key: "Snowfall", value: blizzard.result.facts.snowfall },
                { key: "Power outages", value: blizzard.result.facts.outages },
                { key: "Source", value: blizzard.result.facts.source },
              ]}
            />

            {/* Wire the replay to the deterministic check-in chain. */}
            {checkin === null ? (
              <Button
                variant="primary"
                fullWidth
                loading={checkinBusy}
                loadingLabel="Starting check-in"
                onClick={startCheckin}
              >
                Start Maria&apos;s check-in
              </Button>
            ) : (
              <CheckinChainDemo
                checkin={checkin}
                busy={checkinBusy}
                error={checkinError}
                onAnswer={() =>
                  void postCheckin({
                    alert_id: checkin.alert_id,
                    is_replay: true,
                    event: "resident_answered",
                  })
                }
                onSimulateNoAnswer={simulateNoAnswer}
              />
            )}
          </div>
        ) : null}
      </div>

      {/* Fast-forward 14 days (Req 20.8). */}
      <div className="flex flex-col gap-4 border-t border-line pt-6">
        <p className="text-ink">
          Move the demo clock ahead to see scheduled case follow-ups run. This
          is simulated time, not the real date.
        </p>

        <Button
          variant="secondary"
          fullWidth
          loading={fastForward.state === "loading"}
          loadingLabel="Moving time ahead"
          onClick={() => void runFastForward()}
        >
          <span className="inline-flex items-center gap-2">
            <FastForward aria-hidden="true" size={20} />
            Fast-forward 14 days (simulated)
          </span>
        </Button>

        {fastForward.state === "error" ? (
          <Banner title="Fast-forward unavailable" alert>
            {fastForward.message}
          </Banner>
        ) : null}

        {fastForward.state === "ready" ? (
          <div className="flex flex-col gap-3">
            <Badge
              kind="simulated-time"
              icon={<FastForward aria-hidden="true" size={16} />}
            />
            <p className="text-ink">{fastForward.summary}</p>
            {fastForward.simOffsetDays !== null ? (
              <p className="text-[16px] text-muted">
                Demo clock is now {fastForward.simOffsetDays} simulated{" "}
                {fastForward.simOffsetDays === 1 ? "day" : "days"} ahead.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
