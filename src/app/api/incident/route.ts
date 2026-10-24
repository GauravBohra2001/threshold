/**
 * POST /api/incident — log a Rights_Card incident for the current household.
 *
 * Requirements 14.3, 14.4, 22.1, 22.3, 22.5. All database access happens here
 * in a server route using the service-role Supabase client; the browser never
 * talks to Supabase directly.
 *
 * Behavior:
 *  - Validate `kind` (one of shelter_refusal | service_animal | communication |
 *    other), `place` (non-empty), and `occurred_at` (a valid timestamp). On an
 *    invalid or missing field, return 400 { field, message } and save nothing;
 *    the browser keeps the entered values and shows the field error (Req 14.4).
 *  - On valid input, save { kind, place, occurred_at, notes, right_id } for the
 *    current household and confirm the save (Req 14.3).
 *  - No household cookie -> 404 plain-language message, save nothing.
 *  - Data-store error/timeout -> friendly fallback, no stack trace (Req 22.3),
 *    logged via logServerError.
 */
import type { NextRequest } from "next/server";

import { getCurrentHouseholdId } from "@/lib/auth/household";
import { db } from "@/lib/data/supabase";
import { logServerError } from "@/lib/log";

/** The save must complete within this budget; a stall becomes a friendly 503. */
const SAVE_BUDGET_MS = 5_000;

/** The four permitted incident kinds; matches the DB CHECK constraint. */
const ALLOWED_KINDS = [
  "shelter_refusal",
  "service_animal",
  "communication",
  "other",
] as const;
type IncidentKind = (typeof ALLOWED_KINDS)[number];

const NO_HOUSEHOLD_MESSAGE = "No household found. Please create one first.";
const SAVE_FAILED_MESSAGE =
  "We could not save this incident right now. Please try again in a moment.";
const SAVED_MESSAGE = "Your incident was saved.";

interface FieldError {
  field: string;
  message: string;
}

function isIncidentKind(value: unknown): value is IncidentKind {
  return (
    typeof value === "string" &&
    (ALLOWED_KINDS as readonly string[]).includes(value)
  );
}

/** Validates `kind`: present and one of the four permitted values (Req 14.4). */
function validateKind(value: unknown): FieldError | null {
  if (!isIncidentKind(value)) {
    return {
      field: "kind",
      message: "Please choose what happened from the list.",
    };
  }
  return null;
}

/** Validates `place`: a trimmed, non-empty string (Req 14.4). */
function validatePlace(value: unknown): FieldError | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return {
      field: "place",
      message: "Please enter where this happened.",
    };
  }
  return null;
}

/** Validates `occurred_at`: a parseable timestamp (Req 14.4). */
function validateOccurredAt(value: unknown): FieldError | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return {
      field: "occurred_at",
      message: "Please enter when this happened.",
    };
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return {
      field: "occurred_at",
      message: "Please enter a valid date and time for when this happened.",
    };
  }
  return null;
}

/** Rejects a promise after `ms` so a stalled data store becomes a friendly 503. */
function withTimeout<T>(promise: PromiseLike<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("data store timed out")),
      ms,
    );
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

export async function POST(request: NextRequest): Promise<Response> {
  // Demo-grade auth: derive the household from the HTTP-only cookie.
  let householdId: string | null;
  try {
    householdId = await getCurrentHouseholdId();
  } catch (error) {
    logServerError("POST /api/incident cookie", error);
    return Response.json({ message: SAVE_FAILED_MESSAGE }, { status: 502 });
  }
  if (!householdId) {
    return Response.json({ message: NO_HOUSEHOLD_MESSAGE }, { status: 404 });
  }

  // Parse the body. Malformed JSON is treated as a missing `kind` so the
  // entered values on the client are retained and the field error is shown.
  let body: {
    kind?: unknown;
    place?: unknown;
    occurred_at?: unknown;
    notes?: unknown;
    right_id?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return Response.json(
      {
        field: "kind",
        message: "Please choose what happened from the list.",
      },
      { status: 400 },
    );
  }

  // Validate required fields before touching the data store; on any invalid
  // field, save nothing and name the field (Req 14.4).
  const kindError = validateKind(body?.kind);
  if (kindError) {
    return Response.json(kindError, { status: 400 });
  }
  const placeError = validatePlace(body?.place);
  if (placeError) {
    return Response.json(placeError, { status: 400 });
  }
  const occurredAtError = validateOccurredAt(body?.occurred_at);
  if (occurredAtError) {
    return Response.json(occurredAtError, { status: 400 });
  }

  const kind = body.kind as IncidentKind;
  const place = (body.place as string).trim();
  // Normalize to an ISO 8601 instant for timestamptz storage.
  const occurredAt = new Date(body.occurred_at as string).toISOString();
  const notes =
    typeof body.notes === "string" ? body.notes.trim() : "";
  // right_id is optional; keep it only when it is a non-empty string.
  const rightId =
    typeof body.right_id === "string" && body.right_id.trim().length > 0
      ? body.right_id.trim()
      : null;

  try {
    const insert = await withTimeout(
      db("incidents")
        .insert({
          household_id: householdId,
          kind,
          place,
          occurred_at: occurredAt,
          notes,
          right_id: rightId,
        })
        .select("id")
        .single(),
      SAVE_BUDGET_MS,
    );

    if (insert.error || !insert.data) {
      throw new Error("incident insert failed");
    }

    return Response.json(
      { ok: true, id: (insert.data as { id: string }).id, message: SAVED_MESSAGE },
      { status: 201 },
    );
  } catch (error) {
    // Data store unavailable or timed out: friendly fallback, save nothing, no
    // stack trace (Req 22.3).
    logServerError("POST /api/incident", error);
    return Response.json({ message: SAVE_FAILED_MESSAGE }, { status: 502 });
  }
}
