import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";
import { db } from "@/lib/data/supabase";
import { getCurrentHouseholdId } from "@/lib/auth/household";

vi.mock("@/lib/data/supabase", () => ({
  db: vi.fn(),
}));

vi.mock("@/lib/auth/household", () => ({
  getCurrentHouseholdId: vi.fn(),
}));

const dbMock = vi.mocked(db);
const getHouseholdMock = vi.mocked(getCurrentHouseholdId);

/**
 * Fakes the `cases` query surface for the handler's
 * select().eq().eq().maybeSingle() chain. `result` is what maybeSingle resolves
 * to. The returned object records the household_id passed to the scoping
 * `.eq("household_id", ...)` so a test can assert the query is household-scoped.
 */
function fakeCases(result: { data: unknown; error: unknown }) {
  const scope = { householdId: undefined as unknown };
  const maybeSingle = vi.fn(() => Promise.resolve(result));
  const secondEq = vi.fn((_col: string, value: unknown) => {
    scope.householdId = value;
    return { maybeSingle };
  });
  const firstEq = vi.fn(() => ({ eq: secondEq }));
  return {
    select: vi.fn(() => ({ eq: firstEq })),
    _scope: scope,
  };
}

/** Builds a ctx whose params Promise resolves to the given id (Next 16). */
function ctxFor(id: string) {
  return { params: Promise.resolve({ id }) } as never;
}

function makeRequest(id: string): Request {
  return new Request(`http://localhost/api/case/${id}`, { method: "GET" });
}

const OWNING_HOUSEHOLD = "h1";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/case/[id]", () => {
  it("returns the case and its trace for the owning household (Req 5.3, 7.1)", async () => {
    getHouseholdMock.mockResolvedValue(OWNING_HOUSEHOLD);
    const trace = [
      {
        step: 1,
        tool: "classify_photo",
        input_summary: "Looked at the photo",
        observation_summary: "A blocked sidewalk",
        reasoning_note: "The path was obstructed",
        at: "2026-03-03T12:00:00.000Z",
      },
    ];
    const cases = fakeCases({
      data: {
        id: "c1",
        household_id: OWNING_HOUSEHOLD,
        barrier_type: "blocked_sidewalk",
        description: "Bins blocking the ramp",
        photo_path: "h1/c1.jpg",
        lat: 42.3,
        lng: -71.0,
        route: "311_blocked_sidewalk",
        status: "draft_ready",
        city_case_id: null,
        opened_at: "2026-03-03T11:59:00.000Z",
        clock_due_at: "2026-03-17T11:59:00.000Z",
        trace,
      },
      error: null,
    });
    dbMock.mockReturnValue(cases as never);

    const res = await GET(makeRequest("c1") as never, ctxFor("c1"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe("c1");
    expect(body.barrier_type).toBe("blocked_sidewalk");
    expect(body.status).toBe("draft_ready");
    expect(body.trace).toEqual(trace);
    // The query is scoped to the household from the cookie (Req 10.1).
    expect(cases._scope.householdId).toBe(OWNING_HOUSEHOLD);
  });

  it("returns an empty trace array when the case has no steps yet (Req 5.3)", async () => {
    getHouseholdMock.mockResolvedValue(OWNING_HOUSEHOLD);
    const cases = fakeCases({
      data: {
        id: "c2",
        household_id: OWNING_HOUSEHOLD,
        barrier_type: "other",
        description: "",
        photo_path: "h1/c2.jpg",
        lat: null,
        lng: null,
        route: null,
        status: "investigating",
        city_case_id: null,
        opened_at: "2026-03-03T11:59:00.000Z",
        clock_due_at: null,
        trace: null,
      },
      error: null,
    });
    dbMock.mockReturnValue(cases as never);

    const res = await GET(makeRequest("c2") as never, ctxFor("c2"));

    expect(res.status).toBe(200);
    expect((await res.json()).trace).toEqual([]);
  });

  it("returns 404 for a case not owned by the current household (Req 10.1)", async () => {
    getHouseholdMock.mockResolvedValue(OWNING_HOUSEHOLD);
    // A case owned by another resident yields no row under the household scope.
    const cases = fakeCases({ data: null, error: null });
    dbMock.mockReturnValue(cases as never);

    const res = await GET(makeRequest("other") as never, ctxFor("other"));

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(typeof body.message).toBe("string");
    // Scoped by the cookie household, never the requester's chosen id alone.
    expect(cases._scope.householdId).toBe(OWNING_HOUSEHOLD);
  });

  it("never includes a full_address or coordinates in the body (Req 10.3, 10.4)", async () => {
    getHouseholdMock.mockResolvedValue(OWNING_HOUSEHOLD);
    const cases = fakeCases({
      data: {
        id: "c3",
        household_id: OWNING_HOUSEHOLD,
        barrier_type: "broken_sidewalk",
        description: "Cracked slab",
        photo_path: "h1/c3.jpg",
        lat: 42.3601,
        lng: -71.0589,
        route: "311_sidewalk_repair",
        status: "waiting",
        city_case_id: "101005000001",
        opened_at: "2026-03-03T11:59:00.000Z",
        clock_due_at: "2026-03-17T11:59:00.000Z",
        trace: [
          {
            step: 1,
            tool: "search_nearby_311",
            input_summary: "Searched nearby reports",
            observation_summary: "3 open reports within 50 meters",
            reasoning_note: "Checked for duplicates",
            at: "2026-03-03T12:00:00.000Z",
          },
        ],
      },
      error: null,
    });
    dbMock.mockReturnValue(cases as never);

    const res = await GET(makeRequest("c3") as never, ctxFor("c3"));

    expect(res.status).toBe(200);
    const body = await res.json();
    const serialized = JSON.stringify(body);
    // No full_address and no coordinate keys or values leak to the browser.
    expect(serialized).not.toContain("full_address");
    expect(body.lat).toBeUndefined();
    expect(body.lng).toBeUndefined();
    expect(serialized).not.toContain("42.3601");
    expect(serialized).not.toContain("-71.0589");
  });

  it("returns 404 when there is no household cookie", async () => {
    getHouseholdMock.mockResolvedValue(null);

    const res = await GET(makeRequest("c1") as never, ctxFor("c1"));

    expect(res.status).toBe(404);
    expect(dbMock).not.toHaveBeenCalled();
  });

  it("returns a friendly 502 with no stack trace when the load errors (Req 22.3)", async () => {
    getHouseholdMock.mockResolvedValue(OWNING_HOUSEHOLD);
    const cases = fakeCases({ data: null, error: { message: "connection refused" } });
    dbMock.mockReturnValue(cases as never);

    const res = await GET(makeRequest("c1") as never, ctxFor("c1"));

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.message).not.toMatch(/connection refused|stack|Error/i);
  });
});
