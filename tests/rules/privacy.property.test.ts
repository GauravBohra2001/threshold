// Feature: threshold, Property 4: Privacy — no address leak
// Validates: Requirements 21.4, 10.1, 10.3, 10.5, 6.4
import { describe, it, expect } from "vitest";
import fc from "fast-check";

import {
  forbiddenAddressesFrom,
  guardResponse,
  stripAddresses,
  type Boston311SourceRecord,
} from "@/lib/rules/privacy";

/**
 * Property 4: Privacy — no address leak.
 *
 * For all agent outputs and API response bodies serialized for the browser, no
 * string value equals or contains any `full_address` value present in the
 * source Boston 311 records. We generate a batch of source 311 records with
 * distinctive `full_address` strings, embed some of those addresses (verbatim
 * and re-cased) at random depth in an arbitrary response value, run the guard,
 * then assert `JSON.stringify` of the guarded value contains no source address
 * (checked case-insensitively, since a re-cased copy must not slip through).
 */

// Source addresses are drawn from a distinctive namespace so that arbitrary
// "noise" strings generated elsewhere in the response can never accidentally
// equal or contain a source address (which would be a false positive, not a
// real leak). A real address like "123 Main St, Boston, MA 02118" is modeled
// here as a tagged, non-trivial unique string.
const sourceAddress = (): fc.Arbitrary<string> =>
  fc
    .tuple(
      fc.integer({ min: 1, max: 9999 }),
      fc.integer({ min: 0, max: 0xffffffff }),
    )
    .map(
      ([num, token]) =>
        `${num} ADDR-${token.toString(16)} St, Boston, MA 021${(num % 90) + 10}`,
    );

// A 311 source record: a required distinctive full_address plus optional
// coordinates (which must also never reach the browser).
const sourceRecord = (): fc.Arbitrary<Boston311SourceRecord> =>
  fc.record(
    {
      full_address: sourceAddress(),
      latitude: fc.option(fc.double({ min: 42, max: 43, noNaN: true }), {
        nil: undefined,
      }),
      longitude: fc.option(fc.double({ min: -72, max: -70, noNaN: true }), {
        nil: undefined,
      }),
    },
    { requiredKeys: ["full_address"] },
  );

// Case-variant copy of a string (upper, lower, or alternating) so the test
// exercises the guard's case-insensitive matching.
function recase(value: string, mode: number): string {
  if (mode === 0) return value.toUpperCase();
  if (mode === 1) return value.toLowerCase();
  return value
    .split("")
    .map((ch, i) => (i % 2 === 0 ? ch.toUpperCase() : ch.toLowerCase()))
    .join("");
}

// Build an arbitrary response value that embeds the given source addresses at
// random depth inside nested objects/arrays/strings, some verbatim and some
// re-cased, interleaved with innocent "noise" values.
function responseEmbedding(addresses: string[]): fc.Arbitrary<unknown> {
  // A leaf is either a benign noise value or an embedded source address
  // (possibly re-cased, possibly wrapped in surrounding prose).
  const noiseLeaf: fc.Arbitrary<unknown> = fc.oneof(
    fc.string(),
    fc.integer(),
    fc.boolean(),
    fc.constant(null),
  );

  const addressLeaf: fc.Arbitrary<unknown> =
    addresses.length === 0
      ? noiseLeaf
      : fc
          .tuple(
            fc.constantFrom(...addresses),
            fc.integer({ min: 0, max: 2 }), // recase mode
            fc.string(), // prefix prose
            fc.string(), // suffix prose
          )
          .map(([addr, mode, pre, post]) => `${pre}${recase(addr, mode)}${post}`);

  const { tree } = fc.letrec((rec) => ({
    tree: fc.oneof(
      { depthSize: "small", withCrossShrink: true },
      noiseLeaf,
      addressLeaf,
      fc.array(rec("tree"), { maxLength: 4 }),
      fc.dictionary(fc.string(), rec("tree"), { maxKeys: 4 }),
    ),
  }));

  return tree;
}

describe("Property 4: Privacy — no address leak", () => {
  it("guardResponse strips every source full_address from the serialized output", () => {
    fc.assert(
      fc.property(
        fc
          .array(sourceRecord(), { minLength: 1, maxLength: 6 })
          .chain((records) =>
            responseEmbedding(
              forbiddenAddressesFrom(records),
            ).map((response) => ({ records, response })),
          ),
        ({ records, response }) => {
          const guarded = guardResponse(response, records);
          const haystack = JSON.stringify(guarded) ?? "";
          const haystackLower = haystack.toLowerCase();

          for (const address of forbiddenAddressesFrom(records)) {
            // No verbatim occurrence...
            expect(haystack.includes(address)).toBe(false);
            // ...and no re-cased occurrence either.
            expect(haystackLower.includes(address.toLowerCase())).toBe(false);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it("stripAddresses with forbiddenAddressesFrom removes embedded addresses too", () => {
    fc.assert(
      fc.property(
        fc
          .array(sourceRecord(), { minLength: 1, maxLength: 6 })
          .chain((records) =>
            responseEmbedding(
              forbiddenAddressesFrom(records),
            ).map((response) => ({ records, response })),
          ),
        ({ records, response }) => {
          const forbidden = forbiddenAddressesFrom(records);
          const guarded = stripAddresses(response, forbidden);
          const haystackLower = (JSON.stringify(guarded) ?? "").toLowerCase();

          for (const address of forbidden) {
            expect(haystackLower.includes(address.toLowerCase())).toBe(false);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
