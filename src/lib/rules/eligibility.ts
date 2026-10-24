/**
 * Forbidden-wording guard for eligibility / claim / draft text.
 *
 * Pure functions only: no I/O, no `server-only`. Deterministic and total so
 * they can be property-tested with fast-check (see Property 7).
 *
 * Honesty rule (honesty-and-safety.md): Threshold never promises eligibility or
 * outcomes. FEMA language is always "you may be eligible; FEMA makes the
 * decision." These helpers block or strip the three promise phrases
 * "you will receive", "guaranteed", and "approved" from any generated text,
 * compared case-insensitively.
 *
 * Requirements: 15.5, 16.6, 6.1, 6.2
 */

/**
 * The phrases that must never appear in eligibility/claim/draft text, compared
 * case-insensitively. Exported so Property 7's test can reuse the exact list.
 *
 * Kept lowercase; all comparisons lowercase the input before matching.
 */
export const FORBIDDEN_WORDING = [
  'you will receive',
  'guaranteed',
  'approved',
] as const;

export type ForbiddenPhrase = (typeof FORBIDDEN_WORDING)[number];

/**
 * True iff `text`, compared case-insensitively, contains any forbidden phrase.
 * Total: a non-string (defensive) is coerced to empty and returns false.
 */
export function containsForbiddenWording(text: string): boolean {
  if (typeof text !== 'string' || text.length === 0) return false;
  const haystack = text.toLowerCase();
  return FORBIDDEN_WORDING.some((phrase) => haystack.includes(phrase));
}

/**
 * Every forbidden phrase present in `text` (case-insensitive), in the order
 * they are declared in {@link FORBIDDEN_WORDING}. Empty when the text is clean.
 */
export function findForbiddenWording(text: string): ForbiddenPhrase[] {
  if (typeof text !== 'string' || text.length === 0) return [];
  const haystack = text.toLowerCase();
  return FORBIDDEN_WORDING.filter((phrase) => haystack.includes(phrase));
}

/**
 * Error thrown by {@link assertCleanWording} when forbidden wording is found.
 * Carries the offending phrases so callers can log/report them.
 */
export class ForbiddenWordingError extends Error {
  readonly phrases: ForbiddenPhrase[];

  constructor(phrases: ForbiddenPhrase[]) {
    super(
      `Text contains forbidden eligibility wording: ${phrases
        .map((p) => `"${p}"`)
        .join(', ')}`,
    );
    this.name = 'ForbiddenWordingError';
    this.phrases = phrases;
  }
}

/**
 * Assert that `text` is free of forbidden wording, returning it unchanged.
 * Throws {@link ForbiddenWordingError} otherwise. Use this where promise
 * wording is a correctness failure (e.g. guarding model-generated eligibility
 * text before it reaches the resident).
 */
export function assertCleanWording(text: string): string {
  const found = findForbiddenWording(text);
  if (found.length > 0) throw new ForbiddenWordingError(found);
  return text;
}

/** The marker that replaces a stripped forbidden phrase. */
export const REDACTION = '[removed]';

/**
 * Remove every forbidden phrase from `text`, preserving the original casing of
 * the surrounding text and replacing each match with {@link REDACTION}.
 *
 * The result is guaranteed clean: `containsForbiddenWording(sanitize(text))`
 * is always false. This is the lenient counterpart to
 * {@link assertCleanWording} for display paths that must degrade gracefully
 * rather than throw.
 */
export function sanitizeWording(text: string): string {
  if (typeof text !== 'string' || text.length === 0) return '';
  let result = text;
  for (const phrase of FORBIDDEN_WORDING) {
    // Case-insensitive, global, literal match (phrases contain no regex metachars,
    // but escape defensively in case the list ever changes).
    const pattern = new RegExp(escapeRegExp(phrase), 'gi');
    result = result.replace(pattern, REDACTION);
  }
  return result;
}

/** Escape regex metacharacters so a phrase is matched literally. */
function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
