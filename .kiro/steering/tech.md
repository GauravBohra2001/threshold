---
inclusion: always
---
# Technology stack and rules

## Stack
- Next.js (App Router) + TypeScript + Tailwind. One repo, one deploy. Mobile-first installable web app (web manifest; service worker optional).
- Supabase: Postgres + Storage bucket `vault` (private). All database and storage access happens in server routes using SUPABASE_SERVICE_ROLE_KEY. The browser never talks to Supabase directly, so no RLS work is needed. Photos are served through short-lived signed URLs.
- Azure OpenAI via the `openai` npm package `AzureOpenAI` client. Endpoint is the base URL only (the SDK adds paths). Use `max_completion_tokens`, never `max_tokens`. Deployment name comes from AZURE_OPENAI_DEPLOYMENT (gpt-5.4). Use structured outputs (JSON schema) validated with zod. Images sent as base64 data URLs.
- Twilio Voice: `client.calls.create({ to, from: TWILIO_FROM_NUMBER, twiml })` with inline TwiML `<Response><Say>...</Say></Response>`. No webhook needed.
- Tests: Vitest + fast-check (property-based tests). Accessibility: eslint-plugin-jsx-a11y, Playwright + @axe-core/playwright.
- Icons: lucide-react. Dates: date-fns.

## Hard rules
- Secrets live only in server code. Only NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY may be prefixed NEXT_PUBLIC_. Never read or print .env files.
- Resize photos in the browser to max 1280px wide JPEG before upload (Vercel request body limit is about 4.5 MB).
- The caregiver screen polls every 3 seconds. Do not use realtime subscriptions.
- Every external call has a timeout and a friendly fallback message. The demo must never show a stack trace.
- Pure logic (routing rules, clocks, FEMA matching, check-in escalation) lives in `src/lib/rules/` as pure functions with no I/O, so they can be property-tested.

## Data sources (verified today)
- Boston 311 (CKAN): `https://data.boston.gov/api/3/action/datastore_search` and `datastore_search_sql`, resource id in BOSTON_311_RESOURCE_ID. Covers Aug 2025 to today, about 76k cases. Fields: case_id, open_date, case_topic, service_name, assigned_department, case_status, closure_reason, close_date, target_close_date, on_time (ONTIME or OVERDUE), full_address, zip_code, neighborhood, latitude, longitude, submitted_photo.
  - Accessibility-relevant service_name values: "Sidewalk Repair" (about 2,750 cases), "Illegally Blocked Sidewalk" (about 1,840 cases). Snow types have almost no cases; do not build snow logic on this data.
  - Nearby search: SQL with a lat/lng bounding box, then compute distance in code.
- OpenFEMA: `https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries`. Use `ihProgramDeclared` and `iaProgramDeclared` (FEMA says to use both) to decide whether individual assistance exists. Tribal areas have no county code; use `placeCode`.
- National Weather Service: `https://api.weather.gov/alerts/active?point={lat},{lng}`. Requires a User-Agent header (NWS_USER_AGENT). Old alerts are not served, so replays use fixture files.
- Census geocoder (no key) for address to lat/lng and county FIPS.
- Boston Open311 API exposes only 4 request types to our key; do not use it for filing.
