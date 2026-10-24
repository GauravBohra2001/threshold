import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildSayTwiml,
  placeCall,
  type PlaceCallResult,
  type TwilioCallsClient,
} from "./twilio";

/** A fake Twilio client whose `calls.create` resolves/rejects as configured. */
function fakeClient(
  impl: (opts: { to: string; from: string; twiml: string }) => Promise<{ sid: string }>,
): { client: TwilioCallsClient; calls: Array<{ to: string; from: string; twiml: string }> } {
  const calls: Array<{ to: string; from: string; twiml: string }> = [];
  const client: TwilioCallsClient = {
    calls: {
      create: (opts) => {
        calls.push(opts);
        return impl(opts);
      },
    },
  };
  return { client, calls };
}

describe("buildSayTwiml", () => {
  it("wraps text in a Response/Say document", () => {
    expect(buildSayTwiml("Please check on Maria.")).toBe(
      "<Response><Say>Please check on Maria.</Say></Response>",
    );
  });

  it("escapes XML-significant characters", () => {
    expect(buildSayTwiml('A & B < C > "D"')).toBe(
      "<Response><Say>A &amp; B &lt; C &gt; &quot;D&quot;</Say></Response>",
    );
  });
});

describe("placeCall", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    process.env.TWILIO_ACCOUNT_SID = "AC_test";
    process.env.TWILIO_AUTH_TOKEN = "token_test";
    process.env.TWILIO_FROM_NUMBER = "+16175550000";
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("places a call with inline TwiML and returns the call sid", async () => {
    const { client, calls } = fakeClient(async () => ({ sid: "CA123" }));

    const result = await placeCall(
      { to: "+16175551234", message: "Please check on Maria." },
      client,
    );

    expect(result).toEqual<PlaceCallResult>({ ok: true, callSid: "CA123" });
    expect(calls).toHaveLength(1);
    expect(calls[0].to).toBe("+16175551234");
    expect(calls[0].from).toBe("+16175550000");
    expect(calls[0].twiml).toBe("<Response><Say>Please check on Maria.</Say></Response>");
  });

  it("passes through a caller-supplied twiml document unchanged", async () => {
    const { client, calls } = fakeClient(async () => ({ sid: "CA999" }));
    const twiml = "<Response><Say>Custom</Say></Response>";

    const result = await placeCall({ to: "+16175551234", twiml }, client);

    expect(result).toEqual<PlaceCallResult>({ ok: true, callSid: "CA999" });
    expect(calls[0].twiml).toBe(twiml);
  });

  it("returns invalid_input when neither twiml nor message is given", async () => {
    const { client, calls } = fakeClient(async () => ({ sid: "CA123" }));

    const result = await placeCall({ to: "+16175551234" }, client);

    expect(result).toEqual<PlaceCallResult>({ ok: false, reason: "invalid_input" });
    expect(calls).toHaveLength(0);
  });

  it("returns invalid_input when the destination is blank", async () => {
    const { client } = fakeClient(async () => ({ sid: "CA123" }));

    const result = await placeCall({ to: "   ", message: "hi" }, client);

    expect(result).toEqual<PlaceCallResult>({ ok: false, reason: "invalid_input" });
  });

  it("returns not_configured when secrets are missing (no injected client)", async () => {
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
    delete process.env.TWILIO_FROM_NUMBER;

    const result = await placeCall({ to: "+16175551234", message: "hi" });

    expect(result).toEqual<PlaceCallResult>({ ok: false, reason: "not_configured" });
  });

  it("returns a typed error (no throw) when the provider rejects", async () => {
    const { client } = fakeClient(async () => {
      throw new Error("provider exploded with a stack trace");
    });

    const result = await placeCall({ to: "+16175551234", message: "hi" }, client);

    expect(result).toEqual<PlaceCallResult>({ ok: false, reason: "error" });
  });

  it("returns error when the provider resolves without a sid", async () => {
    const { client } = fakeClient(async () => ({ sid: "" }));

    const result = await placeCall({ to: "+16175551234", message: "hi" }, client);

    expect(result).toEqual<PlaceCallResult>({ ok: false, reason: "error" });
  });

  it("returns timeout when the call does not resolve within the budget", async () => {
    vi.useFakeTimers();
    // Never resolves, forcing the timeout branch.
    const { client } = fakeClient(() => new Promise<{ sid: string }>(() => {}));

    const pending = placeCall({ to: "+16175551234", message: "hi", timeoutMs: 1000 }, client);
    await vi.advanceTimersByTimeAsync(1000);

    await expect(pending).resolves.toEqual<PlaceCallResult>({ ok: false, reason: "timeout" });
  });

  it("clamps an over-large timeout to 30s and still succeeds fast", async () => {
    const { client } = fakeClient(async () => ({ sid: "CA777" }));

    const result = await placeCall(
      { to: "+16175551234", message: "hi", timeoutMs: 999_999 },
      client,
    );

    expect(result).toEqual<PlaceCallResult>({ ok: true, callSid: "CA777" });
  });
});
