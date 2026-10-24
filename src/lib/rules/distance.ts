/**
 * Great-circle distance: pure functions only (no I/O, no `server-only`).
 *
 * These back duplicate detection for the Case Agent: a candidate 311 report is
 * "nearby" only when its great-circle distance from the barrier location is
 * within the radius (default 75 m). Distance is computed with the Haversine
 * formula and rounded to the nearest whole meter so results are deterministic
 * and property-testable with fast-check (see Property 3).
 *
 * Requirements: 6.1, 6.2, 6.3
 */

/** A geographic point in decimal degrees. */
export interface LatLng {
  lat: number;
  lng: number;
}

/** Default radius (meters) within which a report counts as nearby (Req 6.3). */
export const DEFAULT_NEARBY_RADIUS_M = 75;

/** Mean Earth radius in meters (IUGG), used by the Haversine formula. */
const EARTH_RADIUS_M = 6_371_008.8;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * Great-circle distance between two points in meters, computed with the
 * Haversine formula and rounded to the nearest whole meter (Req 6.3).
 *
 * Rounding to a whole meter keeps the "within 75 m" boundary exact and
 * deterministic: a computed distance of 75.4 m rounds to 75 and is nearby,
 * while 75.5 m rounds to 76 and is not.
 */
export function greatCircleMeters(a: LatLng, b: LatLng): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));

  return Math.round(EARTH_RADIUS_M * c);
}

/**
 * Whether two points are within `radiusM` meters of each other, using the
 * rounded great-circle distance. A report is nearby only when that distance is
 * `radiusM` or less (Req 6.3).
 */
export function isNearby(
  a: LatLng,
  b: LatLng,
  radiusM: number = DEFAULT_NEARBY_RADIUS_M,
): boolean {
  return greatCircleMeters(a, b) <= radiusM;
}
