# Slop Hogs

A Bluesky-linked virtual pet with a terrible diet. Built by one developer and Codex in small asynchronous tasks.

SH-012 playtest preflight makes each hog's lifetime favorite, recent six-meal
diet, and ending-relevant stats visible so invited players can pursue a build
deliberately. The [invited playtest protocol](docs/playtest.md) is ready, but
the live Railway gate and invited session still require owner execution.

## Run locally

Use Node 24 or 25 and npm. `.nvmrc` pins the default Node 24 version; switching versions is optional if you already use Node 25. CI checks both majors, including Node 25.9.0.

```sh
npm ci
cp .env.example .env.local
npm run dev
```

If you use nvm and need to install the pinned default, run `nvm install` and `nvm use` first.

Open http://localhost:3000. The shell and local gallery do not require a provider account. Public pens are viewable without signing in; managing a pen, sending treats, and public-post feeding require the PostgreSQL and OAuth configuration below.

In development, open http://localhost:3000/gallery to compare the mutation-composed six-meal AI image, generated post, chatbot screenshot, human post, and shitpost builds. The gallery returns a normal not-found page in production.

The shell and gallery still run without auth configuration. To exercise OAuth, configure PostgreSQL as described in [database development](docs/database.md), run migrations, and set `APP_ORIGIN`, `OAUTH_PRIVATE_KEY`, `OAUTH_ENCRYPTION_KEY`, `BLUESKY_INVITED_DIDS`, and `SLOP_HOGS_OWNER_DIDS`. Generate the two secrets with:

```sh
openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256
openssl rand -base64 32
```

The P-256 private key signs OAuth client authentication with ES256; the 32-byte key encrypts SDK state and provider sessions in PostgreSQL. Keep both outside the repository. OAuth metadata and callbacks require the exact configured origin; production must use HTTPS.

## Check a change

Database setup and real concurrency checks are in [database development](docs/database.md). The shell still runs without a database.

```sh
npm run check
npm run build
npm run smoke
npm run simulate
```

`check` validates the committed cost policy, checks TypeScript, and runs the native Node test suite. `smoke` starts the production build on loopback port 4317, checks the page and health endpoint, then stops it. `simulate` feeds five hogs six meals apiece and prints their stats for a quick behavior check. Database integration tests cover persisted growth cutoffs, read-only behavior, and restore-target isolation. CI runs the automated checks with a ten-minute job timeout and cancels superseded runs.

## Server logs

Meaningful HTTP requests and every state-changing Server Action emit one JSON
`server.activity` event at completion. Events share a stable schema with the
activity, outcome, duration, request and actor identifiers, deployment context,
domain-specific results, and normalized error details. Health checks and static
OAuth discovery documents are intentionally excluded to keep routine probes
from overwhelming the activity stream. Fields whose names identify credentials
or secrets are redacted before serialization.

## Cost boundary

`config/cost-policy.json` holds the approved initial limits. Startup refuses missing, malformed, or unsafe settings. Invite-only registration and external previews are enabled. New public lookups are limited to 12 per account per UTC day and 100 globally per hour; cached previews do not spend lookup quota. Visitor treats are limited to three sent per account per UTC day, ten received per pen per day, one sender-to-pen gift per day, and 20 pending gifts per active hog. Authenticated owners can render at most two new cards per UTC day and the app can render 50 globally; failed render attempts count, one render runs per app instance, PNGs stop at 250 KB each, and stored cards stop at 250 MB total. The app records database size at startup and at most every 15 minutes during writes. It warns at 70% of the 1 GB internal budget, blocks registrations and cards at 85%, and rejects new game state changes at 95%. `features.readOnlyMode` is the manual emergency stop.

The Railway dollar values are **configuration targets, not a billing cap applied by this code**. Configure the workspace dashboard before deployment. Login handle suggestions return at most five accounts and are limited to 60 searches per client address and 1,000 globally each hour. Request quotas must be implemented atomically with each future feature before enabling it. See [cost controls](docs/cost-controls.md).

## Working together

The owner-only `/owner` page shows application feature flags, implemented quota use, measured database size, enforced cutoffs, and the last recorded backup restore verification. The [Railway deployment runbook](docs/railway.md) covers the first manual deployment, spending limits, generated HTTPS domain, restart verification, daily backups, restore testing, and emergency controls.

- [Backlog and current handoff](docs/backlog.md)
- [Implementation plan](docs/implementation-plan.md)
- [Architecture decisions](docs/decisions.md)
- [Cost controls and deployment gate](docs/cost-controls.md)
- [Invited playtest protocol](docs/playtest.md)

Railway is the intended host. Repository support through SH-011 and SH-012
preflight is complete, but no hosted resource or dashboard setting can be
verified from source control and CI does not deploy. Complete the live checklist
in the runbook before inviting players; SH-012 remains open until the invited
session and its observed fixes are complete.
