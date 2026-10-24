import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

// --- Mocks for the route's server-only dependencies -------------------------

const lookupMock = vi.fn();
vi.mock("@/lib/data/geocoder", () => ({
  lookup: (...args: unknown[]) => lookupMock(...args),
}));

// A chainable Supabase query-builder stub. insert().select().single() resolves
// to whatever `insertResult` is set to for the test.
let insertResult: { data: unknown; error: unknown } = {
  data: { id: "house-1", invite_code: "A1B2C3D4" },
  error: null,
};
const dbMock = vi.fn((..._args: unknown[]) => ({
  insert: () => ({
    select: () => ({
      single: async () => insertResult,
    }),
  }),
}));
vi.mock("@/lib/data/supabase", () => ({
  db: (...args: unknown[]) => dbMock(...args),
}));

const setHouseholdCookieMock = vi.fn(async (..._args: unknown[]) => undefined);
const getCurrentHouseholdMock = vi.fn((..._args: unknown[]) => undefined as unknown);
vi.mock("@/lib/auth/household", () => ({
  setHouseholdCookie: (...args: unknown[]) => setHouseholdCookieMock(...args),
  getCurrentHousehold: (...args: unknown[]) => getCurrentHouseholdMock(...args),
}));

import { POST, GET } from "@/app/api/household/route";

/** Build a minimal NextRequest-like object the handler reads from. */
function makeRequest(body: unknown): NextRequest {
  return {
    json: async () => body,
    nextUrl: { origin: "https://threshold.test" },
  } as unknown as NextRequest;
}

const okMatch = {
  ok: true as const,
  match: {
    lat: 42.3,
    lng: -71.06,
    countyFips: "25025",
    stateFips: "25",
    matchedAddress: "123 DORCHESTER AVE, BOSTON, MA",
    neighborhood: null,
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  insertResult = { data: { id: "house-1", invite_code: "A1B2C3D4" }, error: null };
});

describe("POST /api/household", () => {
  it("creates a household, stores geocoded values, sets the cookie, returns 201", async () => {
    lookupMock.mockResolvedValue(okMatch);

    const res = await POST(
      makeRequest({ resident_name: "Maria", address: "123 Dorchester Ave" }),
    );
    expect(res.status).toBe(201);

    const json = (await res.json()) as Record<string, unknown>;
    expect(json.id).toBe("house-1");
    expect(json.invite_code).toBe("A1B2C3D4");
    expect(json.lat).toBe(42.3);
    expect(json.county_fips).toBe("25025");
    expect(json.invite_url).toBe("https://threshold.test/status?code=A1B2C3D4");
    expect(setHouseholdCookieMock).toHaveBeenCalledWith("house-1");

    // Geocoder was called with the 10s budget.
    expect(lookupMock).toHaveBeenCalledWith("123 Dorchester Ave", {
      timeoutMs: 10_000,
    });
  });

  it("returns a 400 field error for an invalid name and does not geocode or save", async () => {
    const res = await POST(makeRequest({ resident_name: "", address: "1 Main St" }));
    expect(res.status).toBe(400);
    const json = (await res.json()) as { field: string; message: string };
    expect(json.field).toBe("resident_name");
    expect(lookupMock).not.toHaveBeenCalled();
    expect(dbMock).not.toHaveBeenCalled();
  });

  it("returns a 502 plain-language message on a geocoder timeout (Req 1.4)", async () => {
    lookupMock.mockResolvedValue({
      ok: false,
      reason: "timeout",
      message: "ignored",
    });

    const res = await POST(
      makeRequest({ resident_name: "Maria", address: "1 Main St" }),
    );
    expect(res.status).toBe(502);
    const json = (await res.json()) as { message: string };
    expect(json.message).toMatch(/try again/i);
    expect(json.message).not.toMatch(/stack|Error:/);
    expect(dbMock).not.toHaveBeenCalled();
    expect(setHouseholdCookieMock).not.toHaveBeenCalled();
  });

  it("returns a 502 'could not locate' message on zero matches (Req 1.5)", async () => {
    lookupMock.mockResolvedValue({
      ok: false,
      reason: "no_match",
      message: "ignored",
    });

    const res = await POST(
      makeRequest({ resident_name: "Maria", address: "nowhere" }),
    );
    expect(res.status).toBe(502);
    const json = (await res.json()) as { message: string };
    expect(json.message).toMatch(/could not locate/i);
    expect(dbMock).not.toHaveBeenCalled();
  });

  it("returns a friendly 502 when persistence fails, with no cookie set", async () => {
    lookupMock.mockResolvedValue(okMatch);
    insertResult = { data: null, error: { code: "08006", message: "down" } };

    const res = await POST(
      makeRequest({ resident_name: "Maria", address: "1 Main St" }),
    );
    expect(res.status).toBe(502);
    const json = (await res.json()) as { message: string };
    expect(json.message).toMatch(/try again/i);
    expect(setHouseholdCookieMock).not.toHaveBeenCalled();
  });

  it("returns a 400 when the request body is not valid JSON", async () => {
    const badRequest = {
      json: async () => {
        throw new Error("bad json");
      },
      nextUrl: { origin: "https://threshold.test" },
    } as unknown as NextRequest;

    const res = await POST(badRequest);
    expect(res.status).toBe(400);
  });
});

describe("GET /api/household", () => {
  it("returns the current household from the cookie", async () => {
    getCurrentHouseholdMock.mockResolvedValue({
      id: "house-1",
      resident_name: "Maria",
      address: "123 Dorchester Ave",
      lat: 42.3,
      lng: -71.06,
      county_fips: "25025",
      neighborhood: "Dorchester",
      caregiver_name: null,
      caregiver_phone: null,
      invite_code: "A1B2C3D4",
      is_demo: false,
      sim_offset_days: 0,
      created_at: "2025-01-01T00:00:00Z",
    });

    const res = await GET(makeRequest({}));
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.id).toBe("house-1");
    expect(json.neighborhood).toBe("Dorchester");
    expect(json.invite_url).toBe("https://threshold.test/status?code=A1B2C3D4");
  });

  it("returns 404 when no household cookie is present", async () => {
    getCurrentHouseholdMock.mockResolvedValue(null);
    const res = await GET(makeRequest({}));
    expect(res.status).toBe(404);
  });

  it("returns a friendly 502 when the data store is unavailable", async () => {
    getCurrentHouseholdMock.mockRejectedValue(new Error("store down"));
    const res = await GET(makeRequest({}));
    expect(res.status).toBe(502);
    const json = (await res.json()) as { message: string };
    expect(json.message).not.toMatch(/store down/);
  });
});
