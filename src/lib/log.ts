import "server-only";

/**
 * Log the real cause of a server-side failure to stdout/stderr so Vercel logs
 * show actionable detail, while never emitting secrets or personal data.
 *
 * Only a short error `code` and `message` are logged (plus a caller-supplied
 * context label). Supabase/Postgres errors carry a `code` (e.g. "23514") and a
 * `message`; fetch/abort errors carry a `name`/`message`. We deliberately do
 * NOT log the error object, stack, request body, phone numbers, addresses, or
 * any value a caller passes in.
 */
export function logServerError(context: string, error: unknown): void {
  const code =
    typeof (error as { code?: unknown })?.code === "string" ||
    typeof (error as { code?: unknown })?.code === "number"
      ? String((error as { code?: unknown }).code)
      : (error as { name?: string })?.name ?? "unknown";
  const message =
    error instanceof Error
      ? error.message
      : typeof (error as { message?: unknown })?.message === "string"
        ? (error as { message: string }).message
        : "no message";
  console.error(`[threshold] ${context}: code=${code} message=${message}`);
}
