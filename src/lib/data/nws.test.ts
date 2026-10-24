import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildActiveAlertsUrl,
  clampTimeout,
  fetchActiveAlerts,
  resolveUserAgent,
  type NwsResult,
} from "./nws";

/** Build a Response-like object with a JSON body for an injected fetch. */
function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
  } as unknown as Response;
}

/** A minimal GeoJSON FeatureCollection with one alert feature. */
const oneAlertBody = {
  features: [
    {
      id: "urn:oid:2.49.0.1.840.0.abc123",
      properties: {
        event: "Blizzard Warning",
        headline: "Blizzard Warning issued for Suffolk County",
        areaDesc: "Suffolk, MA",
        severity: "Severe",
        effective: "2026-02-01T06:00:00-05:00",
        expires: "2026-02-02T06:00:00-05:00",
      },
    },
  ],
};

describe("clampTimeout", () => {
  it("defaults to 10s when undefined or NaN", () => {
    expect(clampTimeout(undefined)).toBe(10_000);
    expect(clampTimeout(NaN)).toBe(10_000);
  });

  it("clamps into the inclusive [1000, 30000] range", () => {
    expect(clampTimeout(500)).toBe(1_000);
    expect(clampTimeout(999_999)).toBe(30_000);
    expect(clampTimeout(5_000)).toBe(5_000);
  });
});

describe("resolveUserAgent", () => {
  const ORIGINAL_ENV = { ...process.env };
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("prefers an explicit override", () => {
    expect(resolveUserAgent("Threshold (demo@example.com)")).toBe(
      "Threshold (demo@example.com)",
    );
  });

  it("falls back to NWS_USER_AGENT and trims it", () => {
    process.env.NWS_USER_AGENT = "  Threshold-UA  ";
    expect(resolveUserAgent()).toBe("Threshold-UA");
  });

  it("returns null when neither yields a non-empty value", () => {
    delete process.env.NWS_USER_AGENT;
    expect(resolveUserAgent()).toBeNull();
    expect(resolveUserAgent("   ")).toBeNull();
  });
});

describe("buildActiveAlertsUrl", () => {
  it("targets the active-alerts endpoint with a point parameter", () => {
    const url = new URL(buildActiveAlertsUrl(42.3601, -71.0589));
    expect(url.origin + url.pathname).toBe("https://api.weather.gov/alerts/active");
    expect(url.searchParams.get("point")).toBe("42.3601,-71.0589");
  });
});

describe("fetchActiveAlerts", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    process.env.NWS_USER_AGENT = "Threshold (demo@example.com)";
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("sends a non-empty User-Agent header and returns typed alerts (Req 11.4)", async () => {
    let seenInit: RequestInit | undefined;
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      seenInit = init;
      return jsonResponse(oneAlertBody);
    }) as unknown as typeof fetch;

    const result = await fetchActiveAlerts({ lat: 42.36, lng: -71.06, fetchImpl });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.alerts).toHaveLength(1);
      expect(result.alerts[0]).toEqual({
        id: "urn:oid:2.49.0.1.840.0.abc123",
        event: "Blizzard Warning",
        headline: "Blizzard Warning issued for Suffolk County",
        areaDesc: "Suffolk, MA",
        severity: "Severe",
        effective: "2026-02-01T06:00:00-05:00",
        expires: "2026-02-02T06:00:00-05:00",
      });
    }

    const headers = (seenInit?.headers ?? {}) as Record<string, string>;
    expect(headers["User-Agent"]).toBe("Threshold (demo@example.com)");
    expect(headers["User-Agent"].length).toBeGreaterThan(0);
  });

  it("returns a typed error (no call) when no User-Agent is configured (Req 11.4)", async () => {
    delete process.env.NWS_USER_AGENT;
    const fetchImpl = vi.fn(async () => jsonResponse(oneAlertBody)) as unknown as typeof fetch;

    const result = await fetchActiveAlerts({ lat: 42.36, lng: -71.06, fetchImpl });

    expect(result).toEqual<NwsResult>({
      ok: false,
      reason: "error",
      message: expect.any(String) as unknown as string,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns a typed error on a non-success response (Req 22.3)", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, false)) as unknown as typeof fetch;

    const result = await fetchActiveAlerts({ lat: 42.36, lng: -71.06, fetchImpl });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("error");
      // No stack trace, exception class name, or raw payload in the message.
      expect(result.message).not.toMatch(/error|stack|undefined|\{/i);
    }
  });

  it("returns a typed error (no throw) when the provider throws (Req 22.3)", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("provider exploded with a stack trace");
    }) as unknown as typeof fetch;

    const result = await fetchActiveAlerts({ lat: 42.36, lng: -71.06, fetchImpl });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("error");
      expect(result.message).not.toContain("provider exploded");
    }
  });

  it("returns a typed timeout when the request aborts (Req 11.3, 22.2)", async () => {
    vi.useFakeTimers();
    // A fetch that rejects with an AbortError when the signal aborts.
    const fetchImpl = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        signal?.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    }) as unknown as typeof fetch;

    const pending = fetchActiveAlerts({
      lat: 42.36,
      lng: -71.06,
      timeoutMs: 1_000,
      fetchImpl,
    });
    await vi.advanceTimersByTimeAsync(1_000);

    const result = await pending;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("timeout");
    }
  });

  it("returns an empty alert list for a FeatureCollection with no features", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ features: [] })) as unknown as typeof fetch;

    const result = await fetchActiveAlerts({ lat: 42.36, lng: -71.06, fetchImpl });

    expect(result).toEqual<NwsResult>({ ok: true, alerts: [] });
  });

  it("tolerates a malformed body without throwing", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(null)) as unknown as typeof fetch;

    const result = await fetchActiveAlerts({ lat: 42.36, lng: -71.06, fetchImpl });

    expect(result).toEqual<NwsResult>({ ok: true, alerts: [] });
  });
});
