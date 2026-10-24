"use client";

import { useCallback, useEffect, useId, useState } from "react";

import LiveRegion from "@/components/LiveRegion";
import PhotoCapture from "@/components/PhotoCapture";

/**
 * Proof Vault listing screen.
 *
 * Fetches `GET /api/vault` and renders the household's vault items as a
 * semantic <ul>/<li> list. Each list item exposes a non-empty text label of
 * 1–150 characters usable by VoiceOver / TalkBack (Req 4.1), shows the photo
 * through its short-lived signed URL with alt text (the AI label when present,
 * otherwise a timestamp-derived value so no photo has empty/missing alt —
 * Req 4.2, 4.3, 23.7), and names the item kind. Items arrive most-recent first
 * from the server (Req 4.4). An empty vault shows a plain-language text message
 * readable by screen readers (Req 4.5). A load failure shows a friendly
 * fallback with no stack trace.
 *
 * The "Add a vault item" section carries a `kind` selector and a
 * {@link PhotoCapture} control. On a successfully resized blob the screen
 * uploads the already-resized JPEG to `POST /api/vault`, refreshes the listing
 * via `reload`, and announces the save through a polite aria-live region
 * (Req 23.9). A labeling-unavailable message from the server is surfaced as a
 * non-error notice (Req 3.7); a field or fallback error is rendered inline
 * next to the control with no stack trace (Req 3.4). The resize-before-upload
 * work lives entirely in PhotoCapture (Req 3.1, 3.2); this screen only uploads
 * the resized blob.
 *
 * Semantic HTML only — real <main>, <h1>, <ul>, <li>, <img>, <label>,
 * <select> (Req 23.1).
 *
 * Built to WCAG 2.2 AA guidelines and tested with VoiceOver.
 * Requirements: 3.1, 3.2, 3.4, 3.7, 3.8, 4.1, 4.2, 4.3, 4.4, 4.5, 10.1, 23.7,
 *   23.9.
 */

/** One vault item as returned by `GET /api/vault`. */
interface VaultListItem {
  id: string;
  kind: "equipment" | "home_feature" | "document";
  label: string;
  ai_description: string;
  accessibility_relevant: boolean;
  captured_at: string;
  signed_url: string;
  alt: string;
}

type Status =
  | { state: "loading" }
  | { state: "ready"; items: VaultListItem[] }
  | { state: "error" };

/** Kinds the resident can choose for a new vault item (matches the API). */
type VaultKind = VaultListItem["kind"];

/** Upload lifecycle for the capture control. */
type UploadState =
  | { state: "idle" }
  | { state: "uploading" }
  // A labeling-unavailable notice is NOT an error (Req 3.7).
  | { state: "saved"; notice: string | null }
  // A field or fallback error, shown inline with no stack trace (Req 3.4).
  | { state: "error"; message: string };

const LOAD_ERROR_MESSAGE =
  "Your vault could not be loaded right now. Please try again in a moment.";

/** Friendly fallback when the upload request itself cannot complete (Req 3.4). */
const UPLOAD_FAILED_MESSAGE =
  "This photo could not be saved. Please try again in a moment.";

/** Polite announcement after a successful save (Req 23.9). */
const SAVED_ANNOUNCEMENT = "Photo saved.";

/** Options for the kind selector, in plain language. */
const KIND_OPTIONS: { value: VaultKind; label: string }[] = [
  { value: "equipment", label: "Equipment (for example, a wheelchair)" },
  { value: "home_feature", label: "Home feature (for example, steps)" },
  { value: "document", label: "Document" },
];

/** Shape of the 201 response body from `POST /api/vault`. */
interface UploadSuccessBody {
  message?: string;
}

/** Shape of a 4xx/5xx error body from `POST /api/vault`. */
interface UploadErrorBody {
  field?: string;
  message?: string;
}

/** Human-readable name for each kind, shown as text next to the label. */
const KIND_LABELS: Record<VaultListItem["kind"], string> = {
  equipment: "Equipment",
  home_feature: "Home feature",
  document: "Document",
};

/** Format a capture timestamp as a readable date for display and labels. */
function formatCaptured(capturedAt: string): string {
  const date = new Date(capturedAt);
  if (Number.isNaN(date.getTime())) {
    return capturedAt;
  }
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/**
 * Build the non-empty text label for a list item, clamped to 1–150 chars
 * (Req 4.1). Uses the AI label when present, otherwise a plain-language
 * "Unlabeled <kind> captured <date>" so the label is never empty.
 */
function itemLabel(item: VaultListItem): string {
  const kindName = KIND_LABELS[item.kind];
  const base =
    item.label.trim().length > 0
      ? `${item.label} (${kindName})`
      : `Unlabeled ${kindName.toLowerCase()} captured ${formatCaptured(
          item.captured_at,
        )}`;
  // Guarantee 1–150 characters.
  const trimmed = base.trim();
  const nonEmpty = trimmed.length > 0 ? trimmed : kindName;
  return nonEmpty.slice(0, 150);
}

/** Announcement text for the polite live region (Req 23.9). */
function announce(status: Status): string {
  if (status.state === "loading") {
    return "Loading your vault.";
  }
  if (status.state === "error") {
    return LOAD_ERROR_MESSAGE;
  }
  const count = status.items.length;
  return count === 0
    ? "Your vault is empty."
    : `Showing ${count} vault ${count === 1 ? "item" : "items"}.`;
}

export default function VaultPage() {
  const [status, setStatus] = useState<Status>({ state: "loading" });
  const [kind, setKind] = useState<VaultKind>("equipment");
  const [upload, setUpload] = useState<UploadState>({ state: "idle" });
  const kindSelectId = useId();
  const uploadMessageId = useId();

  // Fetch the listing and resolve to the next status. Pure of setState so the
  // effect does not update state synchronously (it awaits the network). Task
  // 8.1 reuses this to refresh the listing after an upload.
  const fetchVault = useCallback(async (): Promise<Status> => {
    try {
      const response = await fetch("/api/vault", {
        method: "GET",
        headers: { accept: "application/json" },
        cache: "no-store",
      });
      if (!response.ok) {
        return { state: "error" };
      }
      const body = (await response.json()) as { items?: VaultListItem[] };
      return { state: "ready", items: body.items ?? [] };
    } catch {
      return { state: "error" };
    }
  }, []);

  // Load on mount. State is only set after the async fetch resolves, and the
  // update is skipped if the component unmounted meanwhile.
  useEffect(() => {
    let active = true;
    void fetchVault().then((next) => {
      if (active) {
        setStatus(next);
      }
    });
    return () => {
      active = false;
    };
  }, [fetchVault]);

  // Reload handler (an event handler, so it may set the loading state directly)
  // kept for task 8.1 to refresh the listing after an upload.
  const reload = useCallback(() => {
    setStatus({ state: "loading" });
    void fetchVault().then(setStatus);
  }, [fetchVault]);

  // Upload an already-resized JPEG blob (produced by PhotoCapture, Req 3.1/3.2)
  // to POST /api/vault with the chosen kind, then refresh the listing. On a
  // 201 the save is announced politely (Req 23.9) and any labeling-unavailable
  // message is surfaced as a non-error notice (Req 3.7). On a field (400) or
  // non-ok { message } error the message is rendered inline with no stack
  // trace (Req 3.4). The control is disabled while uploading.
  const handleResized = useCallback(
    async (blob: Blob): Promise<void> => {
      setUpload({ state: "uploading" });

      const form = new FormData();
      form.append("photo", blob, "photo.jpg");
      form.append("kind", kind);

      try {
        const response = await fetch("/api/vault", {
          method: "POST",
          body: form,
        });

        if (response.status === 201) {
          let body: UploadSuccessBody = {};
          try {
            body = (await response.json()) as UploadSuccessBody;
          } catch {
            // A missing/invalid body is still a successful save.
          }
          // Surface a labeling-unavailable notice as a non-error message.
          const notice =
            typeof body.message === "string" && body.message.trim().length > 0
              ? body.message
              : null;
          setUpload({ state: "saved", notice });
          reload();
          return;
        }

        // Non-201: read the plain-language message, never a stack trace.
        let errorBody: UploadErrorBody = {};
        try {
          errorBody = (await response.json()) as UploadErrorBody;
        } catch {
          // Fall through to the generic fallback below.
        }
        const message =
          typeof errorBody.message === "string" &&
          errorBody.message.trim().length > 0
            ? errorBody.message
            : UPLOAD_FAILED_MESSAGE;
        setUpload({ state: "error", message });
      } catch {
        // Network or unexpected failure: friendly fallback, no stack trace.
        setUpload({ state: "error", message: UPLOAD_FAILED_MESSAGE });
      }
    },
    [kind, reload],
  );

  const uploading = upload.state === "uploading";

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 py-8">
      {/* Polite announcer for load results (Req 23.9). */}
      <LiveRegion politeness="polite">{announce(status)}</LiveRegion>

      <h1 className="text-2xl font-semibold">Proof Vault</h1>
      <p className="mt-2 text-muted-foreground">
        Photos of your equipment and home features, labeled and timestamped.
      </p>

      {/*
        Polite announcer for the save result, separate from the listing
        announcer so a successful save is read without being overwritten by the
        reload's "Showing N items" message (Req 23.9).
      */}
      <LiveRegion politeness="polite">
        {upload.state === "saved" ? SAVED_ANNOUNCEMENT : ""}
      </LiveRegion>

      {/* Capture + upload control (task 8.1). */}
      <section aria-label="Add a vault item" className="mt-6 flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <label htmlFor={kindSelectId} className="text-base font-semibold">
            What kind of item is this?
          </label>
          <select
            id={kindSelectId}
            value={kind}
            disabled={uploading}
            onChange={(event) => setKind(event.target.value as VaultKind)}
            className="min-h-[44px] w-full rounded-lg border border-border bg-surface p-3 text-base text-foreground disabled:cursor-not-allowed disabled:opacity-60"
          >
            {KIND_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <PhotoCapture
          label="Add a photo to your vault"
          hint="Use your camera or choose a photo. We resize it on your device before saving."
          onResized={handleResized}
          disabled={uploading}
        />

        {uploading ? (
          <p
            id={uploadMessageId}
            role="status"
            className="text-base text-muted-foreground"
          >
            Saving your photo…
          </p>
        ) : null}

        {upload.state === "saved" && upload.notice ? (
          // Labeling-unavailable notice: informational, not an error (Req 3.7).
          <p
            id={uploadMessageId}
            className="flex items-start gap-2 rounded-lg border border-border bg-surface p-3 text-base"
          >
            <span aria-hidden="true">ℹ</span>
            <span>{upload.notice}</span>
          </p>
        ) : null}

        {upload.state === "error" ? (
          // Inline field/fallback error, no stack trace (Req 3.4). Meaning is
          // carried by icon + text, never color alone (Req 23.6).
          <p
            id={uploadMessageId}
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-alert bg-surface p-3 text-base text-alert"
          >
            <span aria-hidden="true">⚠</span>
            <span>{upload.message}</span>
          </p>
        ) : null}
      </section>

      <section aria-label="Your vault items" className="mt-6 flex-1">
        {status.state === "loading" ? (
          <p role="status">Loading your vault…</p>
        ) : null}

        {status.state === "error" ? (
          <div className="flex flex-col gap-4">
            <p
              role="alert"
              className="rounded-lg border border-alert bg-surface p-3 text-alert"
            >
              {LOAD_ERROR_MESSAGE}
            </p>
            <button
              type="button"
              onClick={reload}
              className="min-h-[44px] w-full rounded-lg border border-border px-6 py-3 text-base font-semibold"
            >
              Try again
            </button>
          </div>
        ) : null}

        {status.state === "ready" && status.items.length === 0 ? (
          // Empty-vault text message, readable by VoiceOver/TalkBack (Req 4.5).
          <p>
            Your vault is empty. Add a photo of your equipment or a home feature
            to get started.
          </p>
        ) : null}

        {status.state === "ready" && status.items.length > 0 ? (
          <ul className="flex flex-col gap-4">
            {status.items.map((item) => {
              const label = itemLabel(item);
              return (
                <li
                  key={item.id}
                  aria-label={label}
                  className="rounded-lg border border-border bg-surface p-4"
                >
                  {/*
                    Short-lived signed URL (≤300s, Req 3.8). next/image is not
                    used because the signed URL expires and is not a stable,
                    optimizable asset.
                  */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={item.signed_url}
                    alt={item.alt}
                    className="h-48 w-full rounded-md object-cover"
                  />
                  <p className="mt-3 text-lg font-medium">{label}</p>
                  <p className="mt-1 text-muted-foreground">
                    {KIND_LABELS[item.kind]} · captured{" "}
                    {formatCaptured(item.captured_at)}
                  </p>
                  {item.ai_description.trim().length > 0 ? (
                    <p className="mt-1">{item.ai_description}</p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}
      </section>
    </main>
  );
}
