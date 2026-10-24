// src/lib/data/azure.ts
//
// Server-only Azure OpenAI client for the Threshold AI_Labeler.
//
// Responsibilities (Req 3.5, 22.1, 22.2, 22.3, 22.4):
// - Build an `AzureOpenAI` client where the endpoint is the base URL only;
//   the SDK adds the deployment-scoped paths. Deployment comes from
//   AZURE_OPENAI_DEPLOYMENT.
// - Send the vault/barrier image as a base64 data URL.
// - Request a JSON-schema structured output and validate it with zod.
// - Use `max_completion_tokens` (NEVER `max_tokens`).
// - Enforce a 30s timeout with an AbortController and return a typed fallback
//   result on timeout/failure rather than throwing. Never surface a stack
//   trace, exception class name, or raw provider payload to callers.
//
// This module is server-only. It reads secrets from the environment and must
// never be imported into browser code.

import "server-only";
import { AzureOpenAI } from "openai";
import { z } from "zod";

/**
 * Structured label produced for a vault photo (design.md, P1 photo pipeline).
 * label ≤ 60 chars, description ≤ 280 chars, a boolean accessibility flag, and
 * a kind restricted to the three allowed values.
 */
export const VaultLabel = z.object({
  label: z.string().max(60),
  description: z.string().max(280),
  accessibility_relevant: z.boolean(),
  kind: z.enum(["equipment", "home_feature", "document"]),
});

export type VaultLabel = z.infer<typeof VaultLabel>;

/**
 * Typed result of a labeling attempt. On success `ok` is true and `value`
 * holds the validated label. On any timeout/error `ok` is false and `reason`
 * explains the failure in a coarse, non-sensitive way (no stack trace, no
 * provider payload).
 */
export type LabelResult =
  | { ok: true; value: VaultLabel }
  | { ok: false; reason: "timeout" | "error" };

/** Default per-call timeout for the AI_Labeler (Req 22.1 allows 1–30s). */
const LABEL_TIMEOUT_MS = 30_000;

/**
 * JSON schema mirroring {@link VaultLabel}, sent to the model as a strict
 * structured-output contract. Kept in sync with the zod schema above; the zod
 * schema remains the source of truth for validation of the returned content.
 */
const vaultLabelJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    label: { type: "string", maxLength: 60 },
    description: { type: "string", maxLength: 280 },
    accessibility_relevant: { type: "boolean" },
    kind: { type: "string", enum: ["equipment", "home_feature", "document"] },
  },
  required: ["label", "description", "accessibility_relevant", "kind"],
} as const;

const SYSTEM_PROMPT =
  "You are Threshold, an AI assistant that labels photos a disabled resident " +
  "captures for their Proof Vault. You are not the City of Boston. Given one " +
  "photo, return a short label (<=60 characters), a plain-language description " +
  "(<=280 characters), whether the item is relevant to accessibility, and the " +
  "kind: equipment, home_feature, or document. Use plain, factual language.";

let cachedClient: AzureOpenAI | null = null;

/**
 * Lazily construct the Azure client from environment configuration. The
 * endpoint is the base URL only; the SDK appends deployment-scoped paths.
 * Returns null when required configuration is missing so callers can fall back
 * gracefully instead of throwing.
 */
function getClient(): AzureOpenAI | null {
  if (cachedClient) return cachedClient;

  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const apiKey = process.env.AZURE_OPENAI_API_KEY;
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION;
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT;

  if (!endpoint || !apiKey || !apiVersion || !deployment) {
    return null;
  }

  cachedClient = new AzureOpenAI({
    endpoint,
    apiKey,
    apiVersion,
    deployment,
    // The SDK retries internally; we own the overall deadline via AbortController.
    maxRetries: 0,
  });
  return cachedClient;
}

/**
 * Label a single photo supplied as a base64 data URL (e.g.
 * `data:image/jpeg;base64,...`).
 *
 * Enforces a 30s timeout via AbortController. On timeout or any failure it
 * returns a typed fallback (`{ ok: false, reason }`) and never throws a raw
 * error or exposes a stack trace. On success it returns the zod-validated
 * {@link VaultLabel}.
 *
 * The optional `client` parameter exists only to support testing with a mocked
 * client; production callers should omit it.
 */
export async function labelPhoto(
  dataUrl: string,
  options?: { timeoutMs?: number; client?: Pick<AzureOpenAI, "chat"> },
): Promise<LabelResult> {
  const client = options?.client ?? getClient();
  if (!client) {
    return { ok: false, reason: "error" };
  }

  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT ?? "";
  const timeoutMs = options?.timeoutMs ?? LABEL_TIMEOUT_MS;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const completion = await client.chat.completions.create(
      {
        // For AzureOpenAI the deployment is used for routing; passing it as the
        // model keeps the request deployment-scoped.
        model: deployment,
        // Never `max_tokens`. Azure gpt-5.x uses `max_completion_tokens`.
        max_completion_tokens: 400,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "vault_label",
            strict: true,
            schema: vaultLabelJsonSchema,
          },
        },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Label this photo for the resident's Proof Vault.",
              },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
        ],
      },
      { signal: controller.signal },
    );

    const content = completion.choices?.[0]?.message?.content;
    if (!content) {
      return { ok: false, reason: "error" };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      return { ok: false, reason: "error" };
    }

    const result = VaultLabel.safeParse(parsed);
    if (!result.success) {
      return { ok: false, reason: "error" };
    }

    return { ok: true, value: result.data };
  } catch (err) {
    // Distinguish an abort (timeout) from any other failure, but never surface
    // the underlying error object, message, or stack to the caller.
    if (controller.signal.aborted || (err as { name?: string })?.name === "AbortError") {
      return { ok: false, reason: "timeout" };
    }
    return { ok: false, reason: "error" };
  } finally {
    clearTimeout(timer);
  }
}
