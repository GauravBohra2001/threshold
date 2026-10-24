"use client";

import {
  Suspense,
  use,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { CheckCircle2, PhoneCall, TriangleAlert } from "lucide-react";

import LiveRegion from "@/components/LiveRegion";
import Badge from "@/components/ui/Badge";
import Banner from "@/components/ui/Banner";
import Button from "@/components/ui/Button";
import Panel from "@/components/ui/Panel";
import StatusChip from "@/components/ui/StatusChip";
import {
  type CheckinStatusResponse,
  EMERGENCY_ADVICE,
  parseStatusResponse,
  REFRESH_FAILED_MESSAGE,
  statusChanged,
  statusView,
} from "./status-view";

/**
 * Caregiver screen: invite-accept entry plus the live check-in status view.
 *
 * The screen first accepts the invite (POST /api/invite/accept). Once a
 * household id is known (from the `household` URL param for an ongoing
 * caregiver, or after accepting an invite that returns one) it switches to the
 * status view, which POLLS GET /api/checkin/status?household=<id> every 3
 * seconds with NO realtime subscriptions (Req 13.1, 13.2). A changed status
 * updates within 1s and is announced via an assertive aria-live region (Req
 * 13.3, 13.4, 23.10). A poll with no response within 10s or an error retains
 * the last status, shows a plain "status could not be refreshed" message, and
 * continues at the next interval (Req 13.5, 13.6). The big block covers
 * "checked in" (success), "calling you now" (tactile-strip Banner, with the
 * "Simulated call (demo mode)" badge when simulated, Req 12.9), and the danger
 * "Call 911 if this is an emergency." at chain end (Req 12.3).
 *
 * Built to WCAG 2.2 AA guidelines and tested with VoiceOver.
 */

type FieldName = "caregiver_name" | "caregiver_phone";

interface CaregiverStatusPageProps {
  searchParams: Promise<{
    code?: string | string[];
    household?: string | string[];
  }>;
}

const GENERIC_ERROR =
  "We couldn't accept this invite right now. Please try again in a moment.";

/** Poll cadence and per-poll timeout (Req 13.1, 13.5). */
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 10000;

function firstValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

/**
 * The live status view. Polls every 3s, retains the last status on a failed or
 * slow poll, and announces real changes assertively.
 */
function CheckinStatusView({ householdId }: { householdId: string }) {
  const [status, setStatus] = useState<CheckinStatusResponse | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [refreshFailed, setRefreshFailed] = useState(false);
  // Hold the latest status without re-subscribing the interval each change.
  const latestStatus = useRef<CheckinStatusResponse | null>(null);

  const poll = useCallback(async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), POLL_TIMEOUT_MS);
    try {
      const response = await fetch(
        `/api/checkin/status?household=${encodeURIComponent(householdId)}`,
        { signal: controller.signal, cache: "no-store" },
      );
      if (!response.ok) {
        setRefreshFailed(true);
        return;
      }
      const parsed = parseStatusResponse(await response.json());
      if (!parsed) {
        setRefreshFailed(true);
        return;
      }
      setRefreshFailed(false);
      if (statusChanged(latestStatus.current, parsed)) {
        latestStatus.current = parsed;
        setStatus(parsed);
        const view = statusView(parsed);
        setAnnouncement(view.heading);
      }
    } catch {
      // Abort (10s timeout) or network error: keep the last status (Req 13.6).
      setRefreshFailed(true);
    } finally {
      clearTimeout(timeout);
    }
  }, [householdId]);

  useEffect(() => {
    let active = true;
    const run = () => {
      if (active) void poll();
    };
    run();
    const interval = setInterval(run, POLL_INTERVAL_MS);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [poll]);

  const view = status
    ? statusView(status)
    : {
        tone: "waiting" as const,
        heading: "Loading check-in status",
        detail: "Checking the latest status.",
        showSimulatedCallBadge: false,
        showEmergencyAdvice: false,
      };

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col px-5 py-8">
      {/* Assertive so a status change interrupts (Req 13.4, 23.10). */}
      <LiveRegion politeness="assertive">{announcement}</LiveRegion>

      <h1 className="text-[28px]">Caregiver status</h1>
      <p className="mt-2 text-muted">
        This updates on its own every few seconds. Threshold is an AI assistant,
        not the City of Boston.
      </p>

      <div className="mt-8 flex flex-1 flex-col gap-6">
        {view.tone === "attention" ? (
          <Banner title={view.heading} alert>
            Threshold is calling you now so you can check on them.
          </Banner>
        ) : (
          <section
            className={[
              "rounded-[18px] border bg-surface p-6",
              view.tone === "success"
                ? "border-success"
                : view.tone === "danger"
                  ? "border-danger"
                  : "border-line",
            ].join(" ")}
          >
            <p
              className={[
                "text-[28px] font-bold",
                view.tone === "success"
                  ? "text-success"
                  : view.tone === "danger"
                    ? "text-danger"
                    : "text-ink",
              ].join(" ")}
            >
              {view.heading}
            </p>
            {view.detail ? (
              <p className="mt-3 text-ink">{view.detail}</p>
            ) : null}
          </section>
        )}

        {view.tone === "attention" && view.detail ? (
          <p className="text-ink">{view.detail}</p>
        ) : null}

        {view.showSimulatedCallBadge ? (
          <Badge
            kind="simulated-call"
            icon={<PhoneCall aria-hidden="true" className="h-4 w-4" />}
          />
        ) : null}

        {view.tone === "success" ? (
          <StatusChip
            tone="success"
            icon={<CheckCircle2 aria-hidden="true" className="h-5 w-5" />}
          >
            No action needed right now.
          </StatusChip>
        ) : null}

        {view.showEmergencyAdvice ? (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-[18px] border border-danger bg-surface p-4 text-[22px] font-bold text-danger"
          >
            <TriangleAlert
              aria-hidden="true"
              className="mt-1 h-6 w-6 shrink-0"
            />
            <span>{EMERGENCY_ADVICE}</span>
          </p>
        ) : null}

        {refreshFailed ? (
          <p className="flex items-start gap-2 text-muted">
            <TriangleAlert
              aria-hidden="true"
              className="mt-0.5 h-5 w-5 shrink-0"
            />
            <span>
              {REFRESH_FAILED_MESSAGE} Showing the last status. Trying again in a
              moment.
            </span>
          </p>
        ) : null}
      </div>
    </main>
  );
}

function CaregiverStatusForm({ searchParams }: CaregiverStatusPageProps) {
  const params = use(searchParams);
  const code = firstValue(params.code).trim();
  const householdParam = firstValue(params.household).trim();

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
  const [acceptedHouseholdId, setAcceptedHouseholdId] = useState<string | null>(
    null,
  );
  const [accepted, setAccepted] = useState(false);
  const [announcement, setAnnouncement] = useState("");

  // Ongoing caregiver context: a real household id (from the URL or returned on
  // accept) shows the live status directly, skipping the accept form (Req
  // 13.1).
  const activeHouseholdId = householdParam || acceptedHouseholdId;
  if (activeHouseholdId) {
    return <CheckinStatusView householdId={activeHouseholdId} />;
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
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          message?: string;
        };
        setFormError(body.message ?? GENERIC_ERROR);
        return;
      }
      const body = (await response.json().catch(() => ({}))) as {
        household_id?: string;
      };
      setAnnouncement("Invite accepted.");
      setAccepted(true);
      // Prefer the id the server returned; fall back to the URL param. With a
      // real id we move straight to the live status view; without one we show
      // the plain confirmation (nothing valid to poll).
      const resolvedId = body.household_id ?? (householdParam || null);
      setAcceptedHouseholdId(resolvedId);
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
          <TriangleAlert
            aria-hidden="true"
            className="mt-0.5 h-5 w-5 shrink-0"
          />
          <span>
            This invite link is incomplete. Please use the full link the
            resident shared with you.
          </span>
        </p>
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
            <TriangleAlert
              aria-hidden="true"
              className="mt-0.5 h-5 w-5 shrink-0"
            />
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
            aria-describedby={
              fieldErrors.caregiver_name ? nameErrorId : undefined
            }
            className="min-h-[56px] rounded-[12px] border border-control-border bg-surface px-3 text-ink"
          />
          {fieldErrors.caregiver_name ? (
            <p id={nameErrorId} className="flex items-start gap-2 text-danger">
              <TriangleAlert
                aria-hidden="true"
                className="mt-0.5 h-5 w-5 shrink-0"
              />
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
              <TriangleAlert
                aria-hidden="true"
                className="mt-0.5 h-5 w-5 shrink-0"
              />
              <span>{fieldErrors.caregiver_phone}</span>
            </p>
          ) : (
            <p className="text-[16px] text-muted">
              Digits only, 10 to 15 numbers.
            </p>
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
          <h1 className="text-[28px]">Caregiver status</h1>
          <p className="mt-4 text-muted">Loading</p>
        </main>
      }
    >
      <CaregiverStatusForm searchParams={searchParams} />
    </Suspense>
  );
}
