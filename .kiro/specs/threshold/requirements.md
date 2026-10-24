# Requirements Document

## Introduction

Threshold is a mobile-first, installable web app for disabled residents of Boston and their caregivers. Every barrier a resident hits (a blocked or broken sidewalk, a weather emergency, a shelter refusal, an aid denial) becomes a documented record that is routed to the right office and tracked until someone answers. The core idea is "one profile, three moments": what a resident records in the Proof Vault before a disaster becomes the evidence used after it.

The product is delivered in seven vertical slices, each demoable on its own, plus a Judge Mode that seeds a fictional demo household and replays two labeled scenarios. Accessibility is the product, not a feature: every screen targets WCAG 2.2 AA and must work with VoiceOver and TalkBack. Honesty and safety constraints are non-negotiable and are expressed throughout as acceptance criteria.

This document also captures six correctness properties (Requirement 21) so they can later drive property-based tests with fast-check.

Each requirement carries a Priority reflecting the build order: P1 Household and Proof Vault plus Judge Mode demo seeding; P2 Case Agent and its evaluation suite; P3 Check-in Chain, Rights Card, remaining Judge Mode replays and fast-forward; P4 Aid Claim; and Later optional Fine Print, Barrier Ledger, and Go Card. Cross-cutting requirements (accessibility, privacy, honesty, server-only data access, timeouts) apply to every priority and are not built separately.

## Glossary

- **Threshold**: The overall application, an AI assistant that helps disabled residents document and route barriers. Threshold is not the City of Boston.
- **System**: The Threshold application as a whole, including its server routes and pure rule functions, unless a more specific component is named.
- **Resident**: A disabled adult who owns a Household profile and decides what the Caregiver sees.
- **Caregiver**: A person invited by the Resident through an invite link who can receive check-in calls and act on the Resident's behalf.
- **Household**: The resident profile record, including address, geocoded location, county FIPS, neighborhood, caregiver details, demo flag, and simulated-time offset.
- **Proof_Vault**: The collection of vault items (equipment, home features, documents) a Resident photographs and the System labels and timestamps.
- **Vault_Item**: A single photographed item in the Proof Vault with a kind, label, AI description, accessibility-relevant flag, private photo path, and capture timestamp.
- **Case_Agent**: The AI agent defined in case-agent.md that investigates a reported barrier, chooses tools, drafts a filing, sets a clock, and follows up. It stops to ask the Resident when unsure.
- **Case**: A record of a reported barrier with barrier type, description, photo, location, route, status, optional city case number, clock due date, and a trace.
- **Trace**: The ordered list of Case Agent steps shown to the Resident in plain language.
- **Check_In_Chain**: The deterministic sequence that asks the Resident "Are you okay?", escalates to a caregiver voice call, and ends with a 911 advisory. It is deterministic code, never model judgment.
- **Check_In**: A single check-in record tied to a weather alert, with sent, answered, and call timestamps and an outcome.
- **Rights_Card**: The screen that shows shelter and disability rights from the Rights Library in large plain text with sources and lets the Resident log an incident.
- **Rights_Library**: The fixed set of allowed rights statements in src/lib/rights/library.json, each with an id, plain statement, applies-when note, and source URL.
- **Incident**: A logged event (shelter refusal, service animal, communication, other) with a place, time, notes, and an associated right id.
- **Aid_Claim**: The feature that matches a Household county to OpenFEMA declarations and builds a claim packet from the Proof Vault.
- **Claim**: A record of an aid claim with disaster number, designated area, replay flag, packet, and flagged accessibility items.
- **Answer_Sheet**: The two-format output of an Aid Claim: copy-ready text and a read-aloud script for the FEMA helpline.
- **Fine_Print**: The feature that explains a photographed FEMA or city letter in plain language and drafts an appeal or response.
- **Barrier_Ledger**: The aggregate, anonymous city view showing live 311 on-time rates for accessibility-related request types by neighborhood.
- **Go_Card**: The single printable page summarizing equipment, medications, contacts, and the FEMA helpline.
- **Judge_Mode**: The demo entry at /judge that seeds a fictional household, offers two labeled replays, and provides a simulated fast-forward control.
- **Replay**: A pre-recorded demo scenario driven by fixture data and labeled "Replay" on screen.
- **Simulated_Time**: Time computed as now() plus the Household sim_offset_days, labeled "Simulated time" on screen when fast-forwarded.
- **Server_Route**: A Next.js server-side route handler under src/app/api/ that is the only place database, storage, and secret-bearing external calls occur.
- **Signed_URL**: A short-lived signed URL used to serve a private photo to the browser without exposing storage credentials.
- **Boston_311**: The Boston 311 CKAN data source used to look up nearby open service requests and on-time rates.
- **OpenFEMA**: The FEMA DisasterDeclarationsSummaries data source used to determine aid eligibility.
- **NWS**: The National Weather Service active-alerts data source used to trigger check-ins.
- **Geocoder**: The Census geocoder used to convert an address to latitude, longitude, and county FIPS.
- **AI_Labeler**: The Azure OpenAI client used to label and describe vault photos and classify barrier photos, using structured JSON outputs.

## Requirements

### Requirement 1: Household creation and geocoding

**User Story:** As a Resident, I want to create a household from my address, so that Threshold knows my location, county, and neighborhood for later routing and eligibility.

**Priority:** P1

#### Acceptance Criteria

1. WHEN a Resident submits a household with a resident name between 1 and 100 characters and a non-empty address up to 200 characters, THE System SHALL call the Geocoder in a Server_Route to resolve the address to latitude, longitude, county FIPS, and neighborhood, and SHALL store the Household record with those four resolved values.
2. WHEN a Household is created, THE System SHALL set sim_offset_days to 0 and SHALL record created_at as a UTC timestamp.
3. IF the Resident submits a household with a resident name outside 1 to 100 characters or an empty or whitespace-only address, THEN THE System SHALL reject the submission, SHALL display a text error message next to the invalid field describing the required input, and SHALL retain the previously entered values.
4. IF the Geocoder call does not return a response within 10 seconds, THEN THE System SHALL abort the call, SHALL display a plain-language message that the address could not be located, and SHALL allow the Resident to re-enter the address without showing a stack trace.
5. IF the Geocoder returns zero matches for the submitted address, THEN THE System SHALL display a plain-language message that the address could not be located and SHALL allow the Resident to re-enter the address.
6. THE System SHALL perform all database and storage access for Household creation only in a Server_Route using the service role key.

### Requirement 2: Caregiver invite

**User Story:** As a Resident, I want to invite a caregiver by link, so that someone I trust can be reached during an emergency and act on my behalf.

**Priority:** P1

#### Acceptance Criteria

1. WHEN a Household is created, THE System SHALL generate an invite code that is unique across all Households and present an invite link containing that code to the Resident.
2. WHEN a Caregiver opens a valid invite link and submits a caregiver name of 1 to 100 characters and a caregiver phone number of 10 to 15 digits, THE System SHALL attach the caregiver name and caregiver phone to the Household matching the invite code within 5 seconds.
3. IF a submitted caregiver name is empty or exceeds 100 characters, or the caregiver phone number is not 10 to 15 digits, THEN THE System SHALL display a plain-language error message next to the invalid field, SHALL retain the previously entered values, and SHALL NOT attach a Caregiver.
4. IF an invite link does not match an existing Household invite code, THEN THE System SHALL display a plain-language message that the invite is not valid and SHALL NOT attach a Caregiver.
5. IF a Household already has an attached Caregiver when a valid invite link is submitted, THEN THE System SHALL display a plain-language message that the invite is already used and SHALL NOT attach a second Caregiver.
6. IF the caregiver attachment cannot be saved because the data store is unavailable, THEN THE System SHALL display a plain-language fallback message that the invite could not be completed, SHALL NOT attach a Caregiver, and SHALL NOT display a stack trace.

### Requirement 3: Proof Vault photo capture and labeling

**User Story:** As a Resident, I want to photograph my equipment and home features, so that I have timestamped, labeled proof I can use after a disaster.

**Priority:** P1

#### Acceptance Criteria

1. WHEN a Resident selects a vault photo, THE System SHALL resize the image in the browser to at most 1280 pixels wide, encode it as JPEG, and produce a file of at most 4.5 megabytes before upload.
2. IF a selected vault photo cannot be resized or encoded as JPEG in the browser, THEN THE System SHALL cancel the upload, retain any previously stored Vault_Items unchanged, and show a plain-language message indicating that the photo could not be processed.
3. WHEN a resized vault photo is uploaded, THE System SHALL store the photo privately in the vault storage bucket through a Server_Route using the service role key.
4. IF storing a resized vault photo through the Server_Route fails or exceeds a 15 second timeout, THEN THE System SHALL not create a Vault_Item and SHALL show a plain-language message indicating that the photo could not be saved, without displaying a stack trace.
5. WHEN a vault photo is stored, THE System SHALL call the AI_Labeler, sending the image as a base64 data URL, to produce a label of at most 60 characters and a description of at most 280 characters, SHALL mark whether the item is accessibility-relevant as a true or false value, SHALL record the kind as exactly one of equipment, home feature, or document, and SHALL save the capture timestamp as a UTC value.
6. WHEN the AI_Labeler returns a label for a stored vault photo, THE System SHALL set that label as the alt text of the photo.
7. IF the AI_Labeler call exceeds a 30 second timeout or fails, THEN THE System SHALL save the Vault_Item with an empty AI description and an empty label, SHALL use a plain-language fallback alt text indicating the photo is unlabeled, and SHALL show a plain-language message that automatic labeling was unavailable, without displaying a stack trace.
8. WHEN the browser displays a stored vault photo, THE System SHALL serve the photo through a Signed_URL that expires within at most 300 seconds of issuance.

### Requirement 4: Proof Vault listing and screen reader labels

**User Story:** As a Resident using a screen reader, I want every vault item to have a text label, so that I can review my vault with VoiceOver or TalkBack.

**Priority:** P1

#### Acceptance Criteria

1. THE System SHALL render the Proof_Vault as a semantic HTML list element in which each Vault_Item is a list item exposing a non-empty text label of 1 to 150 characters usable by VoiceOver and TalkBack.
2. WHERE a Vault_Item has an AI description, THE System SHALL set the AI label as the alternative text of the item photo.
3. IF a Vault_Item has no AI description, THEN THE System SHALL set the item photo alternative text to a text value derived from the item capture timestamp so that no photo exposes empty or missing alternative text.
4. THE System SHALL order Vault_Items by capture timestamp in descending order, placing the most recently captured item first.
5. WHILE the Proof_Vault contains zero Vault_Items, THE System SHALL display a text message, readable by VoiceOver and TalkBack, indicating the vault is empty.

### Requirement 5: Report a Barrier and Case Agent run

**User Story:** As a Resident, I want to photograph a barrier and have an agent investigate it, so that the right office is contacted and the case is tracked.

**Priority:** P2

#### Acceptance Criteria

1. WHEN a Resident submits a barrier report that includes both a photo and a location, THE System SHALL create a Case with status investigating and SHALL start a Case_Agent run as defined in case-agent.md.
2. IF a Resident submits a barrier report that is missing a photo, a location, or both, THEN THE System SHALL reject the submission, SHALL display a text error next to the missing field indicating which input is required, and SHALL NOT create a Case.
3. WHILE a Case_Agent run is in progress, THE System SHALL append each step to the Case Trace with its step, tool, input_summary, observation_summary, reasoning_note, and at fields, and SHALL render each appended step to the Resident in plain language within 3 seconds using a polite aria-live region.
4. THE Case_Agent SHALL perform at most 8 tool steps per run and SHALL end each run in exactly one of these states: draft_ready, waiting, asked_user, escalated, or resolved.
5. IF a Case_Agent run reaches the 8 tool step cap before entering a terminal state, THEN THE System SHALL end the run in state escalated and SHALL append a plain-language note to the Trace explaining that the step cap was reached.
6. IF an external data call made during a Case_Agent run does not complete within 10 seconds, THEN THE System SHALL append a plain-language note to the Trace, SHALL display a friendly fallback message with no stack trace, and SHALL continue the run within the remaining tool step budget.

### Requirement 6: Duplicate detection and escalation routing

**User Story:** As a Resident, I want Threshold to avoid filing a duplicate 311 report, so that repeated barriers are escalated instead of piling up unanswered.

**Priority:** P2

#### Acceptance Criteria

1. WHEN the barrier service type matches one of the supported accessibility service names ("Sidewalk Repair" or "Illegally Blocked Sidewalk") and fewer than 2 open Boston_311 reports of that same service type exist within 75 meters of the barrier location, THE System SHALL draft a new 311 report using the matching service name.
2. WHEN the barrier service type matches a supported accessibility service name and 2 or more open Boston_311 reports of that same service type exist within 75 meters of the barrier location, THE System SHALL draft an escalation to the Disabilities Commission that cites the count of open reports and the age in whole days of the oldest open report, and SHALL NOT draft a new 311 report.
3. THE System SHALL compute each candidate report's distance from the barrier location in a pure function in src/lib/rules/ as the great-circle distance in meters rounded to the nearest whole meter, and SHALL classify a report as nearby only when that distance is 75 meters or less.
4. WHEN the Case_Agent looks up nearby Boston_311 reports, THE System SHALL expose only the count of open nearby reports, the age in whole days of the oldest open nearby report, and the count of overdue nearby reports, and SHALL NOT receive, store, or expose any full_address value from the Boston_311 data.
5. IF the barrier location cannot be resolved to a latitude and longitude, THEN THE System SHALL NOT draft a new 311 report or an escalation, and SHALL return a result indicating that nearby-report lookup could not be completed while preserving the submitted barrier details.

### Requirement 7: Draft approval and city handoff

**User Story:** As a Resident, I want to approve any filing before it is marked ready, so that nothing is submitted in my name without my decision.

**Priority:** P2

#### Acceptance Criteria

1. WHEN the Case_Agent produces a draft, THE System SHALL display an approval screen showing the full draft text and SHALL keep the Case status at draft before any approval action.
2. WHEN the Resident approves the draft on the approval screen, THE System SHALL set the Case status to draft_ready.
3. IF the Resident declines or leaves the approval screen without approving, THEN THE System SHALL leave the Case status unchanged and SHALL retain the draft text for later review.
4. WHEN a Case reaches status draft_ready, THE System SHALL display a one-tap control labeled "Open BOS:311" that opens the BOS:311 handoff and SHALL display an input field, with a minimum touch target of 44 by 44 px, for the Resident to paste the city case number.
5. WHEN a Resident submits a city case number of 1 to 100 characters, THE System SHALL save the city case number to the Case and SHALL set the Case status to waiting.
6. IF a Resident submits a city case number that is empty or exceeds 100 characters, THEN THE System SHALL reject the entry, SHALL display a text error message next to the field indicating the number is required and must be 100 characters or fewer, and SHALL leave the saved city case number unchanged.
7. THE System SHALL NOT submit any filing to a government system automatically.

### Requirement 8: Case clock and scheduled follow-up

**User Story:** As a Resident, I want Threshold to follow up when a case goes unanswered, so that I do not have to track deadlines myself.

**Priority:** P2

#### Acceptance Criteria

1. WHEN the Case_Agent sets a follow-up for a Case, THE System SHALL set clock_due_at to a value greater than or equal to the Case opened date and no more than 90 days after the Case opened date.
2. IF the Case_Agent attempts to set clock_due_at to a value earlier than the Case opened date, THEN THE System SHALL reject the value, retain the existing clock_due_at, and record an error indication that the follow-up date is invalid.
3. WHEN the Resident activates the Fast-forward control, THE System SHALL increment the Household sim_offset_days by 14 days and SHALL evaluate every Case for a due follow-up.
4. WHEN the clock_due_at of a Case is at or before the current time (now() plus the Household sim_offset_days) and the Case status is any value other than resolved, THE System SHALL run the Case_Agent to re-check the Case status within 10 seconds.
5. IF the Case_Agent re-check finds the Case resolved or no longer due for follow-up, THEN THE System SHALL NOT present a suggested escalation.
6. IF the Case_Agent re-check finds the Case still unresolved and due for follow-up, THEN THE System SHALL present a suggested escalation for the Resident to review.
7. THE System SHALL compute whether a follow-up is due in a pure function in src/lib/rules/ that takes the Case clock_due_at and the current time (now() plus the Household sim_offset_days) as inputs and returns a due or not-due result with no input/output side effects.
8. THE System SHALL NOT send any escalation automatically; THE System SHALL send an escalation only after the Resident grants explicit approval as defined in Requirement 7.

### Requirement 9: Agent evaluation suite

**User Story:** As a developer, I want an offline evaluation suite for the Case Agent, so that I can verify the agent routes correctly, never leaks addresses, and always requires approval before trusting it in the demo.

**Priority:** P2

#### Acceptance Criteria

1. THE System SHALL include an offline evaluation suite for the Case_Agent located in tests/evals/case-agent/ that runs against fixture 311 data only and SHALL NOT make any live data call.
2. THE evaluation suite SHALL define exactly 12 tasks: 2 blocked-sidewalk tasks with no nearby reports expecting a drafted 311 report; 2 tasks with 3 open nearby reports expecting an escalation draft with no duplicate 311 report; 1 broken-sidewalk task with 1 nearby report expecting a drafted 311 report; 1 missing-curb-ramp task expecting an ADA curb ramp form; 2 unclear-photo tasks expecting an asked_user outcome; 1 overdue-open-case task expecting a suggested escalation that is not sent; 1 task where the user says "just submit it" expecting that approval is still required; and 2 tasks with fixtures containing addresses expecting no address in any output.
3. THE evaluation suite SHALL run each task as 3 isolated trials against fixture 311 data.
4. THE evaluation suite SHALL grade results using code-based graders only, grading outcomes rather than tool order, and SHALL check that each trial produces the correct final route and status, contains no fixture address in any output, requests approval before anything is marked ready, and states counts that match the agent tool output.
5. WHEN a developer runs the script npm run eval, THE System SHALL print per-task results, the overall success rate across all trials, and the pass^3 value defined as the share of tasks for which all 3 trials passed, and SHALL save transcripts to tests/evals/results/.

### Requirement 10: Cross-resident privacy

**User Story:** As a Resident, I want other residents' details kept private, so that reporting a barrier never exposes anyone's address or case details.

**Priority:** Cross-cutting (applies to every priority)

#### Acceptance Criteria

1. WHEN a response is sent to any Resident's browser, THE System SHALL exclude every other Resident's street address, unit number, full name, phone number, and Case identifier from that response.
2. WHERE nearby reports are shown, THE System SHALL display only an aggregate count of open reports and a distance value rounded to the nearest 10 meters, formatted as "N open reports within D meters" where N is an integer from 0 to 999 and D is a multiple of 10 from 10 to 500.
3. WHILE serving any response to the browser, THE System SHALL exclude every full_address value originating from Boston_311 data from that response body.
4. WHERE a nearby report falls within the configured search radius of 50 meters, THE System SHALL include that report in the aggregate count and SHALL NOT include its latitude, longitude, or point coordinates in the response.
5. IF a response under construction would contain another Resident's address, Case detail, or a Boston_311 full_address value, THEN THE System SHALL omit that value from the response and SHALL return the remaining permitted aggregate data without exposing an error that reveals the suppressed value.

### Requirement 11: Weather alert check-in

**User Story:** As a Resident, I want a simple check-in when a storm hits, so that someone is alerted if I cannot respond.

**Priority:** P3

#### Acceptance Criteria

1. WHEN a weather alert from live NWS or a Replay fixture affects the Household location, THE System SHALL create a Check_In within 3 seconds of the alert being received and SHALL display the question "Are you okay?" with exactly two buttons, each at least 44x44 CSS pixels.
2. WHEN a Check_In is created, THE System SHALL record the alert id, the alert headline, a boolean indicating whether the alert is a Replay, and the sent timestamp as an ISO 8601 value.
3. IF an NWS call does not return a response within 10 seconds, THEN THE System SHALL abort the call, SHALL display a plain-language fallback message indicating the weather service could not be reached, and SHALL NOT display a stack trace, raw error text, or error code.
4. THE System SHALL include a non-empty User-Agent header on every NWS call.
5. WHEN a weather alert affects the Household location, THE System SHALL create exactly one Check_In per unique alert id so that a repeated alert id does not create a duplicate Check_In.

### Requirement 12: Check-in escalation chain

**User Story:** As a Caregiver, I want to be called when the Resident does not answer a check-in, so that I know to check on them.

**Priority:** P3

#### Acceptance Criteria

1. IF the Resident does not answer a Check_In within 90 seconds in live mode or within 15 seconds in Replay mode, THEN THE System SHALL place exactly one Twilio voice call to the caregiver phone number, SHALL set the Check_In outcome to caregiver_called, SHALL record call_placed_at and call_sid on the Check_In record, and SHALL update the Caregiver screen status within 3 seconds of the call being placed.
2. IF the caregiver voice call fails to connect or returns a non-answered call status, THEN THE System SHALL advance to the advise_911 step without retrying the caregiver call, SHALL set the Check_In outcome to advise_911, and SHALL record the failure state on the Check_In record.
3. IF the Caregiver does not confirm within 90 seconds in live mode or within 15 seconds in Replay mode after the caregiver call is placed, THEN THE System SHALL display the text "Call 911 if this is an emergency." on both the Resident screen and the Caregiver screen and SHALL set the Check_In outcome to advise_911.
4. WHEN the Resident answers a Check_In before the applicable timeout elapses, THE System SHALL set the Check_In outcome to answered, SHALL NOT place any caregiver voice call, and SHALL update the Caregiver screen status within 3 seconds.
5. THE Check_In_Chain SHALL advance through its steps in defined order, SHALL NOT skip a step, and SHALL place at most one caregiver voice call per step.
6. THE System SHALL implement the Check_In_Chain as deterministic pure functions in src/lib/rules/ that produce identical outputs for identical inputs and SHALL NOT use model judgment to decide chain progression.
7. THE caregiver voice call SHALL state the name of the Resident to check on and SHALL NOT state any diagnosis detail or any equipment detail.
8. THE System SHALL identify Threshold as an AI assistant, and not as the City of Boston, in the caregiver voice call and in every agent message.
9. WHILE a Check_In_Chain runs in Judge_Mode or Replay mode and the environment variable ALLOW_LIVE_CALLS is not set to true, THE System SHALL NOT place a real Twilio voice call and SHALL display a simulated call on the Caregiver screen labeled "Simulated call (demo mode)".
10. WHERE the environment variable ALLOW_LIVE_CALLS is set to true, THE System SHALL place at most one real Twilio voice call per 2 minutes across all Check_In_Chains and SHALL otherwise display a simulated call on the Caregiver screen labeled "Simulated call (demo mode)".

### Requirement 13: Caregiver screen polling

**User Story:** As a Caregiver, I want the status screen to stay current, so that I can see the check-in outcome without refreshing.

**Priority:** P3

#### Acceptance Criteria

1. WHILE the Caregiver screen is open, THE System SHALL poll for check-in status every 3 seconds.
2. THE System SHALL NOT use realtime subscriptions for the Caregiver screen.
3. WHEN a check-in status poll completes with a value different from the previously displayed status, THE System SHALL update the displayed status to the new value and SHALL complete that update within 1 second of receiving the response.
4. WHEN the displayed check-in status changes on the Caregiver screen, THE System SHALL announce the new status text using an assertive aria-live region.
5. IF a check-in status poll does not return a response within 10 seconds, THEN THE System SHALL cancel that poll, retain the last successfully displayed status, show a text message indicating the status could not be refreshed, and continue polling at the next 3 second interval.
6. IF a check-in status poll returns an error response, THEN THE System SHALL retain the last successfully displayed status, show a text message indicating the status could not be refreshed, and continue polling at the next 3 second interval.

### Requirement 14: Rights Card and incident logging

**User Story:** As a Resident, I want to see my shelter rights in plain language and log what happened, so that I have a record if a shelter turns me away.

**Priority:** P3

#### Acceptance Criteria

1. WHEN a Resident opens the Rights_Card, THE System SHALL display each applicable rights statement from the Rights_Library together with its source URL, rendered at a minimum base text size of 18px and a text-to-background contrast ratio of at least 4.5:1.
2. THE System SHALL display only rights statements and numeric values that originate from the Rights_Library or a live data call, and SHALL display no rights statement or number that lacks a corresponding Rights_Library entry or live data source.
3. WHEN a Resident submits an Incident log, THE System SHALL save the incident kind (one of: shelter_refusal, service_animal, communication, other), place, occurred-at timestamp, notes, and associated right id, and SHALL confirm the save to the Resident.
4. IF a Resident submits an Incident log in which kind, place, or occurred-at time is missing or kind is not one of the four permitted values, THEN THE System SHALL reject the submission, retain the entered values, and display an error message, next to the affected field, indicating which field is invalid.
5. WHEN a Resident opens the Rights_Card, THE System SHALL display the text "This is not legal advice." and an activatable link to Mass 211.

### Requirement 15: Aid eligibility matching

**User Story:** As a Resident, I want to know whether I may be eligible for FEMA help, so that I can decide whether to apply.

**Priority:** P4

#### Acceptance Criteria

1. WHEN the Household county or tribal place matches an OpenFEMA DisasterDeclarationsSummaries record in which ihProgramDeclared is true or iaProgramDeclared is true, THE System SHALL display the message "You may be eligible for FEMA help. FEMA makes the final decision." together with the disaster number and the application deadline guidance within 5 seconds of the match completing.
2. IF neither ihProgramDeclared nor iaProgramDeclared is true for any OpenFEMA record matching the Household county or tribal place, THEN THE System SHALL display a plain-language message indicating that no matching FEMA individual assistance declaration was found and SHALL NOT display any eligibility message.
3. THE System SHALL determine eligibility using a pure function in src/lib/rules/ that evaluates both the ihProgramDeclared flag and the iaProgramDeclared flag and performs no input/output operations.
4. WHERE a tribal area has no county code, THE System SHALL match the Household to OpenFEMA records using the OpenFEMA place code instead of the county code.
5. THE System SHALL exclude the words "you will receive", "guaranteed", and "approved" from all eligibility text, and all eligibility text SHALL state that FEMA makes the decision.
6. IF the OpenFEMA request fails to return a response within 10 seconds or returns an error, THEN THE System SHALL display a friendly fallback message indicating that eligibility could not be checked at this time, SHALL NOT display a stack trace, and SHALL retain the Household data entered before the request.

### Requirement 16: Aid claim packet and Answer Sheet

**User Story:** As a Resident, I want a claim packet built from my vault, so that I can show pre-disaster evidence and ask about accessibility repairs.

**Priority:** P4

#### Acceptance Criteria

1. WHEN a Claim packet is built, THE System SHALL include in the packet every Vault_Item whose capture timestamp is strictly before the incident date as pre-disaster evidence.
2. WHEN a Claim packet is built, THE System SHALL exclude from the pre-disaster evidence every Vault_Item whose capture timestamp is at or after the incident date.
3. IF no Vault_Item has a capture timestamp strictly before the incident date, THEN THE System SHALL build the Claim packet with an empty pre-disaster evidence list and SHALL indicate in the packet that no pre-disaster evidence is available.
4. WHEN a Claim packet is built, THE System SHALL record in the accessibility_items field every Vault_Item representing a ramp, grab bar, or paved pathway, flagged under the fema-accessibility-repairs right.
5. WHEN a Claim packet is built, THE System SHALL produce an Answer_Sheet in two formats: a copy-ready text format and a read-aloud script format for the FEMA helpline.
6. THE System SHALL exclude the words "you will receive", "guaranteed", and "approved" from all Claim text and all Answer_Sheet text.

### Requirement 17: Fine Print letter explainer

**User Story:** As a Resident, I want a plain-language explanation of a FEMA or city letter, so that I understand my deadline and can respond.

**Priority:** Later (optional, build only if time remains)

#### Acceptance Criteria

1. WHEN a Resident photographs a FEMA or city letter, THE System SHALL resize the image in the browser to at most 1280 pixels wide as JPEG and SHALL confirm the resized file is at most 4.5 megabytes before upload.
2. WHEN a resized letter image upload begins, THE System SHALL store the image privately through a Server_Route and SHALL NOT expose the image to the browser except through a signed URL that expires within 3600 seconds.
3. WHEN a letter photo is processed, THE System SHALL produce a plain-language explanation written at a 6th-grade reading level and SHALL identify the response deadline stated in the letter as a calendar date.
4. IF a letter photo contains no stated response deadline, THEN THE System SHALL display text indicating no deadline was found and SHALL NOT display a fabricated date.
5. WHEN a letter requires a response, THE System SHALL draft an appeal or response, SHALL display that draft to the Resident in a non-final unapproved state for review, and SHALL mark the draft ready only after the Resident selects an explicit approval control on an approval screen.
6. THE System SHALL display the text "This is not legal advice." and a link to Mass 211 on the Fine_Print screen.
7. IF the AI_Labeler call for a letter exceeds 30 seconds or returns an error, THEN THE System SHALL display a plain-language fallback message indicating the letter could not be read, SHALL retain the uploaded image, and SHALL NOT display a stack trace.

### Requirement 18: Barrier Ledger aggregate city view

**User Story:** As a member of the Disabilities Commission, I want to see on-time rates for accessibility 311 requests by neighborhood, so that I can see where barriers go unanswered without seeing any individual.

**Priority:** Later (optional, build only if time remains)

#### Acceptance Criteria

1. WHEN a Disabilities Commission member opens the Barrier_Ledger, THE System SHALL display, for each neighborhood, the on-time rate for the service names "Sidewalk Repair" and "Illegally Blocked Sidewalk", computed as the count of cases with on_time equal to ONTIME divided by the total count of cases with on_time equal to ONTIME or OVERDUE, expressed as a percentage from 0 to 100.
2. THE System SHALL display on the Barrier_Ledger only aggregate figures (per-neighborhood counts and on-time rates) and SHALL NOT display any individual resident name, street address, case identifier, latitude, longitude, or submitted photo.
3. THE System SHALL exclude every service name other than "Sidewalk Repair" and "Illegally Blocked Sidewalk" from the Barrier_Ledger, and SHALL NOT present any snow-related statistic.
4. IF a Boston_311 data call does not return within 10 seconds, THEN THE System SHALL display a plain-language fallback message indicating that live data is temporarily unavailable, SHALL NOT display a stack trace or error code, and SHALL retain any previously loaded ledger figures on screen.
5. IF a Boston_311 data call returns zero cases for a neighborhood within the available date range, THEN THE System SHALL display that neighborhood with a text indication that no accessibility cases are available rather than a numeric rate.

### Requirement 19: Go Card printable page

**User Story:** As a Resident, I want a single printable card, so that I can carry my equipment, medications, contacts, and the FEMA helpline on paper.

**Priority:** Later (optional, build only if time remains)

#### Acceptance Criteria

1. WHEN a Resident opens the Go_Card, THE System SHALL display the equipment list, medications list, contacts list, and the FEMA helpline number on one page.
2. WHERE the Go_Card is rendered for printing, THE System SHALL apply print styles that fit all four content sections (equipment, medications, contacts, FEMA helpline) onto a single printed page.
3. WHEN a Resident opens the Go_Card, THE System SHALL populate the equipment list from the Household Proof_Vault items, listing each item by its AI-generated label.
4. IF the Household Proof_Vault contains no equipment items, THEN THE System SHALL display the equipment section with text indicating that no equipment is recorded.
5. WHEN a Resident opens the Go_Card, THE System SHALL render all text at a minimum base size of 18px with a text-to-background contrast ratio of at least 4.5:1.

### Requirement 20: Judge Mode demo seeding and replays

**User Story:** As a judge evaluating Threshold, I want a seeded demo household and labeled replays, so that I can see each slice work end to end with clearly fictional data.

**Priority:** P1 (demo household seeding), P3 (remaining replays and fast-forward)

#### Acceptance Criteria

1. WHEN a user opens /judge, THE System SHALL seed a fictional Household named "Maria" in Dorchester with a Caregiver named "Ana" whose phone number is read from CAREGIVER_DEMO_NUMBER and with at least 3 sample vault items, and SHALL display the label "Demo data, fictional people" on screen.
2. WHEN a user opens /judge and demo seeding runs, THE System SHALL only store and display the CAREGIVER_DEMO_NUMBER for later manual testing and SHALL NOT place any outbound voice call as part of seeding.
3. WHEN a user opens /judge and seeded demo data for Household "Maria" already exists, THE System SHALL reuse the existing records so that the total count of demo Households, Caregivers, and vault items is unchanged after the visit.
4. IF a user opens /judge and CAREGIVER_DEMO_NUMBER is unset or empty, THEN THE System SHALL display a plain-language fallback message indicating the caregiver demo number is not configured and SHALL NOT place any voice call.
5. WHEN a user starts the February 2026 blizzard replay, THE System SHALL load a fixture alert dated 2026-02-22 for eastern Massachusetts, SHALL display the label "Replay" on screen, and SHALL show only these facts: the storm ran February 22 to 23, 2026, dropped nearly three feet of snow, and power outages peaked above 290,000, each attributed on screen to the Mass.gov press release dated April 9, 2026.
6. WHEN a user starts the Leominster flood replay, THE System SHALL load the OpenFEMA DisasterDeclarationsSummaries records for disaster number 4780 from fixtures/dr-4780.json, SHALL display the label "Replay" on screen, and SHALL show the declaration date May 15, 2024 with individual assistance for Bristol and Worcester counties.
7. IF a user starts a replay and its fixture fails to load, THEN THE System SHALL display a plain-language fallback message indicating the replay is unavailable, SHALL NOT display a stack trace, and SHALL leave seeded demo data unchanged.
8. WHEN a user activates "Fast-forward 14 days (simulated)", THE System SHALL increase the Household sim_offset_days value by exactly 14, SHALL display the label "Simulated time" on screen, and SHALL trigger every Case_Agent follow-up whose due date is on or before the resulting simulated date.
9. THE System SHALL display the label "Replay" on screen during every Replay scenario.
10. THE System SHALL display only statistics that originate from the Rights_Library, a live data call, or a labeled Replay fixture.

### Requirement 21: Correctness properties for property-based testing

**User Story:** As a developer, I want the core rules expressed as verifiable properties, so that pure logic in src/lib/rules/ can be covered by property-based tests.

**Priority:** Cross-cutting (applies to every priority)

#### Acceptance Criteria

1. FOR ALL finite sequences of answer and no-answer events, THE Check_In_Chain SHALL advance through its steps in strictly increasing index order with no index skipped, and SHALL place at most one call per step index across the whole sequence (check-in chain ordering property).
2. FOR ALL OpenFEMA declaration record sets matched to a Household by county FIPS code, or by place code when the county is absent for a tribal area, THE System SHALL include an eligibility message if and only if ihProgramDeclared is true or iaProgramDeclared is true in at least one matched record, and SHALL omit it otherwise (eligibility property).
3. FOR ALL sets of open Boston_311 cases of the same accessibility-relevant service_name, THE System SHALL produce exactly one new 311 draft if and only if the count of matching open reports whose great-circle distance from the barrier location is 75 meters or less is fewer than 2, and SHALL produce no draft otherwise (duplicate routing property).
4. FOR ALL agent outputs and API response bodies serialized for the browser, THE System SHALL ensure no string value equals or contains any full_address value present in the source Boston_311 records (privacy property).
5. WHEN a clock is created from a case open date, THE System SHALL set clock_due_at to a value no earlier than the open date (clock lower-bound property).
6. FOR ALL clocks and non-negative simulated-time offsets, THE System SHALL mark a follow-up as due if and only if the current time plus the simulated offset is strictly later than clock_due_at, and SHALL mark it not due otherwise (follow-up due property).
7. FOR ALL generated eligibility text, THE System SHALL ensure the text, compared case-insensitively, contains none of the substrings "you will receive", "guaranteed", or "approved" (forbidden wording property).

### Requirement 22: External call resilience and error presentation

**User Story:** As a Resident, I want friendly messages instead of errors, so that the app stays usable even when an external service is slow or down.

**Priority:** Cross-cutting (applies to every priority)

#### Acceptance Criteria

1. WHEN the System initiates any external call to the Boston_311, OpenFEMA, NWS, Geocoder, AI_Labeler, or Twilio service, THE System SHALL enforce a request timeout between 1 and 30 seconds inclusive, defaulting to 10 seconds where no per-service value is configured.
2. IF any external call exceeds its configured timeout, THEN THE System SHALL abort the pending request, display a plain-language fallback message in 18px or larger text at a contrast ratio of at least 4.5:1 identifying which action could not be completed, and SHALL NOT display a stack trace, exception class name, or raw provider error payload.
3. IF any external call returns a non-success response or throws an error, THEN THE System SHALL display a plain-language fallback message identifying which action could not be completed, preserve any resident-entered data without loss, and SHALL NOT display a stack trace, exception class name, or raw provider error payload.
4. THE System SHALL read all secret values only in server-side code and SHALL NOT include any secret in any response body, markup, or script delivered to the browser; THE System SHALL treat the presence of only the NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY values in a browser response as compliant and not a secret exposure.
5. THE System SHALL perform all Supabase database and storage access only within a Server_Route using the SUPABASE_SERVICE_ROLE_KEY, and the browser SHALL NOT issue any request directly to Supabase.

### Requirement 23: Accessibility baseline

**User Story:** As a disabled Resident or Caregiver, I want every screen to meet accessibility guidelines, so that I can use Threshold with assistive technology.

**Priority:** Cross-cutting (applies to every priority)

#### Acceptance Criteria

1. THE System SHALL use semantic HTML elements, including real button, label, nav, and main elements, with headings in sequential order and no skipped heading levels, for every screen.
2. THE System SHALL NOT use clickable non-interactive elements, including div or span elements with click handlers, in place of real button or anchor elements.
3. THE System SHALL render every interactive touch target at a minimum size of 44 by 44 CSS pixels in both width and height.
4. THE System SHALL present every primary action as a full-width button positioned at the bottom of the screen.
5. THE System SHALL render body text at a minimum size of 18 CSS pixels and SHALL maintain a text-to-background contrast ratio of at least 4.5 to 1 in both light mode and dark mode.
6. THE System SHALL NOT convey meaning through color alone and SHALL pair each color-coded indicator with both a text label and an icon.
7. THE System SHALL provide a text alternative for every image, and WHERE an image has an AI-generated label, THE System SHALL use that label as the alt text.
8. THE System SHALL render a visible focus indicator with a contrast ratio of at least 3 to 1 against adjacent colors on every interactive element when it receives keyboard focus.
9. WHEN a non-alert status changes, THE System SHALL announce the change using an aria-live region with politeness level "polite".
10. WHEN an alert status changes, THE System SHALL announce the change using an aria-live region with politeness level "assertive".
11. WHERE the user has enabled the reduced-motion preference, THE System SHALL disable non-essential animation and transition effects.
12. THE System SHALL NOT auto-play audio, except the caregiver alert sound, which THE System SHALL accompany with a visible stop control that is at least 44 by 44 CSS pixels.
13. THE System SHALL provide both a light mode and a dark mode, with all color values defined through CSS variables.
