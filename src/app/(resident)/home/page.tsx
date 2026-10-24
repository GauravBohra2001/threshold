"use client";

import { useId, useState } from "react";
import { TriangleAlert } from "lucide-react";

import LiveRegion from "@/components/LiveRegion";
import Button from "@/components/ui/Button";
import Panel from "@/components/ui/Panel";

/**
 * Resident household-create screen (ui-design.md).
 *
 * An accessible form that POSTs to POST /api/household. Labels sit above 56px
 * inputs; field errors render below the field in --danger with an icon and
 * text, linked via aria-describedby; entered values are retained on error
 * (Req 1.3). The one primary action is a full-width button at the bottom
 * (Req 23.4). Success shows a confirmation Panel plus the caregiver invite
 * link, announced politely (Req 23.9).
 */

interface HouseholdCreated {
  id: string;
  resident_name: string;
  invite_url: string;
}

type FieldName = "resident_name" | "address";

const GENERIC_ERROR =
  "We couldn't create your household right now. Please try again in a moment.";

export default function ResidentHomePage() {
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
    if (submitting) return;
    setSubmitting(true);
    setFieldErrors({});
    setFormError("");
    setAnnouncement("");
    try {
      const response = await fetch("/api/household", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ resident_name: residentName, address }),
      });
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
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          message?: string;
        };
        setFormError(body.message ?? GENERIC_ERROR);
        return;
      }
      const household = (await response.json()) as HouseholdCreated;
      setCreated(household);
      setAnnouncement("Household created.");
    } catch {
      setFormError(GENERIC_ERROR);
    } finally {
      setSubmitting(false);
    }
  }

  if (created) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col px-5 py-8">
        <LiveRegion politeness="polite">{announcement}</LiveRegion>
        <Panel title="Household created">
          <p>Share this link with your caregiver.</p>
        </Panel>
        <div className="mt-6 rounded-[18px] border border-line bg-surface p-4">
          <h2 className="text-[22px]">Caregiver invite link</h2>
          <p className="mt-2 break-words">
            <a href={created.invite_url} className="text-accent underline">
              {created.invite_url}
            </a>
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col px-5 py-8">
      <LiveRegion politeness="polite">{announcement}</LiveRegion>

      <h1 className="text-[28px]">Create your household</h1>
      <p className="mt-2 text-muted">
        Tell us who you are and where you live. You can invite a caregiver next.
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
            name="resident_name"
            type="text"
            autoComplete="name"
            required
            value={residentName}
            onChange={(event) => setResidentName(event.target.value)}
            aria-invalid={fieldErrors.resident_name ? true : undefined}
            aria-describedby={fieldErrors.resident_name ? nameErrorId : undefined}
            className="min-h-[56px] rounded-[12px] border border-control-border bg-surface px-3 text-ink"
          />
          {fieldErrors.resident_name ? (
            <p id={nameErrorId} className="flex items-start gap-2 text-danger">
              <TriangleAlert aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" />
              <span>{fieldErrors.resident_name}</span>
            </p>
          ) : null}
        </div>

        <div className="mt-6 flex flex-col gap-2">
          <label htmlFor={addressId} className="font-bold">
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
            className="min-h-[56px] rounded-[12px] border border-control-border bg-surface px-3 text-ink"
          />
          {fieldErrors.address ? (
            <p id={addressErrorId} className="flex items-start gap-2 text-danger">
              <TriangleAlert aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" />
              <span>{fieldErrors.address}</span>
            </p>
          ) : null}
        </div>

        <div className="mt-auto pt-8">
          <Button
            type="submit"
            fullWidth
            loading={submitting}
            loadingLabel="Creating household"
          >
            Create household
          </Button>
        </div>
      </form>
    </main>
  );
}
