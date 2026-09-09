# First Railway deployment

Status: repository setup only. No Railway project, billing limits, domain, backup, or deployment has been configured by this PR. Live verification below remains required. This is SH-006a, brought ahead of OAuth; SH-006b is backup/restore and the remaining launch controls.

## 1. Set the spending controls first

Use a dedicated Hobby workspace if practical. In Workspace Usage, set the Compute email alert to $15 and hard limit to $30. Set Railway Agent to zero if accepted, otherwise the minimum available, and do not use it. Confirm you are changing the intended workspace. The compute cutoff can stop every workload in it; it is not a promise that subscription charges, tax, or other vendors are included in $30. These settings are dashboard controls, not enforced by `.railway/railway.ts`. See [Railway cost controls](https://docs.railway.com/pricing/cost-control).

## 2. Create the two services

Create an empty project with one production environment. Add PostgreSQL with a persistent volume and pin its image to major 17 before initializing data. Do not change an existing populated database's major version by editing its image. Keep the database private, without a public TCP proxy. Use one region for both services.

Add an empty application service before connecting GitHub, so you can configure it before the first build. Name it `slop-hogs`. Start with one replica, 0.5 vCPU and 1 GB RAM for the app, and 0.5 vCPU and 512 MB for PostgreSQL if Railway accepts those limits. If these fail, inspect logs before increasing them. Build resources are separate from runtime limits. Keep automatic scaling, PR environments, scheduled jobs, and serverless sleeping off initially.

Set application variables:

| Variable | Value |
| --- | --- |
| DATABASE_URL | `${{Postgres.DATABASE_URL}}`, using the actual database service name |
| NODE_ENV | `production` |
| NEXT_TELEMETRY_DISABLED | `1` |
| PORT | `3000` |

Use the private DATABASE_URL, not DATABASE_PUBLIC_URL. Do not add TEST_DATABASE_URL or paid AI keys. Do not attach a volume to the app. Its filesystem is disposable.

## 3. Connect and deploy deliberately

Connect `cartermp/slop-hogs` with root directory `/`. Do not configure a legacy Railway config-file path. Review `.railway/railway.ts` with `railway config plan`, then apply it deliberately with `railway config apply`. Disable automatic deployments from GitHub and PR environments. Enable Wait for CI if available as an additional guard. If connecting proposes an initial deployment, hold it until the configuration is complete and the chosen main commit has green CI.

Deploy that reviewed commit manually. Confirm the commit SHA in Railway matches the green commit in GitHub. Do not assume that a green earlier commit makes the latest main safe. There is no GitHub Actions deployment credential or automatic deployment workflow in this setup.

The Dockerfile pins Node 24.19.0 and runs npm ci and next build without database access. It runs as the unprivileged node user. TypeScript stays in the image for the current Next config loader; no extra runtime package is added.

Railway reads the pre-deploy command from `.railway/railway.ts`. It validates policy and applies locked, checksummed migrations through the private network. A failed command blocks deployment. The startup script separately checks database connectivity and required migration checksums, then starts Next on 0.0.0.0 and PORT. Missing credentials or a bad schema prevent startup. Restart retries are capped at two. See [pre-deploy commands](https://docs.railway.com/deployments/pre-deploy-command) and [Infrastructure as Code](https://docs.railway.com/infrastructure-as-code).

## 4. Generate HTTPS and verify

In the app's networking settings, generate a Railway domain with target port 3000. No custom domain is needed. Run locally with your actual generated origin:

```sh
npm run smoke:deployed -- https://YOUR-GENERATED-DOMAIN.up.railway.app
```

This makes three bounded HTTP requests: health and home must return 200; the local art gallery must return 404. Open the home page yourself too. The health route is a cheap liveness check, not continuous database monitoring. Railway health checks gate deployment rather than providing ongoing monitoring. See [health checks](https://docs.railway.com/deployments/healthchecks).

Before any real signup, use Railway's app SSH session to run:

```sh
node scripts/check-persistence.ts seed
```

This creates one synthetic operator hog, feeds it once, revokes its session, and prints a verification command containing its ID and state digest. Retain that command. Restart the app through Railway, then run the printed command inside the new app instance. Restart PostgreSQL during this empty-player phase, wait for it to recover, and run the same command again. Both checks must report an identical digest. Keep this one fixture for future restore tests; do not keep running seed. It consumes one account row and contains no user data. Do not run test:db against production.

Record the project/service identifiers, deployed commit, URL, actual resource settings, confirmed spending limits, and restart results in your operating notes. Do not record secrets. This PR cannot mark those checks complete on your behalf.

## Failed deployment and recovery

If migrations fail, inspect their logs and leave the previous deployment running. Never automatically retry migration failures or modify an applied migration. Add a corrective migration. If app startup fails, inspect preflight output and connection settings before redeploying.

For code-only regressions, select the previous successful image and verify it against the current schema. New migration history makes the old migration runner refuse to run, intentionally. If needed, override the old deployment's pre-deploy command with policy validation plus db:check only after verifying backward schema compatibility, then restore the normal pre-deploy command for future deployments. Never reverse SQL blindly.

If the spending cutoff fires, inspect usage and stop the cause before resuming. Do not raise the cap automatically. Pausing the app does not remove database, volume, or backup charges.

Before inviting players, complete SH-006b: daily backups, a demonstrated restore, database growth thresholds, and the remaining operational controls. OAuth will use this generated HTTPS origin in SH-005; a later domain change requires updating OAuth metadata and callbacks.
