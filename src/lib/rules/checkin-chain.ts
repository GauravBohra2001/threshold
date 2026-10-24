/**
 * Check-in chain: an explicit, deterministic state machine (pure functions
 * only — no I/O, no model judgment, no `server-only`).
 *
 * A weather alert sends a check-in to the resident. If the resident answers
 * before the timeout the chain ends `answered`. If it times out, the server
 * places exactly one caregiver call. If that call confirms, the chain resolves;
 * if it fails or times out, the chain advises calling 911. Steps advance in
 * order, no step is skipped, and at most one caregiver call is placed per step.
 *
 * The chain is deterministic code, never model judgment (Req 12.6). The server
 * orchestrator reads `nextState`, performs the side effect the state dictates,
 * and records the outcome; these functions do no I/O so they stay
 * property-testable with fast-check (see Property 1).
 *
 * Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.10
 */

/** States of the check-in chain. ANSWERED, RESOLVED, and ADVISE_911 are terminal. */
export type ChainState =
  | 'SENT'
  | 'ANSWERED'
  | 'CALL_CAREGIVER'
  | 'RESOLVED'
  | 'ADVISE_911';

/** Events that drive the chain forward. */
export type ChainEvent =
  | { type: 'RESIDENT_ANSWERED' }
  | { type: 'CAREGIVER_CONFIRMED' }
  | { type: 'CALL_FAILED' } // caregiver call did not connect / was not answered
  | { type: 'TIMEOUT' }; // the applicable timeout elapsed

/** Live mode places real calls; replay mode is a labeled simulation. */
export type Mode = 'live' | 'replay';

/** Timeout before the chain advances, in milliseconds (Req 12.1, 12.3). */
export const LIVE_TIMEOUT_MS = 90_000;
export const REPLAY_TIMEOUT_MS = 15_000;

/** Minimum gap between real live calls across all chains (Req 12.10). */
export const MIN_LIVE_CALL_GAP_MS = 2 * 60 * 1000;

/** Whether a chain state is terminal (no further transitions). */
export function isTerminal(state: ChainState): boolean {
  return state === 'ANSWERED' || state === 'RESOLVED' || state === 'ADVISE_911';
}

/**
 * The timeout that applies before the chain advances: 90s live, 15s replay
 * (Req 12.1, 12.3).
 */
export function timeoutMs(mode: Mode): number {
  return mode === 'live' ? LIVE_TIMEOUT_MS : REPLAY_TIMEOUT_MS;
}

/**
 * The next chain state given the current state and an event. The transition
 * table is exhaustive and deterministic; any event not listed for a state
 * (and any event on a terminal state) leaves the state unchanged, so steps
 * advance in order, no step is skipped, and at most one caregiver call is
 * placed per step (Req 12.5).
 *
 * `mode` does not change the transition graph (it governs only the timeout
 * duration), but is part of the signature so callers pass it consistently.
 */
export function nextState(
  current: ChainState,
  event: ChainEvent,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  mode: Mode,
): ChainState {
  switch (current) {
    case 'SENT':
      if (event.type === 'RESIDENT_ANSWERED') return 'ANSWERED';
      if (event.type === 'TIMEOUT') return 'CALL_CAREGIVER';
      return current;
    case 'CALL_CAREGIVER':
      if (event.type === 'CAREGIVER_CONFIRMED') return 'RESOLVED';
      if (event.type === 'CALL_FAILED') return 'ADVISE_911';
      if (event.type === 'TIMEOUT') return 'ADVISE_911';
      return current;
    // Terminal states are unchanged by any event.
    case 'ANSWERED':
    case 'RESOLVED':
    case 'ADVISE_911':
      return current;
  }
}

/**
 * The outcome recorded on the check-in row for a given state, or `null` for a
 * non-outcome state (SENT / CALL_CAREGIVER are mid-chain).
 */
export function outcomeFor(
  state: ChainState,
): 'answered' | 'caregiver_called' | 'advise_911' | null {
  switch (state) {
    case 'ANSWERED':
      return 'answered';
    // Once a caregiver call is placed (CALL_CAREGIVER), the recorded outcome is
    // `caregiver_called`; a confirmed call (RESOLVED) keeps that outcome.
    case 'CALL_CAREGIVER':
    case 'RESOLVED':
      return 'caregiver_called';
    case 'ADVISE_911':
      return 'advise_911';
    case 'SENT':
      return null;
  }
}

/**
 * Whether a real Twilio call may be placed right now: true iff live calling is
 * allowed and either no call has been placed yet or at least 2 minutes have
 * elapsed since the last one (Req 12.10). `now` and `lastCallAt` are injected
 * so the decision stays deterministic.
 */
export function mayPlaceLiveCall(
  allowLive: boolean,
  lastCallAt: Date | null,
  now: Date,
): boolean {
  if (!allowLive) return false;
  if (lastCallAt === null) return true;
  return now.getTime() - lastCallAt.getTime() >= MIN_LIVE_CALL_GAP_MS;
}
