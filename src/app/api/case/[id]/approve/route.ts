/**
 * POST /api/case/[id]/approve — explicit resident approval of a drafted filing.
 *
 * Requirements 7.2, 7.3, 7.7, 22.2, 22.3, 22.5. All database access happens
 * here in a server route using the service-role Supabase client; the browser
 * never talks to Supabase directly.
 *
 * Behavior:
 *  - Scope strictly to the case owned by the current household (cookie). A case
 *    that does not exist, or belongs to another household, returns 404.
 *  - This is the explicit approval action. For a case whose agent produced a
 *    draft, set status 'draft_ready' (Req 7.2). Nothing is ever submitted to a
 *    government system automatically here (Req 7.7) — approval only flips the
 *    local status.
 *  - Declining is simply not calling this endpoint: the draft and the current
 *    status are retained (Req 7.3). There is no "decline" side effect to run.
 *  - A data-store failure becomes a friendly plain-language fallback with no
 *    stack trace, logged via logServerError.
 */
import type { NextRequest } from 'next/server';

import { getCurrentHouseholdId } from '@/lib/auth/household';
import { db } from '@/lib/data/supabase';
import { logServerError } from '@/lib/log';

/** The approve/city-number actions must complete within a short budget. */
const DB_BUDGET_MS = 5_000;

const NOT_FOUND_MESSAGE =
  'We could not find that report. Please go back and try again.';
const STORE_DOWN_MESSAGE =
  'We could not approve this draft right now. Please try again in a moment.';

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
  ctx: RouteContext<'/api/case/[id]/approve'>,
): Promise<Response> {
  // Next 16: dynamic route params are a Promise and MUST be awaited.
  const { id } = await ctx.params;

  // The approval screen may send the verbatim (possibly edited) draft text to
  // persist alongside the status flip (Req 7.1). A missing/invalid body is fine.
  let editedDraft: string | null = null;
  try {
    const body = (await request.json()) as { draft?: unknown };
    if (typeof body?.draft === "string" && body.draft.trim().length > 0) {
      editedDraft = body.draft;
    }
  } catch {
    editedDraft = null;
  }

  const householdId = await getCurrentHouseholdId();
  if (!householdId) {
    // No household cookie means we cannot own any case: treat as not found so
    // we never reveal whether a case id exists for another household.
    return Response.json({ message: NOT_FOUND_MESSAGE }, { status: 404 });
  }

  try {
    // Flip to draft_ready only for a case owned by the current household. The
    // household_id guard enforces ownership; a non-owned or missing case
    // matches no row and is reported as 404 (never another household's data).
    const update = await withTimeout(
      db('cases')
        .update(
          editedDraft !== null
            ? { status: 'draft_ready', draft_text: editedDraft }
            : { status: 'draft_ready' },
        )
        .eq('id', id)
        .eq('household_id', householdId)
        .select('id, status')
        .maybeSingle(),
      DB_BUDGET_MS,
    );

    if (update.error) {
      throw new Error('case approve update failed');
    }

    if (!update.data) {
      return Response.json({ message: NOT_FOUND_MESSAGE }, { status: 404 });
    }

    const row = update.data as { id: string; status: string };
    return Response.json(
      { id: row.id, status: row.status },
      { status: 200 },
    );
  } catch (error) {
    logServerError('POST /api/case/[id]/approve', error);
    return Response.json({ message: STORE_DOWN_MESSAGE }, { status: 503 });
  }
}
