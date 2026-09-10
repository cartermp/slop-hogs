# Backlog

The owner assigns a bounded task; Codex implements it and returns a reviewable PR. No calendar commitments or background agent availability are assumed.

| Task | Outcome | Prerequisites | Status |
| --- | --- | --- | --- |
| SH-001 | App shell, CI, policy validation, repository handoff | Repository | Complete |
| SH-002 | Pure deterministic feeding engine | SH-001 | Complete |
| SH-003 | Base SVG hog and five diet appearances | SH-002 | Complete |
| SH-004 | Postgres schema and atomic persistence | SH-002 | Complete |
| SH-005 | Minimal-scope Bluesky OAuth | SH-004 | Complete |
| SH-006 | Railway deployment, budgets, growth controls, backup restore and runbook | SH-004, SH-005 | Repository complete; live owner verification pending |
| SH-007 | Canonical post previews and feeding quotas | SH-004, SH-005 | Complete |
| SH-008 | Eight mutations, collection, care and pacing | SH-003, SH-007 | Complete |
| SH-009 | Public pens, gifts, blocks and owner controls | SH-008 | Complete |
| SH-010 | Speech templates and capped cards | SH-009 | Planned |
| SH-011 | One ending, tombstone, next generation | SH-008 | Planned |
| SH-012 | Invited playtest and observed fixes | SH-006 through SH-011 | Planned |

## Current handoff

SH-009 gives each account a stable opaque public pen URL, owner-controlled visibility and gift intake, bounded visitor treats, and account blocks. Sending a treat never changes hog state; only the recipient can accept it, and acceptance consumes a normal meal atomically with an idempotent game receipt. Live Railway spending controls, resource ceilings, HTTPS OAuth, restart persistence, daily backup scheduling, and one restore still require owner verification before players are invited. SH-010 is next.

Run `npm ci`, `npm run check`, `npm run build`, and `npm run smoke` to reproduce automated validation. Run `npm run dev`, then open `/gallery` to compare the five appearances at desktop and phone widths.

## SH-003 acceptance

Render one recognizable base hog and five clearly different diet builds using modular SVG parts for body, eyes, mouth, outfit, back attachment, and effects. Provide a local gallery that shows real six-meal game states and works at desktop and phone widths. Keep the gallery out of production. Add no image service or runtime dependency.

## SH-008 acceptance

Discover at least one visible mutation during a six-meal first session and collect all eight across deliberate diets. Keep discoveries permanent while equipped body, eyes, mouth, outfit, back, and effect slots respond to sustained recent food exposure with explicit priorities and incompatibilities. Built-in meals remain playable without Bluesky, cleaning removes bounded filth without consuming a meal, and both meal and cleaning pacing are enforced by server time. Reads may display elapsed hunger and refills but never discover or reroll a mutation.

## SH-009 acceptance

Serve each enabled pen at a stable opaque public URL without authentication or external work. Require an authenticated account to send a treat, cap sends per sender and recipient per UTC day, allow only one sender-to-pen gift per day, and cap each active hog's pending basket. A queued treat cannot change hog state; only the recipient can accept it as a normal meal. Owners can hide their pen, disable new gifts, decline treats, and block or unblock accounts. Blocked accounts cannot interact, and accepting, declining, settings, and blocks obey application read-only mode.
