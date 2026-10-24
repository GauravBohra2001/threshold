import { describe, it, expect, vi } from "vitest";
import {
  buildGeocodeUrl,
  clampTimeout,
  lookup,
} from "@/lib/data/geocoder";

/** A minimal Census Geocoder success body with one address match. */
function matchBody() {
  return {
    result: {
      addressMatches: [
        {
          coordinates: { x: -71.0565, y: 42.3555 },
          matchedAddress: "1 CITY HALL SQ, BOSTON, MA, 02201",
          geographies: {
            Counties: [
              {
                GEOID: "25025",
                STATE: "25",
                COUNTY: "025",
                NAME: "Suffolk County",
              },
            ],
          },
        },
      ],
    },
  };
}

/** Build a mocked `fetch` returning the given body with status 200. */
function mockOkFetch(body: unknown): typeof fetch {
  return vi.fn(async () =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  ) as unknown as typeof fetch;
}

describe("clampTimeout", () => {
  it("defaults to 10s when unset or NaN", () => {
    expect(clampTimeout(undefined)).toBe(10_000);
    expect(clampTimeout(Number.NaN)).toBe(10_000);
  });

  it("clamps into the inclusive [1s, 30s] range (Req 22.1)", () => {
    expect(clampTimeout(0)).toBe(1_000);
    expect(clampTimeout(500)).toBe(1_000);
    expect(clampTimeout(45_000)).toBe(30_000);
    expect(clampTimeout(5_000)).toBe(5_000);
  });
});

describe("buildGeocodeUrl", () => {
  it("targets the geographies/onelineaddress endpoint with benchmark + vintage", () => {
    const url = new URL(buildGeocodeUrl("1 City Hall Sq, Boston MA"));
    expect(url.pathname).toContain("/geographies/onelineaddress");
    expect(url.searchParams.get("benchmark")).toBe("Public_AR_Current");
    expect(url.searchParams.get("vintage")).toBe("Current_Current");
    expect(url.searchParams.get("format")).toBe("json");
    expect(url.searchParams.get("address")).toBe("1 City Hall Sq, Boston MA");
  });
});

describe("lookup", () => {
  it("returns lat/lng, county FIPS, and state FIPS on a match (Req 1.1)", async () => {
    const fetchImpl = mockOkFetch(matchBody());
    const result = await lookup("1 City Hall Sq, Boston MA", { fetchImpl });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.match.lat).toBe(42.3555);
      expect(result.match.lng).toBe(-71.0565);
      expect(result.match.countyFips).toBe("25025");
      expect(result.match.stateFips).toBe("25");
      expect(result.match.matchedAddress).toContain("BOSTON");
      // Census never supplies a neighborhood; it is always null.
      expect(result.match.neighborhood).toBeNull();
    }
  });

  it("derives state FIPS from the county GEOID when STATE is absent", async () => {
    const body = matchBody();
    delete (body.result.addressMatches[0].geographies.Counties[0] as Record<
      string,
      unknown
    >).STATE;
    const result = await lookup("1 City Hall Sq, Boston MA", {
      fetchImpl: mockOkFetch(body),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.match.stateFips).toBe("25");
      expect(result.match.countyFips).toBe("25025");
    }
  });

  it("returns a no_match fallback when there are zero matches (Req 1.5)", async () => {
    const fetchImpl = mockOkFetch({ result: { addressMatches: [] } });
    const result = await lookup("nowhere at all", { fetchImpl });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("no_match");
      expect(result.message.length).toBeGreaterThan(0);
    }
  });

  it("treats a blank address as no_match without calling fetch", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const result = await lookup("   ", { fetchImpl });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("no_match");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns a timeout fallback when the request aborts (Req 1.4, 22.2)", async () => {
    const fetchImpl = vi.fn((_url: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        signal?.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    }) as unknown as typeof fetch;

    const result = await lookup("1 City Hall Sq, Boston MA", {
      fetchImpl,
      timeoutMs: 1_000,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("timeout");
  });

  it("returns an error fallback on non-200 responses, no raw payload (Req 22.3)", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response("boom", { status: 500 }),
    ) as unknown as typeof fetch;

    const result = await lookup("1 City Hall Sq, Boston MA", { fetchImpl });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("error");
      expect(result.message).not.toContain("boom");
      expect(result.message.length).toBeGreaterThan(0);
    }
  });

  it("returns an error fallback on an unexpectedly shaped body", async () => {
    const fetchImpl = mockOkFetch({ nope: true });
    const result = await lookup("1 City Hall Sq, Boston MA", { fetchImpl });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("error");
  });

  it("never throws on unexpected network errors, returns an error fallback", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;

    const result = await lookup("1 City Hall Sq, Boston MA", { fetchImpl });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("error");
      expect(result.message).not.toContain("network down");
    }
  });
});
