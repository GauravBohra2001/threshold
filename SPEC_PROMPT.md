# Paste everything below into Kiro: Specs (+) > Feature > Requirements-First

Build Threshold, a mobile-first web app for disabled residents in Boston and their caregivers. Read all steering files first; they are binding. Build in vertical slices in the order below. Each slice must work end to end and be demoable before the next starts.

## Data model (Supabase Postgres, accessed only from server routes)
- households: id, resident_name, address, lat, lng, county_fips, neighborhood, caregiver_name, caregiver_phone, invite_code, is_demo, sim_offset_days (int, default 0), created_at
- vault_items: id, household_id, kind ("equipment" | "home_feature" | "document"), label, ai_description, accessibility_relevant (bool), photo_path, captured_at
- cases: id, household_id, barrier_type, description, photo_path, lat, lng, route, status ("investigating" | "draft_ready" | "waiting" | "asked_user" | "escalated" | "resolved"), city_case_id, opened_at, clock_due_at, trace (jsonb array)
- checkins: id, household_id, alert_id, alert_headline, is_replay, sent_at, answered_at, call_placed_at, call_sid, outcome ("answered" | "caregiver_called" | "advise_911")
- incidents: id, household_id, kind ("shelter_refusal" | "service_animal" | "communication" | "other"), place, occurred_at, notes, right_id
- claims: id, household_id, disaster_number, designated_area, is_replay, packet (jsonb), accessibility_items (jsonb), created_at
Time everywhere uses now() + sim_offset_days so Judge Mode can fast-forward.

## Slice 1: Household, caregiver invite, Proof Vault
- WHEN a resident creates a household, THE System SHALL geocode the address to lat, lng, county FIPS and neighborhood and SHALL generate an invite link for a caregiver.
- WHEN a caregiver opens the invite link and enters a name and phone number, THE System SHALL attach them to the household.
- WHEN a resident adds a vault photo, THE System SHALL resize it to at most 1280px, store it privately, ask the AI for a short label and description, mark whether it is accessibility-relevant, and save the capture timestamp.
- THE System SHALL show the vault as a list where every item has a text label usable by screen readers.

## Slice 2: Case Agent (Report a Barrier)
- WHEN a resident submits a barrier photo with location, THE System SHALL start a Case Agent run as defined in case-agent.md and show the trace in plain language as it progresses.
- WHEN 2 or more open 311 reports of the same service type exist within 75 meters, THE System SHALL NOT draft a new 311 report and SHALL draft an escalation to the Disabilities Commission citing the count and age of the open reports.
- WHEN the agent produces a draft, THE System SHALL require explicit resident approval before marking it ready to submit, and SHALL show a one-tap "Open BOS:311" handoff plus a field to paste the city case number.
- WHEN a case's clock_due_at passes (real or simulated time) and the case is not resolved, THE System SHALL run the agent again to check status and suggest escalation.
- THE System SHALL never display another resident's address or case details.

## Slice 3: Check-in Chain and Rights Card
- WHEN a weather alert (live NWS or replay fixture) affects the household location, THE System SHALL create a check-in and ask the resident "Are you okay?" with two large buttons.
- IF the resident does not answer within the timeout (90 seconds live, 15 seconds in replay), THEN THE System SHALL place a Twilio voice call to the caregiver phone saying who to check on, and show the caregiver screen status.
- IF the caregiver does not confirm within the next timeout, THEN THE System SHALL show "Call 911 if this is an emergency" to both screens. The chain SHALL never skip a step and SHALL never call more than once per step.
- WHEN the resident opens the Rights Card, THE System SHALL show the relevant rights from the rights library in large text with the source, and SHALL let them log an incident with time and place.

## Slice 4: Aid Claim
- WHEN the household county has a declaration where ihProgramDeclared or iaProgramDeclared is true, THE System SHALL show "You may be eligible for FEMA help" with the disaster number and deadline guidance.
- IF neither flag is true, THEN THE System SHALL NOT show any eligibility message.
- WHEN a claim packet is built, THE System SHALL include vault items captured before the incident date as pre-disaster evidence and SHALL flag accessibility items (ramps, grab bars, paved pathways) under the fema-accessibility-repairs right.
- THE System SHALL produce an Answer Sheet in two formats: copy-ready text and a read-aloud script for the FEMA helpline.

## Slice 5 to 7 (only after 1 to 4 work)
Fine Print letter explainer, Barrier Ledger (live on-time rates for "Sidewalk Repair" and "Illegally Blocked Sidewalk" by neighborhood, aggregate only), Go Card (print styles).

## Judge Mode
- /judge seeds a fictional household "Maria" in Dorchester with caregiver "Ana" (phone from CAREGIVER_DEMO_NUMBER) and sample vault items, labeled "Demo data, fictional people".
- Replay A, "February 2026 blizzard (replay)": a fixture alert dated 2026-02-22 for eastern Massachusetts. Facts allowed on screen: the storm ran February 22 to 23, 2026, dropped nearly three feet of snow, and power outages peaked above 290,000 (source: Mass.gov press release, April 9, 2026).
- Replay B, "Leominster flood (replay)": use the fetch MCP to pull the real OpenFEMA DisasterDeclarationsSummaries records for disasterNumber 4780 and save them to fixtures/dr-4780.json. Declared May 15, 2024; individual assistance for Bristol and Worcester counties.
- A "Fast-forward 14 days (simulated)" button increments sim_offset_days and triggers due agent follow-ups.

## Correctness properties to generate property-based tests for (fast-check)
1. Check-in chain: for any sequence of answer and no-answer events, steps occur in order, no step is skipped, and at most one call is placed per step.
2. Eligibility: for any declaration record, an eligibility message appears if and only if ihProgramDeclared or iaProgramDeclared is true for the household's county or tribal place.
3. Duplicate routing: for any set of nearby open cases, a new 311 draft is produced if and only if fewer than 2 matching open reports exist within 75 meters.
4. Privacy: for any agent output or API response sent to the browser, no string contains a full_address from the 311 data.
5. Clocks: for any open date and sim offset, clock_due_at is never earlier than the open date, and a follow-up is due if and only if now plus offset is past clock_due_at.
6. Wording: no generated eligibility text contains "you will receive", "guaranteed", or "approved".
