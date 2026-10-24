import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST, __resetLiveCallClockForTests } from "@/app/api/checkin/route";
import { getCurrentHousehold } from "@/lib/auth/household";
import { db } from "@/lib/data/supabase";
import { placeCall } from "@/lib/data/twilio";

vi.mock("@/lib/auth/household", () => ({
  getCurrentHousehold: vi.fn(),
}));

vi.mock("@/lib/data/supabase", () => ({
  db: vi.fn(),
}));

// Keep buildSayTwiml real (so TwiML content assertions are meaningful) and mock
// only placeCall so no real Twilio call is attempted.
vi.mock("@/lib/data/twilio", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/data/twilio")>();
  return { ...actual, placeCall: vi.fn() };
});

const getCurrentHouseholdMock = vi.mocked(getCurrentHousehold);
const dbMock = vi.mocked(db);
const placeCallMock = vi.mocked(placeCall);

/** A minimal household row the route reads. */
function household(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "h1",
    resident_name: "Maria",
    address: "500 Columbia Rd",
    lat: 42.3,
    lng: -71.0,
    county_fips: "25025",
    neighborhood: "Dorchester",
    caregiver_name: "Ana",
    caregiver_phone: "6175551234",
    invite_code: "DEMOMARIA",
    is_demo: true,
    sim_offset_days: 0,
    created_at: "2026-02-01T00:00:00.000Z",
    ...overrides,
  };
}

/**
 * An in-memory fake of the `checkins` table backing `db('checkins')`. It
 * supports the exact query chains the route uses:
 *   select().eq().eq().maybeSingle()
 *   insert().select().single()
 *   update().eq().select().single()
 * Rows are keyed by (household_id, alert_id); the unique constraint is honored.
 */
function fakeCheckins() {
  const rows: Record<string, Record<string, unknown>> = {};
  let idSeq = 0;
  let failInsert = false;
  const inserts: Array<Record<string, unknown>> = [];
  const updates: Array<Record<string, unknown>> = [];

  const COLUMNS =
    "id, household_id, alert_id, alert_headline, is_replay, sent_at, answered_at, call_placed_at, call_sid, outcome";

  function key(householdId: unknown, alertId: unknown) {
    return `${householdId}::${alertId}`;
  }

  const builder = {
    // select(cols) -> the shape depends on whether eq() is chained after.
    select: vi.fn(() => {
      let hid: unknown;
      let aid: unknown;
      const eqApi = {
        eq: vi.fn((col: string, val: unknown) => {
          if (col === "household_id") hid = val;
          if (col === "alert_id") aid = val;
          return eqApi;
        }),
        maybeSingle: vi.fn(async () => {
          const row = rows[key(hid, aid)] ?? null;
          return { data: row, error: null };
        }),
        // insert().select(cols).single()
        single: vi.fn(async () => insertResult),
      };
      return eqApi;
    }),
    insert: vi.fn((payload: Record<string, unknown>) => {
      inserts.push(payload);
      return {
        select: vi.fn(() => ({
          single: vi.fn(async () => {
            if (failInsert) {
              return { data: null, error: { message: "unique violation" } };
            }
            const k = key(payload.household_id, payload.alert_id);
            if (rows[k]) {
              return { data: null, error: { message: "unique violation" } };
            }
            idSeq += 1;
            const row = {
              id: `c${idSeq}`,
              household_id: payload.household_id,
              alert_id: payload.alert_id,
              alert_headline: payload.alert_headline ?? "",
              is_replay: payload.is_replay ?? false,
              sent_at: "2026-02-01T10:00:00.000Z",
              answered_at: null,
              call_placed_at: null,
              call_sid: null,
              outcome: null,
            };
            rows[k] = row;
            return { data: row, error: null };
          }),
        })),
      };
    }),
    update: vi.fn((patch: Record<string, unknown>) => {
      updates.push(patch);
      let id: unknown;
      const api = {
        eq: vi.fn((col: string, val: unknown) => {
          if (col === "id") id = val;
          return api;
        }),
        select: vi.fn(() => ({
          single: vi.fn(async () => {
            const row = Object.values(rows).find((r) => r.id === id);
            if (!row) return { data: null, error: { message: "no row" } };
            Object.assign(row, patch);
            return { data: { ...row }, error: null };
          }),
        })),
      };
      return api;
    }),
    // Helpers for assertions / setup.
    _rows: rows,
    _inserts: inserts,
    _updates: updates,
    _setFailInsert(v: boolean) {
      failInsert = v;
    },
    _seed(row: Record<string, unknown>) {
      rows[key(row.household_id, row.alert_id)] = row;
    },
    _columns: COLUMNS,
  };

  // `insert().select().single()` reads this; set per call above. Kept for the
  // raced-insert re-select path which uses select().eq().eq().maybeSingle().
  const insertResult = { data: null, error: null };

  return builder;
}

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/checkin", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetLiveCallClockForTests();
  delete process.env.ALLOW_LIVE_CALLS;
  getCurrentHouseholdMock.mockResolvedValue(household() as never);
});

afterEach(() => {
  delete process.env.ALLOW_LIVE_CALLS;
});

describe("POST /api/checkin", () => {
  it("creates exactly one Check_In per unique alert_id (Req 11.5)", async () => {
    const checkins = fakeCheckins();
    dbMock.mockReturnValue(checkins as never);

    const first = await POST(
      makeRequest({
        alert_id: "A1",
        alert_headline: "Blizzard warning",
        is_replay: true,
      }) as never,
    );
    expect(first.status).toBe(201);
    const firstBody = await first.json();
    expect(firstBody.alert_id).toBe("A1");
    expect(firstBody.alert_headline).toBe("Blizzard warning");
    expect(firstBody.is_replay).toBe(true);
    expect(firstBody.state).toBe("SENT");

    // A repeated alert id must reuse the same row, not insert a second.
    const second = await POST(
      makeRequest({ alert_id: "A1", alert_headline: "Blizzard warning", is_replay: true }) as never,
    );
    expect(second.status).toBe(200);
    const secondBody = await second.json();
    expect(secondBody.id).toBe(firstBody.id);
    expect(checkins._inserts).toHaveLength(1);
  });

  it("answered path records `answered` and places no call (Req 12.4)", async () => {
    const checkins = fakeCheckins();
    checkins._seed({
      id: "c1",
      household_id: "h1",
      alert_id: "A1",
      alert_headline: "Blizzard",
      is_replay: true,
      sent_at: "2026-02-01T10:00:00.000Z",
      answered_at: null,
      call_placed_at: null,
      call_sid: null,
      outcome: null,
    });
    dbMock.mockReturnValue(checkins as never);

    const res = await POST(
      makeRequest({ alert_id: "A1", is_replay: true, event: "resident_answered" }) as never,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.outcome).toBe("answered");
    expect(body.state).toBe("ANSWERED");
    expect(body.simulated_call).toBe(false);
    expect(body.answered_at).not.toBeNull();
    expect(placeCallMock).not.toHaveBeenCalled();
  });

  it("timeout in replay without ALLOW_LIVE_CALLS shows a simulated call and places no real call (Req 12.9)", async () => {
    const checkins = fakeCheckins();
    checkins._seed({
      id: "c1",
      household_id: "h1",
      alert_id: "A1",
      alert_headline: "Blizzard",
      is_replay: true,
      sent_at: "2026-02-01T10:00:00.000Z",
      answered_at: null,
      call_placed_at: null,
      call_sid: null,
      outcome: null,
    });
    dbMock.mockReturnValue(checkins as never);

    const res = await POST(
      makeRequest({ alert_id: "A1", is_replay: true, event: "timeout" }) as never,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.outcome).toBe("caregiver_called");
    expect(body.state).toBe("CALL_CAREGIVER");
    expect(body.simulated_call).toBe(true);
    expect(body.simulated_call_label).toBe("Simulated call (demo mode)");
    expect(body.call_placed_at).not.toBeNull();
    expect(body.call_sid).toBeNull();
    expect(placeCallMock).not.toHaveBeenCalled();
  });

  it("timeout with ALLOW_LIVE_CALLS=true places exactly one real call stating only the resident name and identifying an AI assistant (Req 12.1, 12.7, 12.8)", async () => {
    process.env.ALLOW_LIVE_CALLS = "true";
    placeCallMock.mockResolvedValue({ ok: true, callSid: "CA_REAL_1" });

    const checkins = fakeCheckins();
    checkins._seed({
      id: "c1",
      household_id: "h1",
      alert_id: "A1",
      alert_headline: "Blizzard",
      is_replay: false,
      sent_at: "2026-02-01T10:00:00.000Z",
      answered_at: null,
      call_placed_at: null,
      call_sid: null,
      outcome: null,
    });
    dbMock.mockReturnValue(checkins as never);

    const res = await POST(
      makeRequest({ alert_id: "A1", is_replay: false, event: "timeout" }) as never,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.outcome).toBe("caregiver_called");
    expect(body.state).toBe("CALL_CAREGIVER");
    expect(body.simulated_call).toBe(false);
    expect(body.call_sid).toBe("CA_REAL_1");
    expect(body.call_placed_at).not.toBeNull();

    expect(placeCallMock).toHaveBeenCalledTimes(1);
    const callArg = placeCallMock.mock.calls[0][0];
    expect(callArg.to).toBe("6175551234");
    // TwiML states the resident name and identifies an AI assistant, not Boston.
    expect(callArg.twiml).toContain("Maria");
    expect(callArg.twiml?.toLowerCase()).toContain("a i assistant");
    expect(callArg.twiml?.toLowerCase()).toContain("not the city of boston");
    // Says nothing about diagnosis or equipment.
    expect(callArg.twiml?.toLowerCase()).not.toContain("oxygen");
    expect(callArg.twiml?.toLowerCase()).not.toContain("wheelchair");
  });

  it("advances to advise_911 with no retry when the real call fails (Req 12.2)", async () => {
    process.env.ALLOW_LIVE_CALLS = "true";
    placeCallMock.mockResolvedValue({ ok: false, reason: "error" });

    const checkins = fakeCheckins();
    checkins._seed({
      id: "c1",
      household_id: "h1",
      alert_id: "A1",
      alert_headline: "Blizzard",
      is_replay: false,
      sent_at: "2026-02-01T10:00:00.000Z",
      answered_at: null,
      call_placed_at: null,
      call_sid: null,
      outcome: null,
    });
    dbMock.mockReturnValue(checkins as never);

    const res = await POST(
      makeRequest({ alert_id: "A1", is_replay: false, event: "timeout" }) as never,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.outcome).toBe("advise_911");
    expect(body.state).toBe("ADVISE_911");
    expect(body.advisory).toBe("Call 911 if this is an emergency.");
    // Exactly one attempt — no retry of the caregiver call.
    expect(placeCallMock).toHaveBeenCalledTimes(1);
  });

  it("returns 404 when there is no current household", async () => {
    getCurrentHouseholdMock.mockResolvedValue(null as never);
    const checkins = fakeCheckins();
    dbMock.mockReturnValue(checkins as never);

    const res = await POST(makeRequest({ alert_id: "A1" }) as never);
    expect(res.status).toBe(404);
  });

  it("rejects a missing alert_id with a plain-language 400", async () => {
    const res = await POST(makeRequest({ alert_headline: "x" }) as never);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.field).toBe("alert_id");
    expect(dbMock).not.toHaveBeenCalled();
  });

  it("returns a friendly 502 with no stack trace when the data store fails", async () => {
    const checkins = fakeCheckins();
    // Make the lookup error out.
    checkins.select = vi.fn(() => {
      const api = {
        eq: vi.fn(() => api),
        maybeSingle: vi.fn(async () => ({ data: null, error: { message: "db down" } })),
      };
      return api;
    }) as never;
    dbMock.mockReturnValue(checkins as never);

    const res = await POST(makeRequest({ alert_id: "A1" }) as never);
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.message).not.toMatch(/db down|stack|Error/i);
  });
});
