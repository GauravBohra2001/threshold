"use client";

import { useCallback, useId, useState } from "react";
import { Scale, TriangleAlert } from "lucide-react";

import LiveRegion from "@/components/LiveRegion";
import RightsStatement from "@/components/RightsStatement";
import Banner from "@/components/ui/Banner";
import Button from "@/components/ui/Button";
import Panel from "@/components/ui/Panel";
import { rightsLibrary } from "@/lib/rights/library";

/**
 * Rights Card screen (ui-design.md hero screen "Rights Card"; Req 14).
 *
 * Shows one right at a time from the Rights_Library, inverted and large so it
 * can be held up to shelter staff, with a "Next right" button to move through
 * the deck. Only library entries are rendered; no statement or number is shown
 * without a corresponding library entry or live data source (Req 14.2). Each
 * statement meets the >=18px / >=4.5:1 baseline (Req 14.1, 23.5).
 *
 * The screen always shows "This is not legal advice." and an activatable link
 * to Mass 211 (Req 14.5). An accessible incident-logging form posts to
 * /api/incident; invalid submissions keep the entered values and show a
 * field-level error (Req 14.4), and a successful save is confirmed and
 * announced politely (Req 14.3, 23.9).
 */

const KIND_OPTIONS = [
  { value: "shelter_refusal", label: "A shelter turned me away" },
  { value: "service_animal", label: "A problem with my service animal" },
  { value: "communication", label: "A communication problem" },
  { value: "other", label: "Something else" },
] as const;

type IncidentKind = (typeof KIND_OPTIONS)[number]["value"];

const MASS_211_URL = "https://mass211.org";

const SUBMIT_FAILED_MESSAGE =
  "We could not save this incident right now. Please try again in a moment.";

interface FormValues {
  kind: IncidentKind | "";
  place: string;
  occurred_at: string;
  notes: string;
}

const EMPTY_FORM: FormValues = {
  kind: "",
  place: "",
  occurred_at: "",
  notes: "",
};

type SubmitState =
  | { state: "idle" }
  | { state: "saving" }
  | { state: "saved" }
  | { state: "error"; field?: string; message: string };

export default function RightsPage() {
  const rights = rightsLibrary;
  const total = rights.length;
  const [current, setCurrent] = useState(0);

  const [values, setValues] = useState<FormValues>(EMPTY_FORM);
  const [submit, setSubmit] = useState<SubmitState>({ state: "idle" });

  const kindId = useId();
  const placeId = useId();
  const occurredAtId = useId();
  const notesId = useId();
  const kindErrorId = useId();
  const placeErrorId = useId();
  const occurredAtErrorId = useId();

  const entry = total > 0 ? rights[current] : null;

  const showNextRight = useCallback(() => {
    if (total === 0) return;
    setCurrent((prev) => (prev + 1) % total);
  }, [total]);

  const fieldError = (field: string): string | null =>
    submit.state === "error" && submit.field === field ? submit.message : null;

  const kindError = fieldError("kind");
  const placeError = fieldError("place");
  const occurredAtError = fieldError("occurred_at");
  const generalError =
    submit.state === "error" && !submit.field ? submit.message : null;

  const handleSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
      event.preventDefault();
      setSubmit({ state: "saving" });
      try {
        const response = await fetch("/api/incident", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            kind: values.kind,
            place: values.place,
            occurred_at: values.occurred_at,
            notes: values.notes,
            // Tie the incident to the right currently shown, when any.
            right_id: entry?.id ?? null,
          }),
        });

        if (response.status === 201) {
          setSubmit({ state: "saved" });
          // Keep the entered values; the save is confirmed below.
          return;
        }

        let errorBody: { field?: string; message?: string } = {};
        try {
          errorBody = (await response.json()) as {
            field?: string;
            message?: string;
          };
        } catch {
          // Fall through to the generic fallback.
        }
        // Invalid submissions retain the entered values (we never clear the
        // form here) and show the field error (Req 14.4).
        setSubmit({
          state: "error",
          field: errorBody.field,
          message:
            typeof errorBody.message === "string" &&
            errorBody.message.trim().length > 0
              ? errorBody.message
              : SUBMIT_FAILED_MESSAGE,
        });
      } catch {
        setSubmit({ state: "error", message: SUBMIT_FAILED_MESSAGE });
      }
    },
    [values, entry],
  );

  const saving = submit.state === "saving";

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col px-5 py-8">
      <LiveRegion politeness="polite">
        {entry ? `Showing right ${current + 1} of ${total}.` : ""}
      </LiveRegion>

      <h1 className="text-[28px]">Your rights</h1>
      <p className="mt-2 text-[18px] text-muted">
        Show this screen to shelter staff. Use the button below to move through
        each one.
      </p>

      <section aria-label="Rights card" className="mt-6">
        {entry ? (
          <RightsStatement entry={entry} index={current + 1} total={total} />
        ) : (
          <p className="text-[18px]">No rights are available right now.</p>
        )}
      </section>

      {entry ? (
        <div className="mt-4">
          <Button fullWidth onClick={showNextRight}>
            Next right
          </Button>
        </div>
      ) : null}

      <section
        aria-label="This is not legal advice"
        className="mt-8 flex items-start gap-2 rounded-[18px] border border-line bg-surface p-4"
      >
        <Scale aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" />
        <p className="text-[18px] text-ink">
          This is not legal advice. For referrals, visit{" "}
          <a
            href={MASS_211_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-[44px] items-center text-accent underline underline-offset-4"
          >
            Mass 211
          </a>
          .
        </p>
      </section>

      <section aria-label="Log what happened" className="mt-8">
        <h2 className="text-[22px]">Log what happened</h2>
        <p className="mt-2 text-[18px] text-muted">
          Keep a record of a shelter refusal or another problem.
        </p>

        {submit.state === "saved" ? (
          <div className="mt-4">
            <Panel title="Incident saved">
              We saved this to your record. You can log another below.
            </Panel>
          </div>
        ) : null}

        {generalError ? (
          <div className="mt-4">
            <Banner title="We could not save this" alert>
              {generalError}
            </Banner>
          </div>
        ) : null}

        <form className="mt-4 flex flex-col gap-6" onSubmit={handleSubmit} noValidate>
          <div className="flex flex-col gap-2">
            <label htmlFor={kindId} className="text-[18px] font-bold">
              What happened?
            </label>
            <select
              id={kindId}
              value={values.kind}
              disabled={saving}
              aria-invalid={kindError ? true : undefined}
              aria-describedby={kindError ? kindErrorId : undefined}
              onChange={(event) =>
                setValues((prev) => ({
                  ...prev,
                  kind: event.target.value as IncidentKind,
                }))
              }
              className="min-h-[56px] w-full rounded-[12px] border border-control-border bg-surface p-3 text-[18px] text-ink"
            >
              <option value="">Choose one</option>
              {KIND_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            {kindError ? (
              <p
                id={kindErrorId}
                className="flex items-start gap-2 text-[18px] text-danger"
              >
                <TriangleAlert
                  aria-hidden="true"
                  className="mt-0.5 h-5 w-5 shrink-0"
                />
                <span>{kindError}</span>
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-2">
            <label htmlFor={placeId} className="text-[18px] font-bold">
              Where did it happen?
            </label>
            <input
              id={placeId}
              type="text"
              value={values.place}
              disabled={saving}
              aria-invalid={placeError ? true : undefined}
              aria-describedby={placeError ? placeErrorId : undefined}
              onChange={(event) =>
                setValues((prev) => ({ ...prev, place: event.target.value }))
              }
              className="min-h-[56px] w-full rounded-[12px] border border-control-border bg-surface p-3 text-[18px] text-ink"
            />
            {placeError ? (
              <p
                id={placeErrorId}
                className="flex items-start gap-2 text-[18px] text-danger"
              >
                <TriangleAlert
                  aria-hidden="true"
                  className="mt-0.5 h-5 w-5 shrink-0"
                />
                <span>{placeError}</span>
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-2">
            <label htmlFor={occurredAtId} className="text-[18px] font-bold">
              When did it happen?
            </label>
            <input
              id={occurredAtId}
              type="datetime-local"
              value={values.occurred_at}
              disabled={saving}
              aria-invalid={occurredAtError ? true : undefined}
              aria-describedby={occurredAtError ? occurredAtErrorId : undefined}
              onChange={(event) =>
                setValues((prev) => ({
                  ...prev,
                  occurred_at: event.target.value,
                }))
              }
              className="min-h-[56px] w-full rounded-[12px] border border-control-border bg-surface p-3 text-[18px] text-ink"
            />
            {occurredAtError ? (
              <p
                id={occurredAtErrorId}
                className="flex items-start gap-2 text-[18px] text-danger"
              >
                <TriangleAlert
                  aria-hidden="true"
                  className="mt-0.5 h-5 w-5 shrink-0"
                />
                <span>{occurredAtError}</span>
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-2">
            <label htmlFor={notesId} className="text-[18px] font-bold">
              Notes
            </label>
            <p className="text-[16px] text-muted">
              Add anything you want to remember. This is optional.
            </p>
            <textarea
              id={notesId}
              value={values.notes}
              disabled={saving}
              rows={4}
              onChange={(event) =>
                setValues((prev) => ({ ...prev, notes: event.target.value }))
              }
              className="w-full rounded-[12px] border border-control-border bg-surface p-3 text-[18px] text-ink"
            />
          </div>

          <Button
            type="submit"
            fullWidth
            loading={saving}
            loadingLabel="Saving"
          >
            Save this incident
          </Button>
        </form>
      </section>

      <LiveRegion politeness="polite">
        {submit.state === "saved" ? "Your incident was saved." : ""}
      </LiveRegion>
    </main>
  );
}
