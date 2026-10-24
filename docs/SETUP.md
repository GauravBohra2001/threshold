# Setup

How to run Threshold locally, configure environment variables, and use Judge Mode.

## Prerequisites

- Node.js 20 or newer (the project targets Next.js 16 and React 19).
- npm (a package-lock.json is committed).
- A Supabase project with a private storage bucket named `vault`.
- Azure OpenAI access with a deployment (the stack uses the AzureOpenAI client).
- A Twilio account only if you want real voice calls (optional for the demo; see the ALLOW_LIVE_CALLS note).
- uv/uvx if you plan to use the fetch MCP server for fixtures.

## Run locally

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create your local environment file by copying the example, then fill in the values. Never commit the local file.

   ```bash
   cp .env.example .env.local
   ```

3. Start the development server:

   ```bash
   npm run dev
   ```

   Open http://localhost:3000 in your browser.

4. Useful scripts:

   - `npm run build` production build.
   - `npm start` run the production build.
   - `npm run lint` run ESLint (includes jsx-a11y accessibility rules).
   - `npm test` run the Vitest unit and property tests once.

## Environment variables

Every variable comes from `.env.example`. Fill each one in `.env.local`. Do not put real values in `.env.example`, and never commit `.env.local`. All secrets are read only in server code; only the two `NEXT_PUBLIC_` values may reach the browser.

- `AZURE_OPENAI_ENDPOINT` Base URL of your Azure OpenAI resource. The SDK appends paths, so this is the endpoint only.
- `AZURE_OPENAI_API_KEY` Secret key for the Azure OpenAI resource.
- `AZURE_OPENAI_DEPLOYMENT` Name of the deployed model to call (for example gpt-5.4).
- `AZURE_OPENAI_API_VERSION` Azure OpenAI API version string the client sends.
- `TWILIO_ACCOUNT_SID` Twilio account identifier used to place caregiver voice calls.
- `TWILIO_AUTH_TOKEN` Twilio secret token paired with the account SID.
- `TWILIO_FROM_NUMBER` Twilio phone number that caregiver calls are placed from.
- `CAREGIVER_DEMO_NUMBER` Phone number shown and stored for the seeded demo caregiver; seeding never calls it.
- `NEXT_PUBLIC_SUPABASE_URL` Public Supabase project URL; allowed in the browser.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` Public Supabase anon key; allowed in the browser.
- `SUPABASE_SERVICE_ROLE_KEY` Server-only Supabase key used for all database and storage access; never sent to the browser.
- `BOSTON_311_RESOURCE_ID` CKAN resource id for the Boston 311 dataset the app queries.
- `NWS_USER_AGENT` User-Agent header sent on every National Weather Service request; the NWS API requires a non-empty value.
- `ALLOW_LIVE_CALLS` Gate for real Twilio calls; keep false for the demo (see note below).

## Judge Mode

Judge Mode is the guided demo entry point.

1. With the dev server running, open http://localhost:3000/judge.

2. Opening the page seeds a fictional demo household, Maria in Dorchester with caregiver Ana, labeled "Demo data, fictional people." Seeding is idempotent, so reloading does not change the demo counts, and it never places a phone call. If `CAREGIVER_DEMO_NUMBER` is empty you get a plain-language note and still no call.

3. From Judge Mode you can run:

   - Replay: February 2026 blizzard. Runs the check-in chain and Rights Card from a fixture weather alert. Labeled "Replay".
   - Replay: Leominster flood, declared May 15, 2024 (DR-4780). Runs the Aid Claim from OpenFEMA fixture records. Labeled "Replay".
   - A live sidewalk case using real current Boston 311 data.
   - "Fast-forward 14 days (simulated)". Advances simulated time by 14 days and triggers any due agent follow-ups. Labeled "Simulated time".

Replays and simulated time are always labeled on screen, and the demo people are fictional.

## ALLOW_LIVE_CALLS note

`ALLOW_LIVE_CALLS` controls whether the check-in chain places a real Twilio voice call. Keep it `false` (the default in `.env.example`) for demos.

- When `ALLOW_LIVE_CALLS` is not `true`, the chain never places a real call. The caregiver screen shows a simulated call labeled "Simulated call (demo mode)".
- When `ALLOW_LIVE_CALLS=true`, the chain may place a real call, but at most one real call every 2 minutes across all check-in chains. Any call beyond that limit falls back to the same labeled simulated call.

So a real phone call requires both `ALLOW_LIVE_CALLS=true` and valid Twilio credentials (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`) plus a reachable `CAREGIVER_DEMO_NUMBER`. For judging, leaving it `false` is recommended.
