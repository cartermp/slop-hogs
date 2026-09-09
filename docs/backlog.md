# Backlog

The owner assigns a bounded task; Codex implements it and returns a reviewable PR. No calendar commitments or background agent availability are assumed.

| Task | Outcome | Prerequisites | Status |
| --- | --- | --- | --- |
| SH-001 | App shell, CI, policy validation, repository handoff | Repository | Complete |
| SH-002 | Pure deterministic feeding engine | SH-001 | Implemented on this branch, pending review |
| SH-003 | Base SVG hog and five diet appearances | SH-002 | Planned |
| SH-004 | Postgres schema and atomic persistence | SH-002 | Planned |
| SH-005 | Minimal-scope Bluesky OAuth | SH-004 | Planned |
| SH-006 | Railway setup, budgets, backup and restore | SH-001, SH-004, SH-005 | Planned; before public exposure |
| SH-007 | Canonical post previews and feeding quotas | SH-004, SH-005 | Planned |
| SH-008 | Eight mutations, collection, care and pacing | SH-003, SH-007 | Planned |
| SH-009 | Public pens, gifts, blocks and owner controls | SH-008 | Planned |
| SH-010 | Speech templates and capped cards | SH-009 | Planned |
| SH-011 | One ending, tombstone, next generation | SH-008 | Planned |
| SH-012 | Invited playtest and observed fixes | SH-006 through SH-011 | Planned |

## Current handoff

SH-002 adds pure, versioned game transitions for five foods, elapsed hunger, six regenerating meal slots, taste, and deterministic digestion. The engine has no database, UI, network access, or paid integration.

Run `npm ci`, `npm run check`, `npm run build`, `npm run smoke`, and `npm run simulate` to reproduce validation and inspect the five diet outcomes.

## SH-002 acceptance

Implement the game as a pure module with explicit saved state, validated action, server time, deterministic random state, and rules version. Return next state and events. Cover meal capacity, elapsed-time behavior, and distinct diet outcomes. No database, UI, network, or new service is needed. Keep mutation art and full mutation recipes in their later tasks.
