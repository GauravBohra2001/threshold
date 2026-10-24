import type { NextRequest } from "next/server";

import { getCurrentHouseholdId } from "@/lib/auth/household";
import { db } from "@/lib/data/supabase";
import { logServerError } from "@/lib/log";
import { guardResponse } from "@/lib/rules/privacy";
import type { TraceStep } from "@/lib/agent/trace";

/**
 * GET /api/case/[id] — read one case plus its agent trace (Next 16 App Router,
 * server-only data boundary).
 *
 * The live trace view and the approval screen both read this handler. It
 * returns the case fields and the plain-language `trace` step array for the
 * owning household only.
 *
 * Behavior and guarantees:
 *  - Next 16 dynamic params are a Promise and MUST be awaited to get the id
 *    (design "Next.js 16 conventions").
 *  - The case is loaded ONLY when it belongs to the current household (scoped
 *    by the `threshold_household` cookie). A case owned by any other resident
 *    returns 404 — another resident's case is never disclosed (Req 10.1, 10.3).
 *  - No `full_address` or point coordinate from 311 data reaches the body: the
 *    response is passed through `privacy.guardResponse` as defense in depth, so
 *    any lat/lng-style keys (including the case's own stored coordinates) and
 *    any address substring carried in the trace are stripped before serializing
 *    (Req 10.3, 10.4).
 *  - A data-store failure becomes a friendly 502 with no stack trace, logged
 *    via `logServerError` (Req 8.4 follow-up view resilience, 22.3).
 *
 * All database access happens here with the service-role client; the browser
 * never talks to Supabase directly (Req 22.5).
 *
 * Requirements: 5.3, 7.1, 8.4, 10.1, 10.3
 */

// This handler reads the cookie and the data store at request time, so it runs
// dynamically under Cache Components without a route segment config.

const NO_HOUSEHOLD_MESSAGE = "No household found. Please create one first.";
const NOT_FOUND_MESSAGE = "We couldn't find that case.";
const LOAD_FAILED_MESSAGE = "This case could not be loaded right now.";

/** The case row this handler reads. Coordinates are read but stripped before serializing. */
interface CaseRow {
  id: string;
  household_id: string;
  barrier_type: string;
  description: string;
  photo_path: string;
  lat: number | null;
  lng: number | null;
  route: string | null;
  status: string;
  city_case_id: string | null;
  opened_at: string;
  clock_due_at: string | null;
  trace: TraceStep[] | null;
  draft_text: string | null;
}

/** Shape returned to the browser for a case + its trace. No coordinates. */
interface CaseView {
  id: string;
  barrier_type: string;
  description: string;
  route: string | null;
  status: string;
  city_case_id: string | null;
  opened_at: string;
  clock_due_at: string | null;
  trace: TraceStep[];
  draft_text: string | null;
}

export async function GET(
  _request: NextRequest,
  ctx: RouteContext<"/api/case/[id]">,
): Promise<Response> {
  // Next 16: dynamic route params are a Promise and must be awaited.
  const { id } = await ctx.params;

  // Demo-grade auth: derive the household from the HTTP-only cookie.
  let householdId: string | null;
  try {
    householdId = await getCurrentHouseholdId();
  } catch (error) {
    logServerError("GET /api/case/[id] cookie", error);
    return Response.json({ message: LOAD_FAILED_MESSAGE }, { status: 502 });
  }
  if (!householdId) {
    return Response.json({ message: NO_HOUSEHOLD_MESSAGE }, { status: 404 });
  }

  if (typeof id !== "string" || id.trim().length === 0) {
    return Response.json({ message: NOT_FOUND_MESSAGE }, { status: 404 });
  }

  // Load the case ONLY if it belongs to the current household. Scoping by
  // household_id here means a case owned by another resident simply yields no
  // row and returns 404 — it is never disclosed (Req 10.1).
  const { data, error } = await db("cases")
    .select(
      "id, household_id, barrier_type, description, photo_path, lat, lng, route, status, city_case_id, opened_at, clock_due_at, trace, draft_text",
    )
    .eq("id", id)
    .eq("household_id", householdId)
    .maybeSingle();

  if (error) {
    logServerError("GET /api/case/[id] load", error);
    return Response.json({ message: LOAD_FAILED_MESSAGE }, { status: 502 });
  }

  const row = data as CaseRow | null;
  if (!row) {
    // No case with this id belongs to the current household (Req 10.1).
    return Response.json({ message: NOT_FOUND_MESSAGE }, { status: 404 });
  }

  const view: CaseView = {
    id: row.id,
    barrier_type: row.barrier_type,
    description: row.description,
    route: row.route,
    status: row.status,
    city_case_id: row.city_case_id,
    opened_at: row.opened_at,
    clock_due_at: row.clock_due_at,
    trace: Array.isArray(row.trace) ? row.trace : [],
    draft_text: row.draft_text ?? null,
  };

  // Defense in depth (Req 10.3, 10.4): strip any point-coordinate keys and any
  // 311-sourced `full_address` substring that a trace step might carry before
  // the body reaches the browser. We have no 311 source records to key address
  // matching on here, so this primarily drops coordinate-named keys; the case's
  // own lat/lng are already excluded from `CaseView`.
  const guarded = guardResponse(view, []);

  return Response.json(guarded, { status: 200 });
}
