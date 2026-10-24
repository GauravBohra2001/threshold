"use client";

import { Suspense, use, useId, useState } from "react";

import LiveRegion from "@/components/LiveRegion";
import PrimaryButton from "@/components/PrimaryButton";

/**
 * Caregiver invite-accept entry screen.
 *
 * Reads the invite `code` from the URL (the invite link is
 * `/status?code=<invite_code>`) and presents an accessible form that POSTs to
 * `POST /api/invite/accept` with `{ code, caregiver_name, caregiver_phone }`.
 * Field-level errors ({ field, message }) render next to the offending field
 * and the entered values are retained; the primary action is a full-width
 * PrimaryButton at the bottom (Req 23.4) with ≥44×44px targets (Req 23.3); a
 * polite aria-live region confirms acceptance (Req 23.9).
 *
 * This page later also shows live check-in status (task 22.2). It is kept
 * minimal and focused on invite acceptance here — no polling — and structured
 * so polling can be added as a sibling view driven by the same `household`
 * search param.
 *
 * Next 16: `searchParams` is a Promise; this client component reads it with
 * React's `use()` hook. Semantic HTML only; no clickable divs (Req 23.1).
 *
 * Built to WCAG 2.2 AA guidelines and tested with VoiceOver.
 * Requirements: 2.1, 2.2, 23.1, 23.3, 23.4, 23.9.
 */

/** The fields that can carry a field-level validation error. */
type FieldName = "caregiver_name" | "caregiver_phone";

interface CaregiverStatusPageProps {
  searchParams: Promise<{ code?: string | string[] }>;
}

const GENERIC_ERROR =
  "We couldn't accept this invite right now. Please try again in a moment.";

/** Normalize a search param that may arrive as a repeated value. */
function firstValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }
  return value ?? "";
}

function CaregiverStatusForm({
  searchParams,
}: CaregiverStatusPageProps) {
  // Next 16: unwrap the searchParams promise in a client component.
  const code = firstValue(use(searchParams).code).trim();

  const nameId = useId();
  const phoneId = useId();
  const nameErrorId = `${nameId}-error`;
  const phoneErrorId = `${phoneId}-error`;
  const formErrorId = useId();

  const [caregiverName, setCaregiverName] = useState("");
  const [caregiverPhone, setCaregiverPhone] = useState("");

  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<FieldName, string>>
  >({});
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [announcement, setAnnouncement] = useState("");

  async function handleSubmit(
    event: React.FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    if (submitting) {
      return;
    }

    setSubmitting(true);
    setFieldErrors({});
    setFormError("");
    setAnnouncement("");

    try {
      const response = await fetch("/api/invite/accept", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          code,
          caregiver_name: caregiverName,
          caregiver_phone: caregiverPhone,
        }),
      });

      // A 400 carries a field-level { field, message }; render it next to the
      // offending field and keep the entered values.
      if (response.status === 400) {
        const body = (await response.json()) as {
          field?: FieldName;
          message?: string;
        };
        if (
          body.field === "caregiver_name" ||
          body.field === "caregiver_phone"
        ) {
          setFieldErrors({
            [body.field]: body.message ?? "Please check this field.",
          });
        } else {
          setFormError(body.message ?? GENERIC_ERROR);
        }
        return;
      }

      // Invalid/used invite (404/409) or data store down (503) carry { message }.
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          message?: string;
        };
        setFormError(body.message ?? GENERIC_ERROR);
        return;
      }

      setAccepted(true);
      // Polite confirmation of the save (Req 23.9).
      setAnnouncement("Invite accepted.");
    } catch {
      setFormError(GENERIC_ERROR);
    } finally {
      setSubmitting(false);
    }
  }

  // Missing invite code: the link is incomplete, so there is nothing to accept.
  if (!code) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 py-8">
        <h1 className="text-2xl font-semibold">Caregiver invite</h1>
        <p
          role="alert"
          className="mt-4 rounded-lg border border-alert bg-surface p-3 text-alert"
        >
          This invite link is incomplete. Please use the full link the resident
          shared with you.
        </p>
      </main>
    );
  }

  // Success view: confirm acceptance.
  if (accepted) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 py-8">
        <LiveRegion politeness="polite">{announcement}</LiveRegion>
        <h1 className="text-2xl font-semibold">Invite accepted</h1>
        <p className="mt-4 text-muted-foreground">
          You are now set up as the caregiver. You will see check-in updates
          here.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 py-8">
      {/* Polite announcer so a screen reader hears the confirmation (Req 23.9). */}
      <LiveRegion politeness="polite">{announcement}</LiveRegion>

      <h1 className="text-2xl font-semibold">Accept caregiver invite</h1>
      <p className="mt-2 text-muted-foreground">
        Enter your name and phone number to be set up as the caregiver.
      </p>

      <form
        className="mt-8 flex flex-1 flex-col"
        onSubmit={handleSubmit}
        noValidate
        aria-describedby={formError ? formErrorId : undefined}
      >
        {formError ? (
          <p
            id={formErrorId}
            role="alert"
            className="mb-6 rounded-lg border border-alert bg-surface p-3 text-alert"
          >
            {formError}
          </p>
        ) : null}

        <div className="flex flex-col gap-2">
          <label htmlFor={nameId} className="text-lg font-medium">
            Your name
          </label>
          <input
            id={nameId}
            name="caregiver_name"
            type="text"
            autoComplete="name"
            required
            value={caregiverName}
            onChange={(event) => setCaregiverName(event.target.value)}
            aria-invalid={fieldErrors.caregiver_name ? true : undefined}
            aria-describedby={
              fieldErrors.caregiver_name ? nameErrorId : undefined
            }
            className="min-h-[44px] rounded-lg border border-border bg-background px-3 py-2 text-base"
          />
          {fieldErrors.caregiver_name ? (
            <p id={nameErrorId} className="text-alert">
              {fieldErrors.caregiver_name}
            </p>
          ) : null}
        </div>

        <div className="mt-6 flex flex-col gap-2">
          <label htmlFor={phoneId} className="text-lg font-medium">
            Your phone number
          </label>
          <input
            id={phoneId}
            name="caregiver_phone"
            type="tel"
            inputMode="numeric"
            autoComplete="tel"
            required
            value={caregiverPhone}
            onChange={(event) => setCaregiverPhone(event.target.value)}
            aria-invalid={fieldErrors.caregiver_phone ? true : undefined}
            aria-describedby={
              fieldErrors.caregiver_phone ? phoneErrorId : undefined
            }
            className="min-h-[44px] rounded-lg border border-border bg-background px-3 py-2 text-base"
          />
          {fieldErrors.caregiver_phone ? (
            <p id={phoneErrorId} className="text-alert">
              {fieldErrors.caregiver_phone}
            </p>
          ) : (
            <p className="text-muted-foreground">
              Digits only, 10 to 15 numbers.
            </p>
          )}
        </div>

        {/* Full-width primary action at the bottom of the screen (Req 23.4). */}
        <div className="mt-auto pt-8">
          <PrimaryButton type="submit" disabled={submitting}>
            {submitting ? "Accepting…" : "Accept invite"}
          </PrimaryButton>
        </div>
      </form>
    </main>
  );
}

/**
 * Page wrapper. Reading `searchParams` is a request-time access; under Cache
 * Components it must sit inside a <Suspense> boundary so the surrounding shell
 * can prerender while the search-param-dependent form streams in.
 */
export default function CaregiverStatusPage({
  searchParams,
}: CaregiverStatusPageProps) {
  return (
    <Suspense
      fallback={
        <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 py-8">
          <h1 className="text-2xl font-semibold">Caregiver invite</h1>
          <p className="mt-4 text-muted-foreground">Loading…</p>
        </main>
      }
    >
      <CaregiverStatusForm searchParams={searchParams} />
    </Suspense>
  );
}
