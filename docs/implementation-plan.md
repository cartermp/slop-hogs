Slop Hog implementation plan

Revised 8 September 2026.

Build this as a solo developer working with Codex asynchronously in mornings and evenings. Railway is the hosting choice. Use one Next.js application and one PostgreSQL service. Build modular SVG hog art in the repository, with no assumption of a separate illustrator. Minimize production packages and paid services. Cost controls are part of the first deployed slice.

This revision replaces the earlier full-time schedule, Render deployment, separate background worker, external asset storage, and initial 24-mutation requirement. The repository is cartermp/slop-hogs. Track current task status in docs/backlog.md.

1. Work in small, independently reviewable increments.

   Use milestones rather than calendar promises. An implementation task should cover one behavior and end in a small PR with a clear acceptance check. Split a task that cannot be reviewed in about 15 to 30 minutes. Integrations can take several sessions; an agent completing code is not evidence that the gameplay is finished.

   The owner chooses priorities, tests the humor and feel, configures accounts and secrets, and decides when to spend more or release publicly. Codex implements assigned tasks, writes targeted tests, documents setup, and records the next step. Every handoff states what changed, how it was checked, what remains, and any cost impact.

   Keep architecture decisions, task status, and operating instructions in the repository so a later session can resume without reconstructing a chat. Do not rely on an agent running continuously between assignments. There is no standing authorization to add services, enable paid APIs, raise spending limits, or deploy on every push.

2. Start with a playable private alpha.

   Target five recognizable diet builds, eight authored mutations, and one complete ending. The original roughly 24 mutations and three endings remain expansion milestones after the loop works.

   | Milestone | Included behavior |
   | --- | --- |
   | Local toy | One hog, built-in food, stats, five visually distinct diet outcomes |
   | Persistent alpha | Bluesky sign-in, saved state, manual post feeding, cleaning, collection |
   | Social alpha | Public pen, bounded visitor treats, speech templates, share cards |
   | Replayable alpha | First ending, tombstone, next generation |
   | Expanded beta | About 24 mutations, combinations, three endings, better art |

   Use a daily tray of fictional meals alongside Bluesky URLs. A player should see a mutation in the first session. The game remains playable when an external API is unavailable. The owner's judgments about funny, disgusting, and desirable are the acceptance criteria for art and writing.

   Defer automatic activity ingestion, arbitrary URL scraping, uploads, video processing, breeding, paid text or image generation, and direct Bluesky publishing. Ship a death later in the task order, but before calling the alpha replayable.

3. Keep the runtime and dependency list short.

   | Need | Initial choice |
   | --- | --- |
   | Pages and server routes | Next.js, React, TypeScript, supported pinned Node release |
   | Database access | PostgreSQL with the pg driver, parameterized SQL, numbered SQL migrations |
   | Identity | Official AT Protocol Node OAuth SDK and API client where needed |
   | Hog art and animation | Repository-owned SVG parts and CSS |
   | Share PNG rendering | Sharp, added only with the share-card milestone |
   | Testing | Native Node tests initially; add Playwright with browser journeys |
   | Hosting and operations | Railway services, metrics, logs, usage controls, and backups |

   Use the standard library for small utilities. Do not hand-roll OAuth or cryptography to save a dependency. Avoid an ORM, Redis, queue library, separate API framework, analytics SDK, state-management package, component framework, or a monorepo build system unless a concrete problem justifies one.

   Keep one package with ordinary source directories for game rules, database access, auth, Bluesky requests, art, and routes. Commit a lockfile. New runtime dependencies need a short purpose and maintenance note in the PR. New billable services require a recorded owner decision.

   All initial work happens on requests. Small optional operations have deadlines and can be retried explicitly. Do not launch untracked background promises after returning a response. Add a durable job system only when a shipped feature needs work to continue independently of requests.

4. Preserve correct identity and public-content boundaries.

   A DID owns a pen and its sequence of hog lives. One active life per DID is enforced with a database uniqueness constraint. A DID represents an account, not a verified unique person. Handles and avatars are display data that can change. [AT Protocol identity specification](https://atproto.com/specs/did)

   Use server-side OAuth and the minimal identity-only atproto scope. Store the SDK's state and sessions durably, encrypt secret session material, and coordinate refreshes. Authenticate the verified DID returned by OAuth. The browser receives an opaque, revocable application session cookie, never a user-supplied DID as proof of identity. Keep signing keys and encryption keys outside the repository. [OAuth SDKs](https://atproto.com/guides/about-oauth), [permission requests](https://atproto.com/guides/permission-requests)

   Publish HTTPS client metadata and public signing keys with an exact callback URL. Test expiry, logout, denied authorization, invalid callbacks, and handle changes. The game should not require post-writing permission.

   Accept only supported Bluesky post routes at launch. Resolve the post through the API, record its canonical AT URI and observed CID, and deduplicate by canonical URI within a hog life. Explicit repeat-food mechanics can bypass that restriction through their own limited action. Fetch before acquiring a hog database lock, with bounded response size, duration, and redirects. Harden identity and avatar fetches as well.

   Let players assign a food flavor and fictional richness. Unknown provenance stays unknown. These selections are game recipes, not public claims that the original creator used AI. Keep source receipts private by default, expire preview content after seven days, and retain numeric game effects separately. Remove deleted or unavailable source content from later displays.

5. Make all progression server-authoritative.

   The pure game module takes saved state, a validated action, server time, stored randomness, and a ruleset version. It returns the new state and events. It has no network or database access.

   Slop reflects recent diet. Mass reflects calories. Taste holds preferences by food family. Brain responds to monotony. Filth responds to binges and cleaning. Joy follows personality and favorite foods, including delight at terrible stats. Hunger controls cadence. Taste should appear as preferences rather than another maximizable meter.

   Begin with six meal slots, regenerating one every four hours. This is a tunable balance setting. Advance elapsed time when a hog is opened or acted on. Bound neglect effects and exclude neglect death. Reads must not roll mutations or endings, and repeated reads must not change the outcome.

   For every accepted action, validate the session and permissions, check quotas, lock the current hog row, deduplicate the request, advance time, apply the action, resolve discoveries and endings, and save state plus events atomically. Persist random outcomes so retries cannot reroll them. Reject any browser-provided stat delta, price, mutation, or calorie value.

   | Data | Main invariant |
   | --- | --- |
   | Accounts and app sessions | Verified DID ownership and revocable sessions |
   | OAuth state and sessions | Durable, encrypted secrets with expiry and refresh coordination |
   | Hog lives | One active run per DID; frozen terminal state |
   | Meals and actions | Canonical sources and idempotency keys prevent replay |
   | Discoveries and events | Stable ordered results with rules and appearance versions |
   | Drafts and cards | One stored result per eligible event |
   | Usage counters and controls | Atomic quotas shared across requests and restarts |
   | Gifts and blocks | Sender and recipient limits plus owner permission |

6. Make the art cheap to improve.

   Assemble body stages, eyes, mouth, outfit, back attachment, and effects from SVG parts. Codex can implement the first shapes and animations directly; the owner selects the direction and rejects combinations that are dull or visually broken. No external artist or paid image generation is assumed.

   Each mutation defines prerequisites, food exposure, incompatible traits, slot priority, art changes, and event text. Separate discoveries from equipped appearance. Use sustained diet requirements to prevent a single meal from flipping a build back and forth. Keep hidden recipes on the server.

   Build a development-only gallery of the five diet builds, all parts, and representative combinations. Reuse the appearance description for the live hog, event portrait, and tombstone. Version art assets with the game rules so old snapshots remain reproducible.

   Procedural speech uses authored templates selected by diet and mutations. Store a draft once and let the player edit or copy it. No model key should exist in the deployed environment at launch.

7. Make public features bounded.

   Use a stable public account pen and separate event URLs. Serve public HTML and metadata without authentication. Public GET requests can read already prepared cards but cannot trigger remote lookups or image rendering. Unknown IDs return a cheap error, not work.

   Render a share card only after an authenticated owner requests an eligible event. Complete the game transaction first. Reserve the rendering quota durably, then render with a short deadline and one concurrent render per app instance. Store the result in PostgreSQL with a unique event key. If rendering fails or the app restarts, the event survives and the owner can retry within the remaining quota. Return an existing successful card on a retry.

   For the small alpha, store compressed PNGs in a size-limited database table instead of adding object storage. Use caching headers and an immutable image URL. When the card cache reaches its configured budget, stop new rendering and show a generic game card. Keep historical event and appearance data. Moving images into a Railway bucket becomes an explicit later task if measurements justify it.

   Start visitor treats as small Joy or cosmetic changes. Limit them per sender, recipient, and day. An owner must accept a treat as a normal meal before it can change the build. Provide gift-disable and block controls. Visitors cannot cause terminal outcomes.

   Share through an editable draft and a tested compose or copy-link flow. Opening Bluesky is not proof of publication. A publishing bonus, if included, requires a pasted public post URL with the correct author DID and event link, and is awarded once. Direct posting is deferred.

   Terminal events freeze the final appearance, stats, cause, and epitaph. Start with one ending, then add transcendence, content collapse, and humanization as separate tasks. Next generations use the same account pen. Account deletion removes stored history and hosted cards.

8. Deploy only two Railway services.

   Use a Railway Hobby workspace, one app replica, one PostgreSQL service, and a persistent database volume in one region. Connect through private networking. The Postgres template is an unmanaged database deployment, so we own backup configuration, version upgrades, and restore checks. Do not carry over the previous plan's managed-database assumptions. [Railway PostgreSQL](https://docs.railway.com/databases/postgresql)

   Keep art in the application build and game data in Postgres. Application filesystem contents are disposable. Use Railway's generated HTTPS domain initially. A custom domain is optional later.

   Once the owner creates the repo, add railway.json or railway.toml for supported app build, start, and health-check settings. Document workspace spending limits and service settings separately; do not imply config-as-code covers every dashboard control. Pin the database major version and review upgrades deliberately.

   Use local development and automated checks for routine tasks. Keep production deployment manual initially and deploy a known commit only after CI passes. Disable automatic PR environments and avoid a permanent staging copy. Temporary validation environments must have an owner, expiry, and deletion task that includes their storage. Run migrations once with a migration lock and maintain compatibility with the previous application release.

   Start app replica limits at 0.5 vCPU and 1 GB RAM, and database limits at 0.5 vCPU and 512 MB RAM if available. Tune the database to its actual memory allowance. These are ceilings, not expected usage or guaranteed total-cost limits. If a service cannot run within them, investigate before proposing a larger limit. Build-time memory may need a separate configuration.

   Serverless sleeping is optional for the app, not a promised saving. Test OAuth callbacks and cold starts first. Avoid timers, polling loops, and frequent health pings that prevent sleeping. Do not assume the database sleeps, and do not weaken correctness to chase that saving.

9. Install cost controls before inviting players.

   Proposed starting policy: target $10 to $20 per month of Railway usage, an email alert at $15, and a $30 Compute Usage hard limit. These are planning defaults for the owner to set at deployment, not a bill estimate or controls already applied. Railway Hobby has a $5 minimum with included usage credit; actual resource consumption determines the bill above that minimum. [Railway pricing](https://railway.com/pricing)

   Railway documents a workspace-level usage limit that shuts down workloads, plus per-replica resource ceilings. Compute and Railway Agent usage have separate limits. Set both explicitly and inspect the selected workspace before applying them. [Railway cost controls](https://docs.railway.com/pricing/cost-control)

   Prefer service interruption to an automatic budget increase. The $30 setting is a shutdown threshold, not a guarantee that the entire invoice including subscriptions, tax, other vendors, or accounting adjustments is exactly bounded by $30. A shared workspace includes other projects; a dedicated workspace makes this policy easier to understand. If sharing, account for all workloads and the fact that cutoff affects them too.

   | Control | Initial application policy |
   | --- | --- |
   | Signup | Invite-only, 50-account alpha cap |
   | Paid AI | Disabled, zero game-model budget, no provider keys |
   | Railway Agent | Do not use; set zero allowance if supported, otherwise minimum available and document it |
   | Services | One app replica and one database; no automatic replica growth |
   | Owner feeding | Six meal slots with server-side regeneration |
   | Post previews | At most 12 new source lookups per DID per day and 100 globally per hour |
   | Login initiation | Start with five attempts per IP per hour and a global ceiling; test shared-network behavior |
   | Card rendering | Two new cards per DID per day, 50 globally per day, one render concurrently |
   | Card storage | At most 250 KB per image and 250 MB total; stop new cards at the limit |
   | External work | Short timeouts, maximum payload sizes, no unbounded retries |
   | Public requests | Cached reads, IP limits, bounded pagination, no billable work on anonymous cache misses |
   | Preview data | Seven-day retention and bounded cleanup batches |
   | Deployments | Manual known-commit deployments; no deploy loop or permanent preview environments |

   The quotas above are product choices, not provider features. Enforce them on the server, with atomic database counters and an explicit in-flight rendering limit. Reserve quota before expensive work. Failed or abandoned work must not receive unlimited free retries. Handle proxy headers using the platform's trusted configuration so clients cannot invent a new source IP.

   Add flags for registrations, external previews, card rendering, imports, and paid AI, plus a read-only mode. Imports and paid AI start disabled. A protected owner page shows feature flags, account count, quota use, estimated database and card size, and last backup check. It does not contain a Railway admin token or claim to know the current invoice from local counters. Link to the provider usage page for that.

   Start with an internal database growth budget of 1 GB within the provisioned volume. At 70%, surface an owner warning; at 85%, disable new registrations and cards; at 95%, reject state-changing game actions and enter read-only mode until space is recovered. Check these thresholds through bounded maintenance with recorded last-run times. Do not delete hog histories automatically. Provider volume capacity and backups need separate headroom and monitoring.

   Validate limits at startup. Production must not treat a missing or malformed cap as unlimited. Persist quotas across restarts. Test the application with tiny quotas so we can prove requests stop before expensive calls. Provider shutdown remains the last line of defense for traffic and resource usage that application controls cannot prevent.

   If AI is ever added, create a separate task with provider-side restrictions, atomic worst-case cost reservation, token and request ceilings, concurrency limits, retry accounting, and a global kill switch. An alert-only budget is insufficient. No gameplay feature should silently enable a paid API.

10. Back up the game and document how to stop it.

   Enable Railway daily volume backups and test a database restore before the private alpha contains valued progress. The documented daily schedule retains six days; backup storage is billable. Restores are restricted to the same project and environment, and wiping a volume deletes its backups. Record these limitations in the operating notes. [Railway backups](https://docs.railway.com/volumes/backups)

   Target no more than 24 hours of lost game progress for the alpha. Restore work happens when the owner is available; do not imply an around-the-clock support commitment. Include a small encrypted export before risky migrations if a practical secure destination is available, with retention and restore instructions.

   Keep a short runbook for normal deployment, migration failure, disabling expensive features, closing signup, restoring a backup, and responding to a usage cutoff. After cutoff, inspect what spent the money before resuming. Never automatically raise a cap or repeatedly restart workloads to bypass it.

   Use Railway's logs and metrics initially. Avoid logging OAuth secrets, complete imported posts, or every polling request. Check actual usage after the first day and first week, then at the next owner session after a material deployment. Waiting for the next session must not be the only cost defense.

11. Use this assignment backlog once the repository exists.

   The tasks below describe bounded PRs. Split an item further when needed. Each task includes implementation, relevant checks, setup notes, and a handoff; it does not authorize unrelated features or new spending.

   | ID | Task | Depends on | Done when |
   | --- | --- | --- | --- |
   | SH-001 | Create minimal app, CI, decision notes, task template, and cost-policy configuration | Repo created by owner | App runs locally, checks pass, prohibited production defaults fail validation |
   | SH-002 | Implement pure game state and feeding | SH-001 | Five diet inputs produce deterministic, distinct state outcomes |
   | SH-003 | Build base SVG hog, five appearances, and art gallery | SH-002 | Owner can compare builds and approve the visual direction |
   | SH-004 | Add Postgres schema, migrations, sessions, and atomic action persistence | SH-002 | Restart and concurrent-request checks preserve correct state |
   | SH-005 | Add Bluesky OAuth with minimal permissions | SH-004 | Verified account owns its hog; invalid sessions cannot act |
   | SH-006 | Configure Railway deployment, cost limits, backups, and runbook | SH-001, SH-004, SH-005 | Owner verifies caps; restart, real-domain login, and restore checks pass |
   | SH-007 | Add canonical Bluesky post previews and feeding quotas | SH-004, SH-005 | Duplicates, timeouts, quotas, and unavailable posts behave correctly |
   | SH-008 | Add eight authored mutations, collection, care, and pacing | SH-003, SH-007 | First session mutates; deliberate diets sustain different builds |
   | SH-009 | Add public pens, bounded gifts, blocks, and owner controls | SH-008 | Visitors cannot exceed allowances or alter protected state |
   | SH-010 | Add speech templates and capped share-card rendering | SH-009 | Repeated anonymous reads cause no rendering or external fetching |
   | SH-011 | Add one ending, tombstone, and next generation | SH-008 | Exactly one terminal event is recorded and the next life preserves history |
   | SH-012 | Run a small invited playtest and fix observed problems | SH-006 through SH-011 | Cost remains within policy and players deliberately pursue builds |

   Card rendering need not block the first invited testers. Bring forward the deployment safety task before any public exposure. Add subsequent mutations and endings as small content PRs. Avoid mixing art overhaul, authentication changes, and infrastructure changes in one task.

   Record task status in a small backlog file or GitHub issues once available. Use a PR checklist with acceptance evidence, migration and deployment impact, changed dependencies, and changed cost behavior. A task is complete when its acceptance condition is met, not when every possible enhancement has been explored.

12. Expand only in response to playtests or measured constraints.

   The public-beta scope can grow to roughly 24 mutations and three endings without new services. Improve the parts, combinations, and jokes first. Add a bucket when image storage actually strains Postgres. Add a worker only when a feature genuinely needs durable background execution.

   If activity imports become worthwhile, begin with an opt-in pantry of the owner's posts and reposts. Author feeds are public; the likes endpoint requires authentication for the requesting account. Neither proves reading history. [Author-feed definition](https://github.com/bluesky-social/atproto/blob/main/lexicons/app/bsky/feed/getAuthorFeed.json), [likes endpoint definition](https://github.com/bluesky-social/atproto/blob/main/lexicons/app/bsky/feed/getActorLikes.json)

   An import proposal must include per-account and global request budgets, frequency, cursor recovery, deduplication, opt-out behavior, storage retention, and measured cost. Start from opt-in time with no automatic history backfill. Automatic feeding uses the same meal allowance as manual feeding.

   The next concrete step after repository creation is SH-001. The first product question is whether the five diet builds make the owner want to keep feeding the pig.
