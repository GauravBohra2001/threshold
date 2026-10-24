import "server-only";

/**
 * U.S. Census Geocoder client (SERVER-ONLY).
 *
 * This module must only be imported from server code (route handlers, server
 * components, server actions). It performs outbound network I/O and must never
 * be bundled into the browser.
 *
 * Turns a one-line street address into latitude, longitude, and county FIPS
 * using the Census Geocoder "geographies/onelineaddress" endpoint with the
 * Geographies benchmark + vintage so the response includes the county record
 * (state FIPS + county FIPS). The Census Geocoder requires NO API key.
 *
 *   https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress
 *
 * Neighborhood: the Census Geocoder does not return a neighborhood. Boston
 * neighborhoods are not a Census geography level, so `neighborhood` is always
 * `null` here. The household route is expected to derive/display a neighborhood
 * separately (e.g. from the Boston 311 dataset or address components); this
 * client never invents one.
 *
 * Resilience (Req 22.1, 22.2, 22.3): every call runs behind an AbortController
 * timeout (1-30s, default 10s) and returns a typed result the caller turns into
 * a plain-language fallback. It never throws a raw error or leaks a stack trace,
 * exception name, or raw provider payload. The failure result DISTINGUISHES a
 * timeout, a transport/error, and a zero-match ("address could not be located")
 * so the household route can show the right message (Req 1.4, 1.5).
 *
 * Requirements: 1.1, 1.4, 1.5, 22.1, 22.2, 22.3
 */

/** Census Geocoder geographies/onelineaddress endpoint. */
const GEOCODER_URL =
  "https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress";

/**
 * Benchmark + vintage selecting the current public address ranges with current
 * geographies. Using the "geographies" endpoint with a vintage is what makes
 * the response include the Counties record (state FIPS + county FIPS).
 */
const BENCHMARK = "Public_AR_Current";
const VINTAGE = "Current_Current";

/** Timeout bounds (inclusive), in milliseconds. Req 22.1. */
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 30_000;
const DEFAULT_TIMEOUT_MS = 10_000;

/** Friendly, UI-safe fallback copy. Never a stack trace or raw payload. */
const FALLBACK_MESSAGE =
  "We couldn't look up that address right now. Please try again in a moment.";
const NO_MATCH_MESSAGE =
  "We could not locate that address. Please check it and try again.";

/** A successful geocode. */
export interface GeocodeMatch {
  /** Latitude in decimal degrees (Census `coordinates.y`). */
  lat: number;
  /** Longitude in decimal degrees (Census `coordinates.x`). */
  lng: number;
  /** 5-digit combined county GEOID (state FIPS + county FIPS), e.g. "25025". */
  countyFips: string;
  /** 2-digit state FIPS, e.g. "25". */
  stateFips: string;
  /** The Census-normalized matched address string. */
  matchedAddress: string;
  /**
   * Neighborhood is never supplied by the Census Geocoder; always `null`.
   * The caller derives/displays a neighborhood elsewhere.
   */
  neighborhood: string | null;
}

/**
 * Discriminated-union result: a typed fallback instead of throwing (Req 22.2,
 * 22.3). `reason` distinguishes a timeout, a transport/parse error, and a
 * zero-match ("no_match") so the household route can show the right copy
 * (Req 1.4 vs 1.5).
 */
export type GeocodeResult =
  | { ok: true; match: GeocodeMatch }
  | { ok: false; reason: "timeout" | "error" | "no_match"; message: string };

export interface LookupOptions {
  /** Request timeout in ms. Clamped to [1000, 30000]; defaults to 10000. Req 22.1. */
  timeoutMs?: number;
  /**
   * Injectable fetch, for testing. Defaults to the global `fetch`. Keeping the
   * dependency here makes the function easily mockable without network access.
   */
  fetchImpl?: typeof fetch;
}

/** Clamp a requested timeout into the allowed inclusive range. */
export function clampTimeout(requested: number | undefined): number {
  if (requested === undefined || Number.isNaN(requested)) {
    return DEFAULT_TIMEOUT_MS;
  }
  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, Math.trunc(requested)));
}

/** Build the Census Geocoder request URL for a one-line address. */
export function buildGeocodeUrl(address: string): string {
  const url = new URL(GEOCODER_URL);
  url.searchParams.set("address", address);
  url.searchParams.set("benchmark", BENCHMARK);
  url.searchParams.set("vintage", VINTAGE);
  url.searchParams.set("format", "json");
  return url.toString();
}

/** Narrow an unknown value to a finite number (accepts numeric strings). */
function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/** Narrow an unknown value to a non-empty trimmed string. */
function toNonEmptyString(value: unknown): string | null {
  if (typeof value === "string" && value.trim() !== "") return value.trim();
  return null;
}

/**
 * Pull the first address match out of a Census Geocoder response body and map
 * it to a `GeocodeMatch`. Returns `"no_match"` when the match list is empty,
 * and `"error"` when the body is shaped unexpectedly or the required
 * coordinate/county fields are missing.
 */
function parseResponse(
  body: unknown,
): GeocodeResult {
  const result =
    typeof body === "object" && body !== null
      ? (body as { result?: unknown }).result
      : undefined;
  const matches =
    typeof result === "object" && result !== null
      ? (result as { addressMatches?: unknown }).addressMatches
      : undefined;

  if (!Array.isArray(matches)) {
    return { ok: false, reason: "error", message: FALLBACK_MESSAGE };
  }
  if (matches.length === 0) {
    return { ok: false, reason: "no_match", message: NO_MATCH_MESSAGE };
  }

  const first = matches[0] as Record<string, unknown>;

  const coordinates = first.coordinates as Record<string, unknown> | undefined;
  const lng = toFiniteNumber(coordinates?.x);
  const lat = toFiniteNumber(coordinates?.y);
  if (lat === null || lng === null) {
    return { ok: false, reason: "error", message: FALLBACK_MESSAGE };
  }

  const geographies = first.geographies as Record<string, unknown> | undefined;
  const counties = geographies?.["Counties"];
  const county =
    Array.isArray(counties) && counties.length > 0
      ? (counties[0] as Record<string, unknown>)
      : undefined;

  // GEOID is the 5-digit state+county code; STATE is the 2-digit state FIPS.
  const countyFips = toNonEmptyString(county?.GEOID);
  const stateFips =
    toNonEmptyString(county?.STATE) ??
    (countyFips ? countyFips.slice(0, 2) : null);

  if (countyFips === null || stateFips === null) {
    return { ok: false, reason: "error", message: FALLBACK_MESSAGE };
  }

  return {
    ok: true,
    match: {
      lat,
      lng,
      countyFips,
      stateFips,
      matchedAddress:
        toNonEmptyString(first.matchedAddress) ?? "",
      neighborhood: null,
    },
  };
}

/**
 * Geocode a one-line address to lat/lng + county FIPS. Never throws: on timeout
 * or any error it returns a typed fallback, and distinguishes a zero-match
 * (`reason: "no_match"`) from a timeout or transport error (Req 1.4, 1.5,
 * 22.2, 22.3).
 */
export async function lookup(
  address: string,
  options: LookupOptions = {},
): Promise<GeocodeResult> {
  const trimmed = typeof address === "string" ? address.trim() : "";
  if (trimmed === "") {
    return { ok: false, reason: "no_match", message: NO_MATCH_MESSAGE };
  }

  const timeoutMs = clampTimeout(options.timeoutMs);
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = buildGeocodeUrl(trimmed);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
      cache: "no-store",
    });

    if (!response.ok) {
      return { ok: false, reason: "error", message: FALLBACK_MESSAGE };
    }

    const body = (await response.json()) as unknown;
    return parseResponse(body);
  } catch (err) {
    const aborted =
      err instanceof Error &&
      (err.name === "AbortError" || controller.signal.aborted);
    return {
      ok: false,
      reason: aborted ? "timeout" : "error",
      message: FALLBACK_MESSAGE,
    };
  } finally {
    clearTimeout(timer);
  }
}
