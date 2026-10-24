import { readFile } from "node:fs/promises";
import path from "node:path";

import { getCurrentHouseholdId } from "@/lib/auth/household";
import { db } from "@/lib/data/supabase";
import { logServerError } from "@/lib/log";

/**
 * POST /api/judge/replay/blizzard — February 2026 blizzard replay loader
 * (Req 20.5, 20.7, 20.9, 20.10).
 *
 * Loads the fixture alert dated 2026-02-22 for eastern Massachusetts and starts
 * the check-in flow in REPLAY mode for the current demo household by creating a
 * Check_In row with `is_replay=true`. NWS does not serve old alerts, so the
 * replay is driven entirely by `fixtures/blizzard-2026-02-22.json`.
 *
 * Cross-route file ownership: task 21.1 owns `src/app/api/checkin/route.ts`.
 * To avoid a cross-route import or edit, this loader does NOT call that handler.
 * Instead it creates the replay Check_In row directly through the service-role
 * `db()` client (design "approach (b)"), then returns the created row so the
 * replay screen can run the deterministic check-in chain in replay mode. All
 * database access stays server-only (Req 22.4, 22.5).
 *
 * Honesty + safety: the response carries the label "Replay" and only the facts
 * allowed by Req 20.5/20.10, each attributed to the Mass.gov press release
 * dated April 9, 2026. No statistic beyond those allowed facts is produced.
 *
 * Fixture-load failure (Req 20.7): if the fixture cannot be read or parsed, the
 * handler returns the plain-language fallback "This replay is unavailable right
 * now." with no stack trace, and writes nothing — seeded demo data is left
 * unchanged because the Check_In insert only runs after the fixture loads.
 */

/** On-screen label shown during every replay (Req 20.9). */
export const REPLAY_LABEL = "Replay";

/** Plain-language fallback when the fixture cannot be loaded (Req 20.7). */
export const REPLAY_UNAVAILABLE_MESSAGE = "This replay is unavailable right now.";

/** Friendly fallback when there is no seeded demo household to attach to. */
const NO_HOUSEHOLD_MESSAGE =
  "Open the Judge Mode demo first, then start the replay.";

/** Friendly fallback when the Check_In row could not be written. */
const CHECKIN_FAILED_MESSAGE =
  "We couldn't start this replay right now. Please try again in a moment.";

/** Path to the blizzard fixture, resolved from the repo root at request time. */
const FIXTURE_PATH = path.join(
  process.cwd(),
  "fixtures",
  "blizzard-2026-02-22.json",
);

/**
 * The only facts allowed on screen for this replay (Req 20.5, 20.10), each
 * attributed to the Mass.gov press release dated April 9, 2026. No other
 * statistic may be surfaced.
 */
const BLIZZARD_FACTS = {
  dates: "The storm ran February 22 to 23, 2026.",
  snowfall: "It dropped nearly three feet of snow.",
  outages: "Power outages peaked above 290,000.",
  source: "Mass.gov press release dated April 9, 2026.",
} as const;

/** The normalized alert fields the replay surfaces from the fixture. */
interface FixtureAlert {
  id: string;
  event: string | null;
  headline: string | null;
  areaDesc: string | null;
  severity: string | null;
  effective: string | null;
  expires: string | null;
}

/**
 * Loads and validates the blizzard fixture into a single alert. Throws on a
 * missing file, invalid JSON, or an unexpected shape so the caller can return
 * the friendly "unavailable" fallback without leaking a stack trace (Req 20.7).
 *
 * The fixture mirrors the NWS GeoJSON FeatureCollection shape that
 * `src/lib/data/nws.ts` normalizes: a `features` array whose entries carry an
 * `id` and a `properties` object.
 */
async function loadBlizzardAlert(): Promise<FixtureAlert> {
  const raw = await readFile(FIXTURE_PATH, "utf8");
  const parsed = JSON.parse(raw) as unknown;

  const features =
    typeof parsed === "object" &&
    parsed !== null &&
    Array.isArray((parsed as { features?: unknown[] }).features)
      ? (parsed as { features: unknown[] }).features
      : [];

  const first = features[0];
  if (typeof first !== "object" || first === null) {
    throw new Error("blizzard fixture has no alert feature");
  }

  const feature = first as Record<string, unknown>;
  const props =
    typeof feature.properties === "object" && feature.properties !== null
      ? (feature.properties as Record<string, unknown>)
      : {};

  const asString = (v: unknown): string | null =>
    typeof v === "string" && v.length > 0 ? v : null;

  const id = asString(feature.id) ?? asString(props.id);
  if (id === null) {
    throw new Error("blizzard fixture alert is missing an id");
  }

  return {
    id,
    event: asString(props.event),
    headline: asString(props.headline),
    areaDesc: asString(props.areaDesc),
    severity: asString(props.severity),
    effective: asString(props.effective),
    expires: asString(props.expires),
  };
}

/** Shape returned to the replay screen. */
interface BlizzardReplayView {
  /** Always "Replay" — shown on screen during the scenario (Req 20.9). */
  label: typeof REPLAY_LABEL;
  checkin_id: string;
  household_id: string;
  alert: FixtureAlert;
  /** The only facts allowed on screen, with their Mass.gov attribution. */
  facts: typeof BLIZZARD_FACTS;
}

export async function POST(): Promise<Response> {
  // Load the fixture first. If it fails, we return the friendly fallback and
  // write nothing, so seeded demo data is left completely unchanged (Req 20.7).
  let alert: FixtureAlert;
  try {
    alert = await loadBlizzardAlert();
  } catch (error) {
    logServerError("POST /api/judge/replay/blizzard (fixture load)", error);
    return Response.json(
      { message: REPLAY_UNAVAILABLE_MESSAGE },
      { status: 502 },
    );
  }

  // The replay runs against the seeded demo household (cookie set by the seed
  // route). Without one, there is nothing to attach the check-in to.
  const householdId = await getCurrentHouseholdId();
  if (!householdId) {
    return Response.json({ message: NO_HOUSEHOLD_MESSAGE }, { status: 409 });
  }

  try {
    // Approach (b): create the replay Check_In directly via the service-role
    // client with is_replay=true (Req 11.2). We do not import or call the
    // check-in route owned by task 21.1. The (household_id, alert_id) unique
    // constraint makes repeat replays idempotent: upsert reuses the existing
    // row instead of inserting a duplicate.
    const { data, error } = await db("checkins")
      .upsert(
        {
          household_id: householdId,
          alert_id: alert.id,
          alert_headline: alert.headline ?? "",
          is_replay: true,
        },
        { onConflict: "household_id,alert_id" },
      )
      .select("id")
      .single();

    if (error || !data) {
      throw new Error("replay check-in insert failed");
    }

    const view: BlizzardReplayView = {
      label: REPLAY_LABEL,
      checkin_id: (data as { id: string }).id,
      household_id: householdId,
      alert,
      facts: BLIZZARD_FACTS,
    };
    return Response.json(view, { status: 201 });
  } catch (error) {
    // Data store unavailable: friendly fallback, no stack trace. The fixture
    // already loaded, so this failure leaves the fixture untouched and only
    // means the check-in could not be recorded this time.
    logServerError("POST /api/judge/replay/blizzard (checkin)", error);
    return Response.json({ message: CHECKIN_FAILED_MESSAGE }, { status: 502 });
  }
}
