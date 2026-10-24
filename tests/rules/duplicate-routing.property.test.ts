import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { isNearby, type LatLng } from "@/lib/rules/distance";
import { decideSidewalkRoute } from "@/lib/rules/routing";

/**
 * Property 3: Duplicate routing threshold.
 *
 * For all sets of open Boston 311 cases of the same accessibility-relevant
 * service_name, the System produces exactly one new 311 draft if and only if
 * the count of matching open reports whose great-circle distance from the
 * barrier is 75 meters or less is fewer than 2, and escalates otherwise.
 *
 * Invariant:
 *   decideSidewalkRoute({ open_count: nearbyCount })
 *     === (nearbyCount < 2 ? 'draft_311' : 'escalate')
 * where nearbyCount is the number of candidates within 75 m of the barrier.
 *
 * Validates: Requirements 21.3, 6.1, 6.2, 6.3
 */
describe("Feature: threshold, Property 3: Duplicate routing threshold", () => {
  // A barrier anywhere on Earth, kept away from the poles / antimeridian so the
  // small degree offsets below stay valid coordinates.
  const barrierArb: fc.Arbitrary<LatLng> = fc.record({
    lat: fc.double({ min: -60, max: 60, noNaN: true }),
    lng: fc.double({ min: -170, max: 170, noNaN: true }),
  });

  // A small offset in degrees. At these latitudes a degree is roughly 100+ km,
  // so deltas up to ~0.002 degrees span both inside and outside the 75 m radius.
  const deltaArb = fc.double({ min: -0.002, max: 0.002, noNaN: true });

  it("drafts a new 311 report iff fewer than two open reports are within 75 m, else escalates", () => {
    fc.assert(
      fc.property(
        barrierArb,
        fc.array(
          fc.record({ dLat: deltaArb, dLng: deltaArb }),
          { maxLength: 12 },
        ),
        (barrier, offsets) => {
          const candidates: LatLng[] = offsets.map((o) => ({
            lat: barrier.lat + o.dLat,
            lng: barrier.lng + o.dLng,
          }));

          const nearbyCount = candidates.filter((c) =>
            isNearby(barrier, c),
          ).length;

          const expected = nearbyCount < 2 ? "draft_311" : "escalate";
          expect(decideSidewalkRoute({ open_count: nearbyCount })).toBe(
            expected,
          );
        },
      ),
      { numRuns: 200 },
    );
  });
});
