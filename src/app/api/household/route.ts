import type { NextRequest } from "next/server";

import { getCurrentHousehold, setHouseholdCookie } from "@/lib/auth/household";
import { lookup } from "@/lib/data/geocoder";
import { db } from "@/lib/data/supabase";
import { logServerError } from "@/lib/log";
import {
  generateInviteCode,
  validateHouseholdInput,
} from "@/lib/rules/household-input";

/**
 * Household route handlers (Next 16 App Router, server-only data boundary).
 *
 * POST /api/household  create a household: validate input, geocode the address
 *   (10s), store lat/lng/county_fips/neighborhood, set sim_offset_days=0 and
 *   created_at (DB default), mint a unique invite_code, set the HTTP-only
 *   `threshold_household` cookie, and return the created household view.
 * GET  /api/household  read the current household from the cookie.
 *
 * All database access happens here with the service-role client; the browser
 * never talks to Supabase directly (Req 1.6, 22.4, 22.5). Every external call
 * has a timeout and a plain-language fallback with no stack trace (Req 1.4,
 * 1.5, 22.2, 22.3).
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 2.1, 22.2, 22.3, 22.4, 22.5
 */

// This handler reads/writes cookies and the data store at request time, so it
// runs dynamically under Cache Components without a route segment config.

/** 10s geocoder budget per Req 1.4. */
const GEOCODER_TIMEOUT_MS = 10_000;

/** How many times to retry invite-code generation on a unique-constraint hit. */
const INVITE_CODE_RETRIES = 5;

const GEOCODER_DOWN_MESSAGE =
  "We couldn't look up that address right now. Please try again in a moment.";
const NO_MATCH_MESSAGE =
  "We could not locate that address. Please check it and try again.";
const SAVE_FAILED_MESSAGE =
  "We couldn't save your household right now. Please try again in a moment.";

/** Build the caregiver invite link for a code, using the request origin. */
function buildInviteUrl(request: NextRequest, code: string): string {
  const origin = request.nextUrl.origin;
  return `${origin}/status?code=${encodeURIComponent(code)}`;
}

/** Shape returned to the browser for a created/read household. */
interface HouseholdView {
  id: string;
  resident_name: string;
  address: string;
  lat: number | null;
  lng: number | null;
  county_fips: string | null;
  neighborhood: string | null;
  caregiver_name: string | null;
  invite_code: string;
  invite_url: string;
}

/**
 * Insert the household, retrying with a fresh invite code when the unique
 * constraint on `invite_code` collides. Returns the inserted row id + code.
 */
async function insertHousehold(record: {
  resident_name: string;
  address: string;
  lat: number;
  lng: number;
  county_fips: string;
  neighborhood: string | null;
}): Promise<{ id: string; invite_code: string }> {
  for (let attempt = 0; attempt < INVITE_CODE_RETRIES; attempt += 1) {
    const invite_code = generateInviteCode();
    const { data, error } = await db("households")
      .insert({
        resident_name: record.resident_name,
        address: record.address,
        lat: record.lat,
        lng: record.lng,
        county_fips: record.county_fips,
        neighborhood: record.neighborhood,
        invite_code,
        sim_offset_days: 0,
      })
      .select("id, invite_code")
      .single();

    if (!error && data) {
      return { id: data.id as string, invite_code: data.invite_code as string };
    }

    // 23505 = Postgres unique_violation; only a collision warrants a retry.
    const code = (error as { code?: string } | null)?.code;
    if (code !== "23505") {
      break;
    }
  }

  throw new Error("could not persist household");
}

export async function POST(request: NextRequest): Promise<Response> {
  // Parse the body defensively; a malformed body is a 400, not a crash.
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { field: "resident_name", message: "Please fill in the form and try again." },
      { status: 400 },
    );
  }

  // 1.3 field-level validation (name 1-100, address non-empty <=200).
  const validated = validateHouseholdInput(
    body as { resident_name?: string; address?: string },
  );
  if (!validated.ok) {
    return Response.json(validated.error, { status: 400 });
  }

  const { resident_name, address } = validated.value;

  // 1.1, 1.4, 1.5 geocode with a 10s budget and typed fallbacks.
  const geo = await lookup(address, { timeoutMs: GEOCODER_TIMEOUT_MS });
  if (!geo.ok) {
    // Zero matches -> "could not locate" (1.5). Timeout/error -> 502 (1.4).
    if (geo.reason === "no_match") {
      return Response.json({ message: NO_MATCH_MESSAGE }, { status: 502 });
    }
    return Response.json({ message: GEOCODER_DOWN_MESSAGE }, { status: 502 });
  }

  // 1.1, 1.2, 1.6 persist with the resolved values; sim_offset_days=0 and
  // created_at come from the insert/DB default.
  let inserted: { id: string; invite_code: string };
  try {
    inserted = await insertHousehold({
      resident_name,
      address,
      lat: geo.match.lat,
      lng: geo.match.lng,
      county_fips: geo.match.countyFips,
      neighborhood: geo.match.neighborhood,
    });
  } catch (error) {
    logServerError("POST /api/household insert", error);
    return Response.json({ message: SAVE_FAILED_MESSAGE }, { status: 502 });
  }

  // Demo-grade auth: scope the resident's browser to this household.
  await setHouseholdCookie(inserted.id);

  const view: HouseholdView = {
    id: inserted.id,
    resident_name,
    address,
    lat: geo.match.lat,
    lng: geo.match.lng,
    county_fips: geo.match.countyFips,
    neighborhood: geo.match.neighborhood,
    caregiver_name: null,
    invite_code: inserted.invite_code,
    invite_url: buildInviteUrl(request, inserted.invite_code),
  };

  return Response.json(view, { status: 201 });
}

export async function GET(request: NextRequest): Promise<Response> {
  let household;
  try {
    household = await getCurrentHousehold();
  } catch (error) {
    logServerError("GET /api/household", error);
    return Response.json({ message: SAVE_FAILED_MESSAGE }, { status: 502 });
  }

  if (!household) {
    return Response.json(
      { message: "No household found. Please create one first." },
      { status: 404 },
    );
  }

  const view: HouseholdView = {
    id: household.id,
    resident_name: household.resident_name,
    address: household.address,
    lat: household.lat,
    lng: household.lng,
    county_fips: household.county_fips,
    neighborhood: household.neighborhood,
    caregiver_name: household.caregiver_name,
    invite_code: household.invite_code,
    invite_url: buildInviteUrl(request, household.invite_code),
  };

  return Response.json(view, { status: 200 });
}
