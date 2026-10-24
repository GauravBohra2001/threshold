import { describe, expect, it } from "vitest";

import {
  decideSidewalkRoute,
  ESCALATION_THRESHOLD,
  selectRoute,
  SERVICE_BLOCKED_SIDEWALK,
  SERVICE_SIDEWALK_REPAIR,
  sidewalkServiceName,
} from "./routing";

describe("decideSidewalkRoute", () => {
  it("drafts a 311 report when no open reports are nearby", () => {
    expect(decideSidewalkRoute({ open_count: 0 })).toBe("draft_311");
  });

  it("drafts a 311 report when a single open report is nearby", () => {
    expect(decideSidewalkRoute({ open_count: 1 })).toBe("draft_311");
  });

  it("escalates at the threshold of 2 open reports", () => {
    expect(ESCALATION_THRESHOLD).toBe(2);
    expect(decideSidewalkRoute({ open_count: 2 })).toBe("escalate");
  });

  it("escalates when more than 2 open reports are nearby", () => {
    expect(decideSidewalkRoute({ open_count: 5 })).toBe("escalate");
  });
});

describe("sidewalkServiceName", () => {
  it("maps a blocked sidewalk to the blocked-sidewalk service name", () => {
    expect(sidewalkServiceName("blocked_sidewalk")).toBe(SERVICE_BLOCKED_SIDEWALK);
  });

  it("maps a broken sidewalk to the sidewalk-repair service name", () => {
    expect(sidewalkServiceName("broken_sidewalk")).toBe(SERVICE_SIDEWALK_REPAIR);
  });
});

describe("selectRoute", () => {
  it("routes a blocked sidewalk with no duplicates to 311 blocked sidewalk", () => {
    expect(selectRoute("blocked_sidewalk", { open_count: 0 })).toBe("311_blocked_sidewalk");
  });

  it("routes a broken sidewalk with no duplicates to 311 sidewalk repair", () => {
    expect(selectRoute("broken_sidewalk", { open_count: 1 })).toBe("311_sidewalk_repair");
  });

  it("escalates a sidewalk barrier with 2+ nearby open reports", () => {
    expect(selectRoute("blocked_sidewalk", { open_count: 2 })).toBe(
      "escalation_disabilities_commission",
    );
    expect(selectRoute("broken_sidewalk", { open_count: 3 })).toBe(
      "escalation_disabilities_commission",
    );
  });

  it("defaults a sidewalk barrier to 311 when no nearby data is given", () => {
    expect(selectRoute("blocked_sidewalk")).toBe("311_blocked_sidewalk");
  });

  it("routes a missing curb ramp to the ADA curb ramp form", () => {
    expect(selectRoute("missing_curb_ramp")).toBe("ada_curb_ramp_form");
  });

  it("routes a disability access denial to an ADA grievance", () => {
    expect(selectRoute("access_denial")).toBe("ada_grievance");
  });

  it("has no automatic route for an unclassified barrier", () => {
    expect(selectRoute("other")).toBeNull();
  });
});
