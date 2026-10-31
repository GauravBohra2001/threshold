# Implementation Plan: Threshold

## Overview

This plan builds Threshold as one Next.js 16 (App Router) + TypeScript app in incremental, independently demoable slices, grouped by priority (P1 → P2 → P3 → P4 → Later). Each task is small (one route handler, one component, one pure-rules module, or one data client) and cites the requirements it implements. Cross-cutting concerns — server-only data access, external-call timeouts with friendly fallbacks, cross-resident privacy, honesty wording, and the WCAG 2.2 AA accessibility baseline — are woven into each task rather than built separately. The seven correctness properties and the agent evaluation suite are required tasks (not optional) and sit immediately next to the code they validate. Each priority group ends with a checkpoint that runs the build and tests, then asks for approval before any commit or push.

## Tasks

Tasks are grouped by priority (P1 → P2 → P3 → P4 → Later) and ordered into parallel waves within each group; see the Task Dependency Graph at the end.

### P1 — Household, Caregiver invite, Proof Vault, demo seeding

Covers Requirements 1, 2, 3, 4, 20.1–20.4. Cross-cutting 10, 22, 23 apply throughout.

Wave 0 (setup, run first): task 1.
Wave 1 (parallel, data clients + global a11y): tasks 2.1–2.7, 3.1.
Wave 2 (parallel, pure rule used by P1): task 4.1, then 4.2, 4.3 after it.
Wave 3 (feature routes + components, parallel where files differ): tasks 5.1, 5.2, 5.3, 6.1.
Wave 4 (depends on vault route/listing): tasks 7.1, 8.1.
Wave 5: task 9.1 (demo seeding), then checkpoint 10.

- [x] 1. Apply the Supabase schema and create the private vault bucket (infra)
  - Via the Supabase MCP, run the six `CREATE TABLE` statements from design.md exactly as written: `households`, `vault_items`, `cases`, `checkins`, `incidents`, `claims` (including all CHECK constraints, the `households.invite_code` unique constraint, and the `checkins (household_id, alert_id)` unique constraint)
  - Create the private Storage bucket named `vault` (not public) through the Supabase MCP
  - This is a one-time infrastructure/setup step; it runs the DDL and bucket creation only, no application code
  - _Requirements: 1.6, 3.3, 22.5_

- [x] 2. Implement shared server-only data clients in `src/lib/data/`
  - [x] 2.1 Implement `src/lib/data/supabase.ts`
    - Build the server-only Supabase client with `SUPABASE_SERVICE_ROLE_KEY`; expose DB access, `vault` storage upload, and `createSignedUrl(path, 300)` helpers
    - Secret read only in server code; never exported to the browser
    - _Requirements: 1.6, 3.3, 3.8, 22.4, 22.5_
  - [x] 2.2 Implement `src/lib/data/azure.ts` (Azure OpenAI)
    - `AzureOpenAI` client (endpoint = base URL only), deployment from `AZURE_OPENAI_DEPLOYMENT`; use `max_completion_tokens` (never `max_tokens`); images as base64 data URLs; structured outputs via a zod-validated `VaultLabel` JSON schema
    - 30s timeout via `AbortController` with a typed fallback result (no stack trace)
    - _Requirements: 3.5, 22.1, 22.2, 22.3, 22.4_
  - [x] 2.3 Implement `src/lib/data/twilio.ts`
    - `client.calls.create({ to, from: TWILIO_FROM_NUMBER, twiml })` with inline TwiML; no webhook
    - Configurable timeout (1–30s, default 10s); typed fallback on error; secret server-only
    - _Requirements: 22.1, 22.2, 22.3, 22.4_
  - [x] 2.4 Implement `src/lib/data/boston311.ts`
    - CKAN `datastore_search_sql` with a lat/lng bounding box; resource id from `BOSTON_311_RESOURCE_ID`; never returns `full_address` to callers
    - Configurable timeout (default 10s); typed fallback result
    - _Requirements: 6.4, 10.3, 22.1, 22.2, 22.3, 22.4_
  - [x] 2.5 Implement `src/lib/data/openfema.ts`
    - `DisasterDeclarationsSummaries`; reads `ihProgramDeclared` and `iaProgramDeclared`; supports `placeCode` for tribal areas
    - Configurable timeout (default 10s); typed fallback result
    - _Requirements: 15.1, 15.4, 22.1, 22.2, 22.3, 22.4_
  - [x] 2.6 Implement `src/lib/data/nws.ts`
    - `/alerts/active?point=lat,lng`; sends a non-empty `User-Agent` from `NWS_USER_AGENT`
    - 10s timeout; typed fallback result (no stack trace, no error code)
    - _Requirements: 11.3, 11.4, 22.1, 22.2, 22.3, 22.4_
  - [x] 2.7 Implement `src/lib/data/geocoder.ts` (Census)
    - Address → latitude, longitude, county FIPS, neighborhood; no API key
    - 10s timeout via `AbortController`; typed fallback result distinguishing timeout vs zero matches
    - _Requirements: 1.1, 1.4, 1.5, 22.1, 22.2, 22.3_

- [x] 3. Establish the accessibility baseline (global)
  - [x] 3.1 Set up global accessibility foundations and shared primitives
    - Global CSS variables for light/dark mode, body text ≥18px, ≥4.5:1 contrast, visible focus ≥3:1, `prefers-reduced-motion` handling (`src/app/globals.css`)
    - Create `src/components/PrimaryButton.tsx` (full-width bottom action, ≥44×44px) and `src/components/LiveRegion.tsx` (polite/assertive announcer); semantic HTML, one component per file
    - Enable `eslint-plugin-jsx-a11y` in the lint config
    - _Requirements: 23.1, 23.2, 23.3, 23.4, 23.5, 23.6, 23.8, 23.9, 23.10, 23.11, 23.13_

- [x] 4. Implement the simulated-time clock pure module (`src/lib/rules/clock.ts`)
  - [x] 4.1 Implement `clock.ts` pure functions
    - `simNow(household, now)` = now + `sim_offset_days` days; `fastForward(offsetDays)` = offsetDays + 14; follow-up scheduling/clamp so `clock_due_at ∈ [openDate, openDate + 90 days]`; `isFollowUpDue(clockDueAt, simNowInstant)` = simNowInstant > clockDueAt. No I/O.
    - _Requirements: 8.1, 8.2, 8.7, 20.8_
  - [x] 4.2 Write property test for clock lower-bound (required)
    - **Property 5: Clock lower-bound** — `openDate <= clock_due_at <= openDate + 90 days` for all open dates and day offsets (including negatives)
    - **Validates: Requirements 21.5, 8.1, 8.2**
    - Vitest + fast-check, ≥100 iterations, tagged "Feature: threshold, Property 5: Clock lower-bound"
  - [x] 4.3 Write property test for follow-up due equivalence (required)
    - **Property 6: Follow-up due equivalence** — `isFollowUpDue(dueDate, simNow({sim_offset_days: offset}, now)) === (simNow > dueDate)` for all non-negative offsets
    - **Validates: Requirements 21.6, 8.4, 8.7**
    - Vitest + fast-check, ≥100 iterations, tagged "Feature: threshold, Property 6: Follow-up due equivalence"

- [x] 5. Implement household and invite route handlers
  - [x] 5.1 Implement `POST /api/household` and `GET /api/household`
    - POST validates resident name (1–100) and address (non-empty ≤200), geocodes via `geocoder.lookup` (10s), stores `lat/lng/county_fips/neighborhood`, sets `sim_offset_days=0` and `created_at`, generates a unique `invite_code`, sets HTTP-only `threshold_household` cookie; returns `{ id, invite_code, invite_url, ... }`
    - Field-level `{ field, message }` errors retain entered values; geocoder timeout/zero-match → plain-language 502, no stack trace
    - GET reads household from cookie
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 2.1, 22.2, 22.3, 22.4, 22.5_
  - [x] 5.2 Implement `POST /api/invite/accept`
    - Validate caregiver name (1–100) and phone (10–15 digits); attach caregiver to household by invite code within 5s; reject invalid/used/missing invite with plain-language message; friendly 503 when data store unavailable (attaches nothing)
    - _Requirements: 2.2, 2.3, 2.4, 2.5, 2.6, 22.3, 22.5_
  - [x] 5.3 Implement the resident household-create screen and caregiver invite-accept screen
    - `src/app/(resident)/home/page.tsx` create form (one question per screen where possible, errors next to the field, full-width bottom primary action) and `src/app/(caregiver)/status/page.tsx` (or invite-accept entry) reading `code` from the invite link
    - Semantic HTML, ≥44×44 targets, alt text, polite aria-live for save confirmation
    - _Requirements: 1.3, 2.1, 2.2, 23.1, 23.3, 23.4, 23.9_

- [x] 6. Implement the browser photo-resize component
  - [x] 6.1 Implement `src/components/PhotoCapture.tsx`
    - Draw selected image to `<canvas>` scaled to width ≤1280px, export JPEG via `canvas.toBlob('image/jpeg', q)`, verify blob ≤4.5 MB (lower quality if needed); on resize/encode failure cancel upload and show "This photo could not be processed." leaving existing items unchanged
    - Accessible file input with text label; one component per file
    - _Requirements: 3.1, 3.2, 23.1, 23.7_

- [x] 7. Implement the Proof Vault photo pipeline and listing
  - [x] 7.1 Implement `POST /api/vault`
    - Accept multipart resized JPEG + `{ kind }`; upload to private `vault` bucket via service role (15s timeout); on storage failure create no row and show "This photo could not be saved." (no stack trace)
    - Call `azure.labelPhoto(dataUrl)` (30s): save `label` (≤60), `ai_description` (≤280), `accessibility_relevant`, `kind`, `captured_at`; on AI timeout/failure save with empty label/description, fallback alt "Unlabeled photo captured <date>", and a labeling-unavailable message
    - _Requirements: 3.3, 3.4, 3.5, 3.6, 3.7, 22.1, 22.2, 22.3, 22.5_
  - [x] 7.2 Implement `GET /api/vault` and the vault screen
    - GET returns items most-recent first, each with a 300s signed URL, `label`, and `alt`
    - `src/app/(resident)/vault/page.tsx` renders a semantic `<ul>`/`<li>` list; each item has a non-empty text label (1–150), AI label as alt when present else timestamp-derived alt; empty-vault text message readable by VoiceOver/TalkBack
    - _Requirements: 3.8, 4.1, 4.2, 4.3, 4.4, 4.5, 10.1, 23.7_

- [x] 8. Wire vault capture to upload in the vault screen
  - [x] 8.1 Integrate `PhotoCapture` into the vault screen upload flow
    - On resized blob, POST to `/api/vault`, then refresh the listing; announce save via a polite aria-live region; render field/fallback messages without stack traces
    - _Requirements: 3.1, 3.2, 3.4, 3.7, 23.9_

- [x] 9. Implement P1 Judge Mode demo seeding
  - [x] 9.1 Implement `GET /api/judge/seed` and the `/judge` entry screen
    - Idempotently seed fictional household "Maria" (Dorchester) with caregiver "Ana" (phone from `CAREGIVER_DEMO_NUMBER`), `is_demo=true`, and ≥3 sample vault items; reuse existing rows so counts are unchanged on repeat visits
    - Store/display the demo number only; place no outbound call during seeding; if `CAREGIVER_DEMO_NUMBER` is unset/empty show a plain-language fallback and place no call; screen shows "Demo data, fictional people."
    - _Requirements: 20.1, 20.2, 20.3, 20.4_

- [x] 10. Checkpoint — P1 build, tests, approval to commit
  - Run `npm run build` and `npx vitest run`; fix any failures until both pass
  - Then ask the user for approval before committing/pushing: show the file list and a plain imperative commit message and wait for the user's "yes" (follow the git steering; do not commit or push without confirmation)
  - Ensure all tests pass, ask the user if questions arise.

### P2 — Case Agent + Agent evaluation suite

Covers Requirements 5, 6, 7, 8, 9. Cross-cutting 10, 22, 23 apply.

Wave 0 (parallel, pure rules): tasks 11.1, 12.1, 13.1.
Wave 1 (property tests + privacy guard, adjacent to their modules): tasks 11.2, 12.2, 13.2, then 13.3 after 13.2.
Wave 2 (agent core, depends on rules): tasks 14.1, 14.2, 14.3.
Wave 3 (report/case routes, depend on agent): tasks 15.1, 15.2, 15.3.
Wave 4 (case + approval screens): tasks 16.1, 16.2.
Wave 5 (follow-up route): task 17.1.
Wave 6 (eval suite, LAST in P2): task 18.1, then checkpoint 19.

- [x] 11. Implement distance and routing pure modules
  - [x] 11.1 Implement `src/lib/rules/distance.ts` and `src/lib/rules/routing.ts`
    - `greatCircleMeters(a, b)` rounded to nearest whole meter; `isNearby(a, b, radiusM=75)`; `decideSidewalkRoute({ open_count })` returns `'escalate'` iff `open_count >= 2` else `'draft_311'`; route selection for curb ramp (`ada_curb_ramp_form`) and ADA grievance (`ada_grievance`). No I/O.
    - _Requirements: 6.1, 6.2, 6.3_
  - [x] 11.2 Write property test for duplicate routing threshold (required)
    - **Property 3: Duplicate routing threshold** — `decideSidewalkRoute({ open_count })` is `'draft_311'` iff nearby count (`isNearby`/`greatCircleMeters` at ≤75m) is `< 2`, else `'escalate'`
    - **Validates: Requirements 21.3, 6.1, 6.2, 6.3**
    - Vitest + fast-check, ≥100 iterations, tagged "Feature: threshold, Property 3: Duplicate routing threshold"

- [x] 12. Implement the privacy guard pure module
  - [x] 12.1 Implement `src/lib/rules/privacy.ts`
    - Response-guard/serializer that strips any `full_address` value from a response object; exposes only aggregate counts/distances per Req 10 ("N open reports within D meters", D multiple of 10). No I/O.
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 6.4_
  - [x] 12.2 Write property test for privacy — no address leak (required)
    - **Property 4: Privacy — no address leak** — for every source `full_address`, `JSON.stringify(guardedResponse)` contains no occurrence of it
    - **Validates: Requirements 21.4, 10.1, 10.3, 10.5, 6.4**
    - Vitest + fast-check, ≥100 iterations, tagged "Feature: threshold, Property 4: Privacy — no address leak"

- [x] 13. Implement the Case Agent trace module and tools (pure/boundary split)
  - [x] 13.1 Implement `src/lib/agent/trace.ts`
    - `TraceStep` shape (`step`, `tool`, `input_summary`, `observation_summary`, `reasoning_note`, `at`) with append/format helpers producing plain-language summaries; strictly increasing 1-based step index
    - _Requirements: 5.3_
  - [x] 13.2 Implement `src/lib/agent/tools.ts`
    - The ten tools from case-agent.md (`classify_photo`, `search_nearby_311`, `neighborhood_on_time_rate`, `lookup_right`, `draft_filing`, `request_approval`, `schedule_followup`, `check_case_status`, `notify_caregiver`, `ask_user`); `search_nearby_311` returns only `open_count`, `oldest_open_age_days`, `overdue_count` (never addresses/coords), routing through `privacy.ts`; `schedule_followup` clamps via `clock.ts`; honesty wording enforced in `draft_filing`
    - _Requirements: 6.4, 6.5, 8.1, 8.2, 8.8, 10.4, 12.8_
  - [x] 13.3 Implement `src/lib/agent/loop.ts` (run orchestration)
    - `runCaseAgent(...)` drives Azure function-calling; ≤8 tool steps; terminal state ∈ {draft_ready, waiting, asked_user, escalated, resolved}; step-cap reached → `escalated` + trace note; each tool call 10s timeout → trace note + friendly fallback, continue within budget; appends each step to `cases.trace`
    - _Requirements: 5.1, 5.3, 5.4, 5.5, 5.6, 22.2, 22.3_

- [x] 14. Implement eligibility/fema-match pure modules (used by agent drafts and P4)
  - [x] 14.1 Implement `src/lib/rules/eligibility.ts` forbidden-wording guard
    - Case-insensitive guard/sanitizer removing or blocking "you will receive", "guaranteed", "approved" from eligibility and draft text; ensures honesty wording. No I/O.
    - _Requirements: 15.5, 16.6, 6.1, 6.2_
  - [x] 14.2 Write property test for forbidden wording (required)
    - **Property 7: Forbidden wording** — lowercased guarded output contains none of the three forbidden substrings
    - **Validates: Requirements 21.7, 15.5, 16.6**
    - Vitest + fast-check, ≥100 iterations, tagged "Feature: threshold, Property 7: Forbidden wording"

- [x] 15. Implement report and case route handlers
  - [x] 15.1 Implement `POST /api/report`
    - Validate photo and location present (else 400 naming the missing field, no case created); create case `investigating`; start `runCaseAgent`
    - _Requirements: 5.1, 5.2, 10.1, 22.3_
  - [x] 15.2 Implement `GET /api/case/[id]` (await `ctx.params`)
    - Return case + trace; exclude any other resident's details and any `full_address` from the body
    - _Requirements: 5.3, 7.1, 8.4, 10.1, 10.3_
  - [x] 15.3 Implement `POST /api/case/[id]/approve` and `POST /api/case/[id]/city-number`
    - Approve sets `draft_ready`; declining/leaving keeps status + retains draft; city-number validates 1–100 chars and sets `waiting` (invalid → field error, saved number unchanged); never auto-submits to any government system
    - _Requirements: 7.2, 7.3, 7.5, 7.6, 7.7_

- [x] 16. Implement Case Agent resident screens
  - [x] 16.1 Implement the report screen and live trace view
    - `src/app/(resident)/report/page.tsx` using `PhotoCapture` + location; `src/app/(resident)/case/[id]/page.tsx` rendering `TraceList` with each step shown in plain language within 3s via a polite aria-live region
    - _Requirements: 5.1, 5.2, 5.3, 23.1, 23.4, 23.9_
  - [x] 16.2 Implement the draft approval and city-handoff UI
    - Approval screen shows full draft, keeps `draft` until explicit approval (a "just submit it" message still requires the approval action); at `draft_ready` show one-tap "Open BOS:311" and a ≥44×44 input to paste the city case number
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 23.3, 23.4_

- [x] 17. Implement the scheduled follow-up route
  - [x] 17.1 Implement `POST /api/judge/fast-forward`
    - Increment `sim_offset_days` by 14; re-evaluate every case with `isFollowUpDue`; for a due, unresolved case run the agent re-check within 10s; resolved/not-due → suppress suggestion; still-unresolved-and-due → present a suggested escalation for review; never auto-send; screen labeled "Simulated time"
    - _Requirements: 8.3, 8.4, 8.5, 8.6, 8.8, 20.8_

- [x] 18. Implement the Agent evaluation suite (LAST task in P2)
  - [x] 18.1 Implement `tests/evals/case-agent/` and the `npm run eval` script
    - 12 tasks (2 blocked-no-nearby → drafted 311; 2 with 3 open nearby → escalation draft, no duplicate; 1 broken-sidewalk 1 nearby → drafted 311; 1 missing-curb-ramp → ADA curb ramp form; 2 unclear-photo → `asked_user`; 1 overdue-open → suggested escalation not sent; 1 "just submit it" → approval still required; 2 address-containing fixtures → no address in any output), 3 isolated trials each, fixture 311 data only (no live calls)
    - Code-based outcome graders (route+status, no fixture address substring in output, `request_approval` before ready, stated counts match tool output); add `eval` script to `package.json`; print per-task results, overall success rate, and `pass^3`; write transcripts to `tests/evals/results/`
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

- [x] 19. Checkpoint — P2 build, tests, approval to commit
  - Run `npm run build` and `npx vitest run`; fix any failures until both pass
  - Then ask the user for approval before committing/pushing: show the file list and a plain imperative commit message and wait for the user's "yes" (follow the git steering; do not commit or push without confirmation)
  - Ensure all tests pass, ask the user if questions arise.

### P3 — Check-in Chain + Rights Card + remaining Judge Mode

Covers Requirements 11, 12, 13, 14, 20.5–20.10. Cross-cutting 10, 22, 23 apply.

Wave 0 (pure chain module): task 20.1, then property test 20.2 after it.
Wave 1 (parallel routes, different files): tasks 21.1, 22.1, 24.1.
Wave 2 (screens depending on routes): tasks 21.2, 23.1, 24.2.
Wave 3 (remaining Judge Mode + fixtures): task 25.1, then checkpoint 26.

- [x] 20. Implement the check-in chain pure state machine (`src/lib/rules/checkin-chain.ts`)
  - [x] 20.1 Implement `checkin-chain.ts`
    - `nextState(current, event, mode)`, `timeoutMs(mode)` (live 90_000 / replay 15_000), `outcomeFor(state)`, `mayPlaceLiveCall(allowLive, lastCallAt, now)` (true iff allowLive && (lastCallAt null || now−lastCallAt ≥ 2 min)); transition table from design; steps advance in order, no skip, ≤1 caregiver call per step. No I/O, no model judgment.
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.10_
  - [x] 20.2 Write property test for check-in chain ordering (required)
    - **Property 1: Check-in chain ordering** — folding `nextState` from `SENT` over any finite event sequence advances step indices in strictly increasing, non-skipping order and places at most one caregiver call per step index
    - **Validates: Requirements 21.1, 12.5**
    - Vitest + fast-check, ≥100 iterations, tagged "Feature: threshold, Property 1: Check-in chain ordering"

- [x] 21. Implement check-in creation and the chain orchestrator route
  - [x] 21.1 Implement `POST /api/checkin`
    - On a live NWS alert or replay fixture affecting the household, create exactly one `Check_In` per unique `alert_id` within 3s, recording `alert_id`, `alert_headline`, `is_replay`, `sent_at`; drive side effects from `nextState`/`timeoutMs`; place exactly one Twilio call on timeout (via `mayPlaceLiveCall`), recording `call_placed_at`, `call_sid`, `outcome`; on call failure advance to `advise_911` with no retry; TwiML `<Say>` states resident name only, identifies Threshold as an AI assistant (not City of Boston); in Judge/Replay with `ALLOW_LIVE_CALLS` not true, show "Simulated call (demo mode)" and place no real call
    - _Requirements: 11.1, 11.2, 11.5, 12.1, 12.2, 12.5, 12.7, 12.8, 12.9, 12.10, 22.1, 22.2_
  - [x] 21.2 Implement the resident check-in screen
    - `src/app/(resident)/home/` check-in view showing "Are you okay?" with exactly two ≥44×44px buttons; end-of-chain shows "Call 911 if this is an emergency."; assertive aria-live for advisory
    - _Requirements: 11.1, 12.3, 23.3, 23.10_

- [x] 22. Implement caregiver status polling route and screen
  - [x] 22.1 Implement `GET /api/checkin/status`
    - Return current check-in status for the household (for 3s polling); exclude other residents' details
    - _Requirements: 13.1, 10.1_
  - [x] 22.2 Implement caregiver status polling on `src/app/(caregiver)/status/page.tsx`
    - Poll every 3s (no realtime subscriptions); update displayed status within 1s of a changed response and announce via assertive aria-live; on >10s no-response or error, retain last status, show "status could not be refreshed", continue next interval; show "Call 911 if this is an emergency." at chain end; "Simulated call (demo mode)" label when simulated
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 12.3, 12.9, 23.10_

- [x] 23. Implement the Rights Card and incident logging
  - [x] 23.1 Create the rights library data (`src/lib/rights/library.json`)
    - The 10 entries (`shelter-no-exclusion`, `shelter-service-animal`, `shelter-communication`, `boston-ada-grievance`, `boston-curb-ramp`, `fema-accessibility-repairs`, `fema-medical-equipment`, `fema-late-registration`, `fema-helpline`, `fema-appeal`), each with `id`, `plain_statement`, `applies_when`, `source_url`
    - _Requirements: 14.2_
  - [x] 23.2 Implement `POST /api/incident` and the Rights Card screen
    - POST validates `kind` ∈ {shelter_refusal, service_animal, communication, other}, `place`, `occurred_at` (reject missing/invalid with field error, retain values), saves `notes` + `right_id`, confirms save
    - `src/app/(resident)/rights/page.tsx` renders only library entries (≥18px, ≥4.5:1) with source URLs via `RightsStatement`; shows "This is not legal advice." and an activatable Mass 211 link; no statement/number without a library entry or live source
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 23.5_

- [x] 24. Implement NWS alert fixtures and the blizzard replay loader
  - [x] 24.1 Create the blizzard alert fixture and replay loader route
    - `fixtures/` blizzard alert dated 2026-02-22 (eastern MA); loader feeds `POST /api/checkin` in replay mode; on fixture load failure show "This replay is unavailable right now." (no stack trace), leaving seeded data unchanged
    - _Requirements: 20.5, 20.7, 20.9, 20.10_

- [x] 25. Implement remaining Judge Mode screens
  - [x] 25.1 Implement the Judge Mode replay + fast-forward UI on `/judge`
    - Blizzard replay button loads the fixture, shows "Replay" and only the three attributed facts (ran Feb 22–23 2026, nearly three feet of snow, outages peaked above 290,000, each attributed to the Mass.gov press release dated April 9, 2026); "Fast-forward 14 days (simulated)" calls `POST /api/judge/fast-forward` and shows "Simulated time"
    - _Requirements: 20.5, 20.8, 20.9, 20.10, 23.1_

- [x] 26. Checkpoint — P3 build, tests, approval to commit
  - Run `npm run build` and `npx vitest run`; fix any failures until both pass
  - Then ask the user for approval before committing/pushing: show the file list and a plain imperative commit message and wait for the user's "yes" (follow the git steering; do not commit or push without confirmation)
  - Ensure all tests pass, ask the user if questions arise.

### Completed outside the original plan

Work done during build that was not in the original plan. Recorded here for traceability.

- [x] 36. Build the shared UI design system
  - `src/components/ui/` Button, Badge, StatusChip, Skeleton, Banner, Panel, SummaryList, TaskList, ProcessTrace, applied across screens per the ui-design steering
  - _Requirements: 23.1, 23.3, 23.5, 23.6_
- [x] 37. Fix caregiver phone validation to accept E.164
  - Validation `^\+?[0-9]{10,15}$` in `src/lib/rules/household-input.ts`; migration `20261024214010_fix_caregiver_phone_e164.sql`
  - _Requirements: 2.2, 2.3_
- [x] 38. Add the smoke script and server error logging
  - `scripts/smoke.mjs` (`npm run smoke`); `src/lib/log.ts` `logServerError`, no stack traces shown to users
  - _Requirements: 22.2, 22.3_
- [x] 39. Add the home hub and back links
  - `src/app/(resident)/home/HomeHub.tsx`, `src/components/BackLink.tsx`
  - _Requirements: 23.1_
- [x] 40. Mask caregiver phone numbers on screen
  - `src/lib/format/phone.ts` `maskPhone` on Judge Mode and caregiver screens
  - _Requirements: 10.1_
- [x] 41. Persist the draft text verbatim and allow edits before approval
  - `cases.draft_text` column via migration `20261024220000_add_cases_draft_text.sql`
  - _Requirements: 7.1, 7.3_
- [x] 42. Upload demo seed images and clean up test uploads
  - `scripts/upload-demo-images.mjs` (one-time upload to the private `vault` bucket), `scripts/cleanup-demo-test-uploads.mjs`
  - _Requirements: 20.1, 20.3_
- [x] 43. Fix the Boston 311 nearby query
  - `src/lib/data/boston311.ts`: cast text coordinates with `latitude::float8`, open filter `case_status <> 'Closed'`
  - _Requirements: 6.1, 6.2, 6.4_
- [x] 44. Wire the blizzard replay into the check-in chain
  - Replay creates a check-in and drives the resident and caregiver screens, simulated call labeled
  - _Requirements: 20.5, 11.1, 12.9_

### P4 — Aid Claim

Covers Requirements 15, 16, 20.6. Cross-cutting 10, 22, 23 apply. The forbidden-wording guard (`eligibility.ts`) and its Property 7 test were implemented in P2; the `fema-match` property (Property 2) is implemented here.

Wave 0 (fema-match pure module): task 27.1, then property test 27.2 after it.
Wave 1 (eligibility + claim routes): tasks 28.1, 29.1.
Wave 2 (claim screen + Leominster replay fixture/screen): tasks 29.2, 30.1, then checkpoint 31.

- [ ] 27. Implement the FEMA eligibility pure module (`src/lib/rules/fema-match.ts`)
  - [ ] 27.1 Implement `fema-match.ts`
    - `isEligible(records)` returns true iff any matched record has `ihProgramDeclared === true` or `iaProgramDeclared === true`; matching by county FIPS, falling back to `placeCode` for tribal areas with no county code. No I/O.
    - _Requirements: 15.1, 15.2, 15.3, 15.4_
  - [ ] 27.2 Write property test for eligibility iff declared (required)
    - **Property 2: Eligibility iff declared** — `isEligible(matched) === matched.some(r => r.ihProgramDeclared || r.iaProgramDeclared)`
    - **Validates: Requirements 21.2, 15.1, 15.2**
    - Vitest + fast-check, ≥100 iterations, tagged "Feature: threshold, Property 2: Eligibility iff declared"

- [ ] 28. Implement the eligibility route
  - [ ] 28.1 Implement `POST /api/claim/eligibility`
    - Match household county (or tribal placeCode) against OpenFEMA via `openfema.ts` (10s); on match show "You may be eligible for FEMA help. FEMA makes the final decision." with disaster number and deadline guidance within 5s; no match → plain-language no-declaration message and no eligibility message; run all text through the `eligibility.ts` forbidden-wording guard; OpenFEMA timeout/error → friendly fallback retaining entered data (no stack trace)
    - _Requirements: 15.1, 15.2, 15.5, 15.6, 22.1, 22.2, 22.3_

- [ ] 29. Implement the claim packet and Answer Sheet
  - [ ] 29.1 Implement `POST /api/claim`
    - Build the packet including every vault item captured strictly before the incident date (exclude at/after); empty list → explicit "no pre-disaster evidence" note; flag ramps/grab bars/paved pathways in `accessibility_items` under the `fema-accessibility-repairs` right; produce the Answer Sheet in copy-ready text and read-aloud script formats; strip forbidden words from all claim/Answer Sheet text via `eligibility.ts`
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 16.6_
  - [ ] 29.2 Implement the claim screen
    - `src/app/(resident)/claim/page.tsx` showing eligibility result, packet summary, accessibility items, and both Answer Sheet formats; ≥18px, honesty wording, "FEMA makes the decision"
    - _Requirements: 15.1, 16.5, 23.5_

- [ ] 30. Implement the Leominster flood replay
  - [ ] 30.1 Create `fixtures/dr-4780.json` and wire the Leominster replay on `/judge`
    - Load OpenFEMA records for disaster 4780 from `fixtures/dr-4780.json`; show "Replay", declaration date May 15, 2024, individual assistance for Bristol and Worcester counties; fixture load failure → "This replay is unavailable right now." leaving seeded data unchanged
    - _Requirements: 20.6, 20.7, 20.9, 20.10_

- [ ] 31. Checkpoint — P4 build, tests, approval to commit
  - Run `npm run build` and `npx vitest run`; fix any failures until both pass
  - Then ask the user for approval before committing/pushing: show the file list and a plain imperative commit message and wait for the user's "yes" (follow the git steering; do not commit or push without confirmation)
  - Ensure all tests pass, ask the user if questions arise.

### Later — Fine Print, Barrier Ledger, Go Card (optional, build only if time remains)

Covers Requirements 17, 18, 19. Cross-cutting 10, 22, 23 apply. These feature tasks are optional; build only if time remains.

Wave 0 (parallel, independent features): tasks 32.1, 33.1, 34.1.
Wave 1 (screens depending on their routes): tasks 32.2, 33.2.
Then checkpoint 35.

- [ ]* 32. Implement Fine Print letter explainer
  - [ ]* 32.1 Implement `POST /api/letter`
    - Store the resized letter image privately; serve only via signed URL (≤3600s); Azure produces a 6th-grade-level explanation and extracts the stated deadline as a calendar date (or "no deadline found", never fabricated); draft appeal/response in an unapproved state, ready only after explicit approval; AI timeout/error → friendly fallback retaining the image (no stack trace)
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5, 17.7, 22.1, 22.2_
  - [ ]* 32.2 Implement the Fine Print screen
    - `src/app/(resident)/letter/page.tsx` using `PhotoCapture`; shows explanation, deadline, unapproved draft with approval control; "This is not legal advice." and a Mass 211 link
    - _Requirements: 17.5, 17.6, 23.1, 23.4_

- [ ]* 33. Implement the Barrier Ledger aggregate city view
  - [ ]* 33.1 Implement `GET /api/ledger`
    - Compute per-neighborhood on-time rate for "Sidewalk Repair" and "Illegally Blocked Sidewalk" as ONTIME / (ONTIME + OVERDUE) (0–100%) from live Boston 311; exclude all other service names and any snow statistic; expose only aggregate figures; 10s timeout → friendly fallback retaining prior figures; zero cases → text indication instead of a numeric rate
    - _Requirements: 18.1, 18.2, 18.3, 18.4, 18.5, 22.1, 22.2_
  - [ ]* 33.2 Implement the Barrier Ledger screen
    - `src/app/ledger/page.tsx` showing only aggregate per-neighborhood counts and rates; no name, address, case id, coordinate, or photo
    - _Requirements: 18.2, 23.1, 23.5_

- [ ]* 34. Implement the Go Card printable page
  - [ ]* 34.1 Implement the Go Card screen
    - `src/app/(resident)/go-card/page.tsx` listing equipment (from vault items by AI label; empty-state text when none), medications, contacts, and the FEMA helpline number on one page; print styles fit all four sections on one printed page; all text ≥18px at ≥4.5:1 contrast
    - _Requirements: 19.1, 19.2, 19.3, 19.4, 19.5, 23.5_

- [ ]* 35. Checkpoint — Later build, tests, approval to commit
  - Run `npm run build` and `npx vitest run`; fix any failures until both pass
  - Then ask the user for approval before committing/pushing: show the file list and a plain imperative commit message and wait for the user's "yes" (follow the git steering; do not commit or push without confirmation)
  - Ensure all tests pass, ask the user if questions arise.

### Follow-ups (optional)

- [ ]* 45. Add a cases list screen and restore the "Your cases" hub link
  - Resident or caregiver `cases` route listing the household's cases with status; then re-add the hub link
  - _Requirements: 5.3, 8.4_
- [ ]* 46. Add PDF document support to the Proof Vault (deferred)
  - _Requirements: 3.5_
- [ ]* 47. Give each browser its own Judge Mode demo household (deferred)
  - _Requirements: 20.1, 20.3_

## Notes

- Tasks marked with `*` are optional (Later-priority features and their checkpoint) and can be skipped for a faster MVP. The seven property-based tests and the agent evaluation suite are required and are NOT marked optional, even when they fall in P4.
- Each task references specific requirement sub-clauses for traceability and names concrete files/paths from design.md.
- The first P1 task applies the Supabase schema and creates the `vault` bucket via the Supabase MCP; all later data access is server-only with the service role key.
- Property-based tests sit immediately after the pure module they validate (Vitest + fast-check, ≥100 iterations, tagged "Feature: threshold, Property {n}: {text}").
- The agent evaluation suite is the last task in the P2 group.
- Each priority group ends with a checkpoint that runs `npm run build` and `npx vitest run`, fixes failures, then asks for approval before committing/pushing (never commit or push without the user's yes).

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1"] },
    { "id": 1, "tasks": ["2.1", "2.2", "2.3", "2.4", "2.5", "2.6", "2.7", "3.1", "4.1"] },
    { "id": 2, "tasks": ["4.2", "4.3", "5.1", "5.2", "6.1", "9.1"] },
    { "id": 3, "tasks": ["5.3", "7.1"] },
    { "id": 4, "tasks": ["7.2"] },
    { "id": 5, "tasks": ["8.1"] },
    { "id": 6, "tasks": ["11.1", "12.1", "13.1", "14.1"] },
    { "id": 7, "tasks": ["11.2", "12.2", "13.2", "14.2"] },
    { "id": 8, "tasks": ["13.3"] },
    { "id": 9, "tasks": ["15.1", "15.2", "15.3"] },
    { "id": 10, "tasks": ["16.1", "16.2", "17.1"] },
    { "id": 11, "tasks": ["18.1"] },
    { "id": 12, "tasks": ["20.1"] },
    { "id": 13, "tasks": ["20.2", "21.1", "22.1", "23.1", "24.1"] },
    { "id": 14, "tasks": ["21.2", "22.2", "23.2", "25.1"] },
    { "id": 15, "tasks": ["27.1"] },
    { "id": 16, "tasks": ["27.2", "28.1", "29.1", "30.1"] },
    { "id": 17, "tasks": ["29.2"] },
    { "id": 18, "tasks": ["32.1", "33.1", "34.1"] },
    { "id": 19, "tasks": ["32.2", "33.2"] },
    { "id": 20, "tasks": ["45", "46", "47"] }
  ]
}
```
