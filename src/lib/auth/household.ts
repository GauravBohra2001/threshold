import "server-only";

import { cookies } from "next/headers";

import { db } from "@/lib/data/supabase";

/**
 * Demo-grade household auth (SERVER-ONLY).
 *
 * There is no real login. On household creation the server sets an HTTP-only
 * cookie `threshold_household=<household_id>` scoped to the resident's browser
 * (see design "Auth model (demo-grade, no real login)"). Resident screens and
 * route handlers read the current household from that cookie through the
 * helpers here. The parallel invite-accept task and later vault/seed tasks
 * reuse `getCurrentHousehold` / `getCurrentHouseholdId`.
 *
 * This module reads the Supabase service-role client indirectly via `db()` and
 * must never be imported into browser/client code (Req 1.6, 22.4, 22.5).
 *
 * Requirements: 1.6, 2.1, 22.4, 22.5
 */

/** Name of the HTTP-only cookie that carries the current household id. */
export const HOUSEHOLD_COOKIE = "threshold_household";

/** One year, in seconds. The demo cookie is long-lived. */
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/** The household row shape this app reads. Kept minimal and explicit. */
export interface HouseholdRow {
  id: string;
  resident_name: string;
  address: string;
  lat: number | null;
  lng: number | null;
  county_fips: string | null;
  neighborhood: string | null;
  caregiver_name: string | null;
  caregiver_phone: string | null;
  invite_code: string;
  is_demo: boolean;
  sim_offset_days: number;
  created_at: string;
}

/**
 * Sets the HTTP-only household cookie on the outgoing response. Must be called
 * from a Route Handler or Server Function (Next 16 `cookies()` is async).
 */
export async function setHouseholdCookie(householdId: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(HOUSEHOLD_COOKIE, householdId, {
    httpOnly: true,
    sameSite: "lax",
    // Secure in production; relaxed in local http dev so the demo cookie works.
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: COOKIE_MAX_AGE_SECONDS,
  });
}

/** Reads the current household id from the cookie, or null when absent. */
export async function getCurrentHouseholdId(): Promise<string | null> {
  const cookieStore = await cookies();
  const value = cookieStore.get(HOUSEHOLD_COOKIE)?.value;
  return value && value.trim().length > 0 ? value : null;
}

/**
 * Loads the current household from the cookie. Returns null when there is no
 * cookie or no matching row. Never throws for a missing household; a thrown
 * error here means the data store itself is unavailable and the caller turns it
 * into a plain-language fallback.
 */
export async function getCurrentHousehold(): Promise<HouseholdRow | null> {
  const id = await getCurrentHouseholdId();
  if (!id) {
    return null;
  }

  const { data, error } = await db("households")
    .select(
      "id, resident_name, address, lat, lng, county_fips, neighborhood, caregiver_name, caregiver_phone, invite_code, is_demo, sim_offset_days, created_at",
    )
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error("household lookup failed");
  }

  return (data as HouseholdRow | null) ?? null;
}
