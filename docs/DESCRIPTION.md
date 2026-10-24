# Threshold

## One line

Every barrier a disabled Boston resident hits, a blocked or broken sidewalk, a power outage, a shelter that turns them away, an aid denial, becomes a documented record that is routed to the right office and tracked until someone answers.

## What Threshold is

Threshold is a mobile-first, installable web app built as a single Next.js project. It turns the barriers a disabled resident faces into evidence that is labeled, routed, and followed up. The core idea is "one profile, three moments": what a resident records in their Proof Vault before a disaster becomes the proof used during and after it.

Threshold is an AI assistant. It is not the City of Boston, and it says so in every agent message and every phone call. It never submits anything to a government system on its own. The resident always approves a draft before it is marked ready.

## Who it serves

- Resident: a disabled adult in Boston who owns the household profile and decides what the caregiver can see.
- Caregiver: someone the resident invites through a link, who receives check-in calls and can act on the resident's behalf.

## The problem

When a disabled resident reports a broken sidewalk, loses power in a storm, is turned away from a shelter, or is denied aid, the burden of proof and follow-up falls on the person least able to carry it. Reports get filed into systems that may never answer. Deadlines pass. Rights go unknown at the moment they matter most. Evidence that would have helped, a photo of the ramp before the flood, the model of the oxygen concentrator, was never captured.

Threshold closes that gap. It helps the resident record proof ahead of time, it routes each new barrier to the correct office, it watches the clock, and it escalates when a report goes unanswered. It shows rights in large plain language with real sources, and it keeps a record if a shelter refuses entry.

## Features

Each feature is demoable on its own and was built in this order.

1. Household and Proof Vault. Create a household from an address, invite a caregiver by link, and photograph equipment (wheelchair, oxygen concentrator) and home features (steps, doorways). Each photo is resized in the browser, stored privately, labeled by AI, and timestamped. Photos are shown only through short-lived signed URLs.

2. Case Agent ("Report a Barrier"). The resident photographs a barrier. An agent classifies the photo, checks live Boston 311 data for nearby open reports, decides the route (file a new 311 report, or escalate to the Disabilities Commission if two or more similar reports are already open nearby), drafts the filing, and sets a follow-up clock. The resident approves before anything is marked ready. The agent shows its work as a plain-language trace.

3. Check-in Chain and Rights Card. A weather alert triggers a check-in that asks "Are you okay?". No answer places a real voice call to the caregiver. The chain ends with a 911 advisory. It is deterministic code, never model judgment. The Rights Card shows shelter and disability rights in large plain text with sources, and lets the resident log an incident such as a shelter refusal.

## Judge Mode

Judge Mode seeds a fictional demo household, Maria in Dorchester with caregiver Ana, clearly labeled "Demo data, fictional people." It offers a labeled replay and a simulated time control:

- Replay: February 2026 blizzard. Drives the check-in chain and the Rights Card from a fixture weather alert.
- A live sidewalk case uses real current Boston 311 data.
- "Fast-forward 14 days" advances simulated time and triggers the agent's scheduled follow-up. It is labeled "Simulated time".

Seeding is idempotent, so repeated visits do not change the demo counts, and it never places a phone call.

## Data sources

- Boston 311 (CKAN). Nearby open reports and neighborhood on-time rates for accessibility request types ("Sidewalk Repair" and "Illegally Blocked Sidewalk"). The agent never receives a street address from this data; it sees only counts, the age of the oldest open report, and overdue counts. Testing against the live API surfaced two facts the dataset documentation did not make obvious: the latitude and longitude fields are stored as text rather than numbers, and open cases are labeled "In progress" rather than "Open". Both were caught during live-API testing and fixed in the query and parsing code.
- OpenFEMA DisasterDeclarationsSummaries. Used to decide whether individual assistance exists for a household's county or tribal place, reading both the ihProgramDeclared and iaProgramDeclared flags.
- National Weather Service active alerts. Triggers check-ins for the household location. Old alerts are not served by the API, so replays use fixture files.
- Census geocoder. Converts an address to latitude, longitude, and county FIPS. No API key needed.
- ADA and FEMA sources. Every rights statement shown to a resident comes from a fixed rights library with a real source URL (archive.ada.gov, ada.gov, boston.gov, and fema.gov), so no statistic or right is ever invented.

All database, storage, and secret-bearing external calls happen only in server routes. The browser never talks to these services directly.

## Honesty and safety

- Threshold never promises an outcome. FEMA language is always "you may be eligible; FEMA makes the decision."
- Rights and grievance screens state "This is not legal advice." and link to Mass 211.
- Nothing is sent in the resident's name without an explicit approval screen.
- Nearby-report counts never reveal another resident's address or case.
- Replays and simulated time are always labeled on screen, and demo people are labeled fictional.
- The check-in chain is deterministic and never implies rescue; an unanswered chain ends with "Call 911 if this is an emergency."

## Accessibility

Accessibility is the product, not a feature. Every screen is built to WCAG 2.2 AA guidelines and tested with VoiceOver. Semantic HTML, touch targets of at least 44 by 44 pixels, base text of 18 pixels, high contrast, plain language, visible focus states, light and dark mode, and status changes announced through aria-live regions.

## What's next

- Aid Claim. Match the household county to OpenFEMA disaster declarations, build a claim packet from the vault using only evidence captured before the incident date, flag accessibility repairs FEMA may cover, and produce an Answer Sheet for DisasterAssistance.gov or the FEMA helpline, plus a Leominster flood replay (DR-4780) driven by OpenFEMA fixture records.
- Fine Print. Photograph a FEMA or city letter and get a plain-language explanation, the stated deadline, and a drafted appeal or response for review.
- Barrier Ledger. An anonymous city view for the Disabilities Commission showing live Boston 311 on-time rates for accessibility-related request types by neighborhood. It would show only aggregate figures, never an individual.
- Go Card. One printable page with equipment, medications, contacts, and the FEMA helpline, laid out to fit on a single page.
- Direct 311 filing. Today Threshold drafts a filing and hands off to BOS:311 for the resident to submit; it never files automatically. As Boston expands its Open311 API beyond the few request types available today, Threshold could submit supported request types directly, still behind the resident's explicit approval.
- Disabilities Commission pilot of the Barrier Ledger. Partner with Boston's Disabilities Commission to pilot the anonymous neighborhood on-time view as an ongoing tool for spotting where accessibility reports go unanswered.
- Other cities with open 311 data. The routing and privacy logic is city-agnostic, so Threshold could extend to any city that publishes 311 data with the fields it relies on.
