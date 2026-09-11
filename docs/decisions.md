# Decisions

- Use Railway, one app and one Postgres service when persistence arrives. Provisioning belongs to SH-006.
- Use Next.js, React, and TypeScript. No styling framework, external font, ORM, queue, Redis, or hosted asset service at this stage.
- Use Node's native test runner and TypeScript support for the initial pure rules and configuration tests. This replaces the plan's tentative Vitest choice and saves a dependency. Add browser tooling only with a feature that needs it.
- Keep a committed versioned policy with approved ceilings. Changing a JSON value alone cannot enable an unfinished feature or raise a ceiling. The validator and tests must change in a reviewed implementation task.
- Validate policy through npm lifecycle hooks and Next.js Node instrumentation. Missing policy is a startup error, never an unlimited fallback.
- The starter is intentionally not a playable mockup. SH-002 implements state transitions; SH-003 implements the hog renderer.
- Keep production dependencies exact and the lockfile committed. Review dependency changes on their own merits rather than updating automatically.
- Keep deployment manual. Do not create cloud resources or change spending limits as a side effect of routine development.
- Use the official `@atproto/oauth-client-node` SDK with only the base `atproto` identity scope. Store its state and provider sessions encrypted in PostgreSQL, coordinate refreshes with advisory locks, and give browsers a separate opaque application cookie.
- Let any DID verified by Bluesky OAuth create or return to its Slop Hogs account. Keep owner-only operations authorization separate through `SLOP_HOGS_OWNER_DIDS`.
- Identify public pens with random stable UUIDs rather than DIDs. Public reads expose prepared hog state only and perform no provider lookup. Visitor treats require an application session, reserve sender and recipient daily quotas atomically, and remain inert until the recipient accepts one through the normal meal transaction.
- Make the first ending deterministic: an accepted meal ends a life only after 18 lifetime meals when slop reaches 100. Store the ending on the rules state and in a receipt-bound terminal snapshot so reads cannot reroll it. Starting the next generation is an explicit authenticated action; it keeps the account's public pen and historical lives but resets mutable gameplay state.
- Replace the active virtual-pet homepage with one shared, server-authoritative farm while retaining the existing OAuth account boundary and historical pen data. Persist one farm player per account, poll bounded snapshots instead of adding a new realtime service, claim expiring slop transactionally, cap elapsed movement on the server, and expose only random player IDs rather than DIDs.
