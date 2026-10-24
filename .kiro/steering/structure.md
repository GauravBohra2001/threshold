---
inclusion: always
---
# Project structure

src/app/                  screens (mobile-first) and route handlers under src/app/api/
src/app/(resident)/       resident screens: home, vault, report, case/[id], rights, claim, letter, go-card
src/app/(caregiver)/      caregiver screens: status, cases
src/app/ledger/           city view
src/app/judge/            Judge Mode entry: seeds demo household, replays, fast-forward
src/lib/rules/            pure functions only: routing, clocks, fema-match, checkin-chain, eligibility wording
src/lib/agent/            Case Agent: loop, tools, trace
src/lib/rights/           rights library data (JSON) with source URLs
src/lib/data/             clients: boston311, openfema, nws, geocoder, supabase, twilio, azure
src/components/           shared accessible UI components
fixtures/                 replay data (blizzard alert, DR-4780 records fetched from OpenFEMA)
tests/                    vitest unit and property tests; playwright accessibility tests

Naming: kebab-case files, PascalCase components. One component per file.
