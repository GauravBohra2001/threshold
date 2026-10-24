"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { CircleCheck, ImageOff, Info, TriangleAlert } from "lucide-react";

import LiveRegion from "@/components/LiveRegion";
import PhotoCapture from "@/components/PhotoCapture";
import Button from "@/components/ui/Button";

/**
 * Proof Vault listing screen (ui-design.md).
 *
 * Shows the household's evidence as a two-column photo grid; each tile carries
 * the AI label (also its alt text) and the capture date in plain words. The
 * add-item flow pairs a kind selector with PhotoCapture, which resizes in the
 * browser (Req 3.1/3.2); this screen only uploads the resized blob to
 * POST /api/vault, refreshes the grid, and announces the save politely
 * (Req 23.9). A labeling-unavailable notice is informational, not an error
 * (Req 3.7); upload errors render below the control with an icon and text, no
 * stack trace (Req 3.4). Most-recent-first ordering and signed URLs come from
 * the server (Req 3.8, 4.4). The empty state invites one action (Req 4.5).
 */

interface VaultListItem {
  id: string;
  kind: "equipment" | "home_feature" | "document";
  label: string;
  ai_description: string;
  accessibility_relevant: boolean;
  captured_at: string;
  /** Signed photo URL, or null when the photo could not be signed. */
  image_url: string | null;
  alt: string;
}

type Status =
  | { state: "loading" }
  | { state: "ready"; items: VaultListItem[] }
  | { state: "error" };

type VaultKind = VaultListItem["kind"];

type UploadState =
  | { state: "idle" }
  | { state: "uploading" }
  | { state: "saved"; notice: string | null }
  | { state: "error"; message: string };

const LOAD_ERROR_MESSAGE =
  "Your evidence could not be loaded right now. Please try again in a moment.";
const UPLOAD_FAILED_MESSAGE =
  "This photo could not be saved. Please try again in a moment.";
const SAVED_ANNOUNCEMENT = "Photo saved.";

const KIND_OPTIONS: { value: VaultKind; label: string }[] = [
  { value: "equipment", label: "Equipment, like a wheelchair" },
  { value: "home_feature", label: "Home feature, like your front steps" },
  { value: "document", label: "Document" },
];

const KIND_LABELS: Record<VaultKind, string> = {
  equipment: "Equipment",
  home_feature: "Home feature",
  document: "Document",
};

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

function itemLabel(item: VaultListItem): string {
  const kindName = KIND_LABELS[item.kind];
  const base =
    item.label.trim().length > 0
      ? `${item.label} (${kindName})`
      : `Unlabeled ${kindName.toLowerCase()} taken ${formatCaptured(item.captured_at)}`;
  const trimmed = base.trim();
  return (trimmed.length > 0 ? trimmed : kindName).slice(0, 150);
}

function announce(status: Status): string {
  if (status.state === "loading") return "Loading your evidence.";
  if (status.state === "error") return LOAD_ERROR_MESSAGE;
  const count = status.items.length;
  return count === 0
    ? "You have no photos yet."
    : `Showing ${count} ${count === 1 ? "photo" : "photos"}.`;
}

export default function VaultPage() {
  const [status, setStatus] = useState<Status>({ state: "loading" });
  const [kind, setKind] = useState<VaultKind>("equipment");
  const [upload, setUpload] = useState<UploadState>({ state: "idle" });
  const kindSelectId = useId();

  const fetchVault = useCallback(async (): Promise<Status> => {
    try {
      const response = await fetch("/api/vault", {
        method: "GET",
        headers: { accept: "application/json" },
        cache: "no-store",
      });
      if (!response.ok) return { state: "error" };
      const body = (await response.json()) as { items?: VaultListItem[] };
      return { state: "ready", items: body.items ?? [] };
    } catch {
      return { state: "error" };
    }
  }, []);

  useEffect(() => {
    let active = true;
    void fetchVault().then((next) => {
      if (active) setStatus(next);
    });
    return () => {
      active = false;
    };
  }, [fetchVault]);

  const reload = useCallback(() => {
    setStatus({ state: "loading" });
    void fetchVault().then(setStatus);
  }, [fetchVault]);

  const handleResized = useCallback(
    async (blob: Blob): Promise<void> => {
      setUpload({ state: "uploading" });
      const form = new FormData();
      form.append("photo", blob, "photo.jpg");
      form.append("kind", kind);
      try {
        const response = await fetch("/api/vault", { method: "POST", body: form });
        if (response.status === 201) {
          let body: { message?: string } = {};
          try {
            body = (await response.json()) as { message?: string };
          } catch {
            // A missing body is still a successful save.
          }
          const notice =
            typeof body.message === "string" && body.message.trim().length > 0
              ? body.message
              : null;
          setUpload({ state: "saved", notice });
          reload();
          return;
        }
        let errorBody: { message?: string } = {};
        try {
          errorBody = (await response.json()) as { message?: string };
        } catch {
          // Fall through to the generic fallback.
        }
        setUpload({
          state: "error",
          message:
            typeof errorBody.message === "string" &&
            errorBody.message.trim().length > 0
              ? errorBody.message
              : UPLOAD_FAILED_MESSAGE,
        });
      } catch {
        setUpload({ state: "error", message: UPLOAD_FAILED_MESSAGE });
      }
    },
    [kind, reload],
  );

  const uploading = upload.state === "uploading";

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col px-5 py-8">
      <LiveRegion politeness="polite">{announce(status)}</LiveRegion>

      <h1 className="text-[28px]">Your evidence</h1>
      <p className="mt-2 text-muted">
        Photos of your equipment and home features, labeled and dated.
      </p>

      <section aria-label="Add a photo" className="mt-6 flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <label htmlFor={kindSelectId} className="font-bold">
            What is this a photo of?
          </label>
          <select
            id={kindSelectId}
            value={kind}
            disabled={uploading}
            onChange={(event) => setKind(event.target.value as VaultKind)}
            className="min-h-[56px] w-full rounded-[12px] border border-control-border bg-surface p-3 text-ink"
          >
            {KIND_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <PhotoCapture
          label="Add a photo"
          hint="Use your camera or choose a photo. We resize it on your device before saving."
          onResized={handleResized}
          disabled={uploading}
        />

        {uploading ? (
          <p role="status" className="text-muted">
            Saving your photo
          </p>
        ) : null}

        {upload.state === "saved" && upload.notice ? (
          <p className="flex items-start gap-2 rounded-[18px] border border-line bg-surface p-3">
            <Info aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" />
            <span>{upload.notice}</span>
          </p>
        ) : null}

        {upload.state === "saved" && !upload.notice ? (
          <p className="flex items-start gap-2 text-success">
            <CircleCheck aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" />
            <span>Photo saved.</span>
          </p>
        ) : null}

        {upload.state === "error" ? (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-[18px] border border-danger bg-surface p-3 text-danger"
          >
            <TriangleAlert aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" />
            <span>{upload.message}</span>
          </p>
        ) : null}
      </section>

      <LiveRegion politeness="polite">
        {upload.state === "saved" ? SAVED_ANNOUNCEMENT : ""}
      </LiveRegion>

      <section aria-label="Your photos" className="mt-8 flex-1">
        {status.state === "loading" ? (
          <p role="status">Loading your evidence</p>
        ) : null}

        {status.state === "error" ? (
          <div className="flex flex-col gap-4">
            <p
              role="alert"
              className="flex items-start gap-2 rounded-[18px] border border-danger bg-surface p-3 text-danger"
            >
              <TriangleAlert aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" />
              <span>{LOAD_ERROR_MESSAGE}</span>
            </p>
            <Button variant="secondary" onClick={reload}>
              Try again
            </Button>
          </div>
        ) : null}

        {status.state === "ready" && status.items.length === 0 ? (
          <p>
            No photos yet. Start with your wheelchair or your front steps.
          </p>
        ) : null}

        {status.state === "ready" && status.items.length > 0 ? (
          <ul className="grid grid-cols-2 gap-4">
            {status.items.map((item) => {
              const label = itemLabel(item);
              return (
                <li
                  key={item.id}
                  className="overflow-hidden rounded-[18px] border border-line bg-surface"
                >
                  {item.image_url ? (
                    <>
                      {/* Short-lived signed URL (≤300s, Req 3.8); not a stable asset. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={item.image_url}
                        alt={item.alt}
                        className="aspect-square w-full rounded-[12px] object-cover"
                      />
                    </>
                  ) : (
                    // The photo file could not be signed (e.g. missing from
                    // storage). Show a plain placeholder so the item still
                    // lists with its label and date.
                    <div
                      role="img"
                      aria-label={`${label}. Photo not available.`}
                      className="flex aspect-square w-full flex-col items-center justify-center gap-2 rounded-[12px] bg-bg p-3 text-muted"
                    >
                      <ImageOff aria-hidden="true" className="h-6 w-6" />
                      <span className="text-[16px]">Photo not available</span>
                    </div>
                  )}
                  <div className="p-3">
                    <p className="font-bold">{label}</p>
                    <p className="mt-1 text-[16px] text-muted">
                      Taken {formatCaptured(item.captured_at)}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : null}
      </section>
    </main>
  );
}
