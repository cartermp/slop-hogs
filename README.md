# Slop Hogs

A Bluesky-linked virtual pet with a terrible diet. Built by one developer and Codex in small asynchronous tasks.

SH-004 adds PostgreSQL storage and atomic feeding functions. Sign-in and public feeding routes are not implemented yet.

## Run locally

Use Node 24 or 25 and npm. `.nvmrc` pins the default Node 24 version; switching versions is optional if you already use Node 25. CI checks both majors, including Node 25.9.0.

```sh
npm ci
cp .env.example .env.local
npm run dev
```

If you use nvm and need to install the pinned default, run `nvm install` and `nvm use` first.

Open http://localhost:3000. No database, provider account, or API key is required for this slice.

In development, open http://localhost:3000/gallery to compare six-meal AI image, generated post, chatbot screenshot, human post, and shitpost builds. The gallery returns a normal not-found page in production.

## Check a change

Database setup and real concurrency checks are in [database development](docs/database.md). The shell still runs without a database.

```sh
npm run check
npm run build
npm run smoke
npm run simulate
```

`check` validates the committed cost policy, checks TypeScript, and runs the native Node test suite. `smoke` starts the production build on loopback port 4317, checks the page and health endpoint, then stops it. `simulate` feeds five hogs six meals apiece and prints their stats for a quick behavior check. CI runs the automated checks with a ten-minute job timeout and cancels superseded runs.

## Cost boundary

`config/cost-policy.json` holds the approved initial limits. Startup refuses missing, malformed, or unsafe settings. Every unfinished feature is disabled, and there are no paid API calls or credentials in this application.

The Railway dollar values are **configuration targets, not a billing cap applied by this code**. Configure the workspace dashboard before deployment. Request quotas must be implemented atomically with each future feature before enabling it. See [cost controls](docs/cost-controls.md).

## Working together

The [Railway deployment runbook](docs/railway.md) covers the first manual deployment, spending limits, generated HTTPS domain, and restart verification.

- [Backlog and current handoff](docs/backlog.md)
- [Implementation plan](docs/implementation-plan.md)
- [Architecture decisions](docs/decisions.md)
- [Cost controls and deployment gate](docs/cost-controls.md)

Railway is the intended host. No hosted resources are created by this commit, and CI does not deploy. Next task: SH-005, Bluesky OAuth and authenticated sessions.
