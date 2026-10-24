import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

// --- Mocks for the route's server-only dependencies -------------------------

const getCurrentHouseholdIdMock = vi.fn(
  async (..._args: unknown[]) => "house-1" as string | null,
);
vi.mock("@/lib/auth/household", () => ({
  getCurrentHouseholdId: (...args: unknown[]) =>
    getCurrentHouseholdIdMock(...args),
}));

const uploadToVaultMock = vi.fn();
const createSignedUrlMock = vi.fn();
vi.mock("@/lib/data/supabase", () => ({
  uploadToVault: (...args: unknown[]) => uploadToVaultMock(...args),
  createSignedUrl: (...args: unknown[]) => createSignedUrlMock(...args),
  SIGNED_URL_TTL_SECONDS: 300,
  db: (...args: unknown[]) => dbMock(...args),
}));

const labelPhotoMock = vi.fn();
vi.mock("@/lib/data/azure", () => ({
  labelPhoto: (...args: unknown[]) => labelPhotoMock(...args),
}));

// Chainable Supabase insert().select().single() stub.
let insertResult: { data: unknown; error: unknown } = {
  data: {
    id: "item-1",
    kind: "equipment",
    label: "",
    ai_description: "",
    accessibility_relevant: false,
    captured_at: "2026-02-10T12:00:00Z",
  },
  error: null,
};
let capturedInsert: Record<string, unknown> | null = null;

// GET path state: select(...).eq(...).order(...) resolves to listResult.
let listResult: { data: unknown; error: unknown } = { data: [], error: null };
let capturedListEq: { column: string; value: unknown } | null = null;
let capturedListOrder: { column: string; options: unknown } | null = null;

const dbMock = vi.fn((..._args: unknown[]) => ({
  insert: (record: Record<string, unknown>) => {
    capturedInsert = record;
    return {
      select: () => ({
        single: async () => insertResult,
      }),
    };
  },
  // GET path: select().eq().order() is a thenable resolving to listResult.
  select: () => ({
    eq: (column: string, value: unknown) => {
      capturedListEq = { column, value };
      return {
        order: (column2: string, options: unknown) => {
          capturedListOrder = { column: column2, options };
          return Promise.resolve(listResult);
        },
      };
    },
  }),
}));

import { GET, POST } from "@/app/api/vault/route";

/** Build a minimal NextRequest-like object exposing formData(). */
function makeRequest(form: FormData): NextRequest {
  return {
    formData: async () => form,
    nextUrl: { origin: "https://threshold.test" },
  } as unknown as NextRequest;
}

function makeForm(kind: string, withPhoto = true): FormData {
  const form = new FormData();
  form.set("kind", kind);
  if (withPhoto) {
    form.set("photo", new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" }));
  }
  return form;
}

const okLabel = {
  ok: true as const,
  value: {
    label: "Power wheelchair",
    description: "A black motorized wheelchair.",
    accessibility_relevant: true,
    kind: "equipment" as const,
  },
};

/** Build a minimal NextRequest-like object for GET (no form body). */
function makeGetRequest(): NextRequest {
  return {
    nextUrl: { origin: "https://threshold.test" },
  } as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  capturedInsert = null;
  capturedListEq = null;
  capturedListOrder = null;
  listResult = { data: [], error: null };
  getCurrentHouseholdIdMock.mockResolvedValue("house-1");
  uploadToVaultMock.mockResolvedValue("house-1/photo.jpg");
  createSignedUrlMock.mockImplementation(
    async (path: string) => `https://signed.test/${path}?token=abc`,
  );
  labelPhotoMock.mockResolvedValue(okLabel);
  insertResult = {
    data: {
      id: "item-1",
      kind: "equipment",
      label: "Power wheelchair",
      ai_description: "A black motorized wheelchair.",
      accessibility_relevant: true,
      captured_at: "2026-02-10T12:00:00Z",
    },
    error: null,
  };
});

describe("POST /api/vault", () => {
  it("stores the photo, labels it, inserts a row, and returns 201 with the AI label as alt", async () => {
    const res = await POST(makeRequest(makeForm("equipment")));
    expect(res.status).toBe(201);

    const json = (await res.json()) as Record<string, unknown>;
    expect(json.id).toBe("item-1");
    expect(json.label).toBe("Power wheelchair");
    expect(json.accessibility_relevant).toBe(true);
    expect(json.alt).toBe("Power wheelchair");
    expect(json.message).toBeUndefined();

    // Upload ran and the row carried the stored path.
    expect(uploadToVaultMock).toHaveBeenCalledTimes(1);
    expect(capturedInsert).toMatchObject({
      household_id: "house-1",
      kind: "equipment",
      photo_path: "house-1/photo.jpg",
    });
  });

  it("creates NO row and returns a plain 'could not be saved' message on storage failure (Req 3.4)", async () => {
    // uploadToVault throws -> the route maps it to a failure with no row.
    uploadToVaultMock.mockRejectedValue(new Error("boom: storage down"));

    const res = await POST(makeRequest(makeForm("equipment")));
    expect(res.status).toBe(502);

    const json = (await res.json()) as { message: string };
    expect(json.message).toBe("This photo could not be saved.");
    expect(json.message).not.toMatch(/stack|Error:|boom/);

    // No labeling and no DB insert were attempted.
    expect(labelPhotoMock).not.toHaveBeenCalled();
    expect(dbMock).not.toHaveBeenCalled();
  });

  it("saves an unlabeled row with fallback alt and a labeling-unavailable message on AI timeout (Req 3.7)", async () => {
    labelPhotoMock.mockResolvedValue({ ok: false, reason: "timeout" });
    insertResult = {
      data: {
        id: "item-2",
        kind: "equipment",
        label: "",
        ai_description: "",
        accessibility_relevant: false,
        captured_at: "2026-02-10T12:00:00Z",
      },
      error: null,
    };

    const res = await POST(makeRequest(makeForm("equipment")));
    expect(res.status).toBe(201);

    const json = (await res.json()) as Record<string, unknown>;
    expect(json.label).toBe("");
    expect(json.ai_description).toBe("");
    expect(json.accessibility_relevant).toBe(false);
    expect(json.alt).toMatch(/^Unlabeled photo captured /);
    expect(json.message).toMatch(/automatic labeling was unavailable/i);

    // The empty label/description were persisted.
    expect(capturedInsert).toMatchObject({ label: "", ai_description: "" });
  });

  it("rejects an invalid kind with a 400 field error and no upload", async () => {
    const res = await POST(makeRequest(makeForm("not-a-kind")));
    expect(res.status).toBe(400);
    const json = (await res.json()) as { field: string };
    expect(json.field).toBe("kind");
    expect(uploadToVaultMock).not.toHaveBeenCalled();
  });

  it("rejects a missing photo with a 400 field error", async () => {
    const res = await POST(makeRequest(makeForm("equipment", false)));
    expect(res.status).toBe(400);
    const json = (await res.json()) as { field: string };
    expect(json.field).toBe("photo");
    expect(uploadToVaultMock).not.toHaveBeenCalled();
  });

  it("returns 404 when there is no household cookie", async () => {
    getCurrentHouseholdIdMock.mockResolvedValue(null);
    const res = await POST(makeRequest(makeForm("equipment")));
    expect(res.status).toBe(404);
    expect(uploadToVaultMock).not.toHaveBeenCalled();
  });
});

describe("GET /api/vault", () => {
  const rows = [
    {
      id: "item-new",
      kind: "equipment",
      label: "Power wheelchair",
      ai_description: "A black motorized wheelchair.",
      accessibility_relevant: true,
      captured_at: "2026-02-10T12:00:00Z",
      photo_path: "house-1/new.jpg",
    },
    {
      id: "item-old",
      kind: "home_feature",
      label: "",
      ai_description: "",
      accessibility_relevant: false,
      captured_at: "2026-02-01T09:00:00Z",
      photo_path: "house-1/old.jpg",
    },
  ];

  it("returns items most-recent first, each with a ≤300s signed URL and non-empty alt", async () => {
    listResult = { data: rows, error: null };

    const res = await GET(makeGetRequest());
    expect(res.status).toBe(200);

    const json = (await res.json()) as {
      items: Array<Record<string, unknown>>;
    };
    expect(json.items).toHaveLength(2);

    // Only this household's rows were queried (Req 10.1) and ordered DESC by
    // captured_at (most-recent first, Req 4.4).
    expect(capturedListEq).toEqual({ column: "household_id", value: "house-1" });
    expect(capturedListOrder).toEqual({
      column: "captured_at",
      options: { ascending: false },
    });

    // Each item carries a signed URL requested with the 300s cap (Req 3.8).
    expect(createSignedUrlMock).toHaveBeenCalledTimes(2);
    expect(createSignedUrlMock).toHaveBeenCalledWith("house-1/new.jpg", 300);
    expect(createSignedUrlMock).toHaveBeenCalledWith("house-1/old.jpg", 300);

    const [first, second] = json.items;
    expect(first.id).toBe("item-new");
    expect(first.signed_url).toBe(
      "https://signed.test/house-1/new.jpg?token=abc",
    );
    // AI label is used as alt when present (Req 4.2).
    expect(first.alt).toBe("Power wheelchair");

    // No AI label -> timestamp-derived, non-empty alt (Req 4.3, 23.7).
    expect(second.id).toBe("item-old");
    expect(String(second.alt).length).toBeGreaterThan(0);
    expect(second.alt).toMatch(/^Unlabeled photo captured /);
  });

  it("returns an empty list (not an error) when the vault has no items (Req 4.5)", async () => {
    listResult = { data: [], error: null };
    const res = await GET(makeGetRequest());
    expect(res.status).toBe(200);
    const json = (await res.json()) as { items: unknown[] };
    expect(json.items).toEqual([]);
    expect(createSignedUrlMock).not.toHaveBeenCalled();
  });

  it("returns 404 when there is no household cookie", async () => {
    getCurrentHouseholdIdMock.mockResolvedValue(null);
    const res = await GET(makeGetRequest());
    expect(res.status).toBe(404);
  });

  it("returns a plain-language fallback with no stack trace on a data-store error", async () => {
    listResult = { data: null, error: { message: "boom: db down" } };
    const res = await GET(makeGetRequest());
    expect(res.status).toBe(502);
    const json = (await res.json()) as { message: string };
    expect(json.message).toMatch(/could not be loaded/i);
    expect(json.message).not.toMatch(/stack|Error:|boom/);
  });

  it("falls back to a friendly message if signing a URL fails (no broken item)", async () => {
    listResult = { data: rows, error: null };
    createSignedUrlMock.mockRejectedValueOnce(new Error("sign failed"));
    const res = await GET(makeGetRequest());
    expect(res.status).toBe(502);
    const json = (await res.json()) as { message: string };
    expect(json.message).toMatch(/could not be loaded/i);
  });
});
