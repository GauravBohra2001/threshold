import type { NextRequest } from "next/server";

import { runCaseAgent, type TerminalStatus } from "@/lib/agent/loop";
import { getCurrentHousehold } from "@/lib/auth/household";
import { createSignedUrl, db } from "@/lib/data/supabase";
import { logServerError } from "@/lib/log";
import { fastForward, isFollowUpDue, simNow } from "@/lib/rules/clock";

/**
 * POST /api/judge/fast-forward — "Fast-forward 14 days (simulated)" (Req 8.3–8.8, 20.8).
 *
 * This is the Judge Mode control that advances simulated time. It:
 *   1. Resolves the current household from the cookie (404 if none).
 *   2. Increments `sim_offset_days` by EXACTLY 14 via the pure `fastForward`
 *      helper and persists it (Req 8.3, 20.8).
 *   3. Computes the new simulated instant `simNow(household-with-new-offset)`
 *      and re-evaluates every non-resolved case with the pure `isFollowUpDue`
 *      (Req 8.3, 8.4, 8.7).
 *   4. For each due, unresolved case, runs the Case Agent re-check under a 10s
 *      budget (Req 8.4). If the re-check finds the case resolved or no longer
 *      due, the suggestion is suppressed (Req 8.5). If it is still unresolved
 *      and due, a SUGGESTED escalation is returned for the resident to review
 *      — nothing is ever submitted or sent automatically (Req 8.6, 8.8).
 *   5. Returns a summary the `/judge` screen renders under a "Simulated time"
 *      label: the new offset, the simulated date, and the suggested cases.
 *
 * All database/storage access happens here with the service-role client; the
 * browser never talks to Supabase directly (Req 22.4, 22.5). Any failure is
 * turned into a plain-language fallback with no stack trace (Req 22.2, 22.3).
 */

/** The label every Judge-Mode consumer of this response shows on screen. */
export const SIMULATED_TIME_LABEL = "Simulated time";

/** Per-case re-check budget, mirroring the agent's own tool timeout (Req 8.4). */
const RECHECK_BUDGET_MS = 10_000;

const FALLBACK_MESSAGE =
  "We couldn't fast-forward the demo right now. Please try again in a moment.";

const NO_HOUSEHOLD_MESSAGE =
  "There's no demo household yet. Open Judge Mode to seed one first.";

/** The case columns this handler needs to re-evaluate follow-ups. */
interface CaseRow {
  id: string;
  status: string;
  route: string | null;
  clock_due_at: string | null;
  photo_path: string;
  lat: number | null;
  lng: number | null;
  opened_at: string;
}

/** One case the UI should surface a suggested escalation for (Req 8.6). */
interface SuggestedEscalation {
  case_id: string;
  /** The route the re-check settled on, if any (e.g. the Disabilities Commission). */
  route: string | null;
  /** The re-check's terminal status (never a "sent" state; always a suggestion). */
  status: TerminalStatus;
  /** A short, plain-language note for the review card. */
  note: string;
}

/** Shape returned to the `/judge` screen (task 25.1). */
interface FastForwardView {
  label: typeof SIMULATED_TIME_LABEL;
  /** The household's new simulated offset, incremented by exactly 14. */
  sim_offset_days: number;
  /** The resulting simulated instant, ISO 8601. */
  simulated_date: string;
  /** How many non-resolved cases were evaluated for a due follow-up. */
  cases_evaluated: number;
  /** How many due, unresolved cases were re-checked by the agent. */
  cases_rechecked: number;
  /**
   * Cases the resident should review a suggested escalation for. Empty when no
   * follow-up was due or every re-check resolved/was-no-longer-due (Req 8.5).
   * Nothing here has been sent or submitted (Req 8.8).
   */
  suggested_escalations: SuggestedEscalation[];
}

/**
 * A due, unresolved case is still "due" after a re-check when the re-check did
 * not resolve it. `resolved` means the barrier was closed out, so no
 * escalation is suggested (Req 8.5). Every other terminal state leaves the case
 * open, so we surface a suggested escalation for review (Req 8.6).
 */
function shouldSuggestEscalation(status: TerminalStatus): boolean {
  return status !== "resolved";
}

/** A short, plain-language note for a suggested escalation card. */
function noteForStatus(status: TerminalStatus): string {
  switch (status) {
    case "escalated":
      return "This case is overdue. We've prepared an escalation for you to review and approve.";
    case "draft_ready":
      return "This case is overdue. A draft is ready for you to review and approve.";
    case "waiting":
      return "This case is overdue and still waiting. Review whether to escalate it.";
    case "asked_user":
      return "This case is overdue and needs your answer before we can continue.";
    default:
      return "This case is overdue. Review whether to escalate it.";
  }
}

/**
 * Build the `photoDataUrl` the agent re-check needs for this case. We serve the
 * stored photo through a short-lived signed URL rather than exposing storage
 * credentials (Req 3.8). If signing fails the re-check still runs with an empty
 * string; the agent degrades to a plain-language note rather than crashing.
 */
async function photoUrlFor(photoPath: string): Promise<string> {
  try {
    return await createSignedUrl(photoPath);
  } catch (error) {
    logServerError("POST /api/judge/fast-forward signed url", error);
    return "";
  }
}

/** Race the re-check against the 10s budget so one slow run can't hang the request (Req 8.4). */
async function recheckWithin<T>(
  work: Promise<T>,
  fallback: T,
  budgetMs: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), budgetMs);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function POST(_request: NextRequest): Promise<Response> {
  try {
    const household = await getCurrentHousehold();
    if (!household) {
      return Response.json({ message: NO_HOUSEHOLD_MESSAGE }, { status: 404 });
    }

    // 1. Increment the offset by exactly 14 (pure helper) and persist it.
    const newOffset = fastForward(household.sim_offset_days);
    const { error: updateError } = await db("households")
      .update({ sim_offset_days: newOffset })
      .eq("id", household.id);
    if (updateError) {
      throw new Error("household offset update failed");
    }

    // 2. The new simulated instant drives every due-check (Req 8.3, 8.4, 8.7).
    const now = new Date();
    const simulatedNow = simNow({ sim_offset_days: newOffset }, now);

    // 3. Load the household's non-resolved cases (Req 8.4: status other than resolved).
    const { data: casesData, error: casesError } = await db("cases")
      .select("id, status, route, clock_due_at, photo_path, lat, lng, opened_at")
      .eq("household_id", household.id)
      .neq("status", "resolved");
    if (casesError) {
      throw new Error("cases lookup failed");
    }
    const cases = (casesData as CaseRow[] | null) ?? [];

    // 4. Re-evaluate each case. A follow-up is due iff the simulated instant is
    //    strictly past clock_due_at (pure rule). A case with no clock_due_at has
    //    no scheduled follow-up, so it is never due.
    const suggested: SuggestedEscalation[] = [];
    let rechecked = 0;

    for (const c of cases) {
      if (!c.clock_due_at) continue;
      const due = isFollowUpDue(new Date(c.clock_due_at), simulatedNow);
      if (!due) continue; // not due → suppress (Req 8.5)

      rechecked += 1;

      // Run the agent re-check within the 10s budget. On timeout we keep the
      // case as a suggestion so an overdue case is never silently dropped.
      const photoDataUrl = await photoUrlFor(c.photo_path);
      const result = await recheckWithin(
        runCaseAgent({
          caseId: c.id,
          photoDataUrl,
          lat: c.lat ?? 0,
          lng: c.lng ?? 0,
          openedAt: new Date(c.opened_at),
        }).then((r) => ({ status: r.status, route: r.route })),
        // Budget exceeded: treat as still-escalated so it surfaces for review.
        { status: "escalated" as TerminalStatus, route: (c.route as string | null) ?? null },
        RECHECK_BUDGET_MS,
      );

      // Resolved / no longer due → suppress the suggestion (Req 8.5). Still
      // unresolved → present a suggested escalation for review (Req 8.6). Never
      // auto-send: this is only a suggestion (Req 8.8).
      if (shouldSuggestEscalation(result.status)) {
        suggested.push({
          case_id: c.id,
          route: result.route,
          status: result.status,
          note: noteForStatus(result.status),
        });
      }
    }

    const view: FastForwardView = {
      label: SIMULATED_TIME_LABEL,
      sim_offset_days: newOffset,
      simulated_date: simulatedNow.toISOString(),
      cases_evaluated: cases.length,
      cases_rechecked: rechecked,
      suggested_escalations: suggested,
    };
    return Response.json(view, { status: 200 });
  } catch (error) {
    logServerError("POST /api/judge/fast-forward", error);
    return Response.json({ message: FALLBACK_MESSAGE }, { status: 502 });
  }
}
