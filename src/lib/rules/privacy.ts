/**
 * Cross-resident privacy guard: pure functions only (no I/O, no `server-only`).
 *
 * The browser must never receive another resident's street address, case
 * detail, or any `full_address` originating from Boston 311 data. These
 * functions are the final serializer/guard a route handler or the Case Agent
 * nearby-lookup calls before a value is returned to the browser, plus the
 * formatter for the one permitted aggregate ("N open reports within D meters").
 *
 * Everything here is deterministic and I/O-free so it can be property-tested
 * with fast-check (see Property 4: Privacy — no address leak).
 *
 * Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 6.4
 */

/** Bounds for the aggregate count N in the nearby-report summary (Req 10.2). */
export const NEARBY_COUNT_MIN = 0;
export const NEARBY_COUNT_MAX = 999;

/** Bounds for the rounded distance D in the nearby-report summary (Req 10.2). */
export const NEARBY_DISTANCE_MIN = 10;
export const NEARBY_DISTANCE_MAX = 500;

/** Distance D is reported as a multiple of this many meters (Req 10.2, 10.4). */
export const NEARBY_DISTANCE_STEP = 10;

/**
 * A source Boston 311 record whose sensitive fields must never reach the
 * browser. Only the shape relevant to privacy is modeled; records may carry
 * other fields the guard ignores.
 */
export interface Boston311SourceRecord {
  full_address?: string | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
}

/**
 * Collect the set of forbidden strings from a batch of source 311 records:
 * every non-empty `full_address` value. These are the substrings that must not
 * appear anywhere in a response serialized for the browser (Req 10.1, 10.3).
 *
 * Whitespace-only addresses are ignored (they would otherwise match every
 * string and strip the whole response). Values are trimmed so a stored
 * address with incidental surrounding whitespace is still matched.
 */
export function forbiddenAddressesFrom(
  records: ReadonlyArray<Boston311SourceRecord>,
): string[] {
  const seen = new Set<string>();
  for (const record of records) {
    const raw = record?.full_address;
    if (typeof raw !== "string") continue;
    const value = raw.trim();
    if (value.length === 0) continue;
    seen.add(value);
  }
  return [...seen];
}

/**
 * Whether a candidate string must be suppressed because it equals or contains
 * any forbidden address (Req 10.3, 10.5). Comparison is case-insensitive so a
 * re-cased copy of an address cannot slip through.
 */
function containsForbidden(value: string, forbidden: string[]): boolean {
  if (forbidden.length === 0) return false;
  const haystack = value.toLowerCase();
  return forbidden.some((needle) => haystack.includes(needle.toLowerCase()));
}

/**
 * Deep-walk a value destined for the browser and remove any string that equals
 * or contains a forbidden `full_address` (Req 10.1, 10.3, 10.5, 6.4).
 *
 * - Offending strings are replaced with `null` so the field is omitted of its
 *   value while the surrounding permitted aggregate data is preserved
 *   (Req 10.5: suppress the value, return the rest, reveal nothing).
 * - Arrays keep their shape; offending elements become `null`.
 * - Objects are rebuilt with each value guarded recursively.
 * - Numbers, booleans, `null`/`undefined`, and functions pass through
 *   unchanged (coordinates are suppressed at the data-client boundary and by
 *   `stripCoordinateKeys`, not by string matching).
 *
 * The input is never mutated; a sanitized copy is returned.
 */
export function stripAddresses<T>(value: T, forbidden: string[]): T {
  return walk(value, forbidden) as T;
}

function walk(value: unknown, forbidden: string[]): unknown {
  if (typeof value === "string") {
    return containsForbidden(value, forbidden) ? null : value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => walk(item, forbidden));
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      out[key] = walk(child, forbidden);
    }
    return out;
  }
  return value;
}

/** Object keys that carry a resident point coordinate and must be dropped. */
const COORDINATE_KEYS = new Set([
  "latitude",
  "longitude",
  "lat",
  "lng",
  "lon",
  "coordinates",
  "point",
]);

/**
 * Deep-walk a value and omit any property whose key names a point coordinate
 * (latitude, longitude, lat/lng/lon, coordinates, point), so a nearby report's
 * exact location never reaches the response even though it counts toward the
 * aggregate (Req 10.4, 6.4). Arrays and nested objects are walked; the input is
 * never mutated.
 */
export function stripCoordinateKeys<T>(value: T): T {
  return walkCoordinates(value) as T;
}

function walkCoordinates(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(walkCoordinates);
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (COORDINATE_KEYS.has(key)) continue;
      out[key] = walkCoordinates(child);
    }
    return out;
  }
  return value;
}

/**
 * The single guard a route handler / the Case Agent nearby-lookup calls before
 * returning a value to the browser: strip forbidden `full_address` strings
 * sourced from the given 311 records and drop any point-coordinate keys
 * (Req 6.4, 10.1, 10.3, 10.4, 10.5). Pure; returns a sanitized copy.
 */
export function guardResponse<T>(
  value: T,
  sourceRecords: ReadonlyArray<Boston311SourceRecord>,
): T {
  const forbidden = forbiddenAddressesFrom(sourceRecords);
  return stripCoordinateKeys(stripAddresses(value, forbidden));
}

/**
 * Clamp N to `[0, 999]` (Req 10.2). Non-finite or fractional inputs are
 * coerced to a safe integer so the formatter stays total.
 */
export function clampNearbyCount(openCount: number): number {
  if (!Number.isFinite(openCount)) return NEARBY_COUNT_MIN;
  const whole = Math.max(0, Math.floor(openCount));
  return Math.min(NEARBY_COUNT_MAX, whole);
}

/**
 * Round a raw distance to the nearest 10 meters and clamp it to `[10, 500]`
 * (Req 10.2, 10.4). The result is always a multiple of 10 inside the bounds,
 * so the formatter never emits "0 meters" or a non-rounded value. Non-finite
 * inputs clamp to the minimum.
 */
export function roundNearbyDistance(distanceMeters: number): number {
  if (!Number.isFinite(distanceMeters)) return NEARBY_DISTANCE_MIN;
  const rounded = Math.round(distanceMeters / NEARBY_DISTANCE_STEP) * NEARBY_DISTANCE_STEP;
  if (rounded < NEARBY_DISTANCE_MIN) return NEARBY_DISTANCE_MIN;
  if (rounded > NEARBY_DISTANCE_MAX) return NEARBY_DISTANCE_MAX;
  return rounded;
}

/**
 * Format the only cross-resident detail allowed to reach the browser: an
 * aggregate count and a distance rounded to the nearest 10 meters, as
 * "N open reports within D meters" (Req 10.2). N is clamped to `[0, 999]`;
 * D is a multiple of 10 clamped to `[10, 500]`. Total and deterministic — no
 * address, unit, name, phone, case id, or coordinate is ever included.
 */
export function formatNearbyAggregate(
  openCount: number,
  distanceMeters: number,
): string {
  const n = clampNearbyCount(openCount);
  const d = roundNearbyDistance(distanceMeters);
  const reports = n === 1 ? "report" : "reports";
  return `${n} open ${reports} within ${d} meters`;
}
