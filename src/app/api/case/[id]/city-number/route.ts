/**
 * POST /api/case/[id]/city-number — save the city case number for a case.
 *
 * Requirements 7.5, 7.6, 7.7, 22.2, 22.3, 22.5. All database access happens
 * here in a server route using the service-role Supabase client; the browser
 * never talks to Supabase directly.
 *
 * Behavior:
 *  - Scope strictly to the case owned by the current household (cookie). A case
 *    that does not exist, or belongs to another household, returns 404.
 *  - Validate the pasted city case number: a trimmed string of 1 to 100
 *    characters. On a valid number, save city_case_id and set status 'waiting'
 *    (Req 7.5).
 *  - On an invalid number (empty or longer than 100 chars), return a
 *    { field, message } error and leave the saved city_case_id unchanged
 *    (Req 7.6) — no write happens at all.
 *  - Nothing is submitted to a government system automatically; the resident
 *    files with BOS:311 themselves and pastes the number back (Req 7.7).
 *  - A data-store failure becomes a friendly plain-language fallback with no
 *    stack trace, logged via logServerError.
 */
import type { NextRequest } from 'next/server';

import { getCurrentHouseholdId } from '@/lib/auth/household';
import { db } from '@/lib/data/supabase';
import { logServerError } from '@/lib/log';

/** The city-number action must complete within a short budget. */
const DB_BUDGET_MS = 5_000;

/** City case number length bounds (Req 7.5, 7.6; DB CHECK is 1..100). */
const MIN_CITY_NUMBER_LEN = 1;
const MAX_CITY_NUMBER_LEN = 100;

const NOT_FOUND_MESSAGE =
  'We could not find that report. Please go back and try again.';
const STORE_DOWN_MESSAGE =
  'We could not save that number right now. Please try again in a moment.';
const FIELD_ERROR_MESSAGE =
  'Enter the city case number. It is required and must be 100 characters or fewer.';

interface FieldError {
  field: string;
  message: string;
}

/**
 * Validates the pasted city case number. Returns the trimmed value when valid,
 * or a field error when empty or longer than 100 characters. Whitespace-only
 * input is treated as empty.
 */
function validateCityNumber(
  value: unknown,
): { ok: true; value: string } | { ok: false; error: FieldError } {
  if (typeof value !== 'string') {
    return { ok: false, error: { field: 'city_case_id', message: FIELD_ERROR_MESSAGE } };
  }
  const trimmed = value.trim();
  if (
    trimmed.length < MIN_CITY_NUMBER_LEN ||
    trimmed.length > MAX_CITY_NUMBER_LEN
  ) {
    return { ok: false, error: { field: 'city_case_id', message: FIELD_ERROR_MESSAGE } };
  }
  return { ok: true, value: trimmed };
}

/** Rejects a promise after `ms` so a stalled data store becomes a friendly 5xx. */
function withTimeout<T>(promise: PromiseLike<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('data store timed out')),
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

export async function POST(
  request: NextRequest,
  ctx: RouteContext<'/api/case/[id]/city-number'>,
): Promise<Response> {
  // Next 16: dynamic route params are a Promise and MUST be awaited.
  const { id } = await ctx.params;

  const householdId = await getCurrentHouseholdId();
  if (!householdId) {
    return Response.json({ message: NOT_FOUND_MESSAGE }, { status: 404 });
  }

  // Parse the body defensively; a malformed body is an invalid number, which
  // leaves the saved value unchanged (Req 7.6).
  let body: { city_case_id?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { field: 'city_case_id', message: FIELD_ERROR_MESSAGE },
      { status: 400 },
    );
  }

  // Validate before any write so an invalid number never touches the row
  // (Req 7.6: the saved city_case_id is left unchanged).
  const validated = validateCityNumber(body?.city_case_id);
  if (!validated.ok) {
    return Response.json(validated.error, { status: 400 });
  }

  try {
    // Save the number and set status 'waiting', scoped to the owning household.
    // The household_id guard enforces ownership; a non-owned or missing case
    // matches no row and is reported as 404.
    const update = await withTimeout(
      db('cases')
        .update({ city_case_id: validated.value, status: 'waiting' })
        .eq('id', id)
        .eq('household_id', householdId)
        .select('id, status, city_case_id')
        .maybeSingle(),
      DB_BUDGET_MS,
    );

    if (update.error) {
      throw new Error('case city-number update failed');
    }

    if (!update.data) {
      return Response.json({ message: NOT_FOUND_MESSAGE }, { status: 404 });
    }

    const row = update.data as {
      id: string;
      status: string;
      city_case_id: string;
    };
    return Response.json(
      { id: row.id, status: row.status, city_case_id: row.city_case_id },
      { status: 200 },
    );
  } catch (error) {
    logServerError('POST /api/case/[id]/city-number', error);
    return Response.json({ message: STORE_DOWN_MESSAGE }, { status: 503 });
  }
}
