/**
 * Pure, I/O-free math for the browser photo-resize pipeline (Req 3.1).
 *
 * These helpers compute the scaled canvas dimensions and the sequence of JPEG
 * quality steps used by `PhotoCapture.tsx`. They contain no DOM or canvas
 * access so they can be unit-tested in a plain Node environment.
 */

/** Maximum output width in CSS pixels (Req 3.1). */
export const MAX_WIDTH = 1280;

/** Maximum encoded blob size in bytes: 4.5 megabytes (Req 3.1). */
export const MAX_BYTES = Math.round(4.5 * 1024 * 1024);

/**
 * JPEG quality values tried in order, highest first. Each step is attempted
 * until the encoded blob is at or below {@link MAX_BYTES}. The floor (0.4)
 * keeps the image usable; if even the floor exceeds the limit the upload is
 * cancelled (Req 3.2).
 */
export const QUALITY_STEPS: readonly number[] = [0.85, 0.7, 0.55, 0.4];

export interface Dimensions {
  width: number;
  height: number;
}

/**
 * Compute the output dimensions for a source image, scaled down so the width
 * is at most {@link MAX_WIDTH} while preserving aspect ratio. Images already
 * within the limit are returned unchanged (never upscaled). Dimensions are
 * rounded to whole pixels, and both are floored to at least 1.
 */
export function scaledDimensions(
  sourceWidth: number,
  sourceHeight: number,
  maxWidth: number = MAX_WIDTH,
): Dimensions {
  if (
    !Number.isFinite(sourceWidth) ||
    !Number.isFinite(sourceHeight) ||
    sourceWidth <= 0 ||
    sourceHeight <= 0
  ) {
    throw new Error("Source dimensions must be positive finite numbers.");
  }

  if (sourceWidth <= maxWidth) {
    return {
      width: Math.max(1, Math.round(sourceWidth)),
      height: Math.max(1, Math.round(sourceHeight)),
    };
  }

  const scale = maxWidth / sourceWidth;
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
  };
}

/** Whether an encoded blob size (in bytes) is within the upload limit. */
export function withinSizeLimit(
  byteLength: number,
  maxBytes: number = MAX_BYTES,
): boolean {
  return byteLength <= maxBytes;
}
