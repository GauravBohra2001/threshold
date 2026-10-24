import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { NextRequest } from "next/server";

// --- Mocks for the route's server-only dependencies -------------------------

const getCurrentHouseholdIdMock = vi.fn(
  async (..._args: unknown[]) => "house-1" as string | null,
);
vi.mock("@/lib/auth/household", () => ({
  getCurrentHouseholdId: (...args: unknown[]) =>
    getCurrentHouseholdIdMock(...args),
}));

// Chainable Supabase select().eq().order().limit().maybeSingle() stub.
let queryResult: { data: unknown; error: unknown } = { data: null, error: null };
let capturedSelect: string | null = null;
let capturedEq: { column: string; value: unknown } | null = null;
let capturedOrder: { column: string; options: unknown } | null = null;

const dbMock = vi.fn((..._args: unknown[]) => ({
  select: (columns: string) => {
    capturedSelect = columns;
    return {
      eq: (column: string, value: unknown) => {
        capturedEq = { column, value };
        return {
          order: (column2: string, options: unknown) => {
            capturedOrder = { column: column2, options };
            return {
              limit: () => ({
                maybeSingle: async () => queryResult,
              }),
            };
          },
        };
      },
    };
  },
}));

vi.mock("@/lib/data/supabase", () => ({
  db: (...args: unknown[]) => dbMock(...args),
}));

import { GET } from "@/app/api/checkin/status/route";

/** Build a minimal NextRequest-like object with a searchParams surface. */
function makeRequest(household?: string): NextRequest {
  const url = new URL("https://threshold.test/api/checkin/status");
  if (household !== undefined) {
    url.searchParams.set("household", household);
  }
  return {
    nextUrl: url,
  } as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  capturedSelect = null;
  capturedEq = null;
  capturedOrder = null;
  queryResult = { data: null, error: null };
  getCurrentHouseholdIdMock.mockResolvedValue("house-1");
  delete process.env.ALLOW_LIVE_CALLS;
});

afterEach(() => {
  delete process.env.ALLOW_LIVE_CALLS;
});

describe("GET /api/checkin/status", () => {
  it("returns the current check-in status for the household from the query param (Req 13.1)", async () => {
    queryResult = {
      data: {
        alert_headline: "Blizzard Warning",
        is_replay: true,
        answered_at: null,
        call_placed_at: null,
        outcome: null,
      },
      error: null,
    };

    const res = await GET(makeRequest("house-9"));
    expect(res.status).toBe(200);

    const json = (await res.json()) as Record<string, unknown>;
    expect(json.has_checkin).toBe(true);
    expect(json.state).toBe("sent");
    expect(json.outcome).toBeNull();
    expect(json.alert_headline).toBe("Blizzard Warning");

    // The caregiver's query param scoped the query to exactly that household
    // (Req 10.1): the cookie fallback was not consulted.
    expect(getCurrentHouseholdIdMock).not.toHaveBeenCalled();
    expect(capturedEq).toEqual({ column: "household_id", value: "house-9" });
    // Latest check-in first.
    expect(capturedOrder).toEqual({
      column: "sent_at",
      options: { ascending: false },
    });
  });

  it("falls back to the household cookie when no query param is present", async () => {
    getCurrentHouseholdIdMock.mockResolvedValue("house-cookie");
    queryResult = {
      data: {
        alert_headline: "",
        is_replay: false,
        answered_at: "2026-02-10T12:01:00Z",
        call_placed_at: null,
        outcome: "answered",
      },
      error: null,
    };

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.state).toBe("answered");
    expect(json.outcome).toBe("answered");
    expect(getCurrentHouseholdIdMock).toHaveBeenCalledTimes(1);
    expect(capturedEq).toEqual({ column: "household_id", value: "house-cookie" });
  });

  it("never exposes another resident's address, coordinates, or case details (Req 10.1, 10.3)", async () => {
    queryResult = {
      data: {
        alert_headline: "Flood Warning",
        is_replay: false,
        answered_at: null,
        call_placed_at: "2026-02-10T12:05:00Z",
        outcome: "caregiver_called",
      },
      error: null,
    };

    const res = await GET(makeRequest("house-1"));
    const json = (await res.json()) as Record<string, unknown>;

    // Only the allowlisted, non-identifying fields are present.
    expect(Object.keys(json).sort()).toEqual(
      [
        "alert_headline",
        "has_checkin",
        "is_simulated_call",
        "outcome",
        "state",
      ].sort(),
    );

    // The query selected no address, coordinate, or full_address column.
    expect(capturedSelect).not.toMatch(
      /address|full_address|lat|lng|latitude|longitude|resident_name|caregiver_phone|case_id/i,
    );

    const serialized = JSON.stringify(json);
    expect(serialized).not.toMatch(/full_address|latitude|longitude/i);
  });

  it("labels the caregiver call as simulated when live calls are disabled (Req 12.9)", async () => {
    delete process.env.ALLOW_LIVE_CALLS;
    queryResult = {
      data: {
        alert_headline: "Blizzard Warning",
        is_replay: false,
        answered_at: null,
        call_placed_at: "2026-02-10T12:05:00Z",
        outcome: "caregiver_called",
      },
      error: null,
    };

    const res = await GET(makeRequest("house-1"));
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.state).toBe("caregiver_called");
    expect(json.is_simulated_call).toBe(true);
  });

  it("does not mark a real live call as simulated when live calls are enabled", async () => {
    process.env.ALLOW_LIVE_CALLS = "true";
    queryResult = {
      data: {
        alert_headline: "Blizzard Warning",
        is_replay: false,
        answered_at: null,
        call_placed_at: "2026-02-10T12:05:00Z",
        outcome: "caregiver_called",
      },
      error: null,
    };

    const res = await GET(makeRequest("house-1"));
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.is_simulated_call).toBe(false);
  });

  it("derives advise_911 from the recorded outcome", async () => {
    queryResult = {
      data: {
        alert_headline: "Blizzard Warning",
        is_replay: true,
        answered_at: null,
        call_placed_at: "2026-02-10T12:05:00Z",
        outcome: "advise_911",
      },
      error: null,
    };

    const res = await GET(makeRequest("house-1"));
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.state).toBe("advise_911");
    expect(json.outcome).toBe("advise_911");
    // advise_911 is not a caregiver_called state, so no simulated-call label.
    expect(json.is_simulated_call).toBe(false);
  });

  it("returns an empty, non-error status when the household has no check-in", async () => {
    queryResult = { data: null, error: null };
    const res = await GET(makeRequest("house-1"));
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.has_checkin).toBe(false);
    expect(json.state).toBeNull();
    expect(json.outcome).toBeNull();
    expect(json.alert_headline).toBe("");
  });

  it("sets cache-control: no-store so each 3s poll is fresh (Req 13.1)", async () => {
    queryResult = { data: null, error: null };
    const res = await GET(makeRequest("house-1"));
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("returns 404 when no household can be resolved", async () => {
    getCurrentHouseholdIdMock.mockResolvedValue(null);
    const res = await GET(makeRequest());
    expect(res.status).toBe(404);
    expect(dbMock).not.toHaveBeenCalled();
  });

  it("returns a plain-language fallback with no stack trace on a data-store error (Req 13.6)", async () => {
    queryResult = { data: null, error: { message: "boom: db down" } };
    const res = await GET(makeRequest("house-1"));
    expect(res.status).toBe(502);
    const json = (await res.json()) as { message: string };
    expect(json.message).toMatch(/could not be refreshed/i);
    expect(json.message).not.toMatch(/stack|Error:|boom/);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});
