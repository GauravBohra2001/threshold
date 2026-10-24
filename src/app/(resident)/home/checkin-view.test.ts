import { describe, expect, it } from "vitest";

import type { ChainState } from "@/lib/rules/checkin-chain";
import {
  ADVISE_911_TEXT,
  ANSWER_HELP_LABEL,
  ANSWER_YES_LABEL,
  CHECKIN_QUESTION,
  deriveCheckInView,
  SIMULATED_CALL_LABEL,
  type CheckinResponse,
} from "./checkin-view";

/** Build a check-in response in a given state with sane defaults. */
function response(
  state: ChainState,
  overrides: Partial<CheckinResponse> = {},
): CheckinResponse {
  return {
    id: "c1",
    alert_id: "A1",
    alert_headline: "Blizzard warning",
    is_replay: true,
    state,
    outcome: null,
    simulated_call: false,
    ...overrides,
  };
}

describe("deriveCheckInView", () => {
  it("shows the two-button question in the SENT state (Req 11.1)", () => {
    const view = deriveCheckInView(response("SENT"));
    expect(view.heading).toBe(CHECKIN_QUESTION);
    expect(CHECKIN_QUESTION).toBe("Are you okay?");
    expect(view.showAnswerButtons).toBe(true);
    expect(view.advisory).toBeNull();
    // Exactly two distinct, named answer labels.
    expect(ANSWER_YES_LABEL).toBe("Yes, I'm okay");
    expect(ANSWER_HELP_LABEL).toBe("I need help");
    expect(ANSWER_YES_LABEL).not.toBe(ANSWER_HELP_LABEL);
  });

  it("announces an answered check-in politely with no advisory", () => {
    const view = deriveCheckInView(
      response("ANSWERED", { outcome: "answered" }),
    );
    expect(view.showAnswerButtons).toBe(false);
    expect(view.advisory).toBeNull();
    expect(view.politeness).toBe("polite");
    expect(view.announcement.length).toBeGreaterThan(0);
  });

  it("flags a simulated caregiver call and announces assertively (Req 12.9, 23.10)", () => {
    const view = deriveCheckInView(
      response("CALL_CAREGIVER", {
        outcome: "caregiver_called",
        simulated_call: true,
        simulated_call_label: SIMULATED_CALL_LABEL,
      }),
    );
    expect(view.showSimulatedCallBadge).toBe(true);
    expect(view.politeness).toBe("assertive");
    expect(view.advisory).toBeNull();
  });

  it("does not flag a simulated call for a real caregiver call", () => {
    const view = deriveCheckInView(
      response("CALL_CAREGIVER", {
        outcome: "caregiver_called",
        simulated_call: false,
      }),
    );
    expect(view.showSimulatedCallBadge).toBe(false);
  });

  it("shows exactly the 911 advisory, announced assertively, at end of chain (Req 12.3, 23.10)", () => {
    const view = deriveCheckInView(
      response("ADVISE_911", {
        outcome: "advise_911",
        advisory: ADVISE_911_TEXT,
      }),
    );
    expect(view.showAnswerButtons).toBe(false);
    expect(view.advisory).toBe("Call 911 if this is an emergency.");
    expect(view.announcement).toBe("Call 911 if this is an emergency.");
    expect(view.politeness).toBe("assertive");
  });

  it("only the SENT state offers the answer buttons", () => {
    const states: ChainState[] = [
      "ANSWERED",
      "CALL_CAREGIVER",
      "RESOLVED",
      "ADVISE_911",
    ];
    for (const state of states) {
      expect(deriveCheckInView(response(state)).showAnswerButtons).toBe(false);
    }
  });
});
