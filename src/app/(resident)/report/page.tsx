"use client";

import { useCallback, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, MapPin, TriangleAlert } from "lucide-react";

import BackLink from "@/components/BackLink";
import LiveRegion from "@/components/LiveRegion";
import PhotoCapture from "@/components/PhotoCapture";
import Button from "@/components/ui/Button";

/**
 * Report a Barrier screen (ui-design.md hero screen 1 entry point).
 *
 * The resident photographs a barrier and adds its location, then taps one
 * full-width bottom primary action to report it. On submit this POSTs a
 * multipart body (the browser-resized JPEG from PhotoCapture plus lat/lng and
 * an optional message) to POST /api/report, which validates that both a photo
 * and a location are present (Req 5.2), creates a case, and starts the Case
 * Agent run. On success the screen navigates to the case detail page
 * (/case/[id]) using the returned id so the resident watches the live trace
 * (owned by task 16.2).
 *
 * Location: a "Use my location" button reads navigator.geolocation; a manual
 * latitude/longitude fallback is always available so the resident is never
 * blocked by a denied or missing geolocation permission.
 *
 * Field-level errors for a missing photo or location render next to the field
 * with an icon and text, linked via aria-describedby (Req 5.2, 23.1). The
 * primary action keeps its name across the flow and shows a text reason when
 * it is disabled (ui-design.md). Submission status is announced politely
 * (Req 23.9).
 *
 * Built to WCAG 2.2 AA guidelines and tested with VoiceOver.
 * Requirements: 5.1, 5.2, 5.3, 23.1, 23.4, 23.9.
 */

interface ReportCreated {
  id: string;
}

interface Coordinates {
  lat: number;
  lng: number;
}

type FieldName = "photo" | "location";

const GENERIC_ERROR =
  "We could not start this report right now. Please try again in a moment.";
const PHOTO_REQUIRED = "Add a photo of the barrier first.";
const LOCATION_REQUIRED = "Add the location of the barrier first.";
const GEOLOCATION_UNAVAILABLE =
  "We could not get your location automatically. Enter it below instead.";

function parseCoordinate(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

export default function ReportBarrierPage() {
  const router = useRouter();

  const latId = useId();
  const lngId = useId();
  const messageId = useId();
  const photoErrorId = useId();
  const locationErrorId = useId();
  const formErrorId = useId();

  const [photo, setPhoto] = useState<Blob | null>(null);
  const [coords, setCoords] = useState<Coordinates | null>(null);
  const [latInput, setLatInput] = useState("");
  const [lngInput, setLngInput] = useState("");
  const [message, setMessage] = useState("");

  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<FieldName, string>>
  >({});
  const [formError, setFormError] = useState("");
  const [locating, setLocating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [announcement, setAnnouncement] = useState("");

  const handleResized = useCallback((blob: Blob): void => {
    setPhoto(blob);
    setFieldErrors((prev) => ({ ...prev, photo: undefined }));
    setAnnouncement("Photo added.");
  }, []);

  const useMyLocation = useCallback((): void => {
    setFieldErrors((prev) => ({ ...prev, location: undefined }));
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setFieldErrors((prev) => ({ ...prev, location: GEOLOCATION_UNAVAILABLE }));
      return;
    }
    setLocating(true);
    setAnnouncement("Getting your location.");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        setCoords({ lat, lng });
        setLatInput(String(lat));
        setLngInput(String(lng));
        setLocating(false);
        setAnnouncement("Location added.");
      },
      () => {
        setLocating(false);
        setFieldErrors((prev) => ({
          ...prev,
          location: GEOLOCATION_UNAVAILABLE,
        }));
        setAnnouncement(GEOLOCATION_UNAVAILABLE);
      },
    );
  }, []);

  const resolveLocation = useCallback((): Coordinates | null => {
    const lat = parseCoordinate(latInput);
    const lng = parseCoordinate(lngInput);
    if (lat !== null && lng !== null) {
      return { lat, lng };
    }
    return coords;
  }, [latInput, lngInput, coords]);

  const handleSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
      event.preventDefault();
      if (submitting) return;

      setFieldErrors({});
      setFormError("");

      const nextErrors: Partial<Record<FieldName, string>> = {};
      if (!photo) {
        nextErrors.photo = PHOTO_REQUIRED;
      }
      const location = resolveLocation();
      if (!location) {
        nextErrors.location = LOCATION_REQUIRED;
      }
      if (nextErrors.photo || nextErrors.location) {
        setFieldErrors(nextErrors);
        setAnnouncement(
          nextErrors.photo ? PHOTO_REQUIRED : LOCATION_REQUIRED,
        );
        return;
      }

      setSubmitting(true);
      setAnnouncement("Reporting this barrier.");
      try {
        const form = new FormData();
        form.append("photo", photo as Blob, "barrier.jpg");
        form.append("lat", String((location as Coordinates).lat));
        form.append("lng", String((location as Coordinates).lng));
        if (message.trim().length > 0) {
          form.append("message", message.trim());
        }

        const response = await fetch("/api/report", {
          method: "POST",
          body: form,
        });

        if (response.status === 400) {
          const body = (await response.json().catch(() => ({}))) as {
            field?: FieldName;
            message?: string;
          };
          if (body.field === "photo" || body.field === "location") {
            setFieldErrors({
              [body.field]: body.message ?? "Please check this field.",
            });
          } else {
            setFormError(body.message ?? GENERIC_ERROR);
          }
          return;
        }

        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as {
            message?: string;
          };
          setFormError(body.message ?? GENERIC_ERROR);
          return;
        }

        const created = (await response.json()) as ReportCreated;
        setAnnouncement("Report started. Opening your case.");
        router.push(`/case/${created.id}`);
      } catch {
        setFormError(GENERIC_ERROR);
      } finally {
        setSubmitting(false);
      }
    },
    [submitting, photo, resolveLocation, message, router],
  );

  const hasLocation = resolveLocation() !== null;
  const disabledReason = !photo
    ? PHOTO_REQUIRED
    : !hasLocation
      ? LOCATION_REQUIRED
      : undefined;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col px-5 py-8">
      <BackLink />
      <LiveRegion politeness="polite">{announcement}</LiveRegion>

      <h1 className="text-[28px]">Report a barrier</h1>
      <p className="mt-2 text-muted">
        Photograph the barrier and add where it is. The assistant looks into it
        and drafts a report for you to approve.
      </p>

      <form
        className="mt-8 flex flex-1 flex-col gap-8"
        onSubmit={handleSubmit}
        noValidate
        aria-describedby={formError ? formErrorId : undefined}
      >
        {formError ? (
          <p
            id={formErrorId}
            role="alert"
            className="flex items-start gap-2 rounded-[18px] border border-danger bg-surface p-3 text-danger"
          >
            <TriangleAlert aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" />
            <span>{formError}</span>
          </p>
        ) : null}

        <section aria-label="Barrier photo" className="flex flex-col gap-2">
          <PhotoCapture
            label="Photo of the barrier"
            hint="Use your camera or choose a photo. We resize it on your device before sending."
            onResized={handleResized}
            disabled={submitting}
          />
          {photo ? (
            <p className="flex items-start gap-2 text-success">
              <Check aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" />
              <span>Photo added.</span>
            </p>
          ) : null}
          {fieldErrors.photo ? (
            <p
              id={photoErrorId}
              role="alert"
              className="flex items-start gap-2 text-danger"
            >
              <TriangleAlert
                aria-hidden="true"
                className="mt-0.5 h-5 w-5 shrink-0"
              />
              <span>{fieldErrors.photo}</span>
            </p>
          ) : null}
        </section>

        <section
          aria-label="Barrier location"
          aria-describedby={fieldErrors.location ? locationErrorId : undefined}
          className="flex flex-col gap-4"
        >
          <div className="flex flex-col gap-1">
            <span className="font-bold">Where is the barrier?</span>
            <p className="text-[16px] text-muted">
              Use your current location, or enter the coordinates below.
            </p>
          </div>

          <Button
            variant="secondary"
            onClick={useMyLocation}
            loading={locating}
            loadingLabel="Getting your location"
            disabled={submitting}
            className="gap-2"
          >
            <MapPin aria-hidden="true" className="h-5 w-5 shrink-0" />
            <span>Use my location</span>
          </Button>

          <div className="flex gap-4">
            <div className="flex flex-1 flex-col gap-2">
              <label htmlFor={latId} className="font-bold">
                Latitude
              </label>
              <input
                id={latId}
                name="lat"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={latInput}
                disabled={submitting}
                onChange={(event) => {
                  setLatInput(event.target.value);
                  setFieldErrors((prev) => ({ ...prev, location: undefined }));
                }}
                aria-invalid={fieldErrors.location ? true : undefined}
                className="min-h-[56px] rounded-[12px] border border-control-border bg-surface px-3 text-ink"
              />
            </div>
            <div className="flex flex-1 flex-col gap-2">
              <label htmlFor={lngId} className="font-bold">
                Longitude
              </label>
              <input
                id={lngId}
                name="lng"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={lngInput}
                disabled={submitting}
                onChange={(event) => {
                  setLngInput(event.target.value);
                  setFieldErrors((prev) => ({ ...prev, location: undefined }));
                }}
                aria-invalid={fieldErrors.location ? true : undefined}
                className="min-h-[56px] rounded-[12px] border border-control-border bg-surface px-3 text-ink"
              />
            </div>
          </div>

          {fieldErrors.location ? (
            <p
              id={locationErrorId}
              role="alert"
              className="flex items-start gap-2 text-danger"
            >
              <TriangleAlert
                aria-hidden="true"
                className="mt-0.5 h-5 w-5 shrink-0"
              />
              <span>{fieldErrors.location}</span>
            </p>
          ) : null}
        </section>

        <section aria-label="Extra details" className="flex flex-col gap-2">
          <label htmlFor={messageId} className="font-bold">
            Anything else to add? (optional)
          </label>
          <textarea
            id={messageId}
            name="message"
            rows={3}
            value={message}
            disabled={submitting}
            onChange={(event) => setMessage(event.target.value)}
            className="min-h-[56px] rounded-[12px] border border-control-border bg-surface p-3 text-ink"
          />
        </section>

        <div className="mt-auto pt-8">
          <Button
            type="submit"
            fullWidth
            loading={submitting}
            loadingLabel="Reporting this barrier"
            disabled={!photo || !hasLocation}
            disabledReason={disabledReason}
          >
            Report this barrier
          </Button>
        </div>
      </form>
    </main>
  );
}
