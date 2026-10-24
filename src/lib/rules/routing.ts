/**
 * Routing guidance: pure functions only (no I/O, no `server-only`).
 *
 * These decide where a reported barrier should go. Sidewalk barriers route to
 * 311 unless enough open reports already exist nearby, in which case the Case
 * Agent escalates to the Disabilities Commission instead of filing a duplicate.
 * Curb-ramp and disability-access-denial barriers route to their dedicated
 * forms. All logic is deterministic and property-testable with fast-check
 * (see Property 3).
 *
 * Route ids are kept consistent with the `cases.route` CHECK constraint in the
 * schema (design.md Data Models).
 *
 * Requirements: 6.1, 6.2, 6.3
 */

/** Minimum open nearby reports that triggers escalation instead of a new 311. */
export const ESCALATION_THRESHOLD = 2;

/** Boston 311 service name for a sidewalk blocked by an obstruction (Req 6.1). */
export const SERVICE_BLOCKED_SIDEWALK = 'Illegally Blocked Sidewalk';

/** Boston 311 service name for a damaged / broken sidewalk (Req 6.1). */
export const SERVICE_SIDEWALK_REPAIR = 'Sidewalk Repair';

/**
 * Barrier classifications the Case Agent can act on. `other` has no automatic
 * route and is handled by a human / asked_user path.
 */
export type BarrierType =
  | 'blocked_sidewalk'
  | 'broken_sidewalk'
  | 'missing_curb_ramp'
  | 'access_denial'
  | 'other';

/** Route ids, matching the `cases.route` CHECK constraint. */
export type Route =
  | '311_sidewalk_repair'
  | '311_blocked_sidewalk'
  | 'escalation_disabilities_commission'
  | 'ada_curb_ramp_form'
  | 'ada_grievance';

/**
 * The two possible dispositions for a sidewalk barrier: draft a fresh 311
 * report, or escalate to the Disabilities Commission because duplicates exist.
 */
export type SidewalkDecision = 'draft_311' | 'escalate';

/**
 * Decide whether a sidewalk barrier should be filed as a new 311 report or
 * escalated. Escalate iff 2 or more open reports of the same service type
 * already exist nearby (within 75 m); otherwise draft a new 311 report
 * (Req 6.1, 6.2).
 *
 * `open_count` is the nearby open-report count supplied by the privacy-safe
 * `search_nearby_311` lookup (it never exposes addresses or coordinates).
 */
export function decideSidewalkRoute(nearby: { open_count: number }): SidewalkDecision {
  return nearby.open_count >= ESCALATION_THRESHOLD ? 'escalate' : 'draft_311';
}

/**
 * The Boston 311 service name for a sidewalk barrier type: "Illegally Blocked
 * Sidewalk" for an obstruction, "Sidewalk Repair" for damage (Req 6.1).
 */
export function sidewalkServiceName(
  barrier: 'blocked_sidewalk' | 'broken_sidewalk',
): string {
  return barrier === 'blocked_sidewalk'
    ? SERVICE_BLOCKED_SIDEWALK
    : SERVICE_SIDEWALK_REPAIR;
}

/**
 * Select the route for a barrier, given the nearby open-report count for
 * sidewalk cases (Req 6).
 *
 * - `blocked_sidewalk` / `broken_sidewalk`: route to the matching 311 service
 *   unless 2+ open reports already exist nearby, in which case escalate to the
 *   Disabilities Commission (Req 6.1, 6.2).
 * - `missing_curb_ramp`: Boston ADA Curb Ramp Request Form.
 * - `access_denial`: ADA grievance to the Disabilities Commission.
 * - `other`: no automatic route (`null`); handled by a human path.
 *
 * `nearby` defaults to zero open reports, so a sidewalk barrier with no nearby
 * data routes to a fresh 311 report.
 */
export function selectRoute(
  barrier: BarrierType,
  nearby: { open_count: number } = { open_count: 0 },
): Route | null {
  switch (barrier) {
    case 'blocked_sidewalk':
      return decideSidewalkRoute(nearby) === 'escalate'
        ? 'escalation_disabilities_commission'
        : '311_blocked_sidewalk';
    case 'broken_sidewalk':
      return decideSidewalkRoute(nearby) === 'escalate'
        ? 'escalation_disabilities_commission'
        : '311_sidewalk_repair';
    case 'missing_curb_ramp':
      return 'ada_curb_ramp_form';
    case 'access_denial':
      return 'ada_grievance';
    case 'other':
      return null;
  }
}
