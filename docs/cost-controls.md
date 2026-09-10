# Cost controls

## What exists today

`config/cost-policy.json` is validated before dev, build, and start. Next.js instrumentation also validates it during Node startup, including when the Next CLI is run directly. The validator rejects unknown or omitted keys, non-integer and nonpositive quotas, database budgets or thresholds above approved ceilings, nonzero AI budgets, and any enabled unfinished feature.

The app has Bluesky OAuth login plus a cheap `/api/health` route. Login initiation is limited to five attempts per trusted client address per hour and 200 globally per hour using atomic PostgreSQL counters. New accounts require an invited DID and stop at 50. Authenticated public-post previews reserve at most 12 new lookups per account per UTC day and 100 globally per hour before contacting Bluesky. Fresh seven-day cached previews do not spend quota. Visitor treats perform no external work and are limited to three sent per account and ten received per pen each UTC day, one sender-to-pen gift per day, and 20 pending gifts per active hog. Authenticated share-card requests reserve at most two attempts per account and 50 globally per UTC day, serialize local Sharp work to one card per app instance, stop each PNG at 250 KB, and stop stored card data at 250 MB. Failed renders spend their reservation; successful retries read the immutable card without spending another. OAuth discovery, post lookup, and card rendering each have a five-second deadline; card rendering uses only authored text and local SVG assets. Imports and model calls remain disabled.

The internal database budget is 1 GB. Startup records an actual PostgreSQL database-size measurement. New registrations and game writes refresh it at most once every 15 minutes; `/owner` refreshes it on demand. At 70% the owner page warns, at 85% registration and future card creation stop, and at 95% new game state changes stop. `features.readOnlyMode` immediately blocks registration, future card creation, and new game state changes after deploying a reviewed policy change. Measurements and effective controls persist across restarts.

Do not expose provider budget settings through a public route. Do not place credentials in client-visible environment variables or commit them. App config has no Railway administration token.

## Before a Railway deployment

Owner checklist for SH-006:

- Choose the correct workspace. A shared workspace cutoff can affect unrelated projects.
- Set Compute Usage email alert to $15 and hard limit to $30, or a lower reviewed budget. Record the verification date in the handoff.
- Leave Railway Agent unused; set its separate allowance to zero if supported, otherwise the minimum available. It is separate from this game's zero AI budget.
- Keep one app replica. Set initial ceilings of 0.5 vCPU and 1 GB RAM for the app and 0.5 vCPU and 512 MB RAM for Postgres if available. These are resource ceilings, not a prediction of actual spend.
- Use private database networking, daily backups, and a tested restore procedure.
- Disable automatic deployments, PR environments, and automatic replica growth. Do not leave temporary volumes behind.
- Confirm every enabled endpoint's application quotas and growth thresholds are implemented and tested before enabling the corresponding flag.
- Set `SLOP_HOGS_OWNER_DIDS` to the exact owner DID list and confirm `/owner` is unavailable to a signed-in non-owner.

Railway's workspace hard limit shuts workloads down. Accept downtime instead of automatically raising the limit. This is not a guarantee of an exact total invoice including subscription minimums, tax, other vendors, or accounting adjustments. [Railway cost controls](https://docs.railway.com/pricing/cost-control).

## Future feature acceptance

Postgres-backed counters must reserve per-account and global quotas atomically before expensive work, persist across restarts, and bound retries. Anonymous GETs cannot trigger rendering or remote work. Rate limits must use trusted proxy configuration. Apply the policy's timeouts, payload limits, and storage budgets as each endpoint ships.

Features may only leave `false` when their implementation, permission checks, cost enforcement, and targeted tests land together. Registering a feature in the policy does not authorize increasing its budget. Keep paid AI at zero until a separately approved task includes provider-side restrictions and application cost reservation.

At database growth thresholds, registration and card rendering close before read-only mode. Do not delete hog histories to recover space. The protected owner page reports the measured value, current controls, account count, implemented login and post-lookup quota use, feature flags, and last restore check. It links to Railway rather than claiming local counters show the provider invoice.

## If usage spikes

Set `features.registrations` to `false` to close signup, or `features.readOnlyMode` to `true` to stop new game state changes, then deploy the reviewed commit manually. Disable external work through its implemented feature flag. Inspect Railway usage and logs without printing secrets. Stop the app if necessary. Inspect database and backup storage separately. Never add restart loops or raise limits to get around a cutoff. The owner decides when and how to resume.
