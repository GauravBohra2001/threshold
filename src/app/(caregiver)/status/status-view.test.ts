import { describe, expect, it } from "vitest";

import {
  type CheckinStatusResponse,
  EMERGENCY_ADVICE,
  GENERIC_RESIDENT,
  parseStatusResponse,
  statusChanged,
  statusView,
} from "./status-view";

function response(
  overrides: Partial<CheckinStatusResponse> = {},
): CheckinStatusResponse {
  return {
    has_checkin: true,
    state: "SENT",
    outcome: null,
    is_simulated_call: false,
    alert_headline: null,
    ...overrides,
  };
}

describe("statusView", () => {
  it("shows a success block with the resident's name when answered (Req 12.4)", () => {
    const view = statusView(response({ outcome: "answered" }), "Maria");
    expect(view.tone).toBe("success");
    expect(view.heading).toBe("Maria checked in");
    expect(view.showEmergencyAdvice).toBe(false);
    expect(view.showSimulatedCallBadge).toBe(false);
  });

  it("uses the generic resident label when no name is available", () => {
    const view = statusView(response({ outcome: "answered" }));
    expect(view.heading).toBe(`${GENERIC_RESIDENT} checked in`);
  });

  it("shows the calling-you-now attention state for caregiver_called", () => {
    const view = statusView(response({ outcome: "caregiver_called" }), "Maria");
    expect(view.tone).toBe("attention");
    expect(view.heading).toContain("hasn't answered");
    expect(view.showSimulatedCallBadge).toBe(false);
  });

  it("flags the simulated-call badge only when the call is simulated (Req 12.9)", () => {
    const simulated = statusView(
      response({ outcome: "caregiver_called", is_simulated_call: true }),
      "Maria",
    );
    expect(simulated.showSimulatedCallBadge).toBe(true);

    const real = statusView(
      response({ outcome: "caregiver_called", is_simulated_call: false }),
      "Maria",
    );
    expect(real.showSimulatedCallBadge).toBe(false);
  });

  it("shows the exact 911 advice at chain end (Req 12.3)", () => {
    const view = statusView(response({ outcome: "advise_911" }), "Maria");
    expect(view.tone).toBe("danger");
    expect(view.heading).toBe(EMERGENCY_ADVICE);
    expect(view.showEmergencyAdvice).toBe(true);
  });

  it("never promises an outcome and shows a waiting state in progress", () => {
    const view = statusView(response({ outcome: null }), "Maria");
    expect(view.tone).toBe("waiting");
    expect(view.showEmergencyAdvice).toBe(false);
  });

  it("shows a no-active-check-in state when there is none", () => {
    const view = statusView(response({ has_checkin: false, outcome: null }));
    expect(view.tone).toBe("waiting");
    expect(view.heading).toBe("No active check-in");
  });
});

describe("statusChanged", () => {
  it("reports a change on the first poll (previous null)", () => {
    expect(statusChanged(null, response())).toBe(true);
  });

  it("reports no change when outcome and flags are identical", () => {
    const previous = response({ outcome: "answered" });
    const next = response({ outcome: "answered" });
    expect(statusChanged(previous, next)).toBe(false);
  });

  it("reports a change when the outcome advances (Req 13.3)", () => {
    const previous = response({ outcome: null });
    const next = response({ outcome: "caregiver_called" });
    expect(statusChanged(previous, next)).toBe(true);
  });

  it("reports a change when the simulated-call flag flips", () => {
    const previous = response({
      outcome: "caregiver_called",
      is_simulated_call: false,
    });
    const next = response({
      outcome: "caregiver_called",
      is_simulated_call: true,
    });
    expect(statusChanged(previous, next)).toBe(true);
  });
});

describe("parseStatusResponse", () => {
  it("parses a well-formed payload", () => {
    const parsed = parseStatusResponse({
      has_checkin: true,
      state: "CALL_CAREGIVER",
      outcome: "caregiver_called",
      is_simulated_call: true,
      alert_headline: "Winter storm warning",
    });
    expect(parsed).toEqual({
      has_checkin: true,
      state: "CALL_CAREGIVER",
      outcome: "caregiver_called",
      is_simulated_call: true,
      alert_headline: "Winter storm warning",
    });
  });

  it("returns null for a non-object payload so the poll is treated as failed (Req 13.6)", () => {
    expect(parseStatusResponse(null)).toBeNull();
    expect(parseStatusResponse("nope")).toBeNull();
    expect(parseStatusResponse({})).toBeNull();
  });

  it("normalizes an unknown outcome to null", () => {
    const parsed = parseStatusResponse({
      has_checkin: true,
      outcome: "weird_value",
    });
    expect(parsed?.outcome).toBeNull();
  });

  it("defaults missing optional fields safely", () => {
    const parsed = parseStatusResponse({ has_checkin: false });
    expect(parsed).toEqual({
      has_checkin: false,
      state: null,
      outcome: null,
      is_simulated_call: false,
      alert_headline: null,
    });
  });
});
