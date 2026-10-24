/**
 * POST /api/invite/accept — attach a caregiver to a household by invite code.
 *
 * Requirements 2.2–2.6, 22.3, 22.5. All database access happens here in a
 * server route using the service-role Supabase client; the browser never
 * talks to Supabase directly.
 *
 * Behavior:
 *  - Validate caregiver name (1–100 chars) and phone (10–15 digits). On an
 *    invalid field, return 400 { field, message } and attach nothing (2.3).
 *  - Look up the household by invite_code. No match -> 404 plain-language
 *    "invite is not valid" and attach nothing (2.4).
 *  - Household already has a caregiver -> 409 plain-language "invite already
 *    used"; do not attach a second caregiver (2.5).
 *  - Otherwise attach caregiver_name + caregiver_phone within a 5s budget (2.2).
 *  - Data store unavailable -> friendly 503, attach nothing, no stack trace (2.6).
 */
import type { NextRequest } from 'next/server';

import { db } from '@/lib/data/supabase';

/** Attach must complete within 5 seconds (Requirement 2.2). */
const ATTACH_BUDGET_MS = 5_000;

interface FieldError {
  field: string;
  message: string;
}

/** Validates the caregiver name: a trimmed string of 1 to 100 characters. */
function validateCaregiverName(value: unknown): FieldError | null {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return {
      field: 'caregiver_name',
      message: 'Please enter the caregiver name.',
    };
  }
  if (value.trim().length > 100) {
    return {
      field: 'caregiver_name',
      message: 'The caregiver name must be 100 characters or fewer.',
    };
  }
  return null;
}

/** Validates the caregiver phone: 10 to 15 digits (no other characters). */
function validateCaregiverPhone(value: unknown): FieldError | null {
  if (typeof value !== 'string' || !/^[0-9]{10,15}$/.test(value)) {
    return {
      field: 'caregiver_phone',
      message: 'Please enter a phone number with 10 to 15 digits.',
    };
  }
  return null;
}

/** Rejects a promise after `ms` so a stalled data store becomes a friendly 503. */
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

export async function POST(request: NextRequest): Promise<Response> {
  // Parse the body. Malformed JSON is treated as a missing invite code.
  let body: {
    code?: unknown;
    caregiver_name?: unknown;
    caregiver_phone?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { message: 'This invite is not valid. Please check the link and try again.' },
      { status: 404 },
    );
  }

  const code = body?.code;
  const caregiverName = body?.caregiver_name;
  const caregiverPhone = body?.caregiver_phone;

  // Validate caregiver fields before touching the data store. On an invalid
  // field, attach nothing (Requirement 2.3).
  const nameError = validateCaregiverName(caregiverName);
  if (nameError) {
    return Response.json(nameError, { status: 400 });
  }
  const phoneError = validateCaregiverPhone(caregiverPhone);
  if (phoneError) {
    return Response.json(phoneError, { status: 400 });
  }

  // A missing/blank invite code can never match a household (Requirement 2.4).
  if (typeof code !== 'string' || code.trim().length === 0) {
    return Response.json(
      { message: 'This invite is not valid. Please check the link and try again.' },
      { status: 404 },
    );
  }

  const inviteCode = code.trim();
  const name = (caregiverName as string).trim();
  const phone = caregiverPhone as string;

  try {
    // Look up the household by its unique invite code.
    const lookup = await withTimeout(
      db('households')
        .select('id, caregiver_name, caregiver_phone')
        .eq('invite_code', inviteCode)
        .maybeSingle(),
      ATTACH_BUDGET_MS,
    );

    if (lookup.error) {
      // A query error means the data store could not be reached (Requirement 2.6).
      throw new Error('household lookup failed');
    }

    const household = lookup.data as
      | { id: string; caregiver_name: string | null; caregiver_phone: string | null }
      | null;

    // No household matches this invite code (Requirement 2.4): attach nothing.
    if (!household) {
      return Response.json(
        { message: 'This invite is not valid. Please check the link and try again.' },
        { status: 404 },
      );
    }

    // Already has a caregiver (Requirement 2.5): do not attach a second one.
    if (household.caregiver_name && household.caregiver_name.trim().length > 0) {
      return Response.json(
        {
          message:
            'This invite has already been used. Each invite can add one caregiver.',
        },
        { status: 409 },
      );
    }

    // Attach the caregiver. Guard with the same invite code and a
    // still-empty caregiver_name so two concurrent accepts cannot both win
    // (Requirements 2.2, 2.5).
    const update = await withTimeout(
      db('households')
        .update({ caregiver_name: name, caregiver_phone: phone })
        .eq('invite_code', inviteCode)
        .is('caregiver_name', null)
        .select('id')
        .maybeSingle(),
      ATTACH_BUDGET_MS,
    );

    if (update.error) {
      throw new Error('household update failed');
    }

    // The guarded update matched no row: another accept attached a caregiver
    // first (Requirement 2.5).
    if (!update.data) {
      return Response.json(
        {
          message:
            'This invite has already been used. Each invite can add one caregiver.',
        },
        { status: 409 },
      );
    }

    return Response.json({ ok: true }, { status: 200 });
  } catch {
    // Data store unavailable or timed out: friendly 503, attach nothing, no
    // stack trace (Requirement 2.6).
    return Response.json(
      {
        message:
          'We could not complete this invite right now. Please try again in a moment.',
      },
      { status: 503 },
    );
  }
}
