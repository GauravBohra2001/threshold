import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ACCESSIBILITY_SERVICE_NAMES,
  neighborhoodOnTimeRate,
  searchNearbyOpen,
} from "@/lib/data/boston311";

/**
 * A raw CKAN row that DOES include full_address, to prove the client strips it.
 */
function rawRowWithAddress(overrides: Record<string, unknown> = {}) {
  return {
    case_id: "101000000001",
    service_name: "Sidewalk Repair",
    open_date: "2025-09-01 10:00:00",
    case_status: "Open",
    target_close_date: "2025-09-15 10:00:00",
    latitude: 42.3601,
    longitude: -71.0589,
    full_address: "123 Private St, Boston, MA 02118",
    zip_code: "02118",
    neighborhood: "South End",
    on_time: "ONTIME",
    ...overrides,
  };
}

function mockFetchJson(payload: unknown, ok = true) {
  return vi.fn(async () => ({
    ok,
    status: ok ? 200 : 500,
    json: async () => payload,
  })) as unknown as typeof fetch;
}

const ORIGINAL_RESOURCE_ID = process.env.BOSTON_311_RESOURCE_ID;

beforeEach(() => {
  process.env.BOSTON_311_RESOURCE_ID = "test-resource-id";
});

afterEach(() => {
  vi.restoreAllMocks();
  if (ORIGINAL_RESOURCE_ID === undefined) delete process.env.BOSTON_311_RESOURCE_ID;
  else process.env.BOSTON_311_RESOURCE_ID = ORIGINAL_RESOURCE_ID;
});

describe("searchNearbyOpen", () => {
  it("never returns or exposes full_address to callers", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchJson({
        success: true,
        result: { records: [rawRowWithAddress()] },
      }),
    );

    const result = await searchNearbyOpen({
      lat: 42.3601,
      lng: -71.0589,
      radiusM: 50,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveLength(1);

    const report = result.data[0];
    // The shape must not carry full_address (or any address-like field).
    expect(report).not.toHaveProperty("full_address");
    expect(report).not.toHaveProperty("zip_code");
    expect(report).not.toHaveProperty("neighborhood");
    expect(Object.keys(report).sort()).toEqual(
      [
        "case_id",
        "case_status",
        "latitude",
        "longitude",
        "open_date",
        "service_name",
        "target_close_date",
      ].sort(),
    );

    // Strongest guarantee: the private address string appears nowhere in output.
    expect(JSON.stringify(result.data)).not.toContain("123 Private St");
  });

  it("returns coordinates needed for in-code distance filtering", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchJson({
        success: true,
        result: { records: [rawRowWithAddress()] },
      }),
    );

    const result = await searchNearbyOpen({ lat: 42.36, lng: -71.06, radiusM: 50 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data[0].latitude).toBeCloseTo(42.3601, 4);
    expect(result.data[0].longitude).toBeCloseTo(-71.0589, 4);
  });

  it("drops rows missing coordinates or identifiers", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchJson({
        success: true,
        result: {
          records: [
            rawRowWithAddress({ latitude: null, longitude: null }),
            rawRowWithAddress({ case_id: "" }),
            rawRowWithAddress({ case_id: "valid-1" }),
          ],
        },
      }),
    );

    const result = await searchNearbyOpen({ lat: 42.36, lng: -71.06, radiusM: 50 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveLength(1);
    expect(result.data[0].case_id).toBe("valid-1");
  });

  it("returns a typed fallback (no stack trace) when fetch throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network boom");
      }) as unknown as typeof fetch,
    );

    const result = await searchNearbyOpen({ lat: 42.36, lng: -71.06, radiusM: 50 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/Boston 311/i);
    expect(result.error).not.toMatch(/boom|Error|stack/i);
  });

  it("returns a typed fallback on a non-success HTTP response", async () => {
    vi.stubGlobal("fetch", mockFetchJson({}, false));
    const result = await searchNearbyOpen({ lat: 42.36, lng: -71.06, radiusM: 50 });
    expect(result.ok).toBe(false);
  });

  it("rejects an invalid location without calling fetch", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy as unknown as typeof fetch);
    const result = await searchNearbyOpen({ lat: Number.NaN, lng: -71.06, radiusM: 50 });
    expect(result.ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("defaults to the accessibility service names", () => {
    expect(ACCESSIBILITY_SERVICE_NAMES).toContain("Sidewalk Repair");
    expect(ACCESSIBILITY_SERVICE_NAMES).toContain("Illegally Blocked Sidewalk");
  });
});

describe("neighborhoodOnTimeRate", () => {
  it("computes ONTIME / (ONTIME + OVERDUE)", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchJson({
        success: true,
        result: {
          records: [
            { on_time: "ONTIME", n: 8 },
            { on_time: "OVERDUE", n: 2 },
          ],
        },
      }),
    );

    const result = await neighborhoodOnTimeRate({
      neighborhood: "South End",
      service_name: "Sidewalk Repair",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.onTime).toBe(8);
    expect(result.data.overdue).toBe(2);
    expect(result.data.rate).toBeCloseTo(0.8, 5);
  });

  it("returns a null rate when there are no resolved cases", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchJson({ success: true, result: { records: [] } }),
    );
    const result = await neighborhoodOnTimeRate({
      neighborhood: "South End",
      service_name: "Sidewalk Repair",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.rate).toBeNull();
  });
});
