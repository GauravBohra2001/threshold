"use client";

import { useId, useState } from "react";

import LiveRegion from "@/components/LiveRegion";
import PrimaryButton from "@/components/PrimaryButton";

/**
 * Resident household-create screen.
 *
 * An accessible form that POSTs to `POST /api/household` with
 * `{ resident_name, address }`. It uses real <label>s tied to each input,
 * renders field-level errors ({ field, message }) next to the offending field,
 * retains the entered values on error (Req 1.3), places the primary action as a
 * full-width PrimaryButton at the bottom of the screen (Req 23.4) with ≥44×44px
 * targets (Req 23.3), and announces success via a polite aria-live region
 * (Req 23.9). On success it shows the caregiver invite link returned by the API.
 *
 * Semantic HTML only — real <form>, <label>, <input>, <button>; no clickable
 * divs (Req 23.1). This is a client component because it owns form state and
 * calls the server route handler (the only data boundary).
 *
 * Built to WCAG 2.2 AA guidelines and tested with VoiceOver.
 * Requirements: 1.3, 2.1, 23.1, 23.3, 23.4, 23.9.
 */

/** A created household, as returned by `POST /api/household` (201). */
interface HouseholdCreated {
  id: string;
  resident_name: string;
  address: string;
  neighborhood: string | null;
  caregiver_name: string | null;
  invite_code: string;
  invite_url: string;
}

/** The two fields that can carry a field-level validation error. */
type FieldName = "resident_name" | "address";

const GENERIC_ERROR =
  "We couldn't create your household right now. Please try again in a moment.";

export default function ResidentHomePage() {
  // Stable ids so each <label> is tied to its input and each error is wired
  // through aria-describedby for screen readers.
  const nameId = useId();
  const addressId = useId();
  const nameErrorId = `${nameId}-error`;
  const addressErrorId = `${addressId}-error`;
  const formErrorId = useId();

  const [residentName, setResidentName] = useState("");
  const [address, setAddress] = useState("");

  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<FieldName, string>>
  >({});
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<HouseholdCreated | null>(null);
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
      const response = await fetch("/api/household", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // Entered values stay in state regardless of the outcome (Req 1.3).
        body: JSON.stringify({
          resident_name: residentName,
          address,
        }),
      });

      // A 400 carries a field-level { field, message }; render it next to the
      // offending field and keep the entered values (Req 1.3).
      if (response.status === 400) {
        const body = (await response.json()) as {
          field?: FieldName;
          message?: string;
        };
        if (body.field === "resident_name" || body.field === "address") {
          setFieldErrors({ [body.field]: body.message ?? "Please check this field." });
        } else {
          setFormError(body.message ?? GENERIC_ERROR);
        }
        return;
      }

      // Any other non-success status carries a plain-language { message }.
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          message?: string;
        };
        setFormError(body.message ?? GENERIC_ERROR);
        return;
      }

      const household = (await response.json()) as HouseholdCreated;
      setCreated(household);
      // Polite announcement of success (Req 23.9).
      setAnnouncement("Household created.");
    } catch {
      setFormError(GENERIC_ERROR);
    } finally {
      setSubmitting(false);
    }
  }

  // Success view: confirm and surface the caregiver invite link.
  if (created) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 py-8">
        <LiveRegion politeness="polite">{announcement}</LiveRegion>
        <h1 className="text-2xl font-semibold">Household created</h1>
        <p className="mt-4 text-muted-foreground">
          Share this link with your caregiver so they can accept the invite.
        </p>
        <div className="mt-6 rounded-lg border border-border bg-surface p-4">
          <h2 className="text-lg font-semibold">Caregiver invite link</h2>
          <p className="mt-2 break-words">
            <a href={created.invite_url} className="font-medium text-primary underline">
              {created.invite_url}
            </a>
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 py-8">
      {/* Polite announcer so a screen reader hears confirmations (Req 23.9). */}
      <LiveRegion politeness="polite">{announcement}</LiveRegion>

      <h1 className="text-2xl font-semibold">Create your household</h1>
      <p className="mt-2 text-muted-foreground">
        Tell us who you are and where you live. You can invite a caregiver next.
      </p>

      <form
        className="mt-8 flex flex-1 flex-col"
        onSubmit={handleSubmit}
        noValidate
        aria-describedby={formError ? formErrorId : undefined}
      >
        {/* Form-level error (e.g. geocoder down, save failed). */}
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
            name="resident_name"
            type="text"
            autoComplete="name"
            required
            value={residentName}
            onChange={(event) => setResidentName(event.target.value)}
            aria-invalid={fieldErrors.resident_name ? true : undefined}
            aria-describedby={
              fieldErrors.resident_name ? nameErrorId : undefined
            }
            className="min-h-[44px] rounded-lg border border-border bg-background px-3 py-2 text-base"
          />
          {fieldErrors.resident_name ? (
            <p id={nameErrorId} className="text-alert">
              {fieldErrors.resident_name}
            </p>
          ) : null}
        </div>

        <div className="mt-6 flex flex-col gap-2">
          <label htmlFor={addressId} className="text-lg font-medium">
            Home address
          </label>
          <input
            id={addressId}
            name="address"
            type="text"
            autoComplete="street-address"
            required
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            aria-invalid={fieldErrors.address ? true : undefined}
            aria-describedby={fieldErrors.address ? addressErrorId : undefined}
            className="min-h-[44px] rounded-lg border border-border bg-background px-3 py-2 text-base"
          />
          {fieldErrors.address ? (
            <p id={addressErrorId} className="text-alert">
              {fieldErrors.address}
            </p>
          ) : null}
        </div>

        {/* Full-width primary action at the bottom of the screen (Req 23.4). */}
        <div className="mt-auto pt-8">
          <PrimaryButton type="submit" disabled={submitting}>
            {submitting ? "Creating…" : "Create household"}
          </PrimaryButton>
        </div>
      </form>
    </main>
  );
}
