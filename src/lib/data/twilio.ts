import "server-only";

import Twilio from "twilio";

/**
 * Low-level Twilio Voice client for Threshold.
 *
 * Places a single outbound voice call using inline TwiML, with no webhook
 * (per the tech steering: `client.calls.create({ to, from, twiml })`).
 *
 * This module is the thin client only. It does NOT implement the check-in
 * chain, the `ALLOW_LIVE_CALLS` gate, or the per-2-minute rate limit; those
 * live in the P3 rules/route layer. Here we only read secrets (server-only),
 * enforce a configurable timeout, and translate any failure into a typed
 * fallback result rather than throwing or leaking a stack trace (Req 22.1-22.4).
 */

const DEFAULT_TIMEOUT_MS = 10_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 30_000;

export interface PlaceCallInput {
  /** Destination phone number in E.164-ish form (e.g. "+16175550123"). */
  to: string;
  /**
   * Full inline TwiML document to run on answer, e.g.
   * `<Response><Say>...</Say></Response>`. If omitted, `message` is wrapped
   * into a `<Response><Say>...</Say></Response>` document.
   */
  twiml?: string;
  /** Plain spoken text, used only when `twiml` is not supplied. */
  message?: string;
  /** Per-call timeout in ms, clamped to [1000, 30000]. Defaults to 10000. */
  timeoutMs?: number;
}

export type PlaceCallResult =
  | { ok: true; callSid: string }
  | { ok: false; reason: "timeout" | "not_configured" | "invalid_input" | "error" };

/**
 * Clamp a requested timeout into the allowed 1-30s window (Req 22.1).
 * Non-finite or missing values fall back to the 10s default.
 */
function resolveTimeoutMs(requested: number | undefined): number {
  if (requested === undefined || !Number.isFinite(requested)) {
    return DEFAULT_TIMEOUT_MS;
  }
  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, Math.round(requested)));
}

/** Escape text for safe inclusion inside an XML/TwiML text node. */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Build inline TwiML of the form `<Response><Say>...</Say></Response>`. */
export function buildSayTwiml(message: string): string {
  return `<Response><Say>${escapeXml(message)}</Say></Response>`;
}

/**
 * Credentials read lazily and server-side only. Returns null when any required
 * secret is missing so callers get a typed `not_configured` fallback instead
 * of a thrown error (Req 22.3, 22.4).
 */
function readConfig():
  | { accountSid: string; authToken: string; from: string }
  | null {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!accountSid || !authToken || !from) {
    return null;
  }
  return { accountSid, authToken, from };
}

/**
 * Minimal shape of the Twilio client we depend on. Declaring it locally keeps
 * the surface small and makes the client injectable for tests.
 */
export interface TwilioCallsClient {
  calls: {
    create(opts: {
      to: string;
      from: string;
      twiml: string;
    }): Promise<{ sid: string }>;
  };
}

/**
 * Place a single outbound voice call with inline TwiML.
 *
 * Never throws: every failure path (missing config, bad input, timeout, or
 * provider error) resolves to a typed `{ ok: false, reason }` result so the
 * UI/route layer can render a plain-language fallback without a stack trace.
 *
 * @param client optional injected client (used in tests); a real
 *   authenticated Twilio client is created from env secrets when omitted.
 */
export async function placeCall(
  input: PlaceCallInput,
  client?: TwilioCallsClient,
): Promise<PlaceCallResult> {
  const twiml = input.twiml ?? (input.message ? buildSayTwiml(input.message) : undefined);
  if (!input.to || !input.to.trim() || !twiml) {
    return { ok: false, reason: "invalid_input" };
  }

  let from: string;
  let activeClient: TwilioCallsClient;
  if (client) {
    // Injected client (tests). From-number still comes from env when present,
    // falling back to a placeholder so the client is exercised fully.
    from = process.env.TWILIO_FROM_NUMBER ?? "+10000000000";
    activeClient = client;
  } else {
    const config = readConfig();
    if (!config) {
      return { ok: false, reason: "not_configured" };
    }
    from = config.from;
    activeClient = Twilio(config.accountSid, config.authToken) as unknown as TwilioCallsClient;
  }

  const timeoutMs = resolveTimeoutMs(input.timeoutMs);

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<PlaceCallResult>((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, reason: "timeout" }), timeoutMs);
  });

  const call = activeClient.calls
    .create({ to: input.to, from, twiml })
    .then<PlaceCallResult>((result) => {
      if (result && typeof result.sid === "string" && result.sid.length > 0) {
        return { ok: true, callSid: result.sid };
      }
      return { ok: false, reason: "error" };
    })
    // Swallow the provider error; never surface a stack trace or payload.
    .catch<PlaceCallResult>(() => ({ ok: false, reason: "error" }));

  try {
    return await Promise.race([call, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
