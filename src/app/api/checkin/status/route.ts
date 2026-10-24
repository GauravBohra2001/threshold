import type { NextRequest } from "next/server";

import { getCurrentHouseholdId } from "@/lib/auth/household";
import { db } from "@/lib/data/supabase";
import { logServerError } from "@/lib/log";

/**
 * GET /api/checkin/status — current check-in status for one household.
 *
 * The caregiver status screen (task 22.2) polls this endpoint every 3 seconds
 * (no realtime subscriptions, Req 13.1, 13.2). It must be lightweight and never
 * cached, so the caregiver sees status changes within a second (Req 13.3).
 *
 * The caregiver's browser has no resident household cookie, so the screen
 * passes `?household=<id>`; we fall back to the cookie for the resident's own
 * view. We return ONLY this household's latest check-in: its state/outcome,
 * whether the call is simulated (so the screen can show the
 * "Simulated call (demo mode)" label), and the alert headline. We never include
 * any address, coordinates, Boston_311 full_address, another resident's detail,
 * or a case identifier (Req 10.1, 10.3, 10.5).
 *
 * On a data-store error the response is a plain-language fallback with no stack
 * trace, logged via logServerError. The caregiver screen then retains its last
 * status and keeps polling (Req 13.6).
 *
 * Requirements: 13.1, 13.3, 10.1, 10.3, 10.5, 22.3, 22.5
 */

// This handler reads the data store at request time; it must never be cached so
// each 3s poll reflects the latest check-in (Req 13.1, 13.3).

const NO_HOUSEHOLD_MESSAGE =
  "No household found for this link. Please use the invite link the resident shared.";
const REFRESH_FAILED_MESSAGE = "The status could not be refreshed.";

/** The check-in chain states surfaced to the caregiver screen. */
type ChainState = "sent" | "answered" | "caregiver_called" | "advise_911";

/** Shape returned to the caregiver screen for the current check-in. */
interface CheckinStatusView {
  /** Whether there is any check-in for this household yet. */
  has_checkin: boolean;
  /** Current chain state, or null when there is no check-in. */
  state: ChainState | null;
  /** Recorded outcome once reached, else null (still in progress). */
  outcome: "answered" | "caregiver_called" | "advise_911" | null;
  /** True when the caregiver call is simulated (demo mode), not a real call. */
  is_simulated_call: boolean;
  /** The alert headline that triggered the check-in; empty when none. */
  alert_headline: string;
}

/**
 * Derive the current chain state from the recorded timestamps and outcome. The
 * authoritative progression lives in the chain state machine; here we only
 * translate the persisted row into a display state for the poll.
 */
function deriveState(row: {
  outcome: string | null;
  call_placed_at: string | null;
  answered_at: string | null;
}): ChainState {
  if (row.outcome === "advise_911") return "advise_911";
  if (row.outcome === "answered" || row.answered_at) return "answered";
  if (row.outcome === "caregiver_called" || row.call_placed_at) {
    return "caregiver_called";
  }
  return "sent";
}

function normalizeOutcome(
  value: string | null,
): CheckinStatusView["outcome"] {
  return value === "answered" ||
    value === "caregiver_called" ||
    value === "advise_911"
    ? value
    : null;
}

/**
 * Resolve the household id for this poll. The caregiver screen supplies it as a
 * `household` query parameter; the resident's own view falls back to the
 * HTTP-only cookie.
 */
async function resolveHouseholdId(
  request: NextRequest,
): Promise<string | null> {
  const fromQuery = request.nextUrl.searchParams.get("household");
  if (fromQuery && fromQuery.trim().length > 0) {
    return fromQuery.trim();
  }
  return getCurrentHouseholdId();
}

export async function GET(request: NextRequest): Promise<Response> {
  let householdId: string | null;
  try {
    householdId = await resolveHouseholdId(request);
  } catch (error) {
    logServerError("GET /api/checkin/status resolve", error);
    return Response.json(
      { message: REFRESH_FAILED_MESSAGE },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  }

  if (!householdId) {
    return Response.json(
      { message: NO_HOUSEHOLD_MESSAGE },
      { status: 404, headers: { "cache-control": "no-store" } },
    );
  }

  // Select ONLY this household's latest check-in. We never select address,
  // coordinates, or any other resident's data (Req 10.1).
  const { data, error } = await db("checkins")
    .select(
      "alert_headline, is_replay, answered_at, call_placed_at, outcome",
    )
    .eq("household_id", householdId)
    .order("sent_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    logServerError("GET /api/checkin/status query", error);
    return Response.json(
      { message: REFRESH_FAILED_MESSAGE },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  }

  // No check-in yet: a valid, empty status (not an error) so the screen can
  // show a calm resting state and keep polling.
  if (!data) {
    const empty: CheckinStatusView = {
      has_checkin: false,
      state: null,
      outcome: null,
      is_simulated_call: false,
      alert_headline: "",
    };
    return Response.json(empty, {
      status: 200,
      headers: { "cache-control": "no-store" },
    });
  }

  const row = data as {
    alert_headline: string | null;
    is_replay: boolean | null;
    answered_at: string | null;
    call_placed_at: string | null;
    outcome: string | null;
  };

  const state = deriveState(row);

  // A caregiver call is simulated whenever live calls are not enabled, or the
  // check-in is a replay. Only then does the screen show the
  // "Simulated call (demo mode)" label (Req 12.9).
  const liveCallsEnabled = process.env.ALLOW_LIVE_CALLS === "true";
  const isSimulatedCall =
    state === "caregiver_called" && (!liveCallsEnabled || !!row.is_replay);

  const view: CheckinStatusView = {
    has_checkin: true,
    state,
    outcome: normalizeOutcome(row.outcome),
    is_simulated_call: isSimulatedCall,
    alert_headline: row.alert_headline ?? "",
  };

  return Response.json(view, {
    status: 200,
    headers: { "cache-control": "no-store" },
  });
}
