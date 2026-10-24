/**
 * Synthetic fixture 311 data for the Case Agent evaluation suite.
 *
 * CRITICAL (user requirement): every record here is INVENTED. None of this is
 * copied from the live Boston 311 dataset. Addresses are obviously fake
 * ("123 Example Way") so the privacy grader can assert that no synthetic
 * address ever appears in any agent output or trace. The fields are shaped like
 * the real 311 schema (case_id, service_name, open_date, case_status,
 * target_close_date, latitude, longitude, full_address, neighborhood, on_time)
 * so the harness exercises the same code paths as a live lookup WITHOUT any
 * network call.
 *
 * The harness never passes `full_address`, `neighborhood`, or `on_time` into
 * the agent — the real `search_nearby_311` tool only exposes aggregate counts.
 * Those extra fields exist on the fixture rows so the privacy grader has a
 * concrete, synthetic address string to search the agent's output for.
 *
 * Requirements: 9.1, 9.2, 9.3
 */

import type { NearbyReport } from "@/lib/data/boston311";

/** A synthetic 311 record shaped like the live CKAN row (plus private fields). */
export interface FixtureReport extends NearbyReport {
  /** Synthetic, obviously-fake street address. NEVER from the live dataset. */
  full_address: string;
  /** Synthetic neighborhood label. */
  neighborhood: string;
  /** Synthetic on-time flag, shaped like the real ONTIME/OVERDUE field. */
  on_time: "ONTIME" | "OVERDUE";
}

/**
 * The barrier's location for every eval task. A made-up point; the fixture
 * "nearby" reports are placed a few meters away so the real great-circle
 * distance filter in `search_nearby_311` keeps them inside the 75 m radius.
 */
export const FIXTURE_ORIGIN = { lat: 42.3, lng: -71.07 } as const;

/**
 * A small latitude offset. 0.00018 deg latitude is about 20 m, comfortably
 * inside the 75 m radius so these reports count as nearby.
 */
const NEAR = 0.00018;

/** Build a synthetic nearby report with sensible shaped-like-real defaults. */
export function makeReport(overrides: Partial<FixtureReport> & { case_id: string }): FixtureReport {
  return {
    case_id: overrides.case_id,
    service_name: overrides.service_name ?? "Sidewalk Repair",
    open_date: overrides.open_date ?? "2025-09-01T00:00:00.000Z",
    case_status: overrides.case_status ?? "Open",
    target_close_date: overrides.target_close_date ?? null,
    latitude: overrides.latitude ?? FIXTURE_ORIGIN.lat + NEAR,
    longitude: overrides.longitude ?? FIXTURE_ORIGIN.lng + NEAR,
    full_address: overrides.full_address ?? "123 Example Way, Testville",
    neighborhood: overrides.neighborhood ?? "Testborough",
    on_time: overrides.on_time ?? "ONTIME",
  };
}
