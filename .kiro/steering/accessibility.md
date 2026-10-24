---
inclusion: always
---
# Accessibility is the product, not a feature

Users are disabled residents and their caregivers. Every screen must work with VoiceOver and TalkBack.

- Target WCAG 2.2 AA. Never claim "WCAG compliant" in UI or docs; say "built to WCAG 2.2 AA guidelines and tested with VoiceOver".
- Semantic HTML first: real <button>, <label>, <nav>, <main>, headings in order. No clickable divs.
- Touch targets at least 44x44 px. Primary actions are full-width buttons at the bottom of the screen.
- Text: base 18px, high contrast (4.5:1 minimum), plain language around 6th-grade reading level, short sentences.
- Never use color alone to carry meaning; pair with text and icons.
- Every image input has a text alternative; every photo the AI labels gets that label as alt text.
- Visible focus states. Respect prefers-reduced-motion. No auto-playing audio except the caregiver alert sound, which has a visible stop button.
- Status changes are announced with aria-live regions (polite for updates, assertive for alerts).
- Forms: one question per screen where possible, errors described in text next to the field.
- Light and dark mode via CSS variables.
