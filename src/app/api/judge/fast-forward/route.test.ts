import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";
import { runCaseAgent } from "@/lib/agent/loop";
import { getCurrentHousehold } from "@/lib/auth/household";
import { createSignedUrl, db } from "@/lib/data/supabase";

vi.mock("@/lib/agent/loop", () => ({
  runCaseAgent: vi.fn(),
}));

vi.mock("@/lib/auth/household", () => ({
  getCurrentHousehold: vi.fn(),
}));

vi.mock("@/lib/data/supabase", () => ({
  db: vi.fn(),
  createSignedUrl: vi.fn(),
}));

const householdMock = vi.mocked(getCurrentHousehold);
const runCaseAgentMock = vi.mocked(runCaseAgent);
const dbMock = vi.mocked(db);
const signedUrlMock = vi.mocked(createSignedUrl);

/** A minimal household row with the offset the handler reads. */
function household(offset: number) {
  return {
    id: "h1",
    resident_name: "Maria",
    address: "500 Columbia Rd",
    lat: 42.3,
    lng: -71.06,
    county_fips: "25025",
    neighborhood: "Dorchester",
    caregiver_name: "Ana",
    caregiver_phone: "6175551234",
    invite_code: "DEMOMARIA",
    is_demo: true,
    sim_offset_days: offset,
    created_at: "2026-01-01T00:00:00.000Z",
  };
}

/**
 * Fake Supabase surface for this handler. It handles two tables:
 *   - households: update().eq() → captures the persisted patch.
 *   - cases: select().eq().neq() → resolves to the given case list.
 */
function fakeDb(opts: {
  updateResult?: { error: unknown };
  casesResult?: { data: unknown; error: unknown };
}) {
  const updateEq = vi.fn(() =>
    Promise.resolve(opts.updateResult ?? { error: null }),
  );
  const update = vi.fn(() => ({ eq: updateEq }));

  const neq = vi.fn(() =>
    Promise.resolve(opts.casesResult ?? { data: [], error: null }),
  );
  const casesEq = vi.fn(() => ({ neq }));
  const select = vi.fn(() => ({ eq: casesEq }));

  const impl = (table: string) => {
    if (table === "households") return { update };
    if (table === "cases") return { select };
    throw new Error(`unexpected table ${table}`);
  };

  return { impl, update, updateEq, select, casesEq, neq };
}

/** A case row the handler reads. */
function caseRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: "case-1",
    status: "waiting",
    route: "311_blocked_sidewalk",
    clock_due_at: "2026-01-10T00:00:00.000Z",
    photo_path: "h1/cases/case-1.jpg",
    lat: 42.3,
    lng: -71.06,
    opened_at: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

function request() {
  return new Request("http://localhost/api/judge/fast-forward", {
    method: "POST",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  signedUrlMock.mockResolvedValue("https://signed.example/photo.jpg");
});

afterEach(() => {
  vi.useRealTimers();
});

describe("POST /api/judge/fast-forward", () => {
  it("returns a plain-language 404 when there is no household", async () => {
    householdMock.mockResolvedValue(null);

    const res = await POST(request() as never);

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(typeof body.message).toBe("string");
    expect(body.message).not.toMatch(/stack|Error/i);
    expect(runCaseAgentMock).not.toHaveBeenCalled();
  });

  it("increments sim_offset_days by exactly 14 and labels the result (Req 8.3, 20.8)", async () => {
    householdMock.mockResolvedValue(household(7) as never);
    const database = fakeDb({ casesResult: { data: [], error: null } });
    dbMock.mockImplementation(database.impl as never);

    const res = await POST(request() as never);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sim_offset_days).toBe(21); // 7 + 14
    expect(body.label).toBe("Simulated time");
    // Persisted the new offset.
    expect(database.update).toHaveBeenCalledWith({ sim_offset_days: 21 });
    // No cases → nothing re-checked, no suggestions.
    expect(runCaseAgentMock).not.toHaveBeenCalled();
    expect(body.suggested_escalations).toEqual([]);
  });

  it("suggests an escalation for a due, unresolved case without sending it (Req 8.4, 8.6, 8.8)", async () => {
    householdMock.mockResolvedValue(household(0) as never);
    // Fixed wall clock so the due-check is deterministic. With offset+14 the
    // simulated instant is well past the 2026-01-10 due date.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-20T00:00:00.000Z"));

    const database = fakeDb({
      casesResult: { data: [caseRow()], error: null },
    });
    dbMock.mockImplementation(database.impl as never);
    runCaseAgentMock.mockResolvedValue({
      status: "escalated",
      route: "escalation_disabilities_commission",
      trace: [],
    });

    const res = await POST(request() as never);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cases_rechecked).toBe(1);
    expect(runCaseAgentMock).toHaveBeenCalledTimes(1);
    expect(runCaseAgentMock.mock.calls[0][0].caseId).toBe("case-1");
    expect(body.suggested_escalations).toHaveLength(1);
    expect(body.suggested_escalations[0]).toMatchObject({
      case_id: "case-1",
      status: "escalated",
      route: "escalation_disabilities_commission",
    });
    expect(typeof body.suggested_escalations[0].note).toBe("string");
  });

  it("suppresses the suggestion when the re-check resolves the case (Req 8.5)", async () => {
    householdMock.mockResolvedValue(household(0) as never);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-20T00:00:00.000Z"));

    const database = fakeDb({
      casesResult: { data: [caseRow()], error: null },
    });
    dbMock.mockImplementation(database.impl as never);
    runCaseAgentMock.mockResolvedValue({
      status: "resolved",
      route: "311_blocked_sidewalk",
      trace: [],
    });

    const res = await POST(request() as never);

    const body = await res.json();
    expect(body.cases_rechecked).toBe(1);
    expect(runCaseAgentMock).toHaveBeenCalledTimes(1);
    // Resolved → no suggestion (Req 8.5).
    expect(body.suggested_escalations).toEqual([]);
  });

  it("suppresses the suggestion when a case is not yet due (Req 8.4, 8.5)", async () => {
    householdMock.mockResolvedValue(household(0) as never);
    vi.useFakeTimers();
    // Simulated instant (now + 14 days = 2026-01-15) is BEFORE a far-future due date.
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    const database = fakeDb({
      casesResult: {
        data: [caseRow({ clock_due_at: "2026-03-01T00:00:00.000Z" })],
        error: null,
      },
    });
    dbMock.mockImplementation(database.impl as never);

    const res = await POST(request() as never);

    const body = await res.json();
    // Evaluated but not due → never re-checked, no suggestion.
    expect(body.cases_evaluated).toBe(1);
    expect(body.cases_rechecked).toBe(0);
    expect(runCaseAgentMock).not.toHaveBeenCalled();
    expect(body.suggested_escalations).toEqual([]);
  });

  it("returns a friendly 502 with no stack trace when the store errors", async () => {
    householdMock.mockResolvedValue(household(0) as never);
    const database = fakeDb({
      casesResult: { data: null, error: { message: "connection refused" } },
    });
    dbMock.mockImplementation(database.impl as never);

    const res = await POST(request() as never);

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.message).not.toMatch(/connection refused|stack|Error/i);
  });
});
