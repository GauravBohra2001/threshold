/**
 * Unit tests for the Case Agent tools (src/lib/agent/tools.ts).
 *
 * The data clients are mocked so no live call is made. The two load-bearing
 * guarantees are asserted directly:
 *  - `searchNearby311` never returns an address or a coordinate (Req 6.4, 10.4).
 *  - `scheduleFollowup` clamps clock_due_at to [opened_at, opened_at+90d]
 *    (Req 8.1, 8.2).
 * Plus honesty-clean drafting (Req 12.8) and the control-flow sentinels.
 */

import { describe, it, expect } from "vitest";
import { addDays } from "date-fns";
import {
  searchNearby311,
  scheduleFollowup,
  classifyPhoto,
  draftFiling,
  lookupRight,
  requestApproval,
  askUser,
  notifyCaregiver,
  neighborhoodOnTimeRatePct,
  checkCaseStatus,
  type RightEntry,
} from "@/lib/agent/tools";
import type { NearbyReport } from "@/lib/data/boston311";

// A barrier location in Dorchester for distance filtering.
const ORIGIN = { lat: 42.3, lng: -71.07 };
const NOW = new Date("2025-02-01T00:00:00.000Z");

/** Build a NearbyReport at an offset (meters-ish) from the origin. */
function report(overrides: Partial<NearbyReport>): NearbyReport {
  return {
    case_id: "101",
    service_name: "Sidewalk Repair",
    open_date: "2025-01-01T00:00:00.000Z",
    case_status: "Open",
    target_close_date: null,
    latitude: ORIGIN.lat,
    longitude: ORIGIN.lng,
    ...overrides,
  };
}

describe("searchNearby311 — privacy", () => {
  it("returns only the three aggregate fields; never an address or coordinate", async () => {
    const reports = [
      report({ case_id: "1", open_date: "2025-01-20T00:00:00.000Z" }),
      report({ case_id: "2", open_date: "2025-01-10T00:00:00.000Z" }),
    ];
    const res = await searchNearby311(
      ORIGIN.lat,
      ORIGIN.lng,
      75,
      ["Sidewalk Repair"],
      { searchNearbyOpen: async () => ({ ok: true, data: reports }) },
      NOW,
    );

    expect(res.ok).toBe(true);
    if (!res.ok) return;

    // Exactly the three allowed keys, nothing else.
    expect(Object.keys(res).sort()).toEqual(
      ["oldest_open_age_days", "ok", "open_count", "overdue_count"].sort(),
    );

    // No address- or coordinate-bearing key leaked anywhere in the result.
    const serialized = JSON.stringify(res);
    for (const forbidden of [
      "latitude",
      "longitude",
      "lat",
      "lng",
      "full_address",
      "case_id",
      "address",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }

    expect(res.open_count).toBe(2);
    // Oldest open report is 2025-01-10, i.e. 22 whole days before NOW.
    expect(res.oldest_open_age_days).toBe(22);
    expect(res.overdue_count).toBe(0);
  });

  it("excludes reports outside the radius", async () => {
    const near = report({ case_id: "near", latitude: ORIGIN.lat, longitude: ORIGIN.lng });
    // ~1km north: well outside 75 m.
    const far = report({ case_id: "far", latitude: ORIGIN.lat + 0.01, longitude: ORIGIN.lng });
    const res = await searchNearby311(
      ORIGIN.lat,
      ORIGIN.lng,
      75,
      ["Sidewalk Repair"],
      { searchNearbyOpen: async () => ({ ok: true, data: [near, far] }) },
      NOW,
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.open_count).toBe(1);
  });

  it("counts overdue reports by target_close_date", async () => {
    const overdue = report({
      case_id: "od",
      target_close_date: "2025-01-15T00:00:00.000Z", // before NOW
    });
    const onTime = report({
      case_id: "ot",
      target_close_date: "2025-03-01T00:00:00.000Z", // after NOW
    });
    const res = await searchNearby311(
      ORIGIN.lat,
      ORIGIN.lng,
      75,
      ["Sidewalk Repair"],
      { searchNearbyOpen: async () => ({ ok: true, data: [overdue, onTime] }) },
      NOW,
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.overdue_count).toBe(1);
  });

  it("returns a typed fallback when the location cannot be resolved", async () => {
    const res = await searchNearby311(
      Number.NaN,
      Number.NaN,
      75,
      ["Sidewalk Repair"],
      { searchNearbyOpen: async () => ({ ok: true, data: [] }) },
      NOW,
    );
    expect(res.ok).toBe(false);
  });

  it("surfaces the data-client error as a typed fallback", async () => {
    const res = await searchNearby311(
      ORIGIN.lat,
      ORIGIN.lng,
      75,
      ["Sidewalk Repair"],
      { searchNearbyOpen: async () => ({ ok: false, error: "311 down" }) },
      NOW,
    );
    expect(res).toEqual({ ok: false, error: "311 down" });
  });
});

describe("scheduleFollowup — clamping (Req 8.1, 8.2)", () => {
  const openedAt = new Date("2025-02-01T00:00:00.000Z");

  it("clamps a negative/earlier-than-open request up to opened_at", () => {
    const res = scheduleFollowup(-5, openedAt);
    expect(res.clock_due_at).toBe(openedAt.toISOString());
  });

  it("clamps a request beyond 90 days down to opened_at + 90 days", () => {
    const res = scheduleFollowup(1000, openedAt);
    expect(res.clock_due_at).toBe(addDays(openedAt, 90).toISOString());
  });

  it("keeps an in-window request unchanged", () => {
    const res = scheduleFollowup(14, openedAt);
    expect(res.clock_due_at).toBe(addDays(openedAt, 14).toISOString());
  });

  it("always yields a due date within [opened_at, opened_at+90d]", () => {
    const lower = openedAt.getTime();
    const upper = addDays(openedAt, 90);
    for (const days of [-100, -1, 0, 1, 30, 90, 91, 10000]) {
      const due = new Date(scheduleFollowup(days, openedAt).clock_due_at).getTime();
      expect(due).toBeGreaterThanOrEqual(lower);
      expect(due).toBeLessThanOrEqual(upper.getTime());
    }
  });
});

describe("draftFiling — honesty-clean (Req 12.8)", () => {
  it("identifies Threshold as an AI assistant and contains no forbidden wording", () => {
    const { draft_text } = draftFiling("311_sidewalk_repair", {
      description: "Cracked sidewalk",
      neighborhood: "Dorchester",
    });
    expect(draft_text.toLowerCase()).toContain("ai assistant");
    for (const forbidden of ["you will receive", "guaranteed", "approved"]) {
      expect(draft_text.toLowerCase()).not.toContain(forbidden);
    }
  });

  it("cites the open count and age for an escalation draft", () => {
    const { draft_text } = draftFiling("escalation_disabilities_commission", {
      open_count: 3,
      oldest_open_age_days: 40,
    });
    expect(draft_text).toContain("3 open reports");
    expect(draft_text).toContain("40 days");
  });
});

describe("classifyPhoto", () => {
  it("maps a blocked-sidewalk label", async () => {
    const res = await classifyPhoto("data:image/jpeg;base64,x", {
      labelPhoto: async () => ({
        ok: true,
        value: {
          label: "Blocked sidewalk",
          description: "A car is parked across the sidewalk.",
          accessibility_relevant: true,
          kind: "home_feature",
        },
      }),
    });
    expect(res.barrier_type).toBe("blocked_sidewalk");
    expect(res.confidence).toBeGreaterThan(0);
  });

  it("falls back to 'other' when labeling fails", async () => {
    const res = await classifyPhoto("data:image/jpeg;base64,x", {
      labelPhoto: async () => ({ ok: false, reason: "timeout" }),
    });
    expect(res.barrier_type).toBe("other");
    expect(res.confidence).toBe(0);
  });
});

describe("lookupRight", () => {
  const library: RightEntry[] = [
    {
      id: "shelter-service-animal",
      plain_statement: "Shelters must allow service animals.",
      applies_when: "At a shelter with a service animal.",
      source_url: "https://www.ada.gov/topics/emergency-planning",
    },
  ];

  it("matches by substring and returns the source url", () => {
    const res = lookupRight("service animal", library);
    expect(res.entries).toHaveLength(1);
    expect(res.entries[0].source_url).toContain("ada.gov");
  });

  it("returns [] on no match or empty topic", () => {
    expect(lookupRight("nothing here", library).entries).toEqual([]);
    expect(lookupRight("", library).entries).toEqual([]);
  });

  it("returns [] when the library is absent (defensive default)", () => {
    expect(lookupRight("shelter", []).entries).toEqual([]);
  });
});

describe("control-flow and notice tools", () => {
  it("requestApproval returns an approval pause signal and does no I/O", () => {
    expect(requestApproval("draft text")).toEqual({
      paused: true,
      reason: "approval",
      prompt: "draft text",
    });
  });

  it("askUser returns a question pause signal", () => {
    expect(askUser("Is this a curb ramp?")).toEqual({
      paused: true,
      reason: "question",
      prompt: "Is this a curb ramp?",
    });
  });

  it("notifyCaregiver acknowledges an in-app notice only", () => {
    expect(notifyCaregiver("Please check on Maria.")).toEqual({ ok: true });
  });
});

describe("neighborhoodOnTimeRatePct", () => {
  it("converts a rate to a percentage", async () => {
    const res = await neighborhoodOnTimeRatePct("Dorchester", "Sidewalk Repair", {
      neighborhoodOnTimeRate: async () => ({
        ok: true,
        data: { onTime: 3, overdue: 1, rate: 0.75 },
      }),
    });
    expect(res).toEqual({ ok: true, on_time_pct: 75 });
  });

  it("passes null through when there are no resolved cases", async () => {
    const res = await neighborhoodOnTimeRatePct("Dorchester", "Sidewalk Repair", {
      neighborhoodOnTimeRate: async () => ({
        ok: true,
        data: { onTime: 0, overdue: 0, rate: null },
      }),
    });
    expect(res).toEqual({ ok: true, on_time_pct: null });
  });
});

describe("checkCaseStatus", () => {
  it("delegates to the injected lookup", async () => {
    const res = await checkCaseStatus("101004113333", {
      lookupStatus: async () => ({ ok: true, status: "Closed" }),
    });
    expect(res).toEqual({ ok: true, status: "Closed" });
  });

  it("rejects an empty case id with a typed fallback", async () => {
    const res = await checkCaseStatus("  ", {
      lookupStatus: async () => ({ ok: true, status: "Open" }),
    });
    expect(res.ok).toBe(false);
  });
});
