import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { labelPhoto, VaultLabel } from "@/lib/data/azure";

const DATA_URL = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";

/**
 * Build a mock that mimics the shape of the AzureOpenAI client we use:
 * `client.chat.completions.create(body, { signal })`.
 */
function mockClient(create: ReturnType<typeof vi.fn>) {
  return { chat: { completions: { create } } } as never;
}

describe("labelPhoto", () => {
  beforeEach(() => {
    process.env.AZURE_OPENAI_ENDPOINT = "https://example.openai.azure.com/";
    process.env.AZURE_OPENAI_API_KEY = "test-key";
    process.env.AZURE_OPENAI_API_VERSION = "2024-12-01-preview";
    process.env.AZURE_OPENAI_DEPLOYMENT = "gpt-5.4";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns a validated label on a well-formed response", async () => {
    const content = JSON.stringify({
      label: "Power wheelchair",
      description: "A motorized wheelchair with a joystick control.",
      accessibility_relevant: true,
      kind: "equipment",
    });
    const create = vi.fn().mockResolvedValue({
      choices: [{ message: { content } }],
    });

    const result = await labelPhoto(DATA_URL, { client: mockClient(create) });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.label).toBe("Power wheelchair");
      expect(result.value.kind).toBe("equipment");
      expect(result.value.accessibility_relevant).toBe(true);
    }
  });

  it("uses max_completion_tokens and never max_tokens", async () => {
    const content = JSON.stringify({
      label: "Front steps",
      description: "Three concrete steps leading to the front door.",
      accessibility_relevant: true,
      kind: "home_feature",
    });
    const create = vi.fn().mockResolvedValue({
      choices: [{ message: { content } }],
    });

    await labelPhoto(DATA_URL, { client: mockClient(create) });

    const body = create.mock.calls[0][0];
    expect(body).toHaveProperty("max_completion_tokens");
    expect(body).not.toHaveProperty("max_tokens");
  });

  it("sends the image as a base64 data URL", async () => {
    const content = JSON.stringify({
      label: "Letter",
      description: "A FEMA letter.",
      accessibility_relevant: false,
      kind: "document",
    });
    const create = vi.fn().mockResolvedValue({
      choices: [{ message: { content } }],
    });

    await labelPhoto(DATA_URL, { client: mockClient(create) });

    const body = create.mock.calls[0][0];
    const userMsg = body.messages.find((m: { role: string }) => m.role === "user");
    const imagePart = userMsg.content.find(
      (p: { type: string }) => p.type === "image_url",
    );
    expect(imagePart.image_url.url).toBe(DATA_URL);
  });

  it("requests a json_schema structured output", async () => {
    const content = JSON.stringify({
      label: "Oxygen concentrator",
      description: "A portable oxygen concentrator.",
      accessibility_relevant: true,
      kind: "equipment",
    });
    const create = vi.fn().mockResolvedValue({
      choices: [{ message: { content } }],
    });

    await labelPhoto(DATA_URL, { client: mockClient(create) });

    const body = create.mock.calls[0][0];
    expect(body.response_format.type).toBe("json_schema");
    expect(body.response_format.json_schema.name).toBe("vault_label");
  });

  it("returns a typed error fallback when the response is not valid JSON", async () => {
    const create = vi.fn().mockResolvedValue({
      choices: [{ message: { content: "not json" } }],
    });

    const result = await labelPhoto(DATA_URL, { client: mockClient(create) });

    expect(result).toEqual({ ok: false, reason: "error" });
  });

  it("returns a typed error fallback when the response fails schema validation", async () => {
    const create = vi.fn().mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ label: "x", kind: "spaceship" }) } }],
    });

    const result = await labelPhoto(DATA_URL, { client: mockClient(create) });

    expect(result).toEqual({ ok: false, reason: "error" });
  });

  it("returns a typed error fallback (no throw) when the client rejects", async () => {
    const create = vi.fn().mockRejectedValue(new Error("boom with a stack trace"));

    const result = await labelPhoto(DATA_URL, { client: mockClient(create) });

    expect(result).toEqual({ ok: false, reason: "error" });
  });

  it("returns a timeout fallback when the call exceeds the timeout", async () => {
    // Never resolves; the AbortController should fire and reject with an abort.
    const create = vi.fn().mockImplementation(
      (_body: unknown, opts: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          opts.signal.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        }),
    );

    const result = await labelPhoto(DATA_URL, {
      client: mockClient(create),
      timeoutMs: 10,
    });

    expect(result).toEqual({ ok: false, reason: "timeout" });
  });

  it("returns an error fallback when required configuration is missing", async () => {
    delete process.env.AZURE_OPENAI_API_KEY;

    const result = await labelPhoto(DATA_URL);

    expect(result).toEqual({ ok: false, reason: "error" });
  });
});

describe("VaultLabel schema", () => {
  it("rejects labels longer than 60 characters", () => {
    const res = VaultLabel.safeParse({
      label: "x".repeat(61),
      description: "ok",
      accessibility_relevant: false,
      kind: "equipment",
    });
    expect(res.success).toBe(false);
  });

  it("rejects descriptions longer than 280 characters", () => {
    const res = VaultLabel.safeParse({
      label: "ok",
      description: "x".repeat(281),
      accessibility_relevant: false,
      kind: "document",
    });
    expect(res.success).toBe(false);
  });

  it("rejects an unknown kind", () => {
    const res = VaultLabel.safeParse({
      label: "ok",
      description: "ok",
      accessibility_relevant: true,
      kind: "vehicle",
    });
    expect(res.success).toBe(false);
  });
});
