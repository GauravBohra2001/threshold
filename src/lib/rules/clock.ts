/**
 * Simulated-time clock: pure functions only (no I/O, no `server-only`).
 *
 * These back the fast-forward demo control and the case follow-up clock.
 * `now` is always an injected input so the functions stay deterministic and
 * property-testable with fast-check (see Property 5 and Property 6).
 *
 * Requirements: 8.1, 8.2, 8.7, 20.8
 */

import { addDays } from 'date-fns';

/** Days added by a single "Fast-forward 14 days (simulated)" activation. */
export const FAST_FORWARD_DAYS = 14;

/** Maximum span of a case follow-up window, measured from the open date. */
export const MAX_FOLLOW_UP_DAYS = 90;

/** The portion of a Household needed to compute simulated time. */
export interface HouseholdClock {
  sim_offset_days: number;
}

/**
 * The household's current simulated instant: `now` shifted forward by
 * `sim_offset_days` days. `now` is injected (defaulting to the real clock only
 * at the call site) so callers in route handlers pass the wall clock while
 * tests pass a fixed instant.
 */
export function simNow(household: HouseholdClock, now: Date = new Date()): Date {
  return addDays(now, household.sim_offset_days);
}

/**
 * The next `sim_offset_days` value after a fast-forward activation: the current
 * offset plus exactly 14 days (Req 8.3, 20.8).
 */
export function fastForward(offsetDays: number): number {
  return offsetDays + FAST_FORWARD_DAYS;
}

/**
 * Clamp a requested follow-up date to the valid window
 * `[openDate, openDate + 90 days]` (Req 8.1, 8.2).
 *
 * A requested value earlier than `openDate` (including from a negative
 * `days`) is clamped up to `openDate`; a value beyond `openDate + 90 days`
 * is clamped down to that upper bound. The result always satisfies
 * `openDate <= result <= openDate + 90 days`.
 */
export function clampClockDueAt(openDate: Date, requested: Date): Date {
  const lower = openDate;
  const upper = addDays(openDate, MAX_FOLLOW_UP_DAYS);
  const requestedMs = requested.getTime();
  if (requestedMs < lower.getTime()) return new Date(lower.getTime());
  if (requestedMs > upper.getTime()) return new Date(upper.getTime());
  return new Date(requestedMs);
}

/**
 * Schedule a follow-up `days` after `openDate`, clamped to the valid window
 * `[openDate, openDate + 90 days]`. A negative `days` clamps to `openDate`;
 * more than 90 days clamps to `openDate + 90 days` (Req 8.1, 8.2).
 */
export function scheduleFollowUp(openDate: Date, days: number): Date {
  return clampClockDueAt(openDate, addDays(openDate, days));
}

/**
 * Whether a case follow-up is due: true iff the simulated instant is strictly
 * later than the clock due date (Req 8.4, 8.7).
 */
export function isFollowUpDue(clockDueAt: Date, simNowInstant: Date): boolean {
  return simNowInstant.getTime() > clockDueAt.getTime();
}
