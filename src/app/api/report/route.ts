import type { NextRequest } from "next/server";

import { getCurrentHouseholdId } from "@/lib/auth/household";
import { runCaseAgent } from "@/lib/agent/loop";
import { db, uploadToVault } from "@/lib/data/supabase";
import { logServerError } from "@/lib/log";

/**
 * Report a Barrier route handler — starts a Case Agent run (Next 16 App
 * Router, server-only).
 *
 * POST /api/report
 *   Accepts a barrier submission as either multipart form data (a
 *   browser-resized JPEG under `photo`, plus `lat`/`lng` and optional
 *   `location`/`message`) or a JSON body ({ photo: dataUrl, lat, lng,
 *   location?, message? }). It validates that BOTH a photo and a location are
 *   present; if either is missing it returns 400 with { field, message }
 *   naming the missing input and creates NO case (Req 5.2). On a valid
 *   submission it resolves the current household from the cookie, stores the
 *   photo in the private `vault` bucket, inserts a `cases` row with status
 *   `investigating`, and then starts `runCaseAgent` on that case id so its
 *   per-step trace checkpoints land on the created row (Req 5.1).
 *
 * Why the case row is created FIRST, then runCaseAgent(caseId, …): the agent
 * loop persists after every step via its injected persistence (the default
 * writes `db('cases')` keyed by case id). Creating the row up front with the
 * id means a mid-run timeout leaves a saved partial trace on that row rather
 * than losing the whole run. `maxDuration = 60` gives the run up to the Vercel
 * limit; the loop checkpoints each step so being cut off is safe.
 *
 * Privacy and honesty: the response carries only this case's id, status,
 * route, and plain-language trace. No other resident's address or case detail
 * is ever read or returned (Req 10.1). Every failure maps to a plain-language
 * fallback with no stack trace, logged via `logServerError` (Req 22.3).
 *
 * All database and storage access happens here with the service-role client;
 * the browser never talks to Supabase directly (Req 22.5).
 *
 * Requirements: 5.1, 5.2, 10.1, 22.3, 22.5
 */

// Vercel allows this Case Agent run up to 60 seconds. The loop checkpoints its
// trace after every step, so a timeout never loses the whole run.
export const maxDuration = 60;

// This handler reads the request body and the data store at request time, so
// it runs dynamically.

const NO_HOUSEHOLD_MESSAGE = "No household found. Please create one first.";
const MISSING_PHOTO_MESSAGE = "Please add a photo of the barrier.";
const MISSING_LOCATION_MESSAGE = "Please add the location of the barrier.";
const SAVE_FAILED_MESSAGE =
  "We could not start this report right now. Please try again.";

/** A valid default barrier_type at creation; the agent refines the route. */
const DEFAULT_BARRIER_TYPE = "other";

/** Parsed, validated submission. */
interface ParsedSubmission {
  /** JPEG bytes when a file/blob was uploaded, else null (data-URL path). */
  bytes: ArrayBuffer | null;
  /** base64 JPEG data URL to hand the agent for classification. */
  photoDataUrl: string;
  lat: number;
  lng: number;
  message?: string;
}

/** A validation failure naming the missing/invalid field (Req 5.2). */
interface FieldError {
  field: "photo" | "location";
  message: string;
}

function isDataUrl(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("data:");
}

/** Parse a possibly-string number; returns null when not a finite number. */
function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/**
 * Validate that BOTH a photo and a location are present. Returns a FieldError
 * naming the FIRST missing input (photo checked before location) so the UI can
 * show the error next to that field, or the parsed submission when valid. No
 * case is created on error (Req 5.2).
 */
function validate(input: {
  bytes: ArrayBuffer | null;
  photoDataUrl: string | null;
  lat: number | null;
  lng: number | null;
  message?: string;
}): FieldError | ParsedSubmission {
  const hasPhoto =
    (input.bytes !== null && input.bytes.byteLength > 0) ||
    (input.photoDataUrl !== null && input.photoDataUrl.length > 0);
  if (!hasPhoto) {
    return { field: "photo", message: MISSING_PHOTO_MESSAGE };
  }

  if (input.lat === null || input.lng === null) {
    return { field: "location", message: MISSING_LOCATION_MESSAGE };
  }

  return {
    bytes: input.bytes,
    photoDataUrl: input.photoDataUrl ?? "",
    lat: input.lat,
    lng: input.lng,
    message: input.message,
  };
}

/**
 * Read the submission from either multipart form data or a JSON body. A body
 * that cannot be parsed yields all-empty fields, which `validate` turns into a
 * "photo required" 400 (no case created).
 */
async function parseBody(request: NextRequest): Promise<{
  bytes: ArrayBuffer | null;
  photoDataUrl: string | null;
  lat: number | null;
  lng: number | null;
  message?: string;
}> {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    try {
      const body = (await request.json()) as Record<string, unknown>;
      return {
        bytes: null,
        photoDataUrl: isDataUrl(body.photo) ? body.photo : null,
        lat: toNumber(body.lat),
        lng: toNumber(body.lng),
        message:
          typeof body.message === "string" ? body.message : undefined,
      };
    } catch {
      return { bytes: null, photoDataUrl: null, lat: null, lng: null };
    }
  }

  // Default: multipart form data (the browser-resized JPEG path).
  try {
    const form = await request.formData();
    const photo = form.get("photo");
    let bytes: ArrayBuffer | null = null;
    let photoDataUrl: string | null = null;
    if (photo instanceof Blob && photo.size > 0) {
      bytes = await photo.arrayBuffer();
    } else if (isDataUrl(photo)) {
      photoDataUrl = photo;
    }
    const messageRaw = form.get("message");
    return {
      bytes,
      photoDataUrl,
      lat: toNumber(form.get("lat")),
      lng: toNumber(form.get("lng")),
      message: typeof messageRaw === "string" ? messageRaw : undefined,
    };
  } catch {
    return { bytes: null, photoDataUrl: null, lat: null, lng: null };
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  // Parse first so a missing photo/location is a 400 before any case is made.
  const raw = await parseBody(request);
  const validated = validate(raw);
  if ("field" in validated) {
    // 400 naming the missing input; NO case created (Req 5.2).
    return Response.json(validated, { status: 400 });
  }

  // Demo-grade auth: derive the household from the HTTP-only cookie.
  let householdId: string | null;
  try {
    householdId = await getCurrentHouseholdId();
  } catch (error) {
    logServerError("POST /api/report cookie", error);
    return Response.json({ message: SAVE_FAILED_MESSAGE }, { status: 502 });
  }
  if (!householdId) {
    return Response.json({ message: NO_HOUSEHOLD_MESSAGE }, { status: 404 });
  }

  // Store the photo in the private vault bucket (same pattern as /api/vault).
  // When only a data URL was provided (no raw bytes), decode it so the case
  // still has a stored photo_path; keep the data URL for the agent either way.
  let bytes = validated.bytes;
  let photoDataUrl = validated.photoDataUrl;
  if (bytes && photoDataUrl.length === 0) {
    photoDataUrl = `data:image/jpeg;base64,${Buffer.from(bytes).toString(
      "base64",
    )}`;
  } else if (!bytes && photoDataUrl.length > 0) {
    const comma = photoDataUrl.indexOf(",");
    const base64 = comma >= 0 ? photoDataUrl.slice(comma + 1) : "";
    try {
      bytes = Buffer.from(base64, "base64").buffer.slice(0) as ArrayBuffer;
    } catch {
      bytes = null;
    }
  }

  let photoPath: string;
  try {
    if (!bytes || bytes.byteLength === 0) {
      throw new Error("no photo bytes to store");
    }
    photoPath = await uploadToVault(
      `${householdId}/cases/${crypto.randomUUID()}.jpg`,
      bytes,
      "image/jpeg",
    );
  } catch (error) {
    logServerError("POST /api/report upload", error);
    return Response.json({ message: SAVE_FAILED_MESSAGE }, { status: 502 });
  }

  // Create the case row FIRST, status investigating, so its id exists before
  // the agent run and every per-step checkpoint lands on this row (Req 5.1).
  const { data, error } = await db("cases")
    .insert({
      household_id: householdId,
      barrier_type: DEFAULT_BARRIER_TYPE,
      photo_path: photoPath,
      lat: validated.lat,
      lng: validated.lng,
      status: "investigating",
    })
    .select("id")
    .single();

  if (error || !data) {
    logServerError("POST /api/report insert", error);
    return Response.json({ message: SAVE_FAILED_MESSAGE }, { status: 502 });
  }

  const caseId = data.id as string;

  // Start the Case Agent run on the created case. The loop checkpoints its
  // trace to this row after every step (default persistence writes db('cases')
  // keyed by id), so a mid-run timeout leaves a saved partial trace. Any run
  // failure is turned into a plain-language note; we still return the case id
  // so the client can poll GET /api/case/[id].
  try {
    const result = await runCaseAgent({
      caseId,
      photoDataUrl,
      lat: validated.lat,
      lng: validated.lng,
      userMessage: validated.message,
    });
    return Response.json(
      {
        id: caseId,
        status: result.status,
        route: result.route,
        trace: result.trace,
      },
      { status: 201 },
    );
  } catch (error) {
    logServerError("POST /api/report run", error);
    // The case exists and is investigating; the client can poll for its trace.
    return Response.json(
      { id: caseId, status: "investigating", route: null, trace: [] },
      { status: 201 },
    );
  }
}
