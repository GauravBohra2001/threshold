import { describe, expect, it } from "vitest";

import {
  DEFAULT_NEARBY_RADIUS_M,
  greatCircleMeters,
  isNearby,
  type LatLng,
} from "./distance";

// Dorchester, Boston reference point.
const ORIGIN: LatLng = { lat: 42.3016, lng: -71.0676 };

describe("greatCircleMeters", () => {
  it("returns zero for identical points", () => {
    expect(greatCircleMeters(ORIGIN, ORIGIN)).toBe(0);
  });

  it("returns a whole-meter integer", () => {
    const d = greatCircleMeters(ORIGIN, { lat: 42.302, lng: -71.067 });
    expect(Number.isInteger(d)).toBe(true);
  });

  it("is symmetric", () => {
    const b: LatLng = { lat: 42.305, lng: -71.07 };
    expect(greatCircleMeters(ORIGIN, b)).toBe(greatCircleMeters(b, ORIGIN));
  });

  it("matches a known short distance within rounding", () => {
    // One degree of latitude is ~111.2 km; 0.0009 deg is ~100 m.
    const d = greatCircleMeters(ORIGIN, { lat: ORIGIN.lat + 0.0009, lng: ORIGIN.lng });
    expect(d).toBeGreaterThanOrEqual(98);
    expect(d).toBeLessThanOrEqual(102);
  });
});

describe("isNearby", () => {
  it("counts a point at the same location as nearby", () => {
    expect(isNearby(ORIGIN, ORIGIN)).toBe(true);
  });

  it("uses a 75 m default radius", () => {
    expect(DEFAULT_NEARBY_RADIUS_M).toBe(75);
  });

  it("includes a point just inside the radius", () => {
    // ~0.0005 deg latitude is ~56 m, within 75 m.
    const near: LatLng = { lat: ORIGIN.lat + 0.0005, lng: ORIGIN.lng };
    expect(greatCircleMeters(ORIGIN, near)).toBeLessThanOrEqual(75);
    expect(isNearby(ORIGIN, near)).toBe(true);
  });

  it("excludes a point beyond the radius", () => {
    // ~0.002 deg latitude is ~222 m, beyond 75 m.
    const far: LatLng = { lat: ORIGIN.lat + 0.002, lng: ORIGIN.lng };
    expect(greatCircleMeters(ORIGIN, far)).toBeGreaterThan(75);
    expect(isNearby(ORIGIN, far)).toBe(false);
  });

  it("is inclusive at the radius boundary (distance <= radiusM)", () => {
    const b: LatLng = { lat: 42.305, lng: -71.07 };
    const d = greatCircleMeters(ORIGIN, b);
    expect(isNearby(ORIGIN, b, d)).toBe(true);
    expect(isNearby(ORIGIN, b, d - 1)).toBe(false);
  });
});
