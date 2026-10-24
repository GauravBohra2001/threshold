import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  FORBIDDEN_WORDING,
  containsForbiddenWording,
  sanitizeWording,
} from "@/lib/rules/eligibility";

/**
 * Feature: threshold, Property 7: Forbidden wording
 * Validates: Requirements 21.7, 15.5, 16.6
 *
 * For all generated eligibility text, the sanitizer's output, compared
 * case-insensitively, contains none of the forbidden substrings
 * "you will receive", "guaranteed", or "approved".
 */
describe("Feature: threshold, Property 7: Forbidden wording", () => {
  /**
   * Randomly re-case a phrase so matches appear in mixed case, exercising the
   * case-insensitive comparison the guard relies on.
   */
  const mixedCase = (phrase: string) =>
    fc
      .array(fc.boolean(), { minLength: phrase.length, maxLength: phrase.length })
      .map((upperFlags) =>
        phrase
          .split("")
          .map((ch, i) => (upperFlags[i] ? ch.toUpperCase() : ch.toLowerCase()))
          .join(""),
      );

  // A forbidden phrase, injected in mixed case.
  const forbiddenPhrase = fc
    .constantFrom(...FORBIDDEN_WORDING)
    .chain((phrase) => mixedCase(phrase));

  // Build a string from arbitrary filler segments interleaved with forbidden
  // phrases injected at random positions, so phrases land anywhere in the text.
  const textWithInjections = fc
    .array(forbiddenPhrase, { minLength: 1, maxLength: 5 })
    .chain((phrases) =>
      fc
        .array(fc.string(), { minLength: phrases.length + 1, maxLength: phrases.length + 1 })
        .map((fillers) => {
          let out = fillers[0];
          for (let i = 0; i < phrases.length; i++) {
            out += phrases[i] + fillers[i + 1];
          }
          return out;
        }),
    );

  it("sanitized output never contains a forbidden phrase (mixed case, random positions)", () => {
    fc.assert(
      fc.property(textWithInjections, (input) => {
        const cleaned = sanitizeWording(input);
        expect(containsForbiddenWording(cleaned)).toBe(false);
        // Lowercased comparison: no forbidden phrase survives.
        const lowered = cleaned.toLowerCase();
        for (const phrase of FORBIDDEN_WORDING) {
          expect(lowered.includes(phrase)).toBe(false);
        }
      }),
      { numRuns: 200 },
    );
  });

  it("also holds for arbitrary strings, whether or not they contain forbidden wording", () => {
    fc.assert(
      fc.property(fc.string(), (input) => {
        expect(containsForbiddenWording(sanitizeWording(input))).toBe(false);
      }),
      { numRuns: 200 },
    );
  });

  it("leaves text that is already clean unchanged", () => {
    fc.assert(
      fc.property(fc.string(), (input) => {
        fc.pre(!containsForbiddenWording(input));
        // Clean, non-empty text round-trips through the sanitizer unchanged.
        fc.pre(input.length > 0);
        expect(sanitizeWording(input)).toBe(input);
      }),
      { numRuns: 200 },
    );
  });
});
