import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";
import { getCurrentHouseholdId } from "@/lib/auth/household";
import { runCaseAgent } from "@/lib/agent/loop";
import { db, uploadToVault } from "@/lib/data/supabase";

vi.mock("@/lib/auth/household", () => ({
  getCurrentHouseholdId: vi.fn(),
}));

vi.mock("@/lib/agent/loop", () => ({
  runCaseAgent: vi.fn(),
}));

vi.mock("@/lib/data/supabase", () => ({
  db: vi.fn(),
  uploadToVault: vi.fn(),
}));

const householdMock = vi.mocked(getCurrentHouseholdId);
const runCaseAgentMock = vi.mocked(runCaseAgent);
const dbMock = vi.mocked(db);
const uploadMock = vi.mocked(uploadToVault);

/**
 * Builds a fake `cases` query surface whose insert().select().single()
 * resolves to the given result. Records the inserted row so tests can assert
 * status/household/barrier_type.
 */
function fakeCases(result: { data: unknown; error: unknown }) {
  const single = vi.fn(() => Promise.resolve(result));
  const insert = vi.fn((_row: Record<string, unknown>) => ({
    select: vi.fn(() => ({ single })),
  }));
  return { insert, _single: single };
}

/** JSON request helper. */
function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/api/report", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** A tiny valid 1x1 JPEG data URL stand-in (content is irrelevant to tests). */
const PHOTO_DATA_URL = `data:image/jpeg;base64,${Buffer.from("jpeg-bytes").toString("base64")}`;

beforeEach(() => {
  vi.clearAllMocks();
  householdMock.mockResolvedValue("h1");
  uploadMock.mockResolvedValue("h1/cases/photo.jpg");
  runCaseAgentMock.mockResolvedValue({
    status: "draft_ready",
    route: "311_blocked_sidewalk",
    trace: [],
  });
});

describe("POST /api/report", () => {
  it("rejects a submission missing a photo with 400 and creates no case (Req 5.2)", async () => {
    const res = await POST(
      jsonRequest({ lat: 42.3, lng: -71.06 }) as never,
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.field).toBe("photo");
    expect(typeof body.message).toBe("string");
    // No case created and no agent run started.
    expect(dbMock).not.toHaveBeenCalled();
    expect(runCaseAgentMock).not.toHaveBeenCalled();
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it("rejects a submission missing a location with 400 and creates no case (Req 5.2)", async () => {
    const res = await POST(
      jsonRequest({ photo: PHOTO_DATA_URL }) as never,
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.field).toBe("location");
    expect(typeof body.message).toBe("string");
    expect(dbMock).not.toHaveBeenCalled();
    expect(runCaseAgentMock).not.toHaveBeenCalled();
  });

  it("rejects a submission missing both photo and location, naming photo first (Req 5.2)", async () => {
    const res = await POST(jsonRequest({}) as never);

    expect(res.status).toBe(400);
    expect((await res.json()).field).toBe("photo");
    expect(dbMock).not.toHaveBeenCalled();
    expect(runCaseAgentMock).not.toHaveBeenCalled();
  });

  it("creates a case investigating then starts runCaseAgent with the case id (Req 5.1)", async () => {
    const cases = fakeCases({ data: { id: "case-123" }, error: null });
    dbMock.mockReturnValue(cases as never);

    const res = await POST(
      jsonRequest({ photo: PHOTO_DATA_URL, lat: 42.3, lng: -71.06 }) as never,
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBe("case-123");
    expect(body.status).toBe("draft_ready");
    expect(body.route).toBe("311_blocked_sidewalk");

    // The case row was inserted first with status investigating.
    expect(cases.insert).toHaveBeenCalledTimes(1);
    const inserted = cases.insert.mock.calls[0]![0];
    expect(inserted.status).toBe("investigating");
    expect(inserted.household_id).toBe("h1");
    expect(inserted.lat).toBe(42.3);
    expect(inserted.lng).toBe(-71.06);

    // runCaseAgent was invoked with the created case id.
    expect(runCaseAgentMock).toHaveBeenCalledTimes(1);
    const runArg = runCaseAgentMock.mock.calls[0][0];
    expect(runArg.caseId).toBe("case-123");
    expect(runArg.lat).toBe(42.3);
    expect(runArg.lng).toBe(-71.06);
    expect(runArg.photoDataUrl).toContain("data:image/jpeg");
  });

  it("returns 404 when there is no household and creates no case", async () => {
    householdMock.mockResolvedValue(null);

    const res = await POST(
      jsonRequest({ photo: PHOTO_DATA_URL, lat: 42.3, lng: -71.06 }) as never,
    );

    expect(res.status).toBe(404);
    expect(dbMock).not.toHaveBeenCalled();
    expect(runCaseAgentMock).not.toHaveBeenCalled();
  });

  it("returns a friendly fallback with no stack trace when the insert fails (Req 22.3)", async () => {
    const cases = fakeCases({ data: null, error: { message: "boom" } });
    dbMock.mockReturnValue(cases as never);

    const res = await POST(
      jsonRequest({ photo: PHOTO_DATA_URL, lat: 42.3, lng: -71.06 }) as never,
    );

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(typeof body.message).toBe("string");
    expect(body.message).not.toMatch(/boom|stack|Error/i);
    expect(runCaseAgentMock).not.toHaveBeenCalled();
  });

  it("still returns the case id if the agent run throws, so the client can poll (Req 22.3)", async () => {
    const cases = fakeCases({ data: { id: "case-err" }, error: null });
    dbMock.mockReturnValue(cases as never);
    runCaseAgentMock.mockRejectedValue(new Error("agent exploded"));

    const res = await POST(
      jsonRequest({ photo: PHOTO_DATA_URL, lat: 42.3, lng: -71.06 }) as never,
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBe("case-err");
    expect(body.status).toBe("investigating");
    // No leaked error detail in the response.
    expect(JSON.stringify(body)).not.toMatch(/agent exploded|stack/i);
  });

  it("accepts multipart form data with a photo blob and location", async () => {
    const cases = fakeCases({ data: { id: "case-mp" }, error: null });
    dbMock.mockReturnValue(cases as never);

    const form = new FormData();
    form.set("photo", new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" }));
    form.set("lat", "42.31");
    form.set("lng", "-71.1");
    const req = new Request("http://localhost/api/report", {
      method: "POST",
      body: form,
    });

    const res = await POST(req as never);

    expect(res.status).toBe(201);
    expect(uploadMock).toHaveBeenCalledTimes(1);
    expect(runCaseAgentMock).toHaveBeenCalledTimes(1);
    expect(runCaseAgentMock.mock.calls[0][0].caseId).toBe("case-mp");
  });
});
