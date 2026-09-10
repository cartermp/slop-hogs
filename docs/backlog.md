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
| SH-008 | Eight mutations, collection, care and pacing | SH-003, SH-007 | Planned |
| SH-009 | Public pens, gifts, blocks and owner controls | SH-008 | Planned |
| SH-010 | Speech templates and capped cards | SH-009 | Planned |
| SH-011 | One ending, tombstone, next generation | SH-008 | Planned |
| SH-012 | Invited playtest and observed fixes | SH-006 through SH-011 | Planned |

## Current handoff

SH-007 adds authenticated canonical Bluesky post previews, persisted per-account and global lookup quotas, seven-day private preview retention, and canonical URI deduplication within each hog life. Unavailable posts are cached without exposing stale content, and game results retain their numeric effects separately from expiring source text. Live Railway spending controls, resource ceilings, HTTPS OAuth, restart persistence, daily backup scheduling, and one restore still require owner verification before players are invited. SH-008 is next.

Run `npm ci`, `npm run check`, `npm run build`, and `npm run smoke` to reproduce automated validation. Run `npm run dev`, then open `/gallery` to compare the five appearances at desktop and phone widths.

## SH-003 acceptance

Render one recognizable base hog and five clearly different diet builds using modular SVG parts for body, eyes, mouth, outfit, back attachment, and effects. Provide a local gallery that shows real six-meal game states and works at desktop and phone widths. Keep the gallery out of production. Add no image service or runtime dependency.
