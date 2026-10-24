"use client";

import { Suspense, use, useId, useState } from "react";
import { TriangleAlert } from "lucide-react";

import LiveRegion from "@/components/LiveRegion";
import Button from "@/components/ui/Button";
import Panel from "@/components/ui/Panel";

/**
 * Caregiver invite-accept entry screen (ui-design.md).
 *
 * Reads the invite `code` from the URL and POSTs to POST /api/invite/accept.
 * Labels above 56px inputs, field errors below the field in --danger with an
 * icon, entered values retained; one full-width bottom primary action; polite
 * aria-live confirmation (Req 23.9). Live check-in status is a later P2 task.
 */

type FieldName = "caregiver_name" | "caregiver_phone";

interface CaregiverStatusPageProps {
  searchParams: Promise<{ code?: string | string[] }>;
}

const GENERIC_ERROR =
  "We couldn't accept this invite right now. Please try again in a moment.";

function firstValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function CaregiverStatusForm({ searchParams }: CaregiverStatusPageProps) {
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
    if (submitting) return;
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
      if (response.status === 400) {
        const body = (await response.json()) as {
          field?: FieldName;
          message?: string;
        };
        if (body.field === "caregiver_name" || body.field === "caregiver_phone") {
          setFieldErrors({ [body.field]: body.message ?? "Please check this field." });
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
      setAccepted(true);
      setAnnouncement("Invite accepted.");
    } catch {
      setFormError(GENERIC_ERROR);
    } finally {
      setSubmitting(false);
    }
  }

  if (!code) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col px-5 py-8">
        <h1 className="text-[28px]">Caregiver invite</h1>
        <p
          role="alert"
          className="mt-4 flex items-start gap-2 rounded-[18px] border border-danger bg-surface p-3 text-danger"
        >
          <TriangleAlert aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" />
          <span>
            This invite link is incomplete. Please use the full link the
            resident shared with you.
          </span>
        </p>
      </main>
    );
  }

  if (accepted) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col px-5 py-8">
        <LiveRegion politeness="polite">{announcement}</LiveRegion>
        <Panel title="Invite accepted">
          <p>You will see check-in updates here.</p>
        </Panel>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col px-5 py-8">
      <LiveRegion politeness="polite">{announcement}</LiveRegion>

      <h1 className="text-[28px]">Accept caregiver invite</h1>
      <p className="mt-2 text-muted">
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
            className="mb-6 flex items-start gap-2 rounded-[18px] border border-danger bg-surface p-3 text-danger"
          >
            <TriangleAlert aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" />
            <span>{formError}</span>
          </p>
        ) : null}

        <div className="flex flex-col gap-2">
          <label htmlFor={nameId} className="font-bold">
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
            aria-describedby={fieldErrors.caregiver_name ? nameErrorId : undefined}
            className="min-h-[56px] rounded-[12px] border border-control-border bg-surface px-3 text-ink"
          />
          {fieldErrors.caregiver_name ? (
            <p id={nameErrorId} className="flex items-start gap-2 text-danger">
              <TriangleAlert aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" />
              <span>{fieldErrors.caregiver_name}</span>
            </p>
          ) : null}
        </div>

        <div className="mt-6 flex flex-col gap-2">
          <label htmlFor={phoneId} className="font-bold">
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
            className="min-h-[56px] rounded-[12px] border border-control-border bg-surface px-3 text-ink"
          />
          {fieldErrors.caregiver_phone ? (
            <p id={phoneErrorId} className="flex items-start gap-2 text-danger">
              <TriangleAlert aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" />
              <span>{fieldErrors.caregiver_phone}</span>
            </p>
          ) : (
            <p className="text-[16px] text-muted">Digits only, 10 to 15 numbers.</p>
          )}
        </div>

        <div className="mt-auto pt-8">
          <Button
            type="submit"
            fullWidth
            loading={submitting}
            loadingLabel="Accepting invite"
          >
            Accept invite
          </Button>
        </div>
      </form>
    </main>
  );
}

export default function CaregiverStatusPage({
  searchParams,
}: CaregiverStatusPageProps) {
  return (
    <Suspense
      fallback={
        <main className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col px-5 py-8">
          <h1 className="text-[28px]">Caregiver invite</h1>
          <p className="mt-4 text-muted">Loading</p>
        </main>
      }
    >
      <CaregiverStatusForm searchParams={searchParams} />
    </Suspense>
  );
}
