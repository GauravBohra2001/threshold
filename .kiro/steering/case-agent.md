---
inclusion: fileMatch
fileMatchPattern: ["src/lib/agent/**", "src/app/api/agent/**"]
---
# Case Agent design

A real agent: it chooses its next tool from what it observes, the path differs per case, it persists state, wakes on a schedule, and stops to ask when unsure. It is not a fixed pipeline.

## Loop
- Azure OpenAI chat completions with function calling. Max 8 tool steps per run. Each run ends with exactly one of: draft_ready (waiting for approval), waiting (clock set), asked_user, escalated, resolved.
- Every step is appended to the case trace: { step, tool, input_summary, observation_summary, reasoning_note, at }. The trace is shown to the user in plain language.

## Tools
- classify_photo(photo) -> { barrier_type: "blocked_sidewalk" | "broken_sidewalk" | "missing_curb_ramp" | "other", description, confidence }
- search_nearby_311(lat, lng, radius_m, service_names) -> counts, oldest open age in days, overdue count. Never returns addresses.
- neighborhood_on_time_rate(neighborhood, service_name) -> on-time percentage over the last 90 days, computed live.
- lookup_right(topic) -> rights library entries with source URLs.
- draft_filing(route, facts) -> plain-language draft in the destination's format.
- request_approval(draft) -> stops the run until the resident approves or edits.
- schedule_followup(days) -> sets clock_due_at.
- check_case_status(city_case_id) -> status from the 311 dataset by case_id.
- notify_caregiver(message) -> in-app notice (calls are reserved for the check-in chain).
- ask_user(question) -> stops the run with a question.

## Routing guidance
- Blocked or broken sidewalk: 311 ("Illegally Blocked Sidewalk" or "Sidewalk Repair"). If 2 or more open reports exist nearby, do not file a duplicate; draft an escalation to the Disabilities Commission citing the count and age instead.
- Missing or non-compliant curb ramp: Boston's ADA Curb Ramp Request Form.
- City service denied access because of disability: ADA grievance to the Disabilities Commission.
- When the clock passes target_close_date and the case is still open: suggest escalation, never send automatically.
