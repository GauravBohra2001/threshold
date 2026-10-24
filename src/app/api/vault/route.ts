import type { NextRequest } from "next/server";

import { getCurrentHouseholdId } from "@/lib/auth/household";
import { labelPhoto } from "@/lib/data/azure";
import {
  createSignedUrl,
  db,
  SIGNED_URL_TTL_SECONDS,
  uploadToVault,
} from "@/lib/data/supabase";
import { logServerError } from "@/lib/log";

/**
 * Proof Vault photo pipeline route handler (Next 16 App Router, server-only).
 *
 * POST /api/vault  accept a browser-resized JPEG (multipart form data) plus a
 *   `kind`, store it in the private `vault` bucket via the service role (15s
 *   timeout), AI-label it (30s timeout), persist a `vault_items` row, and
 *   return the created item view.
 *
 * GET /api/vault  list the current household's vault items, most-recent first,
 *   each with a ≤300s signed URL, its `label`, and a non-empty `alt`
 *   (Req 3.8, 4.1-4.4). Only this household's items are returned (Req 10.1).
 *
 * Resilience and honesty (design "P1 photo pipeline", steps 2-3):
 * - Storage failure/timeout -> NO row is created and the response is a
 *   plain-language "This photo could not be saved." with no stack trace
 *   (Req 3.4).
 * - AI labeling timeout/failure -> the row is still saved with an empty
 *   `label`/`ai_description`, the response carries a fallback alt text
 *   "Unlabeled photo captured <date>" and a labeling-unavailable message
 *   (Req 3.7).
 *
 * All database and storage access happens here with the service-role client;
 * the browser never talks to Supabase directly (Req 22.5).
 *
 * Requirements: 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 4.1, 4.2, 4.3, 4.4, 10.1,
 *   22.1, 22.2, 22.3, 22.5, 23.7
 */

// This handler reads the request body and the data store at request time, so it
// runs dynamically under Cache Components without a route segment config.

/** 15s storage budget per design step 2 (Req 3.4). */
const UPLOAD_TIMEOUT_MS = 15_000;

/** 30s AI labeling budget per design step 3 (Req 3.5). */
const LABEL_TIMEOUT_MS = 30_000;

/** Allowed vault item kinds; matches the DB CHECK constraint. */
const ALLOWED_KINDS = ["equipment", "home_feature", "document"] as const;
type VaultKind = (typeof ALLOWED_KINDS)[number];

const NO_HOUSEHOLD_MESSAGE =
  "No household found. Please create one first.";
const BAD_PHOTO_MESSAGE =
  "Please attach a photo and try again.";
const BAD_KIND_MESSAGE =
  "Please choose what kind of item this is and try again.";
const SAVE_FAILED_MESSAGE =
  "This photo could not be saved.";
const LABELING_UNAVAILABLE_MESSAGE =
  "We saved your photo, but automatic labeling was unavailable. You can add a label yourself.";

function isVaultKind(value: unknown): value is VaultKind {
  return (
    typeof value === "string" &&
    (ALLOWED_KINDS as readonly string[]).includes(value)
  );
}

/** Shape returned to the browser for a created vault item. */
interface VaultItemView {
  id: string;
  kind: VaultKind;
  label: string;
  ai_description: string;
  accessibility_relevant: boolean;
  captured_at: string;
  /** Text alternative for the stored photo; always non-empty (Req 3.7). */
  alt: string;
  /** Present only when automatic labeling was unavailable (Req 3.7). */
  message?: string;
}

/**
 * Build the fallback alt text used when the AI could not label the photo.
 * "Unlabeled photo captured <date>" (Req 3.7).
 */
function unlabeledAlt(capturedAt: string): string {
  const date = new Date(capturedAt);
  const formatted = Number.isNaN(date.getTime())
    ? capturedAt
    : date.toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
  return `Unlabeled photo captured ${formatted}`;
}

/** Run `uploadToVault` with a hard deadline, mapping any failure to `null`. */
async function uploadWithTimeout(
  path: string,
  body: ArrayBuffer,
  timeoutMs: number,
): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  try {
    // uploadToVault throws on failure; translate that to `null` so the caller
    // creates no row and returns a plain-language fallback (no stack trace).
    const stored = uploadToVault(path, body, "image/jpeg").catch(() => null);
    return await Promise.race([stored, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  // Demo-grade auth: derive the household from the HTTP-only cookie.
  let householdId: string | null;
  try {
    householdId = await getCurrentHouseholdId();
  } catch (error) {
    logServerError("POST /api/vault cookie", error);
    return Response.json({ message: SAVE_FAILED_MESSAGE }, { status: 502 });
  }
  if (!householdId) {
    return Response.json({ message: NO_HOUSEHOLD_MESSAGE }, { status: 404 });
  }

  // Parse multipart form data defensively; a malformed body is a 400.
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ message: BAD_PHOTO_MESSAGE }, { status: 400 });
  }

  const kindRaw = form.get("kind");
  if (!isVaultKind(kindRaw)) {
    return Response.json(
      { field: "kind", message: BAD_KIND_MESSAGE },
      { status: 400 },
    );
  }
  const kind: VaultKind = kindRaw;

  const photo = form.get("photo");
  if (!(photo instanceof Blob) || photo.size === 0) {
    return Response.json(
      { field: "photo", message: BAD_PHOTO_MESSAGE },
      { status: 400 },
    );
  }

  const bytes = await photo.arrayBuffer();

  // Step 2: storage with a 15s budget. On failure/timeout create NO row and
  // return "This photo could not be saved." (Req 3.4).
  const photoPath = `${householdId}/${crypto.randomUUID()}.jpg`;
  const storedPath = await uploadWithTimeout(
    photoPath,
    bytes,
    UPLOAD_TIMEOUT_MS,
  );
  if (!storedPath) {
    return Response.json({ message: SAVE_FAILED_MESSAGE }, { status: 502 });
  }

  // Step 3: AI labeling with its own 30s budget. On timeout/failure keep going
  // and save an unlabeled row (Req 3.7).
  const base64 = Buffer.from(bytes).toString("base64");
  const dataUrl = `data:image/jpeg;base64,${base64}`;
  const label = await labelPhoto(dataUrl, { timeoutMs: LABEL_TIMEOUT_MS });

  const labelText = label.ok ? label.value.label : "";
  const descriptionText = label.ok ? label.value.description : "";
  const accessibilityRelevant = label.ok
    ? label.value.accessibility_relevant
    : false;

  // Persist the vault item. The photo is already stored; if the row insert
  // fails we still cannot show it, so surface the save-failed fallback.
  const { data, error } = await db("vault_items")
    .insert({
      household_id: householdId,
      kind,
      label: labelText,
      ai_description: descriptionText,
      accessibility_relevant: accessibilityRelevant,
      photo_path: storedPath,
    })
    .select("id, kind, label, ai_description, accessibility_relevant, captured_at")
    .single();

  if (error || !data) {
    logServerError("POST /api/vault insert", error);
    return Response.json({ message: SAVE_FAILED_MESSAGE }, { status: 502 });
  }

  const capturedAt = data.captured_at as string;
  const view: VaultItemView = {
    id: data.id as string,
    kind: data.kind as VaultKind,
    label: data.label as string,
    ai_description: data.ai_description as string,
    accessibility_relevant: data.accessibility_relevant as boolean,
    captured_at: capturedAt,
    // Alt text: the AI label when present, else the timestamp-derived fallback
    // so no photo ever has empty/missing alt (Req 3.7, 23.7).
    alt: labelText.length > 0 ? labelText : unlabeledAlt(capturedAt),
  };

  if (!label.ok) {
    view.message = LABELING_UNAVAILABLE_MESSAGE;
  }

  return Response.json(view, { status: 201 });
}

/** Shape returned to the browser for a listed vault item (GET). */
interface VaultListItemView {
  id: string;
  kind: VaultKind;
  label: string;
  ai_description: string;
  accessibility_relevant: boolean;
  captured_at: string;
  /**
   * Short-lived signed URL for the private photo; expires ≤300s (Req 3.8).
   * `null` when this item's photo could not be signed (e.g. the file is
   * missing from storage); the item is still returned so the vault lists it
   * with a "Photo not available" placeholder rather than failing the whole
   * response (Req 22.3).
   */
  image_url: string | null;
  /** Text alternative for the stored photo; always non-empty (Req 4.2, 4.3). */
  alt: string;
}

const LIST_FAILED_MESSAGE = "Your vault could not be loaded right now.";

/**
 * GET /api/vault — list the current household's vault items.
 *
 * Returns items ordered by capture timestamp descending so the most recently
 * captured item is first (Req 4.4). Each item carries its stored `label`, an
 * `alt` that is the AI label when present, otherwise a timestamp-derived value
 * so no photo ever exposes empty/missing alt text (Req 4.2, 4.3, 23.7), and an
 * `image_url` that is a signed URL expiring within at most 300 seconds
 * (Req 3.8). Each photo is signed independently: if signing one item fails
 * (for example its file is missing from storage), that failure is logged and
 * the item is returned with `image_url` null, rather than failing the whole
 * response. Only this household's rows are selected, so no other resident's
 * data is returned (Req 10.1). On a data-store failure the response is a
 * plain-language fallback with no stack trace (Req 22.3).
 */
export async function GET(_request: NextRequest): Promise<Response> {
  // Demo-grade auth: derive the household from the HTTP-only cookie.
  let householdId: string | null;
  try {
    householdId = await getCurrentHouseholdId();
  } catch (error) {
    logServerError("GET /api/vault cookie", error);
    return Response.json({ message: LIST_FAILED_MESSAGE }, { status: 502 });
  }
  if (!householdId) {
    return Response.json({ message: NO_HOUSEHOLD_MESSAGE }, { status: 404 });
  }

  // Select ONLY this household's items, most-recent first (Req 4.4, 10.1).
  const { data, error } = await db("vault_items")
    .select(
      "id, kind, label, ai_description, accessibility_relevant, captured_at, photo_path",
    )
    .eq("household_id", householdId)
    .order("captured_at", { ascending: false });

  if (error || !data) {
    logServerError("GET /api/vault list", error);
    return Response.json({ message: LIST_FAILED_MESSAGE }, { status: 502 });
  }

  // Sign each photo independently for ≤300s and compute non-empty alt text. A
  // signing failure on one item (e.g. the file is missing from storage) is
  // logged and that item is returned with image_url null, so one broken photo
  // never fails the whole response.
  const items: VaultListItemView[] = await Promise.all(
    (data as Array<Record<string, unknown>>).map(async (row) => {
      const capturedAt = row.captured_at as string;
      const label = (row.label as string) ?? "";
      const photoPath = row.photo_path as string;
      let imageUrl: string | null = null;
      try {
        imageUrl = await createSignedUrl(photoPath, SIGNED_URL_TTL_SECONDS);
      } catch (signError) {
        logServerError(
          `GET /api/vault sign path=${photoPath}`,
          signError,
        );
        imageUrl = null;
      }
      return {
        id: row.id as string,
        kind: row.kind as VaultKind,
        label,
        ai_description: (row.ai_description as string) ?? "",
        accessibility_relevant: row.accessibility_relevant as boolean,
        captured_at: capturedAt,
        image_url: imageUrl,
        // AI label when present, else timestamp-derived alt (Req 4.2, 4.3).
        alt: label.length > 0 ? label : unlabeledAlt(capturedAt),
      };
    }),
  );

  return Response.json({ items }, { status: 200 });
}
