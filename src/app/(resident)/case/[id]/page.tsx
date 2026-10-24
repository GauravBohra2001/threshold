"use client";
"use client";

import { Suspense, use, useCallback, useEffect, useId, useRef, useState } from "react";
import { CircleCheck, FileText, Info, TriangleAlert } from "lucide-react";

import LiveRegion from "@/components/LiveRegion";
import Button from "@/components/ui/Button";
import Panel from "@/components/ui/Panel";
import ProcessTrace, { type ProcessStep } from "@/components/ui/ProcessTrace";

/**
 * Case detail screen: live Case Agent trace, draft approval gate, and BOS:311
 * handoff (ui-design.md hero screen "Case Agent trace"; design P2 section e).
 *
 * Flow and guarantees:
 *  - Reads GET /api/case/[id]; while the run is still investigating it polls a
 *    few times so the streaming trace appears step by step (Req 5.3). Each new
 *    step is announced politely via an aria-live region.
 *  - The trace is rendered with ui/ProcessTrace. NOTE: task 16.1 owns a reusable
 *    src/components/TraceView.tsx; once that exists, swap the inline ProcessTrace
 *    rendering below for `<TraceView trace={...} />`. This file does not create
 *    TraceView (16.1 owns it); ProcessTrace here is the interim fallback.
 *  - When the agent has produced a draft, the FULL draft text is shown in an
 *    approval card with a full-width primary "Approve draft" button. Nothing is
 *    marked ready without this explicit action — even if the resident said
 *    "just submit it" (Req 7.1, 7.2). Declining is simply not approving; the
 *    draft is retained (Req 7.3). Approval POSTs to /api/case/[id]/approve and
 *    shows a confirmation Panel ("Draft approved").
 *  - At draft_ready (and after), a one-tap "Open BOS:311" control opens the
 *    BOS:311 site and a ≥44×44px labeled input lets the resident paste the city
 *    case number. "Save case number" POSTs to /api/case/[id]/city-number; an
 *    invalid number shows a field-level error (Req 7.4, 7.6). Nothing is ever
 *    submitted to a government system automatically (Req 7.7).
 *
 * Semantic HTML, ≥44px targets, a single full-width bottom primary action, and
 * a polite LiveRegion for status (Req 23.1, 23.3, 23.4, 23.9).
 */

/** BOS:311 report entry point for the resident to file themselves (Req 7.7). */
const BOS_311_URL = "https://311.boston.gov/";

/** Statuses at or past which the draft is treated as produced/ready. */
const DRAFT_PRODUCED = new Set(["draft_ready", "waiting", "escalated", "resolved"]);

const LOAD_ERROR_MESSAGE =
  "This case could not be loaded right now. Please try again in a moment.";
const APPROVE_ERROR_MESSAGE =
  "We could not approve this draft right now. Please try again in a moment.";
const SAVE_ERROR_MESSAGE =
  "We could not save that number right now. Please try again in a moment.";

/** One trace step as returned by GET /api/case/[id] (shape from agent/trace.ts). */
interface TraceStepView {
  step: number;
  tool: string;
  input_summary: string;
  observation_summary: string;
  reasoning_note: string;
  at: string;
}

/** The case view returned by GET /api/case/[id]. */
interface CaseView {
  id: string;
  barrier_type: string;
  description: string;
  route: string | null;
  status: string;
  city_case_id: string | null;
  opened_at: string;
  clock_due_at: string | null;
  trace: TraceStepView[];
  /** Full draft text, when the server surfaces it. */
  draft_text?: string | null;
}

type LoadState =
  | { state: "loading" }
  | { state: "ready"; data: CaseView }
  | { state: "error" };

type ApproveState =
  | { state: "idle" }
  | { state: "approving" }
  | { state: "approved" }
  | { state: "error"; message: string };

type SaveState =
  | { state: "idle" }
  | { state: "saving" }
  | { state: "saved"; number: string }
  | { state: "error"; message: string };

const BARRIER_LABELS: Record<string, string> = {
  blocked_sidewalk: "Blocked sidewalk",
  broken_sidewalk: "Broken sidewalk",
  missing_curb_ramp: "Missing curb ramp",
  other: "Barrier",
};

function barrierLabel(barrierType: string): string {
  return BARRIER_LABELS[barrierType] ?? "Barrier";
}

/** Maps a trace step to a ProcessTrace step, marking the latest as current. */
function toProcessSteps(trace: TraceStepView[], done: boolean): ProcessStep[] {
  const ordered = [...trace].sort((a, b) => a.step - b.step);
  return ordered.map((step, index) => {
    const isLast = index === ordered.length - 1;
    const state: ProcessStep["state"] =
      done || !isLast ? "finished" : "current";
    const chips: string[] = [];
    if (step.observation_summary.trim().length > 0) {
      chips.push(step.observation_summary.trim());
    }
    return {
      sentence: step.input_summary.trim() || step.tool.replace(/_/g, " "),
      chips: chips.length > 0 ? chips : undefined,
      state,
    };
  });
}

/**
 * Finds the full draft text to show on the approval card. Prefers an explicit
 * `draft_text` field; otherwise falls back to the richest plain-language text
 * the trace carries for the drafting/approval steps so the resident always sees
 * what the agent prepared.
 */
function draftTextFrom(data: CaseView): string | null {
  if (typeof data.draft_text === "string" && data.draft_text.trim().length > 0) {
    return data.draft_text.trim();
  }
  const draftingStep = [...data.trace]
    .sort((a, b) => b.step - a.step)
    .find(
      (step) => step.tool === "draft_filing" || step.tool === "request_approval",
    );
  if (!draftingStep) return null;
  const parts = [
    draftingStep.input_summary.trim(),
    draftingStep.observation_summary.trim(),
    draftingStep.reasoning_note.trim(),
  ].filter((part) => part.length > 0);
  return parts.length > 0 ? parts.join("\n\n") : null;
}

function politeStatus(load: LoadState): string {
  if (load.state === "loading") return "Loading your report.";
  if (load.state === "error") return LOAD_ERROR_MESSAGE;
  const stepCount = load.data.trace.length;
  if (load.data.status === "investigating") {
    return stepCount === 0
      ? "Threshold is looking into your report."
      : `Threshold has taken ${stepCount} ${stepCount === 1 ? "step" : "steps"} so far.`;
  }
  if (load.data.status === "draft_ready") {
    return "A draft is ready for you to review and approve.";
  }
  if (load.data.status === "waiting") {
    return "Your city case number is saved. Threshold is tracking this case.";
  }
  if (load.data.status === "asked_user") {
    return "Threshold has a question about your report.";
  }
  if (load.data.status === "escalated") {
    return "Threshold has prepared an escalation for you to review.";
  }
  if (load.data.status === "resolved") {
    return "This case is resolved.";
  }
  return "";
}

interface CasePageProps {
  params: Promise<{ id: string }>;
}

function CaseDetail({ params }: CasePageProps) {
  // Next 16: route params are a Promise; unwrap with React use() in a client
  // page. `use(params)` suspends until params resolve; the Suspense boundary in
  // the default export streams a placeholder meanwhile (Next 16 Cache
  // Components: data access must sit under <Suspense>).
  const { id } = use(params);

  const [load, setLoad] = useState<LoadState>({ state: "loading" });
  const [approve, setApprove] = useState<ApproveState>({ state: "idle" });
  const [cityNumber, setCityNumber] = useState("");
  const [editedDraft, setEditedDraft] = useState<string | null>(null);
  const [save, setSave] = useState<SaveState>({ state: "idle" });
  const [fieldError, setFieldError] = useState<string>("");

  const numberInputId = useId();
  const numberErrorId = `${numberInputId}-error`;
  const numberHelpId = `${numberInputId}-help`;

  // Poll budget so the streaming trace appears while the run is investigating.
  const pollsLeft = useRef(10);

  const fetchCase = useCallback(async (): Promise<LoadState> => {
    try {
      const response = await fetch(`/api/case/${encodeURIComponent(id)}`, {
        method: "GET",
        headers: { accept: "application/json" },
        cache: "no-store",
      });
      if (!response.ok) return { state: "error" };
      const data = (await response.json()) as CaseView;
      return { state: "ready", data };
    } catch {
      return { state: "error" };
    }
  }, [id]);

  const reload = useCallback(() => {
    pollsLeft.current = 10;
    setLoad({ state: "loading" });
    void fetchCase().then(setLoad);
  }, [fetchCase]);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      const next = await fetchCase();
      if (!active) return;
      setLoad(next);
      // Keep polling only while the run is still investigating (streaming trace).
      const investigating =
        next.state === "ready" && next.data.status === "investigating";
      if (investigating && pollsLeft.current > 0) {
        pollsLeft.current -= 1;
        timer = setTimeout(() => {
          void tick();
        }, 3000);
      }
    };

    void tick();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [fetchCase]);

  const handleApprove = useCallback(async () => {
    if (approve.state === "approving") return;
    setApprove({ state: "approving" });
    try {
      const response = await fetch(
        `/api/case/${encodeURIComponent(id)}/approve`,
        {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({ draft: editedDraft ?? draftText ?? "" }),
        },
      );
      if (!response.ok) {
        setApprove({ state: "error", message: APPROVE_ERROR_MESSAGE });
        return;
      }
      setApprove({ state: "approved" });
      // Refresh so the handoff controls (Open BOS:311 + number input) appear.
      void fetchCase().then((next) => {
        if (next.state === "ready") setLoad(next);
      });
    } catch {
      setApprove({ state: "error", message: APPROVE_ERROR_MESSAGE });
    }
  }, [approve.state, fetchCase, id]);

  const handleSaveNumber = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (save.state === "saving") return;
      setSave({ state: "saving" });
      setFieldError("");
      try {
        const response = await fetch(
          `/api/case/${encodeURIComponent(id)}/city-number`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ city_case_id: cityNumber }),
          },
        );
        if (response.status === 400) {
          const body = (await response.json().catch(() => ({}))) as {
            message?: string;
          };
          setFieldError(
            body.message ??
              "Enter the city case number. It is required and must be 100 characters or fewer.",
          );
          setSave({ state: "idle" });
          return;
        }
        if (!response.ok) {
          setSave({ state: "error", message: SAVE_ERROR_MESSAGE });
          return;
        }
        const body = (await response.json()) as { city_case_id?: string };
        const saved = body.city_case_id ?? cityNumber.trim();
        setSave({ state: "saved", number: saved });
        void fetchCase().then((next) => {
          if (next.state === "ready") setLoad(next);
        });
      } catch {
        setSave({ state: "error", message: SAVE_ERROR_MESSAGE });
      }
    },
    [cityNumber, fetchCase, id, save.state],
  );

  if (load.state === "loading") {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col px-5 py-8">
        <LiveRegion politeness="polite">Loading your report.</LiveRegion>
        <h1 className="text-[28px]">Your report</h1>
        <p role="status" className="mt-4 text-muted">
          Loading
        </p>
      </main>
    );
  }

  if (load.state === "error") {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col px-5 py-8">
        <LiveRegion politeness="polite">{LOAD_ERROR_MESSAGE}</LiveRegion>
        <h1 className="text-[28px]">Your report</h1>
        <p
          role="alert"
          className="mt-4 flex items-start gap-2 rounded-[18px] border border-danger bg-surface p-3 text-danger"
        >
          <TriangleAlert aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" />
          <span>{LOAD_ERROR_MESSAGE}</span>
        </p>
        <div className="mt-auto pt-8">
          <Button variant="secondary" fullWidth onClick={reload}>
            Try again
          </Button>
        </div>
      </main>
    );
  }

  const data = load.data;
  const investigating = data.status === "investigating";
  const draftProduced = DRAFT_PRODUCED.has(data.status);
  const draftText = draftTextFrom(data);
  const showApprovalCard = data.status === "draft_ready" && draftText !== null;
  const showHandoff = draftProduced;
  const steps = toProcessSteps(data.trace, !investigating);
  const savedNumber =
    data.city_case_id ?? (save.state === "saved" ? save.number : null);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col px-5 py-8">
      <LiveRegion politeness="polite">{politeStatus(load)}</LiveRegion>

      <h1 className="text-[28px]">{barrierLabel(data.barrier_type)} report</h1>
      {data.description.trim().length > 0 ? (
        <p className="mt-2 text-muted">{data.description}</p>
      ) : null}

      {/*
        Live Case Agent trace. Interim rendering with ui/ProcessTrace; task 16.1
        owns src/components/TraceView.tsx — swap this block for <TraceView /> once
        that component exists. Each step is announced politely via the LiveRegion
        above (Req 5.3, 23.9).
      */}
      <section aria-label="What Threshold is doing" className="mt-8">
        <h2 className="text-[22px]">What Threshold is doing</h2>
        {steps.length === 0 ? (
          <p role="status" className="mt-3 text-muted">
            Threshold is looking into your report
          </p>
        ) : (
          <div className="mt-4">
            <ProcessTrace steps={steps} label="Case Agent steps" />
          </div>
        )}
        {investigating && steps.length > 0 ? (
          <p role="status" className="mt-4 text-muted">
            Still working
          </p>
        ) : null}
      </section>

      {/* Approval gate: the full draft, retained until explicit approval (Req 7.1–7.3). */}
      {showApprovalCard && approve.state !== "approved" ? (
        <section aria-label="Draft to approve" className="mt-8">
          <h2 className="text-[22px]">Review the draft</h2>
          <p className="mt-2 text-muted">
            Nothing is sent until you approve it. You decide.
          </p>
          <article className="mt-4 rounded-[18px] border border-line bg-surface p-5">
            <h3 className="flex items-center gap-2 text-[18px]">
              <FileText aria-hidden="true" className="h-5 w-5 shrink-0" />
              <span>Your draft</span>
            </h3>
            <p className="mt-2 text-[16px] text-muted">
              Read it over and edit anything before you approve. Nothing is sent
              until you approve it.
            </p>
            <label htmlFor="draft-editor" className="sr-only">
              Draft text
            </label>
            <textarea
              id="draft-editor"
              className="mt-3 min-h-[200px] w-full whitespace-pre-wrap rounded-[12px] border border-control-border bg-bg p-3 text-ink"
              value={editedDraft ?? draftText ?? ""}
              onChange={(event) => setEditedDraft(event.target.value)}
            />
          </article>

          {approve.state === "error" ? (
            <p
              role="alert"
              className="mt-4 flex items-start gap-2 rounded-[18px] border border-danger bg-surface p-3 text-danger"
            >
              <TriangleAlert
                aria-hidden="true"
                className="mt-0.5 h-5 w-5 shrink-0"
              />
              <span>{approve.message}</span>
            </p>
          ) : null}
        </section>
      ) : null}

      {/* Confirmation after approval (ui-design.md: "Approve draft" → "Draft approved"). */}
      {approve.state === "approved" ? (
        <section aria-label="Draft approved" className="mt-8">
          <LiveRegion politeness="polite">Draft approved.</LiveRegion>
          <Panel title="Draft approved">
            <p>Next, file it with BOS:311 and paste the case number below.</p>
          </Panel>
        </section>
      ) : null}

      {/* City handoff: open BOS:311 + paste the city case number (Req 7.4–7.6). */}
      {showHandoff ? (
        <section aria-label="File with BOS:311" className="mt-8">
          <h2 className="text-[22px]">File with BOS:311</h2>
          <p className="mt-2 text-muted">
            Open BOS:311, submit your report, then paste the case number here so
            Threshold can track it.
          </p>

          <a
            href={BOS_311_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 inline-flex min-h-[44px] items-center justify-center rounded-[14px] border border-accent bg-surface px-6 font-bold text-[18px] text-accent transition-colors duration-100 hover:bg-bg active:brightness-95"
          >
            Open BOS:311
          </a>

          {savedNumber ? (
            <p className="mt-6 flex items-start gap-2 text-success">
              <CircleCheck aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" />
              <span>City case number saved: {savedNumber}</span>
            </p>
          ) : null}

          <form className="mt-6 flex flex-col gap-2" onSubmit={handleSaveNumber} noValidate>
            <label htmlFor={numberInputId} className="font-bold">
              City case number
            </label>
            <p id={numberHelpId} className="text-[16px] text-muted">
              Copy the number BOS:311 gives you and paste it here.
            </p>
            <input
              id={numberInputId}
              name="city_case_id"
              type="text"
              inputMode="numeric"
              value={cityNumber}
              onChange={(event) => setCityNumber(event.target.value)}
              aria-invalid={fieldError ? true : undefined}
              aria-describedby={
                fieldError ? numberErrorId : numberHelpId
              }
              className="min-h-[56px] rounded-[12px] border border-control-border bg-surface px-3 text-ink"
            />
            {fieldError ? (
              <p id={numberErrorId} className="flex items-start gap-2 text-danger">
                <TriangleAlert
                  aria-hidden="true"
                  className="mt-0.5 h-5 w-5 shrink-0"
                />
                <span>{fieldError}</span>
              </p>
            ) : null}

            {save.state === "error" ? (
              <p
                role="alert"
                className="mt-2 flex items-start gap-2 rounded-[18px] border border-danger bg-surface p-3 text-danger"
              >
                <TriangleAlert
                  aria-hidden="true"
                  className="mt-0.5 h-5 w-5 shrink-0"
                />
                <span>{save.message}</span>
              </p>
            ) : null}

            <div className="mt-6">
              <Button
                type="submit"
                variant="secondary"
                fullWidth
                loading={save.state === "saving"}
                loadingLabel="Saving case number"
              >
                Save case number
              </Button>
            </div>
          </form>
        </section>
      ) : null}

      {/* Asked-user state: the agent paused with a question (Req 5.4). */}
      {data.status === "asked_user" ? (
        <section aria-label="Threshold has a question" className="mt-8">
          <p className="flex items-start gap-2 rounded-[18px] border border-line bg-surface p-3">
            <Info aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" />
            <span>
              Threshold has a question about your report. Check the steps above
              for what it needs.
            </span>
          </p>
        </section>
      ) : null}

      {/* The single full-width bottom primary action is "Approve draft" when a
          draft is awaiting approval (Req 23.4). */}
      {showApprovalCard && approve.state !== "approved" ? (
        <div className="mt-auto pt-8">
          <Button
            fullWidth
            onClick={handleApprove}
            loading={approve.state === "approving"}
            loadingLabel="Approving draft"
          >
            Approve draft
          </Button>
        </div>
      ) : null}
    </main>
  );
}

export default function CasePage({ params }: CasePageProps) {
  return (
    <Suspense
      fallback={
        <main className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col px-5 py-8">
          <h1 className="text-[28px]">Your report</h1>
          <p role="status" className="mt-4 text-muted">
            Loading
          </p>
        </main>
      }
    >
      <CaseDetail params={params} />
    </Suspense>
  );
}
