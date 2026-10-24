/**
 * Pure view-model for the resident check-in screen (ui-design.md, design P3 a/c).
 *
 * The check-in chain itself is a deterministic state machine in
 * `src/lib/rules/checkin-chain.ts` and the server orchestrator in
 * `POST /api/checkin`. This module holds only the *presentation* decisions the
 * resident screen makes from a check-in response: which heading and supporting
 * sentence to show, whether the 911 advisory is active, whether a
 * "Simulated call (demo mode)" badge applies, and how a status change should be
 * announced. Keeping it pure (no React, no I/O) lets it be unit-tested in the
 * node environment without a DOM.
 *
 * Requirements: 11.1, 12.3, 23.3, 23.10
 */

import type { ChainState } from "@/lib/rules/checkin-chain";

/** The exact end-of-chain advisory shown on both screens (Req 12.3). */
export const ADVISE_911_TEXT = "Call 911 if this is an emergency.";

/** The honesty label for a simulated caregiver call (Req 12.9). */
export const SIMULATED_CALL_LABEL = "Simulated call (demo mode)";

/** The two answer-button labels. Exactly two, each a named action (Req 11.1). */
export const ANSWER_YES_LABEL = "Yes, I'm okay";
export const ANSWER_HELP_LABEL = "I need help";

/**
 * The subset of the `POST /api/checkin` response the screen renders. Mirrors
 * the `CheckinView` the route returns (see `src/app/api/checkin/route.ts`).
 */
export interface CheckinResponse {
  id: string;
  alert_id: string;
  alert_headline: string;
  is_replay: boolean;
  state: ChainState;
  outcome: "answered" | "caregiver_called" | "advise_911" | null;
  simulated_call: boolean;
  simulated_call_label?: string;
  advisory?: string;
}

/** How the screen should present the current check-in. */
export interface CheckInView {
  /** Section heading, e.g. the "Are you okay?" question while active. */
  heading: string;
  /** One supporting sentence under the heading. */
  detail: string;
  /** True only in the SENT state: show the two answer buttons (Req 11.1). */
  showAnswerButtons: boolean;
  /** The 911 advisory text when the chain has reached its end, else null. */
  advisory: string | null;
  /** True when a labeled "Simulated call (demo mode)" badge applies (12.9). */
  showSimulatedCallBadge: boolean;
  /**
   * aria-live announcement for the current state. Alerts (the caregiver call
   * and the 911 advisory) are "assertive"; routine updates (answered) are
   * "polite" (Req 23.9, 23.10).
   */
  announcement: string;
  /** The politeness level for the announcement region (Req 23.10). */
  politeness: "polite" | "assertive";
}

/** The active check-in question shown while the resident can still answer. */
export const CHECKIN_QUESTION = "Are you okay?";

/**
 * Derive the screen's presentation from a check-in response. Pure: the same
 * response always yields the same view.
 *
 * - SENT: show "Are you okay?" and the two answer buttons.
 * - ANSWERED: confirm the resident checked in (polite announcement).
 * - CALL_CAREGIVER: the resident did not answer, so the caregiver is being
 *   called now; in demo mode this is a labeled simulated call. This is an
 *   alert, announced assertively.
 * - ADVISE_911: the chain ended; show exactly "Call 911 if this is an
 *   emergency." announced assertively (Req 12.3, 23.10).
 */
export function deriveCheckInView(response: CheckinResponse): CheckInView {
  switch (response.state) {
    case "SENT":
      return {
        heading: CHECKIN_QUESTION,
        detail: "Answer so your caregiver knows you are safe.",
        showAnswerButtons: true,
        advisory: null,
        showSimulatedCallBadge: false,
        announcement: "",
        politeness: "polite",
      };
    case "ANSWERED":
      return {
        heading: "You checked in",
        detail: "Your caregiver can see that you are okay.",
        showAnswerButtons: false,
        advisory: null,
        showSimulatedCallBadge: false,
        announcement: "You checked in. Your caregiver can see that you are okay.",
        politeness: "polite",
      };
    case "CALL_CAREGIVER":
      return {
        heading: "Calling your caregiver now",
        detail:
          "You did not answer in time, so we are calling your caregiver to check on you.",
        showAnswerButtons: false,
        advisory: null,
        showSimulatedCallBadge: response.simulated_call === true,
        announcement: "Calling your caregiver now.",
        politeness: "assertive",
      };
    case "ADVISE_911":
      return {
        heading: "No one has answered",
        detail: ADVISE_911_TEXT,
        showAnswerButtons: false,
        advisory: ADVISE_911_TEXT,
        showSimulatedCallBadge: response.simulated_call === true,
        announcement: ADVISE_911_TEXT,
        politeness: "assertive",
      };
    // RESOLVED is terminal on the caregiver side; the resident screen treats a
    // confirmed call the same as the calling state (the resident took no
    // further action). Fall back to the calling view.
    case "RESOLVED":
      return {
        heading: "Your caregiver was reached",
        detail: "Your caregiver confirmed they will check on you.",
        showAnswerButtons: false,
        advisory: null,
        showSimulatedCallBadge: response.simulated_call === true,
        announcement: "Your caregiver was reached.",
        politeness: "assertive",
      };
  }
}
