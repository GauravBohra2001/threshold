/**
 * Pure presentation logic for the caregiver live check-in status view.
 *
 * Kept free of React and I/O so it can be unit-tested in the node environment.
 * The caregiver screen polls `GET /api/checkin/status?household=<id>` every 3
 * seconds (no realtime subscriptions) and feeds the parsed response here to
 * derive exactly what the big status block should show (Req 13.3–13.6, 12.3,
 * 12.9).
 *
 * Requirements: 13.3, 13.4, 13.5, 13.6, 12.3, 12.9, 23.10
 */

/** The chain outcome values the status endpoint can report. */
export type CheckinOutcome = "answered" | "caregiver_called" | "advise_911";

/** Shape returned by GET /api/checkin/status (task 22.1). */
export interface CheckinStatusResponse {
  has_checkin: boolean;
  state: string | null;
  outcome: CheckinOutcome | null;
  is_simulated_call: boolean;
  alert_headline: string | null;
}

/** The three rendered tones for the big status block. */
export type StatusTone = "waiting" | "success" | "attention" | "danger";

/** A fully resolved view model for the status block. */
export interface StatusView {
  tone: StatusTone;
  /** The large heading read across a room. */
  heading: string;
  /** One supporting sentence, or null when none is needed. */
  detail: string | null;
  /** Whether to show the "Simulated call (demo mode)" badge. */
  showSimulatedCallBadge: boolean;
  /** Whether to show the "Call 911 if this is an emergency." danger line. */
  showEmergencyAdvice: boolean;
}

/** Fallback name when the resident's name is not available to the caregiver. */
export const GENERIC_RESIDENT = "The resident";

/** Text shown (retaining the last status) when a poll fails or times out. */
export const REFRESH_FAILED_MESSAGE = "Status could not be refreshed.";

/** The chain's terminal emergency line, shown verbatim (Req 12.3). */
export const EMERGENCY_ADVICE = "Call 911 if this is an emergency.";

/**
 * Builds the view model for the big status block from a poll response.
 *
 * `residentName` is the resident's display name when the caregiver context has
 * it; otherwise the generic fallback is used. The mapping never promises an
 * outcome and always surfaces the emergency advice at chain end (Req 12.3).
 */
export function statusView(
  response: CheckinStatusResponse,
  residentName?: string | null,
): StatusView {
  const name =
    residentName && residentName.trim().length > 0
      ? residentName.trim()
      : GENERIC_RESIDENT;

  if (!response.has_checkin) {
    return {
      tone: "waiting",
      heading: "No active check-in",
      detail: response.alert_headline
        ? `Last alert: ${response.alert_headline}`
        : "You will see check-in updates here.",
      showSimulatedCallBadge: false,
      showEmergencyAdvice: false,
    };
  }

  switch (response.outcome) {
    case "answered":
      return {
        tone: "success",
        heading: `${name} checked in`,
        detail: null,
        showSimulatedCallBadge: false,
        showEmergencyAdvice: false,
      };
    case "caregiver_called":
      return {
        tone: "attention",
        heading: `${name} hasn't answered. Calling you now.`,
        detail: null,
        showSimulatedCallBadge: response.is_simulated_call,
        showEmergencyAdvice: false,
      };
    case "advise_911":
      return {
        tone: "danger",
        heading: EMERGENCY_ADVICE,
        detail: `We could not reach ${name} or you.`,
        showSimulatedCallBadge: false,
        showEmergencyAdvice: true,
      };
    default:
      // Check-in in progress, waiting for the resident to answer.
      return {
        tone: "waiting",
        heading: `Checking in with ${name}`,
        detail: response.alert_headline
          ? `Alert: ${response.alert_headline}`
          : "Waiting for a response.",
        showSimulatedCallBadge: false,
        showEmergencyAdvice: false,
      };
  }
}

/**
 * Narrows unknown JSON (from the poll fetch) into a CheckinStatusResponse.
 * Returns null when the payload does not match, so the caller treats it like a
 * failed poll and retains the last status (Req 13.6).
 */
export function parseStatusResponse(
  value: unknown,
): CheckinStatusResponse | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.has_checkin !== "boolean") {
    return null;
  }

  const outcome =
    record.outcome === "answered" ||
    record.outcome === "caregiver_called" ||
    record.outcome === "advise_911"
      ? record.outcome
      : null;

  return {
    has_checkin: record.has_checkin,
    state: typeof record.state === "string" ? record.state : null,
    outcome,
    is_simulated_call: record.is_simulated_call === true,
    alert_headline:
      typeof record.alert_headline === "string" ? record.alert_headline : null,
  };
}

/**
 * Whether the status changed between two poll responses, used to decide if the
 * assertive live region should re-announce (Req 13.3, 13.4). Compares the
 * fields that affect what the caregiver sees.
 */
export function statusChanged(
  previous: CheckinStatusResponse | null,
  next: CheckinStatusResponse,
): boolean {
  if (previous === null) {
    return true;
  }
  return (
    previous.has_checkin !== next.has_checkin ||
    previous.outcome !== next.outcome ||
    previous.is_simulated_call !== next.is_simulated_call
  );
}
