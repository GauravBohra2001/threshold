---
inclusion: fileMatch
fileMatchPattern: ["src/app/**", "src/components/**", "src/app/globals.css"]
---
# Threshold UI design system (binding for every screen)

## Concept
Threshold is named after the doorway, curb cut, and ramp: the exact places where disabled people get stopped. The visual language comes from that world:
- Accent blue inspired by the International Symbol of Access.
- Attention yellow inspired by tactile warning strips, the dotted yellow pads at curb ramps.
- Granite and ink neutrals, tinted toward the accent blue, like pavement and signage.

Spend boldness in one place: the tactile strip. Everything else is quiet, disciplined, and plain. A judge should ask "how was this made?", not "which AI made this?"

Patterns borrowed on purpose:
- GOV.UK Design System: task list with plain-text statuses (all-caps status tags tested poorly), notification banner with role="alert", panel for confirmations, summary list for review screens.
- US Web Design System: process list (3 to 10 steps) as the model for the Case Agent trace.

## Color (OKLCH, tinted neutrals, no alpha)
Define every color as a CSS variable in OKLCH on :root, with dark values under @media (prefers-color-scheme: dark). Neutrals carry a tiny chroma toward the accent hue (255) so the whole interface feels cohesive. Never use pure black, pure gray, or white #FFFFFF. Never build colors with alpha transparency (contrast becomes unpredictable); use solid tokens.

| Token | Light | Dark | Use |
|---|---|---|---|
| --bg | oklch(95.5% 0.006 255) /* #EDF0F4 */ | oklch(17% 0.012 255) /* #0C1015 */ | page background |
| --surface | oklch(99.5% 0.003 255) /* #FCFEFF */ | oklch(22% 0.014 255) /* #161B21 */ | cards, sheets, inputs |
| --ink | oklch(24% 0.025 255) /* #17202B */ | oklch(94% 0.008 255) /* #E8EBF1 */ | primary text |
| --muted | oklch(47% 0.025 255) /* #525C69 */ | oklch(74% 0.02 255) /* #A3ACB8 */ | secondary text |
| --line | oklch(88% 0.01 255) /* #D3D8DE */ | oklch(32% 0.015 255) /* #2E333B */ | dividers only (decorative) |
| --control-border | oklch(60% 0.02 255) /* #78818C */ | oklch(55% 0.02 255) /* #6A727D */ | input and checkbox borders (3:1 minimum) |
| --accent | oklch(48% 0.16 255) /* #005BB5 */ | oklch(74% 0.12 255) /* #75AEF5 */ | primary actions, links, focus ring |
| --on-accent | var(--surface) | var(--bg) | text on accent fills |
| --tactile | oklch(84% 0.16 90) /* #F3C530 */ | same | attention fill, always with --ink text |
| --tactile-dot | oklch(62% 0.12 85) | same | the dots inside the tactile strip |
| --danger | oklch(52% 0.19 27) /* #BE2323 */ | oklch(74% 0.14 27) /* #F6857A */ | emergency |
| --success | oklch(50% 0.12 150) /* #21763C */ | oklch(78% 0.13 150) /* #76CF8A */ | done, resolved |

All pairings above were checked: text pairs are 5.5:1 or higher, control borders are 3:1 or higher, in both modes.

Proportion (60-30-10): about 60% neutral background and surface, 30% ink, muted text, and lines, 10% accent. The tactile yellow is rarer still: it marks attention only.

The tactile strip (decorative, always aria-hidden, solid colors only):
```css
.tactile-strip {
  height: 8px;
  background:
    radial-gradient(circle, var(--tactile-dot) 1.5px, transparent 2px) 0 0 / 8px 8px,
    var(--tactile);
}
```
Place it only on TOP edges: the top of the app header, the top of attention banners, the top of the Rights Card. Never as a left or side border (side-tab borders are a known AI-generated tell).

## Typography
- One family: Atkinson Hyperlegible, designed by the Braille Institute for low-vision readers. Load with next/font/google (`Atkinson_Hyperlegible`, weights 400 and 700, latin subset, display swap). Verify the import against node_modules/next/dist/docs. Remove Geist.
- Four sizes only: 16px small, 18px body and card titles, 22px section heading, 28px page title. Body line-height 1.55, headings 1.2.
- Weights: 400 body, 700 headings, card titles, and buttons. Nothing else.
- Headings use text-wrap: balance. Paragraphs use text-wrap: pretty.
- Paragraph rhythm: space between paragraphs, never indents.
- In dark mode add letter-spacing: 0.01em to body text to compensate for light-on-dark bloom.
- Sentence case everywhere. No all-caps labels, no letter-spaced eyebrows, no middle-dot separators, no arrows appended to button text.
- Paragraph measure under 65 characters. Left-align everything. Never justify.

## Space and layout
- 4px spacing scale only: 4, 8, 12, 16, 24, 32, 48. Page side padding 20px is the one exception.
- Mobile-first single column, max-width 480px, centered on wider screens.
- One primary action per screen: a full-width button fixed to the bottom with safe-area padding. Squint test: blur your eyes at the screen and the primary action and the screen title must be the two most prominent things.
- Cards are overused; use them only for discrete objects (a case, a vault photo, a status). Lists (trace, task list, summary list) sit directly on the page with dividers. Never nest a card inside a card. No drop shadows; separate surfaces with --line borders.
- Radius by role, not one value everywhere: buttons 14px, cards 18px, photos 12px, chips fully rounded, inputs 12px.
- Judge Mode at 1024px and wider: Resident view and Caregiver view side by side as two phone-width columns, labeled "Maria, resident" and "Ana, caregiver", so judges see both ends of the check-in chain at once.

## Interaction states (every interactive element)
- Define default, hover, focus-visible, active, disabled, and loading states.
- Focus: 3px --accent outline with 2px offset, on focus-visible. Never remove outlines.
- Disabled: --muted text plus a reason in text near the control ("Add a photo first"). Never signal disabled by opacity alone.
- Loading: skeletons for content regions with aria-busy="true"; buttons keep their width and change label to the present tense of the action ("Saving", "Checking 311").
- Touch targets at least 44 by 44px; primary buttons 56px tall.
- Forms: label above the field, field 56px tall, help text below the label, errors below the field in --danger with an icon and text, linked with aria-describedby.

## Components (src/components/ui/, build first, reuse everywhere)
- Button: primary (accent fill, --on-accent text), secondary (1px accent border), danger. Labels name the exact action: "Take photo", "Save to vault", "Report this barrier", "Approve draft", "Copy for BOS:311". An action keeps its name across the flow, so "Approve draft" leads to a panel that says "Draft approved".
- TaskList (GOV.UK): task name as an underlined link, plain-text status on the right ("Done", "Not started", "Needs a photo").
- Banner (GOV.UK notification banner): tactile strip on top, title plus one sentence, role="alert" when it appears after an action or a status change.
- Panel (GOV.UK panel): confirmation after an action completes. No buttons inside.
- SummaryList (GOV.UK): key and value rows for review screens.
- ProcessTrace (USWDS process list): numbered vertical sequence for the Case Agent trace. Each step: a numbered circle marker, one plain sentence, optional data chips ("3 open reports within 75 m", "oldest 16 days", "on-time rate 62%"). The current step's marker is filled with --tactile; finished steps use --accent; no side bars.
- Badge: honesty labels only ("Replay", "Simulated time", "Demo data, fictional people", "Simulated call (demo mode)"). Sentence case, 1px --control-border outline, small icon plus text, identical everywhere.
- StatusChip: icon plus text, never color alone.
- Skeleton: neutral --line blocks, no shimmer gradients.

## Hero screens (most care goes here)
1. Case Agent trace: photo thumbnail at top, ProcessTrace streaming steps as the agent works, then the approval card with the draft visible and editable before "Approve draft".
2. Caregiver status: one large status block readable across a room. States: "Maria checked in" (success), "Maria hasn't answered. Calling you now." (tactile strip on top), "Call 911 if this is an emergency" (danger). Show the "Simulated call (demo mode)" badge when applicable.
3. Rights Card ("Show this screen"): inverted (--ink background, --surface text), 28px text minimum, tactile strip on top, one right per screen with a "Next right" button, source link below. Made to be held up to shelter staff.
4. Proof Vault: two-column photo grid; each tile shows the AI label (also its alt text) and the capture date in plain words ("Taken March 3, 2026").

Home screen order: greeting with the household name, any active Banner, open cases with their clock ("City target date: Oct 30"), then the vault TaskList.

## Motion
- Durations: 100ms for press feedback, 250ms for state changes. Nothing longer.
- Animate only transform and opacity. Easing cubic-bezier(0.2, 0, 0, 1). No bounce, no elastic, no spring overshoot.
- The one orchestrated moment: ProcessTrace steps appearing as the agent works (fade plus 4px rise). Responses to user actions may animate to show what changed. Nothing else moves.
- Under prefers-reduced-motion, all motion becomes instant.

## Copy
Plain verbs, sentence case, short sentences, written from the resident's point of view. Say what happened and what happens next. Errors say what went wrong and how to fix it, without apologizing. Empty states invite one action ("No photos yet. Start with your wheelchair or your front steps."). Never alarming, never promising outcomes. Name things as the resident understands them ("Your evidence", not "vault_items").

## Banned (known AI-generated tells)
Inter, Roboto, Arial, or system-default fonts. Purple or blue gradients, gradient washes, glows, glassmorphism, neon on dark. Pure black or pure gray. Gray text on colored backgrounds. Nested cards, identical card grids, the same shadow under everything. Side-tab or left-border accents. Rounded-square icon tiles above headings. A big number with a small label unless the number is the content. All-caps labels, eyebrows, middle dots, arrows in buttons. Emoji in the interface. Bounce or elastic easing, decorative motion, shimmer loaders. City of Boston branding or any third-party logos. Stock illustrations. Text under 16px. Color as the only signal.

## Quality gate
At every checkpoint, run `npx impeccable detect src/` and fix every primary finding (exit code 2 means findings remain), then check each hero screen with VoiceOver and in both light and dark mode.
