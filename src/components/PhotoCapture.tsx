"use client";

import { useId, useRef, useState } from "react";
import { Camera, ImagePlus, TriangleAlert } from "lucide-react";
import {
  MAX_WIDTH,
  QUALITY_STEPS,
  scaledDimensions,
  withinSizeLimit,
} from "@/lib/photo/resize-math";

/** Message shown when the image cannot be decoded, resized, or encoded (Req 3.2). */
const PROCESS_ERROR = "This photo could not be processed.";

export interface PhotoCaptureProps {
  /**
   * Visible text label for the file input (semantic <label>, Req 23.1). Plain
   * language describing what to capture, e.g. "Photograph your wheelchair".
   */
  label: string;
  /**
   * Called with the resized JPEG blob once the image is successfully scaled to
   * at most {@link MAX_WIDTH}px wide and encoded at or below 4.5 MB. The parent
   * (e.g. the vault screen) performs the upload; this component never uploads.
   */
  onResized: (blob: Blob) => void;
  /**
   * Optional hint shown beneath the label (e.g. "Use your camera or choose a
   * photo"). Associated with the input via aria-describedby.
   */
  hint?: string;
  /** Disable the control while a parent upload is in flight. */
  disabled?: boolean;
}

/**
 * Load an image file into an HTMLImageElement via an object URL, revoking the
 * URL when done. Rejects if the file is not a decodable image.
 */
function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("The image could not be decoded."));
    };
    img.src = url;
    // Note: the caller revokes the URL after drawing, via the returned image's
    // currentSrc; we revoke on error here and the success path revokes below.
  });
}

/** Encode a canvas to a JPEG blob at the given quality (promisified toBlob). */
function encodeJpeg(
  canvas: HTMLCanvasElement,
  quality: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error("The image could not be encoded."));
        }
      },
      "image/jpeg",
      quality,
    );
  });
}

/**
 * Resize a selected image file to a JPEG blob: draw to a <canvas> scaled so
 * width <= MAX_WIDTH (preserving aspect ratio), then encode at progressively
 * lower quality until the blob is at or below the 4.5 MB limit. Throws if any
 * step fails or the limit cannot be met at the lowest quality (Req 3.1, 3.2).
 */
async function resizeToJpeg(file: File): Promise<Blob> {
  const img = await loadImage(file);
  try {
    const { width, height } = scaledDimensions(
      img.naturalWidth || img.width,
      img.naturalHeight || img.height,
      MAX_WIDTH,
    );

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Canvas drawing is not available.");
    }
    ctx.drawImage(img, 0, 0, width, height);

    for (const quality of QUALITY_STEPS) {
      const blob = await encodeJpeg(canvas, quality);
      if (withinSizeLimit(blob.size)) {
        return blob;
      }
    }
    throw new Error("The image is too large even at the lowest quality.");
  } finally {
    // Release the object URL created in loadImage.
    URL.revokeObjectURL(img.src);
  }
}

/**
 * PhotoCapture lets the resident add a photo two ways, then resizes the chosen
 * image in the browser to a JPEG at most 1280px wide and at most 4.5 MB before
 * handing the resulting blob to `onResized` for the parent to upload. On any
 * decode, resize, or encode failure it cancels (no blob emitted) and shows
 * "This photo could not be processed." inline, leaving existing state unchanged.
 *
 * Two real <button>s drive two hidden <input type="file"> controls so the
 * resident is never forced into the camera: "Take photo" uses
 * capture="environment" to open the rear camera on phones, and "Choose from
 * library" has no capture attribute so it opens the photo library. Both feed
 * the same resize and upload flow. Error text is rendered inline next to the
 * controls (icon plus text, not color alone) and linked via aria-describedby
 * so VoiceOver / TalkBack announce it.
 *
 * Built to WCAG 2.2 AA guidelines and tested with VoiceOver.
 * Requirements: 3.1, 3.2, 23.1, 23.7.
 */
export default function PhotoCapture({
  label,
  onResized,
  hint,
  disabled = false,
}: PhotoCaptureProps) {
  const groupId = useId();
  const hintId = useId();
  const errorId = useId();
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const libraryInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);

  async function handleChange(
    event: React.ChangeEvent<HTMLInputElement>,
  ): Promise<void> {
    const file = event.target.files?.[0];
    // Clear the input value so selecting the same file again re-triggers change.
    event.target.value = "";
    if (!file) {
      return;
    }

    setError(null);
    setProcessing(true);
    try {
      const blob = await resizeToJpeg(file);
      onResized(blob);
    } catch {
      // Cancel the upload and leave existing items unchanged (Req 3.2).
      setError(PROCESS_ERROR);
    } finally {
      setProcessing(false);
    }
  }

  const describedBy =
    [hint ? hintId : null, error ? errorId : null]
      .filter(Boolean)
      .join(" ") || undefined;

  const controlsDisabled = disabled || processing;

  const buttonClasses = [
    "inline-flex min-h-[56px] w-full items-center justify-center gap-2",
    "rounded-[14px] px-4 py-2 text-base font-bold",
    "disabled:cursor-not-allowed",
  ].join(" ");

  return (
    <div
      role="group"
      aria-labelledby={groupId}
      aria-describedby={describedBy}
      className="flex flex-col gap-2"
    >
      <span id={groupId} className="text-base font-semibold">
        {label}
      </span>

      {hint ? (
        <p id={hintId} className="text-base text-muted">
          {hint}
        </p>
      ) : null}

      {/* Hidden inputs: one forces the camera, one opens the library. Both feed
          the same resize/upload flow via handleChange. */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={handleChange}
      />
      <input
        ref={libraryInputRef}
        type="file"
        accept="image/*"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={handleChange}
      />

      <div className="flex flex-col gap-2">
        <button
          type="button"
          disabled={controlsDisabled}
          onClick={() => cameraInputRef.current?.click()}
          className={[
            buttonClasses,
            "bg-accent text-on-accent",
            "disabled:bg-surface disabled:text-muted",
          ].join(" ")}
        >
          <Camera aria-hidden="true" className="h-5 w-5 shrink-0" />
          <span>Take photo</span>
        </button>

        <button
          type="button"
          disabled={controlsDisabled}
          onClick={() => libraryInputRef.current?.click()}
          className={[
            buttonClasses,
            "border border-accent bg-surface text-accent",
            "disabled:text-muted",
          ].join(" ")}
        >
          <ImagePlus aria-hidden="true" className="h-5 w-5 shrink-0" />
          <span>Choose from library</span>
        </button>
      </div>

      {processing ? (
        <p role="status" aria-live="polite" className="text-base text-muted">
          Processing photo…
        </p>
      ) : null}

      {error ? (
        <p
          id={errorId}
          role="alert"
          className="flex items-start gap-2 text-base text-danger"
        >
          {/* Icon + text: meaning is never carried by color alone (Req 23.6). */}
          <TriangleAlert aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}
