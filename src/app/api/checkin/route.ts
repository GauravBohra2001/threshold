/**
 * POST /api/checkin — create and advance the weather-alert check-in chain.
 *
 * A weather alert (live NWS or a Replay fixture) that affects the current
 * household creates exactly one Check_In, then the deterministic chain in
 * `src/lib/rules/checkin-chain.ts` drives every side effect. This handler is
 * the server orchestrator described in design P3 (a): it reads `nextState` /
 * `timeoutMs`, performs the side effect the state dictates (place a caregiver
 * call, or render the 911 advisory), and records the outcome on the row. It
 * never uses model judgment to decide chain progression (Req 12.6).
 *
 * Request body (JSON):
 *   {
 *     alert_id: string,              // unique per alert (Req 11.5)
 *     alert_headline?: string,       // short human text (Req 11.2)
 *     is_replay?: boolean,           // true in Judge/Replay mode (Req 11.2)
 *     event?: "resident_answered" | "caregiver_confirmed" | "timeout"
 *   }
 *
 * - No `event` (or `event` omitted): the alert is received and a Check_In is
 *   created exactly once per (household_id, alert_id). A repeated alert id
 *   returns the existing Check_In without creating a duplicate (Req 11.5).
 * - `event: "resident_answered"`: the resident answered before timeout —
 *   outcome `answered`, no call placed (Req 12.4).
 * - `event: "timeout"` from SENT: place exactly one caregiver call. Whether the
 *   call is real or a labeled simulation is decided by `ALLOW_LIVE_CALLS` and
 *   the cross-chain rate limiter (Req 12.9, 12.10). On a failed real call the
 *   chain advances to `advise_911` with no retry (Req 12.2).
 * - `event: "caregiver_confirmed"` / `event: "timeout"` from CALL_CAREGIVER:
 *   resolve or advise 911 respectively.
 *
 * Every external call (Twilio) has a timeout and a plain-language fallback; no
 * stack trace is ever returned (Req 22.1, 22.2). All database access happens
 * here with the service-role client; the browser never talks to Supabase
 * directly (Req 22.5).
 *
 * Requirements: 11.1, 11.2, 11.5, 12.1, 12.2, 12.5, 12.7, 12.8, 12.9, 12.10,
 *   22.1, 22.2
 */
import type { NextRequest } from "next/server";

import { getCurrentHousehold } from "@/lib/auth/household";
import { db } from "@/lib/data/supabase";
import { buildSayTwiml, placeCall } from "@/lib/data/twilio";
import { logServerError } from "@/lib/log";
import {
  mayPlaceLiveCall,
  nextState,
  outcomeFor,
  type ChainState,
  type Mode,
} from "@/lib/rules/checkin-chain";

// This handler reads the request body, cookies, env, and the data store at
// request time, so it runs dynamically under Cache Components.

/** Per-call timeout for the Twilio voice call (Req 22.1). */
const CALL_TIMEOUT_MS = 10_000;

/** The chain's "Call 911" advisory shown on both screens (Req 12.3). */
const ADVISE_911_TEXT = "Call 911 if this is an emergency.";

const NO_HOUSEHOLD_MESSAGE =
  "No household found. Please create one first.";
const CHECKIN_FAILED_MESSAGE =
  "We could not update this check-in right now. Please try again in a moment.";

/**
 * Live-call rate limiter (Req 12.10).
 *
 * The spec allows "at most one real Twilio voice call per 2 minutes across all
 * Check_In_Chains". We track that with a single module-level timestamp. A
 * module-level (in-memory) value is intentional for this demo: it is simple,
 * needs no extra table, and resets on cold start — acceptable because real
 * calls only happen when an operator explicitly sets ALLOW_LIVE_CALLS=true. The
 * decision itself is made by the pure `mayPlaceLiveCall`, which takes this
 * timestamp as input so it stays deterministic and testable.
 */
let lastLiveCallAt: Date | null = null;

/** Test-only hook to reset the in-memory rate-limit clock between cases. */
export function __resetLiveCallClockForTests(): void {
  lastLiveCallAt = null;
}

/** True only when the operator opted into real calls via the env flag. */
function liveCallsAllowed(): boolean {
  return process.env.ALLOW_LIVE_CALLS === "true";
}

/** Map an incoming event string to a chain event, or null when unrecognized. */
function toChainEvent(
  event: unknown,
):
  | { type: "RESIDENT_ANSWERED" }
  | { type: "CAREGIVER_CONFIRMED" }
  | { type: "TIMEOUT" }
  | null {
  switch (event) {
    case "resident_answered":
      return { type: "RESIDENT_ANSWERED" };
    case "caregiver_confirmed":
      return { type: "CAREGIVER_CONFIRMED" };
    case "timeout":
      return { type: "TIMEOUT" };
    default:
      return null;
  }
}

/**
 * The spoken message for the caregiver call (Req 12.7, 12.8). It states ONLY
 * the resident's name to check on, says nothing about any diagnosis or
 * equipment, and identifies Threshold as an AI assistant, not the City of
 * Boston.
 */
function caregiverSayMessage(residentName: string): string {
  return (
    `Hello. This is Threshold, an automated A I assistant, not the City of Boston. ` +
    `Please check on ${residentName}, who did not answer a safety check-in. ` +
    `${ADVISE_911_TEXT}`
  );
}

/** Shape of the current check-in row this handler reads/writes. */
interface CheckinRow {
  id: string;
  household_id: string;
  alert_id: string;
  alert_headline: string;
  is_replay: boolean;
  sent_at: string;
  answered_at: string | null;
  call_placed_at: string | null;
  call_sid: string | null;
  outcome: "answered" | "caregiver_called" | "advise_911" | null;
}

const CHECKIN_COLUMNS =
  "id, household_id, alert_id, alert_headline, is_replay, sent_at, answered_at, call_placed_at, call_sid, outcome";

/** Response view returned to the resident/caregiver screens. */
interface CheckinView {
  id: string;
  alert_id: string;
  alert_headline: string;
  is_replay: boolean;
  sent_at: string;
  answered_at: string | null;
  call_placed_at: string | null;
  call_sid: string | null;
  outcome: "answered" | "caregiver_called" | "advise_911" | null;
  state: ChainState;
  /** True when the caregiver call was a labeled simulation (Req 12.9, 12.10). */
  simulated_call: boolean;
  /** Label shown on the caregiver screen for a simulated call. */
  simulated_call_label?: string;
  /** The 911 advisory text, present once the chain reaches advise_911 (12.3). */
  advisory?: string;
}

/**
 * Derive the current chain state from a check-in row. SENT until an outcome is
 * recorded; `caregiver_called` maps to CALL_CAREGIVER mid-chain (a confirmed
 * call would already be `advise_911`/resolved via outcome transitions here).
 */
function stateFromRow(row: CheckinRow): ChainState {
  switch (row.outcome) {
    case "answered":
      return "ANSWERED";
    case "caregiver_called":
      return "CALL_CAREGIVER";
    case "advise_911":
      return "ADVISE_911";
    default:
      return "SENT";
  }
}

/** Build the response view for a row and its resolved chain state. */
function toView(
  row: CheckinRow,
  state: ChainState,
  opts: { simulatedCall?: boolean } = {},
): CheckinView {
  const view: CheckinView = {
    id: row.id,
    alert_id: row.alert_id,
    alert_headline: row.alert_headline,
    is_replay: row.is_replay,
    sent_at: row.sent_at,
    answered_at: row.answered_at,
    call_placed_at: row.call_placed_at,
    call_sid: row.call_sid,
    outcome: row.outcome,
    state,
    simulated_call: opts.simulatedCall === true,
  };
  if (opts.simulatedCall) {
    view.simulated_call_label = "Simulated call (demo mode)";
  }
  if (state === "ADVISE_911") {
    view.advisory = ADVISE_911_TEXT;
  }
  return view;
}

/**
 * Load the existing check-in for (household, alert), or create it if absent,
 * returning the row. A unique-constraint violation on insert (a concurrent or
 * repeated alert id) is handled by re-selecting the existing row so exactly one
 * Check_In exists per unique alert id (Req 11.5).
 */
async function getOrCreateCheckin(
  householdId: string,
  alertId: string,
  alertHeadline: string,
  isReplay: boolean,
): Promise<{ row: CheckinRow; created: boolean }> {
  const existing = await db("checkins")
    .select(CHECKIN_COLUMNS)
    .eq("household_id", householdId)
    .eq("alert_id", alertId)
    .maybeSingle();

  if (existing.error) {
    throw new Error("checkin lookup failed");
  }
  if (existing.data) {
    return { row: existing.data as CheckinRow, created: false };
  }

  const inserted = await db("checkins")
    .insert({
      household_id: householdId,
      alert_id: alertId,
      alert_headline: alertHeadline,
      is_replay: isReplay,
    })
    .select(CHECKIN_COLUMNS)
    .single();

  if (inserted.error || !inserted.data) {
    // A unique violation means a duplicate alert id raced us; re-select the
    // winning row rather than failing (exactly one check-in — Req 11.5).
    const raced = await db("checkins")
      .select(CHECKIN_COLUMNS)
      .eq("household_id", householdId)
      .eq("alert_id", alertId)
      .maybeSingle();
    if (raced.error || !raced.data) {
      throw new Error("checkin insert failed");
    }
    return { row: raced.data as CheckinRow, created: false };
  }

  return { row: inserted.data as CheckinRow, created: true };
}

/** Persist an update to the check-in row and return the updated row. */
async function updateCheckin(
  id: string,
  patch: Partial<Pick<
    CheckinRow,
    "answered_at" | "call_placed_at" | "call_sid" | "outcome"
  >>,
): Promise<CheckinRow> {
  const updated = await db("checkins")
    .update(patch)
    .eq("id", id)
    .select(CHECKIN_COLUMNS)
    .single();

  if (updated.error || !updated.data) {
    throw new Error("checkin update failed");
  }
  return updated.data as CheckinRow;
}

export async function POST(request: NextRequest): Promise<Response> {
  // Parse the body. A malformed body is a 400 with a plain-language message.
  let body: {
    alert_id?: unknown;
    alert_headline?: unknown;
    is_replay?: unknown;
    event?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { message: "This check-in request could not be read." },
      { status: 400 },
    );
  }

  const alertId = body?.alert_id;
  if (typeof alertId !== "string" || alertId.trim().length === 0) {
    return Response.json(
      { field: "alert_id", message: "A weather alert id is required." },
      { status: 400 },
    );
  }
  const alertHeadline =
    typeof body?.alert_headline === "string" ? body.alert_headline : "";
  const isReplay = body?.is_replay === true;
  const mode: Mode = isReplay ? "replay" : "live";

  const chainEvent = toChainEvent(body?.event);
  if (body?.event !== undefined && chainEvent === null) {
    return Response.json(
      { field: "event", message: "That check-in action is not recognized." },
      { status: 400 },
    );
  }

  // Demo-grade auth: resolve the current household from the HTTP-only cookie.
  let household;
  try {
    household = await getCurrentHousehold();
  } catch (error) {
    logServerError("POST /api/checkin household", error);
    return Response.json({ message: CHECKIN_FAILED_MESSAGE }, { status: 502 });
  }
  if (!household) {
    return Response.json({ message: NO_HOUSEHOLD_MESSAGE }, { status: 404 });
  }

  try {
    // Exactly one Check_In per unique (household_id, alert_id) (Req 11.5).
    const { row, created } = await getOrCreateCheckin(
      household.id,
      alertId.trim(),
      alertHeadline,
      isReplay,
    );
    const currentState = stateFromRow(row);

    // No event: the alert was just received. Return the (possibly reused)
    // check-in so the resident screen can show "Are you okay?" (Req 11.1).
    // 201 only on first creation; a repeated alert id reuses the row -> 200.
    if (!chainEvent) {
      return Response.json(toView(row, currentState), {
        status: created ? 201 : 200,
      });
    }

    const resolved = nextState(currentState, chainEvent, mode);

    // No state change (terminal, or an event that does not apply): return the
    // row as-is so steps never skip and no duplicate side effect runs (12.5).
    if (resolved === currentState) {
      return Response.json(toView(row, currentState), { status: 200 });
    }

    // Resident answered before timeout: outcome `answered`, place no call.
    if (resolved === "ANSWERED") {
      const updated = await updateCheckin(row.id, {
        answered_at: new Date().toISOString(),
        outcome: outcomeFor(resolved),
      });
      return Response.json(toView(updated, resolved), { status: 200 });
    }

    // Timeout from SENT: place exactly one caregiver call (real or simulated).
    if (resolved === "CALL_CAREGIVER") {
      return await handleCaregiverCall(row, household.resident_name, household.caregiver_phone);
    }

    // Timeout/confirm from CALL_CAREGIVER: resolve or advise 911.
    const updated = await updateCheckin(row.id, {
      outcome: outcomeFor(resolved),
    });
    return Response.json(toView(updated, resolved), { status: 200 });
  } catch (error) {
    logServerError("POST /api/checkin", error);
    return Response.json({ message: CHECKIN_FAILED_MESSAGE }, { status: 502 });
  }
}

/**
 * Perform the SENT -> CALL_CAREGIVER side effect: place exactly one caregiver
 * call, as a real Twilio call when allowed and within the rate limit, else a
 * labeled simulation. On a failed real call, advance to `advise_911` with no
 * retry (Req 12.2). Returns the response for the resulting state.
 */
async function handleCaregiverCall(
  row: CheckinRow,
  residentName: string,
  caregiverPhone: string | null,
): Promise<Response> {
  const now = new Date();
  const allowLive = liveCallsAllowed();
  const canPlaceReal =
    allowLive &&
    caregiverPhone !== null &&
    caregiverPhone.trim().length > 0 &&
    mayPlaceLiveCall(allowLive, lastLiveCallAt, now);

  if (!canPlaceReal) {
    // Simulated call (Judge/Replay default, or rate-limited): record the
    // check-in as caregiver_called with a placed-at timestamp and NO call_sid,
    // and label the caregiver screen "Simulated call (demo mode)" (12.9, 12.10).
    const updated = await updateCheckin(row.id, {
      call_placed_at: now.toISOString(),
      outcome: "caregiver_called",
    });
    return Response.json(
      toView(updated, "CALL_CAREGIVER", { simulatedCall: true }),
      { status: 200 },
    );
  }

  // Place the one real call. Reserve the rate-limit slot before the call so a
  // slow provider cannot let a second chain slip a concurrent call through.
  lastLiveCallAt = now;
  const twiml = buildSayTwiml(caregiverSayMessage(residentName));
  const call = await placeCall(
    { to: caregiverPhone as string, twiml, timeoutMs: CALL_TIMEOUT_MS },
    undefined,
  );

  if (!call.ok) {
    // Call failed or did not connect: advance to advise_911 with NO retry
    // (Req 12.2). Record the placed-at (we attempted the call) and outcome.
    const advised = nextState("CALL_CAREGIVER", { type: "CALL_FAILED" }, "live");
    const updated = await updateCheckin(row.id, {
      call_placed_at: now.toISOString(),
      outcome: outcomeFor(advised),
    });
    return Response.json(toView(updated, advised), { status: 200 });
  }

  // Real call placed: record call_placed_at, call_sid, outcome caregiver_called.
  const updated = await updateCheckin(row.id, {
    call_placed_at: now.toISOString(),
    call_sid: call.callSid,
    outcome: "caregiver_called",
  });
  return Response.json(toView(updated, "CALL_CAREGIVER"), { status: 200 });
}
