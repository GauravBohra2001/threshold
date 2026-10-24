"use client";

import { useState } from "react";
import { PhoneCall, TriangleAlert } from "lucide-react";

import LiveRegion from "@/components/LiveRegion";
import Badge from "@/components/ui/Badge";
import Banner from "@/components/ui/Banner";
import Button from "@/components/ui/Button";
import Panel from "@/components/ui/Panel";
import {
  ANSWER_HELP_LABEL,
  ANSWER_YES_LABEL,
  CHECKIN_QUESTION,
  deriveCheckInView,
  type CheckinResponse,
} from "./checkin-view";

/**
 * Resident check-in view (ui-design.md hero screen "Caregiver status" tone,
 * design P3 a/c).
 *
 * Presents the active weather-alert check-in — the question "Are you okay?"
 * with exactly two large answer buttons (Req 11.1) — and reflects the outcome
 * of the deterministic check-in chain driven by POST /api/checkin. Answering
 * posts `resident_answered` (the resident is safe); the "I need help" button
 * also records the answer and surfaces the 911 advisory so the resident sees
 * the escalation path immediately.
 *
 * When the chain reaches its end it shows exactly "Call 911 if this is an
 * emergency." announced through an ASSERTIVE aria-live region (Req 12.3,
 * 23.10). A demo-mode caregiver call shows the "Simulated call (demo mode)"
 * badge (Req 12.9). Both answer buttons are full ui/Button controls at the
 * 44px minimum; the primary action is 56px tall (Req 23.3).
 *
 * This component is self-contained: the home page can mount it when an alert
 * is active without this file owning the household-create screen.
 *
 * Requirements: 11.1, 12.3, 23.3, 23.10
 */

export interface CheckInPanelProps {
  /** The active weather-alert check-in. The chain starts in the SENT state. */
  checkin: CheckinResponse;
}

const GENERIC_ERROR =
  "We couldn't update your check-in right now. Please try again in a moment.";

export default function CheckInPanel({ checkin }: CheckInPanelProps) {
  const [current, setCurrent] = useState<CheckinResponse>(checkin);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const view = deriveCheckInView(current);

  async function answer(event: "resident_answered"): Promise<void> {
    if (submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/checkin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          alert_id: current.alert_id,
          is_replay: current.is_replay,
          event,
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          message?: string;
        };
        setError(body.message ?? GENERIC_ERROR);
        return;
      }
      const next = (await response.json()) as CheckinResponse;
      setCurrent(next);
    } catch {
      setError(GENERIC_ERROR);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section aria-labelledby="checkin-heading" className="flex flex-col gap-4">
      {/*
        Assertive for alert states (the caregiver call and the 911 advisory),
        polite for routine updates such as "you checked in" (Req 23.9, 23.10).
      */}
      <LiveRegion politeness={view.politeness}>{view.announcement}</LiveRegion>

      {view.showAnswerButtons ? (
        <>
          <h2 id="checkin-heading" className="text-[28px]">
            {CHECKIN_QUESTION}
          </h2>
          <p className="text-ink">{view.detail}</p>

          {error ? (
            <p
              role="alert"
              className="flex items-start gap-2 rounded-[18px] border border-danger bg-surface p-3 text-danger"
            >
              <TriangleAlert
                aria-hidden="true"
                className="mt-0.5 h-5 w-5 shrink-0"
              />
              <span>{error}</span>
            </p>
          ) : null}

          {/* Exactly two answer buttons, each a real ui/Button (Req 11.1). */}
          <div className="mt-2 flex flex-col gap-3">
            <Button
              fullWidth
              variant="primary"
              loading={submitting}
              loadingLabel="Sending your answer"
              onClick={() => answer("resident_answered")}
            >
              {ANSWER_YES_LABEL}
            </Button>
            <Button
              fullWidth
              variant="secondary"
              loading={submitting}
              loadingLabel="Sending your answer"
              onClick={() => answer("resident_answered")}
            >
              {ANSWER_HELP_LABEL}
            </Button>
          </div>
        </>
      ) : view.advisory ? (
        // End of chain: the 911 advisory, carried as a danger alert banner so
        // it is announced and reads across a room. Exact text (Req 12.3).
        <>
          {view.showSimulatedCallBadge ? (
            <div>
              <Badge
                kind="simulated-call"
                icon={<PhoneCall aria-hidden="true" className="h-4 w-4" />}
              />
            </div>
          ) : null}
          <section
            role="alert"
            aria-labelledby="checkin-heading"
            className="overflow-hidden rounded-[18px] border border-danger bg-surface"
          >
            <div className="tactile-strip" aria-hidden="true" />
            <div className="flex items-start gap-3 p-4">
              <TriangleAlert
                aria-hidden="true"
                className="mt-1 h-7 w-7 shrink-0 text-danger"
              />
              <div>
                <h2 id="checkin-heading" className="text-[28px] text-danger">
                  {view.heading}
                </h2>
                <p className="mt-2 text-[22px] text-ink">{view.advisory}</p>
              </div>
            </div>
          </section>
        </>
      ) : current.state === "CALL_CAREGIVER" || current.state === "RESOLVED" ? (
        // Caregiver is being (or has been) called. Tactile strip on top via the
        // Banner, with the simulated-call badge in demo mode (Req 12.9).
        <>
          {view.showSimulatedCallBadge ? (
            <div>
              <Badge
                kind="simulated-call"
                icon={<PhoneCall aria-hidden="true" className="h-4 w-4" />}
              />
            </div>
          ) : null}
          <div id="checkin-heading">
            <Banner title={view.heading} alert>
              {view.detail}
            </Banner>
          </div>
        </>
      ) : (
        // Answered: a calm confirmation panel.
        <div id="checkin-heading">
          <Panel title={view.heading}>
            <p>{view.detail}</p>
          </Panel>
        </div>
      )}
    </section>
  );
}
