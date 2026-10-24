import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";
import { getCurrentHouseholdId } from "@/lib/auth/household";
import { db } from "@/lib/data/supabase";

vi.mock("@/lib/data/supabase", () => ({
  db: vi.fn(),
}));

vi.mock("@/lib/auth/household", () => ({
  getCurrentHouseholdId: vi.fn(),
}));

const dbMock = vi.mocked(db);
const getHouseholdMock = vi.mocked(getCurrentHouseholdId);

/**
 * Builds a fake `incidents` query surface whose insert().select().single()
 * chain resolves to `insertResult`. The captured insert payload is exposed so
 * tests can assert what was saved.
 */
function fakeIncidents(
  insertResult: { data: unknown; error: unknown } | (() => Promise<unknown>),
) {
  const single = vi.fn(() =>
    typeof insertResult === "function"
      ? insertResult()
      : Promise.resolve(insertResult),
  );
  const insert = vi.fn((payload: Record<string, unknown>) => {
    void payload;
    return { select: vi.fn(() => ({ single })) };
  });
  return { insert, _single: single };
}

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/incident", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const VALID_BODY = {
  kind: "shelter_refusal",
  place: "City Shelter on Main St",
  occurred_at: "2026-02-14T18:30",
  notes: "Front desk said no pets.",
  right_id: "shelter-service-animal",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  getHouseholdMock.mockResolvedValue("h1");
});

afterEach(() => {
  vi.useRealTimers();
});

describe("POST /api/incident", () => {
  it("saves a valid incident and confirms the save (Req 14.3)", async () => {
    const incidents = fakeIncidents({ data: { id: "i1" }, error: null });
    dbMock.mockReturnValue(incidents as never);

    const res = await POST(makeRequest(VALID_BODY) as never);

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.id).toBe("i1");
    expect(typeof body.message).toBe("string");
    expect(body.message.length).toBeGreaterThan(0);

    expect(dbMock).toHaveBeenCalledWith("incidents");
    expect(incidents.insert).toHaveBeenCalledTimes(1);
    const saved = incidents.insert.mock.calls[0]![0];
    expect(saved.household_id).toBe("h1");
    expect(saved.kind).toBe("shelter_refusal");
    expect(saved.place).toBe("City Shelter on Main St");
    expect(saved.notes).toBe("Front desk said no pets.");
    expect(saved.right_id).toBe("shelter-service-animal");
    // occurred_at is normalized to an ISO instant.
    expect(saved.occurred_at).toBe(
      new Date("2026-02-14T18:30").toISOString(),
    );
  });

  it("trims place and notes before saving (Req 14.3)", async () => {
    const incidents = fakeIncidents({ data: { id: "i2" }, error: null });
    dbMock.mockReturnValue(incidents as never);

    await POST(
      makeRequest({
        ...VALID_BODY,
        place: "  Downtown shelter  ",
        notes: "  needed an interpreter  ",
      }) as never,
    );

    const saved = incidents.insert.mock.calls[0]![0];
    expect(saved.place).toBe("Downtown shelter");
    expect(saved.notes).toBe("needed an interpreter");
  });

  it("saves an empty notes string and null right_id when omitted (Req 14.3)", async () => {
    const incidents = fakeIncidents({ data: { id: "i3" }, error: null });
    dbMock.mockReturnValue(incidents as never);

    await POST(
      makeRequest({
        kind: "other",
        place: "Bus stop",
        occurred_at: "2026-02-14T09:00",
      }) as never,
    );

    const saved = incidents.insert.mock.calls[0]![0];
    expect(saved.notes).toBe("");
    expect(saved.right_id).toBeNull();
  });

  it("rejects a kind that is not one of the four permitted values (Req 14.4)", async () => {
    const res = await POST(
      makeRequest({ ...VALID_BODY, kind: "not_a_kind" }) as never,
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.field).toBe("kind");
    expect(typeof body.message).toBe("string");
    expect(dbMock).not.toHaveBeenCalled();
  });

  it("rejects a missing kind and saves nothing (Req 14.4)", async () => {
    const res = await POST(
      makeRequest({
        place: "Shelter",
        occurred_at: "2026-02-14T18:30",
      }) as never,
    );

    expect(res.status).toBe(400);
    expect((await res.json()).field).toBe("kind");
    expect(dbMock).not.toHaveBeenCalled();
  });

  it("rejects an empty place and saves nothing (Req 14.4)", async () => {
    const res = await POST(
      makeRequest({ ...VALID_BODY, place: "   " }) as never,
    );

    expect(res.status).toBe(400);
    expect((await res.json()).field).toBe("place");
    expect(dbMock).not.toHaveBeenCalled();
  });

  it("rejects a missing occurred_at and saves nothing (Req 14.4)", async () => {
    const res = await POST(
      makeRequest({ kind: "communication", place: "Shelter" }) as never,
    );

    expect(res.status).toBe(400);
    expect((await res.json()).field).toBe("occurred_at");
    expect(dbMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid occurred_at timestamp and saves nothing (Req 14.4)", async () => {
    const res = await POST(
      makeRequest({ ...VALID_BODY, occurred_at: "not-a-date" }) as never,
    );

    expect(res.status).toBe(400);
    expect((await res.json()).field).toBe("occurred_at");
    expect(dbMock).not.toHaveBeenCalled();
  });

  it("returns 404 when there is no household cookie and saves nothing", async () => {
    getHouseholdMock.mockResolvedValue(null);

    const res = await POST(makeRequest(VALID_BODY) as never);

    expect(res.status).toBe(404);
    expect(dbMock).not.toHaveBeenCalled();
  });

  it("returns a friendly fallback with no stack trace when the insert errors (Req 22.3)", async () => {
    const incidents = fakeIncidents({
      data: null,
      error: { message: "connection refused" },
    });
    dbMock.mockReturnValue(incidents as never);

    const res = await POST(makeRequest(VALID_BODY) as never);

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.message).toMatch(/could not save this incident/i);
    expect(body.message).not.toMatch(/connection refused|stack|Error/i);
  });

  it("returns a friendly fallback when the data store throws (Req 22.3)", async () => {
    const incidents = fakeIncidents(() =>
      Promise.reject(new Error("network down")),
    );
    dbMock.mockReturnValue(incidents as never);

    const res = await POST(makeRequest(VALID_BODY) as never);

    expect(res.status).toBe(502);
    expect((await res.json()).message).not.toMatch(/network down/i);
  });

  it("treats malformed JSON as a missing kind field error (Req 14.4)", async () => {
    const req = new Request("http://localhost/api/incident", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not json",
    });

    const res = await POST(req as never);

    expect(res.status).toBe(400);
    expect((await res.json()).field).toBe("kind");
    expect(dbMock).not.toHaveBeenCalled();
  });
});
