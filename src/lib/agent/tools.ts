/**
 * Case Agent tools: the ten functions the agent loop may invoke.
 *
 * This module wires the agent's tools to already-built pieces: the Boston 311
 * data client, the Azure photo labeler, and the pure rule functions for
 * distance, routing, clock, eligibility wording, and privacy. It is the
 * boundary at which tool calls become concrete effects (or pure results).
 *
 * The data clients it calls are server-only (they import "server-only" and read
 * secrets). This module itself performs no secret reads — it delegates.
 *
 * Design references:
 *  - case-agent.md: the tool list + routing guidance.
 *  - design.md P2 (b): the ten tool signatures.
 *  - rights-library.md: the 10 allowed rights.
 *
 * Non-negotiable guarantees enforced here:
 *  - `searchNearby311` exposes ONLY { open_count, oldest_open_age_days,
 *    overdue_count }. It never returns an address or a coordinate. Candidates
 *    are filtered to within 75 m using distance.ts, and the result is run
 *    through the privacy guard as defense in depth (Req 6.4, 10.4).
 *  - `scheduleFollowup` clamps clock_due_at to [opened_at, opened_at + 90 days]
 *    using clock.ts; a value earlier than open is clamped up, not rejected
 *    silently — the clamped value is returned (Req 8.1, 8.2).
 *  - `draftFiling` output is honesty-clean: forbidden promise wording is
 *    stripped and then asserted absent (Req 12.8, honesty-and-safety.md).
 *  - `requestApproval` and `askUser` perform NO I/O. They return a sentinel
 *    that tells the loop to stop and wait for the resident (Req 7, 5.4).
 *  - `notifyCaregiver` is an in-app notice only. It never places a call;
 *    calls are reserved for the deterministic check-in chain.
 *
 * Requirements: 6.4, 6.5, 8.1, 8.2, 8.8, 10.4, 12.8
 */

import {
  neighborhoodOnTimeRate,
  searchNearbyOpen,
  ACCESSIBILITY_SERVICE_NAMES,
  type NearbyReport,
} from "@/lib/data/boston311";
import { labelPhoto } from "@/lib/data/azure";
import {
  DEFAULT_NEARBY_RADIUS_M,
  isNearby,
  type LatLng,
} from "@/lib/rules/distance";
import { scheduleFollowUp } from "@/lib/rules/clock";
import { assertCleanWording, sanitizeWording } from "@/lib/rules/eligibility";
import { guardResponse } from "@/lib/rules/privacy";
import type { Route } from "@/lib/rules/routing";

// ---------------------------------------------------------------------------
// Tool result types
// ---------------------------------------------------------------------------

/** Barrier classifications `classify_photo` can return (case-agent.md). */
export type BarrierType =
  | "blocked_sidewalk"
  | "broken_sidewalk"
  | "missing_curb_ramp"
  | "other";

/** `classify_photo` result. */
export interface ClassifyPhotoResult {
  barrier_type: BarrierType;
  description: string;
  confidence: number;
}

/**
 * `search_nearby_311` result. Intentionally only aggregate-safe fields: no
 * address, no coordinate, no case id (Req 6.4, 10.4). `ok: false` carries a
 * plain-language fallback the loop records as a trace note (Req 6.5, 5.6).
 */
export type SearchNearbyResult =
  | {
      ok: true;
      open_count: number;
      oldest_open_age_days: number;
      overdue_count: number;
    }
  | { ok: false; error: string };

/** `neighborhood_on_time_rate` result. */
export type OnTimeRateResult =
  | { ok: true; on_time_pct: number | null }
  | { ok: false; error: string };

/** A single rights-library entry (rights-library.md). */
export interface RightEntry {
  id: string;
  plain_statement: string;
  applies_when: string;
  source_url: string;
}

/** `lookup_right` result. `entries` is empty when nothing matches / library absent. */
export interface LookupRightResult {
  entries: RightEntry[];
}

/** `draft_filing` result: an honesty-clean, plain-language draft. */
export interface DraftFilingResult {
  draft_text: string;
}

/**
 * Sentinel returned by the control-flow tools (`request_approval`, `ask_user`).
 * It signals the loop to STOP and move the case to a waiting-on-resident state.
 * These tools perform no I/O.
 */
export interface PauseSignal {
  paused: true;
  /** Why the run paused, to be surfaced to the resident. */
  reason: "approval" | "question";
  /** The draft awaiting approval, or the question to ask. */
  prompt: string;
}

/** `schedule_followup` result: the clamped clock due date as an ISO string. */
export interface ScheduleFollowupResult {
  clock_due_at: string;
}

/** `check_case_status` result from the 311 dataset by case id. */
export type CheckCaseStatusResult =
  | { ok: true; status: string }
  | { ok: false; error: string };

/** `notify_caregiver` result. Always an in-app notice; never a call. */
export interface NotifyCaregiverResult {
  ok: true;
}

// ---------------------------------------------------------------------------
// classify_photo
// ---------------------------------------------------------------------------

/**
 * Map the Azure labeler's free-text label/description to a bounded barrier
 * type. The labeler is a general vault labeler; for a barrier photo we map its
 * wording onto one of the four allowed barrier types, defaulting to "other"
 * when nothing matches.
 */
function inferBarrierType(label: string, description: string): BarrierType {
  const text = `${label} ${description}`.toLowerCase();
  const hasCurbRamp = /\bcurb\b.*\bramp\b|\bramp\b.*\bcurb\b|curb ramp/.test(text);
  if (hasCurbRamp) return "missing_curb_ramp";
  const mentionsSidewalk = text.includes("sidewalk") || text.includes("pavement") || text.includes("walkway");
  if (mentionsSidewalk) {
    const blocked = /block|obstruct|parked|parking|vehicle|bin|trash|debris|dumpster|construction/.test(text);
    if (blocked) return "blocked_sidewalk";
    const broken = /broke|crack|damage|uneven|heav|buckl|pothole|hole|lift/.test(text);
    if (broken) return "broken_sidewalk";
    // A sidewalk mentioned with no obstruction/damage cue — leave it to a human.
    return "other";
  }
  return "other";
}

/**
 * `classify_photo(photo)` — classify a barrier photo. Delegates to the Azure
 * labeler (sending the image as a base64 data URL) and maps its output to the
 * bounded `{ barrier_type, description, confidence }` shape.
 *
 * On any labeler timeout/failure it returns a safe `other` classification with
 * zero confidence and a plain-language description, so the loop can decide to
 * ask the user rather than crash (Req 5.6).
 */
export async function classifyPhoto(
  photoDataUrl: string,
  deps: { labelPhoto: typeof labelPhoto } = { labelPhoto },
): Promise<ClassifyPhotoResult> {
  const result = await deps.labelPhoto(photoDataUrl);
  if (!result.ok) {
    return {
      barrier_type: "other",
      description: "The photo could not be classified automatically.",
      confidence: 0,
    };
  }
  const { label, description } = result.value;
  const barrier_type = inferBarrierType(label, description);
  // The general labeler gives no numeric confidence; a recognized barrier type
  // is treated as moderately confident, an unrecognized one as low.
  const confidence = barrier_type === "other" ? 0.3 : 0.8;
  return { barrier_type, description, confidence };
}

// ---------------------------------------------------------------------------
// search_nearby_311  (privacy-critical)
// ---------------------------------------------------------------------------

/** Whole days between two instants, floored and never negative. */
function ageInDays(openDate: string, now: Date): number {
  const opened = new Date(openDate).getTime();
  if (!Number.isFinite(opened)) return 0;
  const diffMs = now.getTime() - opened;
  if (diffMs <= 0) return 0;
  return Math.floor(diffMs / 86_400_000);
}

/** Whether a report is past its target close date and therefore overdue. */
function isOverdue(report: NearbyReport, now: Date): boolean {
  if (!report.target_close_date) return false;
  const target = new Date(report.target_close_date).getTime();
  if (!Number.isFinite(target)) return false;
  return now.getTime() > target;
}

/**
 * `search_nearby_311(lat, lng, radius_m, service_names)` — aggregate-safe
 * nearby lookup.
 *
 * Flow:
 *  1. Call the server-only 311 client, which returns coordinates for a coarse
 *     bounding box (never a `full_address`).
 *  2. Filter candidates to those within `radius_m` (default 75 m) of the
 *     barrier using the pure `isNearby` / great-circle distance.
 *  3. Aggregate into ONLY three numbers: open_count, oldest_open_age_days,
 *     overdue_count.
 *  4. Run the aggregate through the privacy guard (`guardResponse`) with the
 *     source records as the forbidden-address set and coordinate-key stripping,
 *     as defense in depth so no address or coordinate can ever leak.
 *
 * On a data-client failure it returns a typed `{ ok: false, error }` the loop
 * records as a trace note (Req 5.6, 6.5). The success shape never contains an
 * address or a coordinate (Req 6.4, 10.4).
 */
export async function searchNearby311(
  lat: number,
  lng: number,
  radiusM: number = DEFAULT_NEARBY_RADIUS_M,
  serviceNames: readonly string[] = ACCESSIBILITY_SERVICE_NAMES,
  deps: { searchNearbyOpen: typeof searchNearbyOpen } = { searchNearbyOpen },
  now: Date = new Date(),
): Promise<SearchNearbyResult> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    // The barrier location could not be resolved to lat/lng; no lookup is
    // possible and no draft should be produced (Req 6.5).
    return {
      ok: false,
      error: "We could not pin the location, so nearby reports were not checked.",
    };
  }

  const effectiveRadius = radiusM > 0 ? radiusM : DEFAULT_NEARBY_RADIUS_M;
  const res = await deps.searchNearbyOpen({
    lat,
    lng,
    radiusM: effectiveRadius,
    serviceNames,
  });
  if (!res.ok) {
    return { ok: false, error: res.error };
  }

  const origin: LatLng = { lat, lng };
  const withinRadius = res.data.filter((report) =>
    isNearby(origin, { lat: report.latitude, lng: report.longitude }, effectiveRadius),
  );

  let open_count = 0;
  let oldest_open_age_days = 0;
  let overdue_count = 0;
  for (const report of withinRadius) {
    open_count += 1;
    const age = ageInDays(report.open_date, now);
    if (age > oldest_open_age_days) oldest_open_age_days = age;
    if (isOverdue(report, now)) overdue_count += 1;
  }

  // Defense in depth: even though we only built three numbers above, run the
  // result through the privacy guard using the raw records as the forbidden
  // set and strip any coordinate-named key. The guard returns the aggregate
  // unchanged because it contains no address substring or coordinate key.
  const safe = guardResponse(
    { open_count, oldest_open_age_days, overdue_count },
    withinRadius,
  );

  return { ok: true, ...safe };
}

// ---------------------------------------------------------------------------
// neighborhood_on_time_rate
// ---------------------------------------------------------------------------

/**
 * `neighborhood_on_time_rate(neighborhood, service_name)` — live on-time
 * percentage over the last 90 days. Delegates to the 311 client and converts
 * its rate (0..1 or null) to a percentage (0..100 or null). On failure it
 * returns a typed fallback for the loop to record (Req 5.6).
 */
export async function neighborhoodOnTimeRatePct(
  neighborhood: string,
  serviceName: string,
  deps: { neighborhoodOnTimeRate: typeof neighborhoodOnTimeRate } = {
    neighborhoodOnTimeRate,
  },
): Promise<OnTimeRateResult> {
  const res = await deps.neighborhoodOnTimeRate({
    neighborhood,
    service_name: serviceName,
  });
  if (!res.ok) return { ok: false, error: res.error };
  const pct = res.data.rate === null ? null : Math.round(res.data.rate * 1000) / 10;
  return { ok: true, on_time_pct: pct };
}

// ---------------------------------------------------------------------------
// lookup_right
// ---------------------------------------------------------------------------

/**
 * Defensive accessor for the rights library. The JSON file at
 * `src/lib/rights/library.json` is owned by a separate task (23.1) and may not
 * exist yet. We import it lazily so this module compiles and runs whether or
 * not the file is present; when it is absent we return an empty list rather
 * than throwing. The file is NOT created here to avoid a file-ownership
 * conflict.
 */
function loadRightsLibrary(): RightEntry[] {
  try {
    // Lazy, defensive require so a missing JSON file (task 23.1) degrades to [].
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("@/lib/rights/library.json") as unknown;
    const raw = Array.isArray(mod)
      ? mod
      : Array.isArray((mod as { default?: unknown })?.default)
        ? (mod as { default: unknown[] }).default
        : [];
    return raw.filter(isRightEntry);
  } catch {
    return [];
  }
}

function isRightEntry(value: unknown): value is RightEntry {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.plain_statement === "string" &&
    typeof v.applies_when === "string" &&
    typeof v.source_url === "string"
  );
}

/**
 * `lookup_right(topic)` — return rights-library entries matching a topic, each
 * with its source URL. Matching is a case-insensitive substring over the id,
 * plain statement, and applies-when text. When the library file is not present
 * (owned by task 23.1) or nothing matches, `entries` is empty — the loop then
 * records that no right was found rather than inventing one (honesty rule).
 *
 * The optional `library` dependency makes this testable without the JSON file.
 */
export function lookupRight(
  topic: string,
  library: RightEntry[] = loadRightsLibrary(),
): LookupRightResult {
  const needle = typeof topic === "string" ? topic.trim().toLowerCase() : "";
  if (needle.length === 0) return { entries: [] };
  const entries = library.filter((entry) => {
    const haystack =
      `${entry.id} ${entry.plain_statement} ${entry.applies_when}`.toLowerCase();
    return haystack.includes(needle);
  });
  return { entries };
}

// ---------------------------------------------------------------------------
// draft_filing  (honesty-clean)
// ---------------------------------------------------------------------------

/** Human-readable name for each route, used in the draft heading. */
const ROUTE_TITLE: Record<Route, string> = {
  "311_sidewalk_repair": "Boston 311 report: Sidewalk Repair",
  "311_blocked_sidewalk": "Boston 311 report: Illegally Blocked Sidewalk",
  escalation_disabilities_commission:
    "Escalation to the Boston Disabilities Commission",
  ada_curb_ramp_form: "Boston ADA Curb Ramp Request Form",
  ada_grievance: "ADA grievance to the Boston Disabilities Commission",
};

/**
 * Facts the draft may reference. All optional so the loop can supply whatever
 * it has gathered; the draft renders only the fields that are present.
 */
export interface DraftFacts {
  description?: string;
  neighborhood?: string;
  open_count?: number;
  oldest_open_age_days?: number;
  overdue_count?: number;
  [key: string]: unknown;
}

/**
 * `draft_filing(route, facts)` — produce a plain-language draft in the
 * destination's format. The output is honesty-clean: any forbidden promise
 * wording ("you will receive", "guaranteed", "approved") is stripped via
 * `sanitizeWording`, then `assertCleanWording` verifies the result is clean
 * (Req 12.8). Every draft identifies Threshold as an AI assistant, not the City
 * of Boston (honesty-and-safety.md).
 *
 * This is a pure function (no I/O): the loop gates it behind `request_approval`
 * and nothing is submitted automatically (Req 7.7).
 */
export function draftFiling(route: Route, facts: DraftFacts = {}): DraftFilingResult {
  const lines: string[] = [];
  lines.push(ROUTE_TITLE[route]);
  lines.push("");
  lines.push(
    "This draft was prepared by Threshold, an AI assistant. It is not from the City of Boston and is not legal advice.",
  );
  lines.push("");

  if (facts.description) {
    lines.push(`What was reported: ${facts.description}`);
  }
  if (facts.neighborhood) {
    lines.push(`Neighborhood: ${facts.neighborhood}`);
  }

  if (route === "escalation_disabilities_commission") {
    const count =
      typeof facts.open_count === "number" ? facts.open_count : undefined;
    const age =
      typeof facts.oldest_open_age_days === "number"
        ? facts.oldest_open_age_days
        : undefined;
    if (count !== undefined) {
      const reports = count === 1 ? "open report" : "open reports";
      const agePart =
        age !== undefined
          ? `, the oldest open ${age === 1 ? "1 day" : `${age} days`}`
          : "";
      lines.push(
        `There are already ${count} ${reports} for this location nearby${agePart}. Rather than file a duplicate request, we are asking the Disabilities Commission to follow up on the existing reports.`,
      );
    } else {
      lines.push(
        "We are asking the Disabilities Commission to follow up on the existing reports for this location.",
      );
    }
    lines.push(
      "Please review these existing reports and advise on next steps for an accessible path of travel.",
    );
  } else if (route === "ada_curb_ramp_form") {
    lines.push(
      "This corner is missing a curb ramp or the ramp does not meet ADA requirements. Please install or repair a compliant curb ramp so the crossing is accessible.",
    );
  } else if (route === "ada_grievance") {
    lines.push(
      "A city service was not accessible because of a disability. I am filing this ADA grievance and request that the barrier be corrected and that I be contacted about next steps.",
    );
  } else {
    // 311 sidewalk routes.
    lines.push(
      "Please inspect and repair the sidewalk at this location so it is safe and accessible for people who use wheelchairs, walkers, and other mobility aids.",
    );
  }

  lines.push("");
  lines.push("Thank you for your help.");

  const draft = lines.join("\n");
  // Strip any forbidden promise wording, then assert the result is clean.
  const cleaned = assertCleanWording(sanitizeWording(draft));
  return { draft_text: cleaned };
}

// ---------------------------------------------------------------------------
// request_approval  (control flow — no I/O)
// ---------------------------------------------------------------------------

/**
 * `request_approval(draft)` — STOP the run and wait for the resident to approve
 * or edit. Performs no I/O. Returns a {@link PauseSignal}; the loop maps this to
 * the `draft_ready` / awaiting-approval terminal state. Nothing is ever marked
 * ready or submitted without the resident's explicit approval action, even if
 * they said "just submit it" (Req 7.1–7.3, 7.7).
 */
export function requestApproval(draft: string): PauseSignal {
  return { paused: true, reason: "approval", prompt: draft };
}

// ---------------------------------------------------------------------------
// schedule_followup  (clamped via clock.ts)
// ---------------------------------------------------------------------------

/**
 * `schedule_followup(days)` — set `clock_due_at`, clamped to
 * `[opened_at, opened_at + 90 days]` via `scheduleFollowUp` (clock.ts).
 *
 * A negative `days` clamps up to `opened_at`; more than 90 days clamps down to
 * `opened_at + 90 days` (Req 8.1, 8.2). `openedAt` is injected because the tool
 * signature in case-agent.md takes only `days`; the loop supplies the case's
 * open date. Returns the clamped due date as an ISO 8601 string.
 */
export function scheduleFollowup(days: number, openedAt: Date): ScheduleFollowupResult {
  const due = scheduleFollowUp(openedAt, days);
  return { clock_due_at: due.toISOString() };
}

// ---------------------------------------------------------------------------
// check_case_status
// ---------------------------------------------------------------------------

/**
 * `check_case_status(city_case_id)` — look up a case's status in the 311
 * dataset by `case_id`. Delegates to the server-only 311 client via an injected
 * lookup. On failure it returns a typed fallback for the loop to record
 * (Req 5.6). The injected `lookupStatus` keeps this independent of the client's
 * eventual by-id query (and testable without a live call).
 */
export async function checkCaseStatus(
  cityCaseId: string,
  deps: { lookupStatus: (caseId: string) => Promise<{ ok: true; status: string } | { ok: false; error: string }> },
): Promise<CheckCaseStatusResult> {
  const id = typeof cityCaseId === "string" ? cityCaseId.trim() : "";
  if (id.length === 0) {
    return { ok: false, error: "A city case number is needed to check status." };
  }
  return deps.lookupStatus(id);
}

// ---------------------------------------------------------------------------
// notify_caregiver  (in-app notice only — never a call)
// ---------------------------------------------------------------------------

/**
 * `notify_caregiver(message)` — record an in-app notice for the caregiver. This
 * NEVER places a phone call; voice calls are reserved for the deterministic
 * check-in chain. The persistence of the notice is the route handler's job; the
 * tool itself just acknowledges the in-app notice so the loop can continue.
 *
 * `message` is sanitized of forbidden promise wording as a precaution.
 */
export function notifyCaregiver(message: string): NotifyCaregiverResult {
  // Sanitize defensively; the return shape carries no text, but any downstream
  // persistence should store the cleaned message.
  void sanitizeWording(typeof message === "string" ? message : "");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// ask_user  (control flow — no I/O)
// ---------------------------------------------------------------------------

/**
 * `ask_user(question)` — STOP the run with a question for the resident.
 * Performs no I/O. Returns a {@link PauseSignal} the loop maps to the
 * `asked_user` terminal state (Req 5.4). Used when the agent is unsure (for
 * example, an unclear photo).
 */
export function askUser(question: string): PauseSignal {
  return { paused: true, reason: "question", prompt: question };
}
