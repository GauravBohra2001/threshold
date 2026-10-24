import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  MAX_BYTES,
  MAX_WIDTH,
  QUALITY_STEPS,
  scaledDimensions,
  withinSizeLimit,
} from "./resize-math";

describe("scaledDimensions", () => {
  it("leaves an image already within the width limit unchanged", () => {
    expect(scaledDimensions(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it("scales a wide image down to the max width, preserving aspect ratio", () => {
    expect(scaledDimensions(2560, 1440)).toEqual({ width: 1280, height: 720 });
  });

  it("rounds to whole pixels", () => {
    const { width, height } = scaledDimensions(1920, 1281);
    expect(Number.isInteger(width)).toBe(true);
    expect(Number.isInteger(height)).toBe(true);
    expect(width).toBe(1280);
  });

  it("never returns a zero dimension for a very wide, short image", () => {
    const { width, height } = scaledDimensions(100000, 1);
    expect(width).toBe(MAX_WIDTH);
    expect(height).toBeGreaterThanOrEqual(1);
  });

  it("rejects non-positive or non-finite inputs", () => {
    expect(() => scaledDimensions(0, 100)).toThrow();
    expect(() => scaledDimensions(100, 0)).toThrow();
    expect(() => scaledDimensions(-10, 100)).toThrow();
    expect(() => scaledDimensions(Number.NaN, 100)).toThrow();
    expect(() => scaledDimensions(Infinity, 100)).toThrow();
  });

  it("output width never exceeds MAX_WIDTH and aspect ratio is preserved", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 20000 }),
        fc.integer({ min: 1, max: 20000 }),
        (w, h) => {
          const out = scaledDimensions(w, h);
          expect(out.width).toBeGreaterThanOrEqual(1);
          expect(out.height).toBeGreaterThanOrEqual(1);
          expect(out.width).toBeLessThanOrEqual(MAX_WIDTH);
          if (w <= MAX_WIDTH) {
            expect(out.width).toBe(w);
          } else {
            // Aspect ratio preserved within one pixel of rounding.
            const expectedHeight = (h * MAX_WIDTH) / w;
            expect(Math.abs(out.height - expectedHeight)).toBeLessThanOrEqual(1);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe("withinSizeLimit", () => {
  it("accepts a blob at or below the 4.5 MB limit", () => {
    expect(withinSizeLimit(MAX_BYTES)).toBe(true);
    expect(withinSizeLimit(MAX_BYTES - 1)).toBe(true);
  });

  it("rejects a blob above the limit", () => {
    expect(withinSizeLimit(MAX_BYTES + 1)).toBe(false);
  });
});

describe("constants", () => {
  it("quality steps descend from highest to a usable floor", () => {
    expect(QUALITY_STEPS[0]).toBeGreaterThan(
      QUALITY_STEPS[QUALITY_STEPS.length - 1],
    );
    for (const q of QUALITY_STEPS) {
      expect(q).toBeGreaterThan(0);
      expect(q).toBeLessThanOrEqual(1);
    }
  });
});
