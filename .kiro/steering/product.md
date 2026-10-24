---
inclusion: always
---
# Threshold: product

## One line
Every barrier a disabled resident hits (a blocked or broken sidewalk, a power outage, a shelter that turns them away, an aid denial) becomes a documented record that is routed to the right office and tracked until someone answers.

## Users
- Resident: a disabled adult. Owns the household profile and decides what the caregiver sees.
- Caregiver: invited by the resident through an invite link. Receives check-in calls, can act on the resident's behalf.
- City view (Barrier Ledger): aggregate, anonymous view for Boston's Disabilities Commission. Never shows individuals.

## Core idea: one profile, three moments
What the resident records BEFORE a disaster becomes the proof used AFTER it. The Proof Vault feeds every later step.

## Features, in build order (each slice must be demoable on its own)
1. Household and Proof Vault: create household, invite caregiver, photograph equipment (wheelchair, oxygen concentrator) and home features (steps, doorways). Each item labeled by AI and timestamped.
2. Case Agent ("Report a Barrier"): resident photographs a barrier; an agent investigates live 311 data, decides the route, drafts the filing, starts a clock, and follows up. See case-agent.md.
3. Check-in Chain and Rights Card: weather alert triggers check-in; no answer means a real voice call to the caregiver; chain ends at 911. Rights Card shows shelter rights in large plain text and logs incidents.
4. Aid Claim: match household county to OpenFEMA declarations; build claim packet from the vault; flag accessibility repairs FEMA may cover; Answer Sheet for DisasterAssistance.gov or the FEMA helpline.
5. Fine Print: photograph a FEMA or city letter; plain-language explanation, deadline, drafted appeal or response.
6. Barrier Ledger: anonymous city view; live 311 on-time rates for accessibility-related request types by neighborhood.
7. Go Card: one printable page (equipment, medications, contacts, FEMA helpline) via print styles.

## Judge Mode (required)
A seeded demo household with two labeled replays:
- "Replay: February 2026 blizzard" (check-in chain, Rights Card).
- "Replay: Leominster flood, declared May 15, 2024 (DR-4780)" (Aid Claim).
Plus a live sidewalk case using real current 311 data. A "Fast-forward 14 days" control triggers the agent's scheduled follow-up and is labeled as simulated time.

## Non-goals today
No real login (invite link plus cookie, demo grade). No automatic submission to any government system. No snow data claims (the 311 dataset has almost no snow cases). No maps library.
