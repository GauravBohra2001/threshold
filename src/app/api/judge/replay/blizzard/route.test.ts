import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  POST,
  REPLAY_LABEL,
  REPLAY_UNAVAILABLE_MESSAGE,
} from "./route";
import { getCurrentHouseholdId } from "@/lib/auth/household";
import { db } from "@/lib/data/supabase";

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
}));

vi.mock("@/lib/auth/household", () => ({
  getCurrentHouseholdId: vi.fn(),
}));

vi.mock("@/lib/data/supabase", () => ({
  db: vi.fn(),
}));

// Imported after the mock so these are the mocked implementations.
import { readFile } from "node:fs/promises";

const readFileMock = vi.mocked(readFile);
const getCurrentHouseholdIdMock = vi.mocked(getCurrentHouseholdId);
const dbMock = vi.mocked(db);

/** A valid NWS-style fixture mirroring the shape nws.ts normalizes. */
const VALID_FIXTURE = JSON.stringify({
  type: "FeatureCollection",
  features: [
    {
      id: "urn:oid:blizzard-2026-02-22",
      type: "Feature",
      properties: {
        id: "urn:oid:blizzard-2026-02-22",
        event: "Blizzard Warning",
        headline: "Blizzard Warning issued February 22, 2026",
        areaDesc: "Suffolk, MA; Norfolk, MA",
        severity: "Extreme",
        effective: "2026-02-22T06:00:00-05:00",
        expires: "2026-02-23T18:00:00-05:00",
      },
    },
  ],
});

/**
 * Builds a fake `checkins` upsert surface returning `result` from
 * upsert().select().single().
 */
function fakeCheckins(result: { data: unknown; error: unknown }) {
  const single = vi.fn(() => Promise.resolve(result));
  const upsert = vi.fn(() => ({ select: vi.fn(() => ({ single })) }));
  return { upsert, _single: single };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/judge/replay/blizzard", () => {
  it("loads the fixture and creates a replay check-in (Req 20.5, 20.9)", async () => {
    readFileMock.mockResolvedValue(VALID_FIXTURE);
    getCurrentHouseholdIdMock.mockResolvedValue("hh-demo");
    const checkins = fakeCheckins({ data: { id: "ci-1" }, error: null });
    dbMock.mockReturnValue(checkins as never);

    const res = await POST();

    expect(res.status).toBe(201);
    const body = await res.json();
    // Replay label is always surfaced (Req 20.9).
    expect(body.label).toBe(REPLAY_LABEL);
    expect(body.checkin_id).toBe("ci-1");
    expect(body.household_id).toBe("hh-demo");
    expect(body.alert.id).toBe("urn:oid:blizzard-2026-02-22");
    expect(body.alert.event).toBe("Blizzard Warning");

    // is_replay=true recorded on the Check_In row (Req 11.2), keyed on the
    // unique (household_id, alert_id) pair so repeat replays are idempotent.
    expect(checkins.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        household_id: "hh-demo",
        alert_id: "urn:oid:blizzard-2026-02-22",
        is_replay: true,
      }),
      { onConflict: "household_id,alert_id" },
    );
  });

  it("surfaces only the allowed facts attributed to Mass.gov (Req 20.5, 20.10)", async () => {
    readFileMock.mockResolvedValue(VALID_FIXTURE);
    getCurrentHouseholdIdMock.mockResolvedValue("hh-demo");
    dbMock.mockReturnValue(
      fakeCheckins({ data: { id: "ci-1" }, error: null }) as never,
    );

    const res = await POST();
    const body = await res.json();

    expect(body.facts.dates).toMatch(/February 22 to 23, 2026/);
    expect(body.facts.snowfall).toMatch(/nearly three feet/i);
    expect(body.facts.outages).toMatch(/above 290,000/);
    expect(body.facts.source).toMatch(/Mass\.gov press release dated April 9, 2026/);
  });

  it("returns a friendly fallback and writes nothing when the fixture fails to load (Req 20.7)", async () => {
    readFileMock.mockRejectedValue(new Error("ENOENT: no such file"));
    getCurrentHouseholdIdMock.mockResolvedValue("hh-demo");

    const res = await POST();

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.message).toBe(REPLAY_UNAVAILABLE_MESSAGE);
    // No stack trace / raw error leaked (Req 20.7).
    expect(body.message).not.toMatch(/ENOENT|stack|Error:/i);
    // Seeded demo data is left unchanged: no db access at all.
    expect(dbMock).not.toHaveBeenCalled();
  });

  it("returns a friendly fallback when the fixture JSON is malformed (Req 20.7)", async () => {
    readFileMock.mockResolvedValue("{ not valid json");
    getCurrentHouseholdIdMock.mockResolvedValue("hh-demo");

    const res = await POST();

    expect(res.status).toBe(502);
    expect((await res.json()).message).toBe(REPLAY_UNAVAILABLE_MESSAGE);
    expect(dbMock).not.toHaveBeenCalled();
  });

  it("returns a friendly fallback when the fixture has no alert feature (Req 20.7)", async () => {
    readFileMock.mockResolvedValue(
      JSON.stringify({ type: "FeatureCollection", features: [] }),
    );
    getCurrentHouseholdIdMock.mockResolvedValue("hh-demo");

    const res = await POST();

    expect(res.status).toBe(502);
    expect((await res.json()).message).toBe(REPLAY_UNAVAILABLE_MESSAGE);
    expect(dbMock).not.toHaveBeenCalled();
  });

  it("asks the user to open the demo first when no household cookie is set", async () => {
    readFileMock.mockResolvedValue(VALID_FIXTURE);
    getCurrentHouseholdIdMock.mockResolvedValue(null);

    const res = await POST();

    expect(res.status).toBe(409);
    expect(typeof (await res.json()).message).toBe("string");
    expect(dbMock).not.toHaveBeenCalled();
  });

  it("returns a friendly fallback when the check-in insert fails (no stack trace)", async () => {
    readFileMock.mockResolvedValue(VALID_FIXTURE);
    getCurrentHouseholdIdMock.mockResolvedValue("hh-demo");
    dbMock.mockReturnValue(
      fakeCheckins({ data: null, error: { message: "connection refused" } }) as never,
    );

    const res = await POST();

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(typeof body.message).toBe("string");
    expect(body.message).not.toMatch(/connection refused|stack|Error:/i);
  });
});
