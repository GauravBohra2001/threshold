# Threshold

> "Two weeks post storm, I am rolling in the middle of Washington Street."
>
> A wheelchair user wrote that to Boston 311 after the curb cuts near their job in Downtown Crossing were still buried in snow. Their request ended: nobody is responding. ([Boston 311 request #101006503050](https://311.boston.gov/tickets/101006503050))

A threshold is a doorway, a curb cut, a ramp. It is the exact place where disabled people get stopped, and it should be the place where help begins.

For most people, a blocked sidewalk is an annoyance. For a wheelchair user, it can mean choosing between missing work and rolling into the street beside traffic. When they report it, they wait alone, with no way to know whether anyone is listening.

**Threshold makes sure the next person does not wait alone.** Every barrier a disabled Boston resident hits becomes a documented record, routed to the right office and tracked until someone answers.

## Live demo

https://threshold-six-omega.vercel.app

### Try it in 60 seconds

Open `/judge` on a phone. This loads a fictional demo household, Maria in Dorchester with her caregiver Ana. From there you can:

- Explore Maria's Proof Vault of labeled, timestamped photos.
- Run a live sidewalk case against real current Boston 311 data.
- Start the February 2026 blizzard replay to see the check-in chain and Rights Card.

The demo people are fictional and labeled as such, and every replay is labeled "Replay" on screen.

Test photos: judges can open the sample photos at https://threshold-six-omega.vercel.app/demo/samples/blocked-sidewalk.jpg, https://threshold-six-omega.vercel.app/demo/samples/broken-sidewalk.jpg, and https://threshold-six-omega.vercel.app/demo/samples/missing-curb-ramp.jpg, save one, and report it as a barrier to see how the Case Agent routes each one differently.

[SCREENSHOT: home screen on a phone]

## The problem

When a disabled resident in Boston reports a broken sidewalk, loses power in a storm, is turned away from a shelter, or is denied aid, the burden of proof and follow-up falls on the person least able to carry it. Reports get filed into systems that may never answer, and deadlines pass unnoticed. Rights go unknown at the moment they matter most. Evidence that would have helped, a photo of the ramp before the flood or the model of an oxygen concentrator, was often never captured.

## What it does

The core idea is "one profile, three moments": what a resident records before a disaster becomes the proof used during and after it.

- Before (Proof Vault). The resident photographs equipment and home features. Each photo is resized in the browser, stored privately, labeled by AI, and timestamped, served only through short-lived signed URLs.
- During (check-in chain and Rights Card). A weather alert triggers a check-in that asks "Are you okay?"; no answer places a voice call to the caregiver and ends with a 911 advisory. The Rights Card shows shelter and disability rights in large plain text with sources and lets the resident log an incident such as a shelter refusal.
- After (Case Agent and aid claims). The Case Agent investigates a reported barrier, routes it, and follows up until it is answered. Aid Claim matches the household county to FEMA disaster declarations and builds a claim packet from the vault. [CONFIRM] Aid Claim

## The Case Agent

The Case Agent is a real agent, not a fixed pipeline. It classifies the barrier photo, chooses its next tool from what it observes, keeps case state, wakes on a schedule to follow up, and stops to ask the resident when it is unsure. The path differs per case: it may draft a new 311 report, or, when two or more similar reports are already open nearby, escalate to the Disabilities Commission instead of filing a duplicate. It shows its work as a plain-language trace, and nothing is marked ready until the resident approves it.

The safety-critical parts are deliberately not left to the model. The check-in chain, the case deadlines, and FEMA eligibility are implemented as deterministic pure functions and covered by property-based tests, so they produce the same output for the same input every time. For example, the check-in chain advances through its steps in order and places at most one caregiver call per step; eligibility shows a message only when FEMA has actually declared individual assistance. [CONFIRM] agent evaluation suite

## Data sources

- Boston 311 open data. Nearby open reports and neighborhood on-time rates for accessibility request types such as "Sidewalk Repair" and "Illegally Blocked Sidewalk". The agent sees only counts and ages, never a street address.
- OpenFEMA disaster declarations. Used to decide whether individual assistance exists for a household's county or tribal place, reading both the ihProgramDeclared and iaProgramDeclared flags.
- National Weather Service alerts. Trigger check-ins for the household location. Old alerts are not served by the API, so replays use fixture files.
- US Census geocoder. Converts an address to latitude, longitude, and county FIPS. No API key needed.
- ADA and FEMA guidance. Every rights statement on the Rights Card comes from a fixed rights library with a real source URL, so no statistic or right is ever invented.

## Accessibility

Accessibility is the product, not a feature. Every screen is built to WCAG 2.2 AA guidelines and tested with VoiceOver. The app uses the Atkinson Hyperlegible font, designed by the Braille Institute for low-vision readers, along with large touch targets of at least 44 by 44 pixels, base text of 18 pixels, high contrast, visible focus states, light and dark mode, and screen reader support with status changes announced through aria-live regions. We do not claim certified compliance; we say the app is built to WCAG 2.2 AA guidelines and tested with VoiceOver.

## Honesty and privacy

- Threshold never promises eligibility or an outcome. FEMA language is always "you may be eligible; FEMA makes the decision."
- Nothing is sent in the resident's name without an explicit approval screen.
- The app never shows another resident's address or case; nearby reports appear only as aggregate counts.
- Rights and grievance screens state "This is not legal advice." and link to Mass 211.
- No real personal data is used in the demo; the demo people are fictional and labeled.

## Built with Kiro

Threshold was built with Kiro using spec-driven development: requirements first in EARS form, then a design that maps every requirement to concrete code, then a task list the agent worked through. Standing rules live in steering files, agent hooks ran accessibility lint and tests automatically, MCP servers supplied FEMA fixtures and applied the database schema, and the core rules are covered by property-based tests. The build ran the Kiro IDE and the Kiro CLI in parallel, the IDE for the spec-driven build and the CLI for documentation. See [docs/KIRO_WRITEUP.md](docs/KIRO_WRITEUP.md).

## Tech stack

Next.js 16, TypeScript, Tailwind, Supabase, Azure OpenAI, Twilio Voice, and Vercel.

## Run it locally

See [docs/SETUP.md](docs/SETUP.md) for prerequisites, environment variables, Judge Mode, and the live-calls note.

## What's next

- Direct 311 filing as Boston expands its Open311 API, still behind the resident's explicit approval. [CONFIRM]
- A Disabilities Commission pilot of the Barrier Ledger, the anonymous neighborhood on-time view. [CONFIRM] Barrier Ledger
- Other cities with open 311 data, since the routing and privacy logic is city-agnostic. [CONFIRM]
