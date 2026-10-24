import "server-only";

/**
 * National Weather Service active-alerts client (SERVER-ONLY).
 *
 * This module must only be imported from server code (route handlers, server
 * components, server actions). It performs outbound network I/O and must never
 * be bundled into the browser.
 *
 * Fetches currently active weather alerts for a point (lat, lng) from the NWS
 * API. The NWS API requires a non-empty `User-Agent` header on every request
 * (Req 11.4); it is read from the `NWS_USER_AGENT` environment variable. NWS
 * does not serve old/expired alerts, so historical replays use fixture files
 * rather than this client.
 *
 * Per the design: every external call runs behind an AbortController timeout
 * (1–30s, default 10s) and returns a typed result the handler turns into a
 * plain-language fallback — never a stack trace, exception class name, raw
 * provider payload, or error code.
 *
 * Requirements: 11.3, 11.4, 22.1, 22.2, 22.3, 22.4
 */

/** Base URL for the NWS active-alerts endpoint. */
const NWS_ALERTS_URL = "https://api.weather.gov/alerts/active";

/** Timeout bounds (inclusive), in milliseconds. Req 22.1. */
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 30_000;
const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * A single active weather alert, reduced to the fields we rely on. NWS returns
 * a GeoJSON FeatureCollection with many more properties; all fields here are
 * optional except `id` because the provider does not guarantee their presence.
 */
export interface WeatherAlert {
  id: string;
  event: string | null;
  headline: string | null;
  areaDesc: string | null;
  severity: string | null;
  effective: string | null;
  expires: string | null;
}

/**
 * Discriminated-union result: a typed fallback instead of throwing. The failure
 * branch carries only a UI-safe plain-language message — never a stack trace,
 * exception class name, raw provider payload, or error code. Req 22.2, 22.3.
 */
export type NwsResult =
  | { ok: true; alerts: WeatherAlert[] }
  | { ok: false; reason: "timeout" | "error"; message: string };

/** Friendly, UI-safe fallback copy. Never a stack trace or raw payload. */
const FALLBACK_MESSAGE =
  "We couldn't reach the weather service right now. Please try again in a moment.";

export interface FetchActiveAlertsOptions {
  /** Latitude of the point to query. */
  lat: number;
  /** Longitude of the point to query. */
  lng: number;
  /** Request timeout in ms. Clamped to [1000, 30000]; defaults to 10000. Req 22.1. */
  timeoutMs?: number;
  /**
   * Injectable fetch, for testing. Defaults to the global `fetch`. Keeping the
   * dependency here makes the function easily mockable without network access.
   */
  fetchImpl?: typeof fetch;
  /**
   * Override for the User-Agent value. Defaults to `process.env.NWS_USER_AGENT`.
   * Primarily for testing; production reads the environment variable. Req 11.4.
   */
  userAgent?: string;
}

/** Clamp a requested timeout into the allowed inclusive range. Req 22.1. */
export function clampTimeout(requested: number | undefined): number {
  if (requested === undefined || Number.isNaN(requested)) {
    return DEFAULT_TIMEOUT_MS;
  }
  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, Math.trunc(requested)));
}

/**
 * Resolve the non-empty User-Agent value to send on NWS calls (Req 11.4). An
 * explicit override wins; otherwise `NWS_USER_AGENT` is used. Returns `null`
 * when neither yields a non-empty value, so the caller can fall back without
 * ever sending an empty header.
 */
export function resolveUserAgent(override?: string): string | null {
  const value = override ?? process.env.NWS_USER_AGENT;
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return null;
}

/** Build the active-alerts query URL for a point. */
export function buildActiveAlertsUrl(lat: number, lng: number): string {
  const url = new URL(NWS_ALERTS_URL);
  // NWS expects `point=lat,lng`. URLSearchParams encodes the comma, which NWS
  // accepts; set it directly as the documented single `point` parameter.
  url.searchParams.set("point", `${lat},${lng}`);
  return url.toString();
}

/** Coerce a single GeoJSON alert feature into our strict record shape. */
function normalizeAlert(raw: unknown): WeatherAlert | null {
  if (typeof raw !== "object" || raw === null) return null;
  const feature = raw as Record<string, unknown>;

  const props =
    typeof feature.properties === "object" && feature.properties !== null
      ? (feature.properties as Record<string, unknown>)
      : {};

  const asString = (v: unknown): string | null =>
    typeof v === "string" && v.length > 0 ? v : null;

  // Prefer the feature `id`; fall back to the alert properties `id`.
  const id = asString(feature.id) ?? asString(props.id);
  if (id === null) return null;

  return {
    id,
    event: asString(props.event),
    headline: asString(props.headline),
    areaDesc: asString(props.areaDesc),
    severity: asString(props.severity),
    effective: asString(props.effective),
    expires: asString(props.expires),
  };
}

/**
 * Fetch active weather alerts for a point. Never throws: on a missing
 * User-Agent, timeout, non-success response, or any error it returns a typed
 * fallback with a plain-language message. Req 11.3, 11.4, 22.2, 22.3.
 */
export async function fetchActiveAlerts(
  options: FetchActiveAlertsOptions,
): Promise<NwsResult> {
  const { lat, lng } = options;
  const timeoutMs = clampTimeout(options.timeoutMs);
  const fetchImpl = options.fetchImpl ?? fetch;

  // A non-empty User-Agent is required on every NWS call (Req 11.4). Without
  // one we do not call out at all; return the friendly fallback instead.
  const userAgent = resolveUserAgent(options.userAgent);
  if (userAgent === null) {
    return { ok: false, reason: "error", message: FALLBACK_MESSAGE };
  }

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { ok: false, reason: "error", message: FALLBACK_MESSAGE };
  }

  const url = buildActiveAlertsUrl(lat, lng);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: {
        // GeoJSON is the documented, stable NWS response format.
        Accept: "application/geo+json",
        "User-Agent": userAgent,
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      return { ok: false, reason: "error", message: FALLBACK_MESSAGE };
    }

    const body = (await response.json()) as unknown;
    const rawFeatures =
      typeof body === "object" &&
      body !== null &&
      Array.isArray((body as { features?: unknown[] }).features)
        ? (body as { features: unknown[] }).features
        : [];

    const alerts = rawFeatures
      .map(normalizeAlert)
      .filter((a): a is WeatherAlert => a !== null);

    return { ok: true, alerts };
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
