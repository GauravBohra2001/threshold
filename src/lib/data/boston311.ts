import "server-only";

/**
 * Boston 311 CKAN data client (server-only).
 *
 * Queries the Boston 311 open-data CKAN endpoints:
 *   - datastore_search_sql: https://data.boston.gov/api/3/action/datastore_search_sql
 *
 * Resource id comes from the BOSTON_311_RESOURCE_ID environment variable.
 *
 * CRITICAL privacy rule (Req 6.4, 10.3): this client NEVER returns, stores, or
 * exposes a `full_address` value from Boston 311 to callers. Even though the
 * raw CKAN rows contain `full_address`, every value returned from this module
 * is stripped of it. Distance filtering happens in `src/lib/rules/distance.ts`
 * against the coordinates returned here; this module does not compute distance.
 */

const CKAN_BASE = "https://data.boston.gov/api/3/action";
const SEARCH_SQL_URL = `${CKAN_BASE}/datastore_search_sql`;

const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 30_000;
const DEFAULT_TIMEOUT_MS = 10_000;

/** Service names that represent accessibility barriers in the 311 dataset. */
export const ACCESSIBILITY_SERVICE_NAMES = [
  "Sidewalk Repair",
  "Illegally Blocked Sidewalk",
] as const;

/**
 * A nearby open 311 report, limited to aggregate-safe fields only.
 *
 * NOTE: `full_address` is intentionally absent from this type. Callers only
 * receive the coordinates needed for in-code distance filtering plus status
 * fields; they never receive a street address.
 */
export interface NearbyReport {
  case_id: string;
  service_name: string;
  open_date: string;
  case_status: string;
  target_close_date: string | null;
  latitude: number;
  longitude: number;
}

export interface SearchNearbyParams {
  lat: number;
  lng: number;
  /** Search radius in meters; used to size the bounding box. */
  radiusM: number;
  /** Optional service-name filter. Defaults to accessibility service names. */
  serviceNames?: readonly string[];
  /** Request timeout in ms (clamped to 1000–30000, default 10000). */
  timeoutMs?: number;
}

export interface OnTimeRateParams {
  neighborhood: string;
  service_name: string;
  /** Request timeout in ms (clamped to 1000–30000, default 10000). */
  timeoutMs?: number;
}

export interface OnTimeRate {
  onTime: number;
  overdue: number;
  /** ONTIME / (ONTIME + OVERDUE); null when there are no resolved cases. */
  rate: number | null;
}

/**
 * Typed result wrapper. On any timeout or error the client returns
 * `{ ok: false }` with a plain-language message and no stack trace,
 * exception class name, or raw provider payload (Req 22.2, 22.3).
 */
export type ClientResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

function clampTimeout(timeoutMs?: number): number {
  if (typeof timeoutMs !== "number" || Number.isNaN(timeoutMs)) {
    return DEFAULT_TIMEOUT_MS;
  }
  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, Math.round(timeoutMs)));
}

function resourceId(): string {
  const id = process.env.BOSTON_311_RESOURCE_ID;
  if (!id) {
    throw new Error("missing-resource-id");
  }
  return id;
}

/** Escape a string value for inclusion in a single-quoted SQL literal. */
function sqlQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Approximate degrees of latitude/longitude for a given distance in meters.
 * Used only to size a generous bounding box; precise distance filtering is done
 * in code (rules/distance.ts). One degree of latitude ~= 111,320 m. Longitude
 * degrees shrink with latitude by cos(lat).
 */
function boundingBox(lat: number, lng: number, radiusM: number) {
  const latDelta = radiusM / 111_320;
  const cosLat = Math.cos((lat * Math.PI) / 180);
  const lngDelta = radiusM / (111_320 * (Math.abs(cosLat) < 1e-6 ? 1e-6 : cosLat));
  return {
    minLat: lat - latDelta,
    maxLat: lat + latDelta,
    minLng: lng - lngDelta,
    maxLng: lng + lngDelta,
  };
}

async function fetchSql(
  sql: string,
  timeoutMs: number,
): Promise<ClientResult<Record<string, unknown>[]>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = `${SEARCH_SQL_URL}?sql=${encodeURIComponent(sql)}`;
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) {
      return { ok: false, error: "Boston 311 could not be reached. Please try again." };
    }
    const body = (await res.json()) as {
      success?: boolean;
      result?: { records?: Record<string, unknown>[] };
    };
    if (!body?.success || !body.result?.records) {
      return { ok: false, error: "Boston 311 returned no usable data. Please try again." };
    }
    return { ok: true, data: body.result.records };
  } catch {
    // Never surface a stack trace, exception class name, or raw payload.
    return { ok: false, error: "Boston 311 could not be reached. Please try again." };
  } finally {
    clearTimeout(timer);
  }
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function toStringOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s === "" ? null : s;
}

/**
 * Map a raw CKAN row to a `NearbyReport`, dropping `full_address` and any other
 * field not on the aggregate-safe allowlist. Rows without valid coordinates or a
 * case id are discarded (they cannot be distance-filtered or identified).
 */
function toNearbyReport(row: Record<string, unknown>): NearbyReport | null {
  const latitude = toNumber(row.latitude);
  const longitude = toNumber(row.longitude);
  const caseId = toStringOrNull(row.case_id);
  const serviceName = toStringOrNull(row.service_name);
  const openDate = toStringOrNull(row.open_date);
  const caseStatus = toStringOrNull(row.case_status);
  if (latitude === null || longitude === null) return null;
  if (caseId === null || serviceName === null || openDate === null || caseStatus === null) {
    return null;
  }
  return {
    case_id: caseId,
    service_name: serviceName,
    open_date: openDate,
    case_status: caseStatus,
    target_close_date: toStringOrNull(row.target_close_date),
    latitude,
    longitude,
  };
}

/**
 * Find OPEN 311 reports inside a bounding box around (lat, lng). Returns only
 * aggregate-safe fields (never `full_address`). Distance filtering against
 * `radiusM` is the caller's responsibility (rules/distance.ts); the bounding box
 * here is a coarse pre-filter sized from `radiusM`.
 */
export async function searchNearbyOpen(
  params: SearchNearbyParams,
): Promise<ClientResult<NearbyReport[]>> {
  const { lat, lng, radiusM } = params;
  const serviceNames = params.serviceNames ?? ACCESSIBILITY_SERVICE_NAMES;
  const timeoutMs = clampTimeout(params.timeoutMs);

  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !(radiusM > 0)) {
    return { ok: false, error: "A valid location is required to look up nearby reports." };
  }

  let rid: string;
  try {
    rid = resourceId();
  } catch {
    return { ok: false, error: "Nearby-report lookup is not available right now." };
  }

  const box = boundingBox(lat, lng, radiusM);
  const serviceFilter =
    serviceNames.length > 0
      ? `AND service_name IN (${serviceNames.map(sqlQuote).join(", ")})`
      : "";

  // Select only the columns we expose. full_address is deliberately NOT selected.
  const sql = `
    SELECT case_id, service_name, open_date, case_status, target_close_date,
           latitude, longitude
    FROM "${rid}"
    WHERE case_status = 'Open'
      AND latitude BETWEEN ${box.minLat} AND ${box.maxLat}
      AND longitude BETWEEN ${box.minLng} AND ${box.maxLng}
      ${serviceFilter}
    LIMIT 1000
  `.trim();

  const result = await fetchSql(sql, timeoutMs);
  if (!result.ok) return result;

  // Defense in depth: map through the allowlist so even if the upstream query
  // ever returned full_address, it is stripped before reaching the caller.
  const reports = result.data
    .map(toNearbyReport)
    .filter((r): r is NearbyReport => r !== null);

  return { ok: true, data: reports };
}

/**
 * On-time rate for a neighborhood + service over the last 90 days:
 * ONTIME / (ONTIME + OVERDUE). For later Ledger/agent use. Returns aggregate
 * counts only; no addresses or per-case detail.
 */
export async function neighborhoodOnTimeRate(
  params: OnTimeRateParams,
): Promise<ClientResult<OnTimeRate>> {
  const { neighborhood, service_name } = params;
  const timeoutMs = clampTimeout(params.timeoutMs);

  if (!neighborhood?.trim() || !service_name?.trim()) {
    return { ok: false, error: "A neighborhood and service name are required." };
  }

  let rid: string;
  try {
    rid = resourceId();
  } catch {
    return { ok: false, error: "On-time rates are not available right now." };
  }

  const sql = `
    SELECT on_time, COUNT(*) AS n
    FROM "${rid}"
    WHERE neighborhood = ${sqlQuote(neighborhood)}
      AND service_name = ${sqlQuote(service_name)}
      AND open_date >= (NOW() - INTERVAL '90 days')
      AND on_time IN ('ONTIME', 'OVERDUE')
    GROUP BY on_time
  `.trim();

  const result = await fetchSql(sql, timeoutMs);
  if (!result.ok) return result;

  let onTime = 0;
  let overdue = 0;
  for (const row of result.data) {
    const label = toStringOrNull(row.on_time);
    const n = toNumber(row.n) ?? 0;
    if (label === "ONTIME") onTime = n;
    else if (label === "OVERDUE") overdue = n;
  }

  const denom = onTime + overdue;
  const rate = denom === 0 ? null : onTime / denom;
  return { ok: true, data: { onTime, overdue, rate } };
}
