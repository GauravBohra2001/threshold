# Building Threshold with Kiro

This write-up answers each judging question.

## Which Kiro tools were used, and how they differed

We used Kiro in two distinct ways:

- Kiro IDE for the spec-driven build. The whole feature set was planned and implemented through a Kiro spec: requirements, then design, then a task list the agent worked through task by task inside the IDE. This is where the application code, tests, and the Supabase schema came from.
- Kiro CLI for a parallel documentation agent. While the IDE session built the app, a separate Kiro CLI session wrote the documentation you are reading. The CLI agent ran under strict rules: it could only create files inside docs/, and it could not edit app code, run builds, run tests, or run git. This let documentation proceed in parallel without touching the build.

The difference matters: the IDE session owned the source of truth (spec and code), and the CLI session was a read-only-plus-docs companion. The two never wrote to the same files.

## Spec-driven development

The build followed Kiro's requirements-first flow. We wrote requirements before any code, expressed as acceptance criteria in EARS form (WHEN, IF, WHILE, WHERE, THE System SHALL). The requirements document is the source of truth; the design document maps every requirement to a concrete route handler, pure function, or component.

- Twenty-three numbered requirements, each with a priority (P1 through P4 and Later) that set the build order.
- Acceptance criteria written in EARS so each one is testable and unambiguous.
- Analyze Requirements caught 5 ambiguities before design started.
- requirement-detailer subagents ran in parallel batches to expand requirements into detailed acceptance criteria.

## Agent hooks

Four hooks under .kiro/hooks automated quality checks during the build:

- Accessibility lint on save. Trigger PostFileSave, matcher `src/.*\.tsx$`. Runs `npx eslint --fix` (including jsx-a11y rules) whenever the agent saves a TSX component, so accessibility problems surface immediately.
- Tests after each task. Trigger PostTaskExec. Runs the full Vitest suite (`npx vitest run`) after each spec task completes, so a finished task is a tested task.
- Property tests on rule changes. Trigger PostFileSave, matcher `src/lib/rules/.*\.ts$`. Runs the rules property tests (`npx vitest run tests/rules`) whenever a pure rule file changes, since those files carry the property-based guarantees.
- Secret-file guard. Trigger PreToolUse, matcher `read_file|fs_write|str_replace|fs_append`. Runs a Node script (`.kiro/hooks/scripts/guard-env.mjs`) that inspects the tool input and exits with code 2 to block any attempt to read or write a `.env` file. It allows `.env.example` and nothing else, so secrets stay out of the agent's reach.

## Steering

Eight steering files in .kiro/steering carry the project's standing rules so the agent does not have to be reminded each turn:

- product.md: what Threshold is, who it serves, the feature slices, and Judge Mode. Always included.
- tech.md: the stack and hard rules (server-only secrets, browser photo resize, polling not realtime, timeouts and fallbacks, pure rules in src/lib/rules). Always included.
- structure.md: the folder layout and naming conventions. Always included.
- accessibility.md: the WCAG 2.2 AA baseline that makes accessibility the product. Always included.
- honesty-and-safety.md: the non-negotiable honesty and safety rules (no promised outcomes, not legal advice, explicit approval, labeled replays). Always included.
- git.md: commit and push rules (ask first, plain imperative messages, never commit .env.local). Always included.
- case-agent.md: the Case Agent loop, tools, and routing guidance. Conditionally included (inclusion fileMatch) when files under src/lib/agent or the agent API are in context.
- rights-library.md: the only rights statements that may be shown, each with a source URL. Conditionally included (inclusion fileMatch) when files under src/lib/rights, src/lib/agent, or the rights screen are in context.

Why the modes differ: the five project-wide rules are always included because they apply to every change. The two deep-reference files (the agent design and the rights library) are large and only relevant when working in their specific areas, so they are file-matched to load on demand and keep the context focused.

## MCP

- Supabase power's MCP. Used to apply the database schema (households, vault_items, cases, checkins, incidents, claims) to the Postgres database during the tasks phase. The private `vault` storage bucket was created separately. All database and storage access happens in server routes with the service role key.

## Property-based testing

Threshold's decision logic lives in pure functions under src/lib/rules, which makes it well suited to property-based testing with fast-check. Seven properties, each a fast-check test of at least 100 iterations, protect the rules that matter most:

1. Check-in chain ordering. For all sequences of answer and no-answer events, the chain advances through step indices in strictly increasing order with no index skipped, and places at most one caregiver call per step. This matters because the chain is a safety path; skipping a step or double-calling would be a real-world failure.

2. Eligibility if and only if declared. For all OpenFEMA record sets matched to a household, an eligibility message appears if and only if ihProgramDeclared or iaProgramDeclared is true in at least one matched record. This matters because a false positive would tell someone they may be eligible when FEMA has declared no individual assistance.

3. Duplicate routing threshold. For all sets of open 311 cases of the same service type, exactly one new 311 draft is produced if and only if fewer than two matching open reports are within 75 meters; otherwise the agent escalates instead. This matters because filing duplicates buries the barrier instead of surfacing it.

4. Privacy, no address leak. For all agent outputs and API response bodies, no string contains any full_address value from the source 311 records. This matters because exposing another resident's address would break the product's core privacy promise.

5. Clock lower bound. For all case open dates and requested follow-up offsets, including invalid negative values, clock_due_at is set no earlier than the open date and no more than 90 days after it. This matters because a follow-up scheduled in the past would fire immediately or never.

6. Follow-up due equivalence. For all clocks and non-negative simulated-time offsets, a follow-up is marked due if and only if the current time plus the offset is strictly later than clock_due_at. This matters because the fast-forward demo and real follow-ups both depend on this being exact.

7. Forbidden wording. For all generated eligibility text, the text contains none of "you will receive", "guaranteed", or "approved", compared case-insensitively. This matters because those words would promise an outcome that only FEMA can decide.

## Agent evaluation suite

The Case Agent has an offline evaluation suite that runs entirely against fixture 311 data and never makes a live data call. It is a deterministic eval: the model's responses are scripted, so the suite exercises the agent's loop, tool wiring, routing decisions, approval gate, and privacy handling rather than measuring the quality of the live model. The graders are code-based and check outcomes, not tool order: the correct final route and status, no fixture address appearing in any output, approval requested before anything is marked ready, and stated counts matching the tool output. Because the inputs and model responses are fixed, the same run produces the same result every time, which is what makes it useful as a regression check during the build.

## Powers

- Supabase (hosted). The Supabase power provided the Postgres database, the private `vault` storage bucket, and the server-only access pattern the app relies on. Its MCP server was used to apply the schema. All database and storage access happens in server routes with the service role key, and photos are served through short-lived signed URLs, so the browser never talks to Supabase directly and no row-level security work was needed for the demo.
