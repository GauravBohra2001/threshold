import { describe, it, expect, vi } from "vitest";
import {
  buildDeclarationsUrl,
  clampTimeout,
  fetchDisasterDeclarations,
} from "@/lib/data/openfema";

/** Build a mocked `fetch` returning the given OpenFEMA body with status 200. */
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

describe("buildDeclarationsUrl", () => {
  it("filters by county FIPS (state + county)", () => {
    const url = buildDeclarationsUrl({
      fipsStateCode: "25",
      fipsCountyCode: "027",
    });
    const filter = new URL(url).searchParams.get("$filter") ?? "";
    expect(filter).toContain("fipsStateCode eq '25'");
    expect(filter).toContain("fipsCountyCode eq '027'");
    expect(filter).not.toContain("placeCode");
  });

  it("falls back to placeCode for tribal areas with no county (Req 15.4)", () => {
    const url = buildDeclarationsUrl({ fipsStateCode: "04", placeCode: "99999" });
    const filter = new URL(url).searchParams.get("$filter") ?? "";
    expect(filter).toContain("placeCode eq '99999'");
  });

  it("prefers county over placeCode when both are present", () => {
    const url = buildDeclarationsUrl({
      fipsStateCode: "25",
      fipsCountyCode: "027",
      placeCode: "99999",
    });
    const filter = new URL(url).searchParams.get("$filter") ?? "";
    expect(filter).toContain("fipsCountyCode eq '027'");
    expect(filter).not.toContain("placeCode");
  });

  it("selects the fields we consume", () => {
    const select = new URL(buildDeclarationsUrl({ fipsStateCode: "25" }))
      .searchParams.get("$select") ?? "";
    for (const field of [
      "disasterNumber",
      "ihProgramDeclared",
      "iaProgramDeclared",
      "placeCode",
    ]) {
      expect(select).toContain(field);
    }
  });
});

describe("fetchDisasterDeclarations", () => {
  it("returns normalized records on success (reads IH/IA flags)", async () => {
    const fetchImpl = mockOkFetch({
      DisasterDeclarationsSummaries: [
        {
          disasterNumber: 4780,
          declarationDate: "2024-05-15T00:00:00.000Z",
          incidentBeginDate: "2024-05-01T00:00:00.000Z",
          designatedArea: "Worcester (County)",
          ihProgramDeclared: true,
          iaProgramDeclared: true,
          fipsStateCode: "25",
          fipsCountyCode: "027",
          placeCode: "99027",
        },
      ],
    });

    const result = await fetchDisasterDeclarations({
      fipsStateCode: "25",
      fipsCountyCode: "027",
      fetchImpl,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.records).toHaveLength(1);
      const rec = result.records[0];
      expect(rec.disasterNumber).toBe(4780);
      expect(rec.ihProgramDeclared).toBe(true);
      expect(rec.iaProgramDeclared).toBe(true);
      expect(rec.designatedArea).toBe("Worcester (County)");
    }
  });

  it("coerces missing/false IH-IA flags to boolean false", async () => {
    const fetchImpl = mockOkFetch({
      DisasterDeclarationsSummaries: [{ disasterNumber: 1 }],
    });
    const result = await fetchDisasterDeclarations({ fetchImpl });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.records[0].ihProgramDeclared).toBe(false);
      expect(result.records[0].iaProgramDeclared).toBe(false);
    }
  });

  it("drops malformed records without a numeric disasterNumber", async () => {
    const fetchImpl = mockOkFetch({
      DisasterDeclarationsSummaries: [{ foo: "bar" }, { disasterNumber: 42 }],
    });
    const result = await fetchDisasterDeclarations({ fetchImpl });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.records).toHaveLength(1);
      expect(result.records[0].disasterNumber).toBe(42);
    }
  });

  it("returns a typed error fallback on non-200 responses (Req 22.3)", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response("boom", { status: 500 }),
    ) as unknown as typeof fetch;

    const result = await fetchDisasterDeclarations({ fetchImpl });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("error");
      expect(result.message).not.toContain("boom");
      expect(result.message.length).toBeGreaterThan(0);
    }
  });

  it("returns a typed timeout fallback when the request aborts (Req 22.2)", async () => {
    // A fetch that rejects with an AbortError once the signal fires.
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

    const result = await fetchDisasterDeclarations({ fetchImpl, timeoutMs: 1_000 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("timeout");
    }
  });

  it("never throws on unexpected errors, returns an error fallback", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;

    const result = await fetchDisasterDeclarations({ fetchImpl });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("error");
      expect(result.message).not.toContain("network down");
    }
  });
});
