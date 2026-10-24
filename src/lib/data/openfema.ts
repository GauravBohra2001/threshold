/**
 * OpenFEMA DisasterDeclarationsSummaries client (SERVER-ONLY).
 *
 * This module must only be imported from server code (route handlers, server
 * components, server actions). It performs outbound network I/O and must never
 * be bundled into the browser.
 *
 * Fetches disaster declaration records for a county FIPS code, falling back to
 * the OpenFEMA `placeCode` for tribal areas that have no county code. This
 * module only fetches and returns typed records; the eligibility decision is a
 * separate pure function in `src/lib/rules/fema-match.ts` (P4).
 *
 * Per the design: every external call runs behind an AbortController timeout
 * (1–30s, default 10s) and returns a typed result the handler turns into a
 * plain-language fallback — never a stack trace or raw provider payload.
 *
 * OpenFEMA requires no API key.
 * Requirements: 15.1, 15.4, 22.1, 22.2, 22.3, 22.4
 */

/** Base URL for the OpenFEMA DisasterDeclarationsSummaries endpoint. */
const OPENFEMA_URL =
  "https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries";

/** Timeout bounds (inclusive), in milliseconds. Req 22.1. */
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 30_000;
const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * A single disaster declaration record. Only the fields we rely on are typed;
 * OpenFEMA returns many more. All fields are optional because the provider does
 * not guarantee their presence (e.g. tribal areas omit county codes).
 */
export interface DisasterDeclaration {
  disasterNumber: number;
  declarationDate?: string;
  incidentBeginDate?: string;
  incidentEndDate?: string;
  designatedArea?: string;
  ihProgramDeclared: boolean;
  iaProgramDeclared: boolean;
  fipsStateCode?: string;
  fipsCountyCode?: string;
  placeCode?: string;
  state?: string;
  declarationTitle?: string;
}

/** Discriminated-union result: a typed fallback instead of throwing. Req 22.2, 22.3. */
export type OpenFemaResult =
  | { ok: true; records: DisasterDeclaration[] }
  | { ok: false; reason: "timeout" | "error"; message: string };

/** Friendly, UI-safe fallback copy. Never a stack trace or raw payload. */
const FALLBACK_MESSAGE =
  "We couldn't check FEMA disaster declarations right now. Please try again in a moment.";

export interface FetchDeclarationsOptions {
  /** 5-digit (or 2+3) state FIPS; matched against `fipsStateCode`. */
  fipsStateCode?: string;
  /** 3-digit county FIPS; matched against `fipsCountyCode`. */
  fipsCountyCode?: string;
  /** Tribal place code; used when a tribal area has no county code. Req 15.4. */
  placeCode?: string;
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

/**
 * Build the OpenFEMA query URL. Matching is by county FIPS
 * (`fipsStateCode` + `fipsCountyCode`), or by `placeCode` for tribal areas.
 */
export function buildDeclarationsUrl(options: FetchDeclarationsOptions): string {
  const { fipsStateCode, fipsCountyCode, placeCode } = options;
  const filters: string[] = [];

  if (fipsStateCode) {
    filters.push(`fipsStateCode eq '${fipsStateCode}'`);
  }
  if (fipsCountyCode) {
    filters.push(`fipsCountyCode eq '${fipsCountyCode}'`);
  }
  // Tribal fallback: when there is no county code, match on placeCode. Req 15.4.
  if (placeCode && !fipsCountyCode) {
    filters.push(`placeCode eq '${placeCode}'`);
  }

  const url = new URL(OPENFEMA_URL);
  if (filters.length > 0) {
    url.searchParams.set("$filter", filters.join(" and "));
  }
  // Return only the fields we consume; keeps payloads small.
  url.searchParams.set(
    "$select",
    [
      "disasterNumber",
      "declarationDate",
      "incidentBeginDate",
      "incidentEndDate",
      "designatedArea",
      "ihProgramDeclared",
      "iaProgramDeclared",
      "fipsStateCode",
      "fipsCountyCode",
      "placeCode",
      "state",
      "declarationTitle",
    ].join(","),
  );
  url.searchParams.set("$format", "json");

  return url.toString();
}

/** Coerce OpenFEMA's loosely typed JSON into our strict record shape. */
function normalizeRecord(raw: unknown): DisasterDeclaration | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;

  const disasterNumber =
    typeof r.disasterNumber === "number"
      ? r.disasterNumber
      : typeof r.disasterNumber === "string"
        ? Number(r.disasterNumber)
        : NaN;
  if (Number.isNaN(disasterNumber)) return null;

  const asString = (v: unknown): string | undefined =>
    typeof v === "string" && v.length > 0 ? v : undefined;

  return {
    disasterNumber,
    declarationDate: asString(r.declarationDate),
    incidentBeginDate: asString(r.incidentBeginDate),
    incidentEndDate: asString(r.incidentEndDate),
    designatedArea: asString(r.designatedArea),
    ihProgramDeclared: r.ihProgramDeclared === true,
    iaProgramDeclared: r.iaProgramDeclared === true,
    fipsStateCode: asString(r.fipsStateCode),
    fipsCountyCode: asString(r.fipsCountyCode),
    placeCode: asString(r.placeCode),
    state: asString(r.state),
    declarationTitle: asString(r.declarationTitle),
  };
}

/**
 * Fetch DisasterDeclarationsSummaries records for a county (or tribal place).
 * Never throws: on timeout or any error it returns a typed fallback. Req 22.2, 22.3.
 */
export async function fetchDisasterDeclarations(
  options: FetchDeclarationsOptions,
): Promise<OpenFemaResult> {
  const timeoutMs = clampTimeout(options.timeoutMs);
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = buildDeclarationsUrl(options);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });

    if (!response.ok) {
      return { ok: false, reason: "error", message: FALLBACK_MESSAGE };
    }

    const body = (await response.json()) as unknown;
    const rawRecords =
      typeof body === "object" &&
      body !== null &&
      Array.isArray((body as { DisasterDeclarationsSummaries?: unknown[] })
        .DisasterDeclarationsSummaries)
        ? (body as { DisasterDeclarationsSummaries: unknown[] })
            .DisasterDeclarationsSummaries
        : [];

    const records = rawRecords
      .map(normalizeRecord)
      .filter((r): r is DisasterDeclaration => r !== null);

    return { ok: true, records };
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
