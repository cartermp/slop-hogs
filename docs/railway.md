# First Railway deployment

Status: repository support for SH-006 is complete. Source control cannot confirm Railway billing limits, resource settings, domains, backup schedules, or a live restore. The owner must complete and record the live checks below before inviting players.

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
| APP_ORIGIN | Exact generated HTTPS origin, with no trailing path |
| OAUTH_PRIVATE_KEY | P-256 EC private key generated outside the repository |
| OAUTH_ENCRYPTION_KEY | Base64-encoded 32-byte key generated outside the repository |
| OAUTH_KEY_ID | Stable public key identifier, for example `slop-hogs-1` |
| BLUESKY_INVITED_DIDS | Comma-separated invited account DIDs; empty means only configured owners can create accounts |
| SLOP_HOGS_OWNER_DIDS | Comma-separated owner DIDs allowed to create an account and open `/owner` |
| TRUSTED_PROXY_COUNT | `1` for Railway's forwarding proxy |

Use the private DATABASE_URL, not DATABASE_PUBLIC_URL. Do not add TEST_DATABASE_URL or paid AI keys. Keep OAuth keys in Railway variables, never in `NEXT_PUBLIC_` variables or operating notes. Do not attach a volume to the app. Its filesystem is disposable.

## 3. Connect and deploy deliberately

Connect `cartermp/slop-hogs` with root directory `/`. Do not configure a legacy Railway config-file path. The IaC file exports the named `slop-hogs` partial so it owns only the application service; the manually managed PostgreSQL service and volume must remain outside that partial. Review `.railway/railway.ts` with `railway config plan` and confirm the plan does not delete or replace PostgreSQL or its volume, then apply it deliberately with `railway config apply`. Disable automatic deployments from GitHub and PR environments. Enable Wait for CI if available as an additional guard. If connecting proposes an initial deployment, hold it until the configuration is complete and the chosen main commit has green CI.

Deploy that reviewed commit manually. Confirm the commit SHA in Railway matches the green commit in GitHub. Do not assume that a green earlier commit makes the latest main safe. There is no GitHub Actions deployment credential or automatic deployment workflow in this setup.

The Dockerfile pins Node 24.19.0 and runs npm ci and next build without database access. It runs as the unprivileged node user. TypeScript stays in the image for the current Next config loader; no extra runtime package is added.

Railway reads the pre-deploy command from `.railway/railway.ts`. It validates policy and applies locked, checksummed migrations through the private network. A failed command blocks deployment. As a startup safeguard, the application reruns the idempotent, advisory-locked migrator, verifies database connectivity and migration checksums, then starts Next on 0.0.0.0 and PORT. Missing credentials or a bad schema prevent startup. Restart retries are capped at two. See [pre-deploy commands](https://docs.railway.com/deployments/pre-deploy-command) and [Infrastructure as Code](https://docs.railway.com/infrastructure-as-code).

## 4. Generate HTTPS and verify

In the app's networking settings, generate a Railway domain with target port 3000. No custom domain is needed. Run locally with your actual generated origin:

```sh
npm run smoke:deployed -- https://YOUR-GENERATED-DOMAIN.up.railway.app
```

This makes three bounded HTTP requests: health and home must return 200; the local art gallery must return 404. Open the home page yourself too. Sign in as an owner and confirm `/owner` reports the expected feature flags, account cap, database measurement, and no restore verification yet. Sign in as a non-owner and confirm `/owner` returns 404. The health route is a cheap liveness check, not continuous database monitoring. Railway health checks gate deployment rather than providing ongoing monitoring. See [health checks](https://docs.railway.com/deployments/healthchecks).

Before any real signup, use Railway's app SSH session to run:

```sh
node scripts/check-persistence.ts seed
```

This creates one synthetic operator hog, feeds it once, revokes its session, and prints a verification command containing its ID and state digest. Retain that command. Restart the app through Railway, then run the printed command inside the new app instance. Restart PostgreSQL during this empty-player phase, wait for it to recover, and run the same command again. Both checks must report an identical digest. Keep this one fixture for future restore tests; do not keep running seed. It consumes one account row and contains no user data. Do not run test:db against production.

After manually testing the live app, use the app service's SSH session to preview cleanup for each test account DID, then repeat with `--execute` only after checking the counts:

```sh
npm run db:clean-test-data -- did:plc:TEST_ACCOUNT
npm run db:clean-test-data -- --execute did:plc:TEST_ACCOUNT
```

The command targets only the listed DIDs and refuses to remove the retained deployment and backup-check fixtures.

Record the project/service identifiers, deployed commit, URL, actual resource settings, confirmed spending limits, and restart results in your operating notes. Do not record secrets. Source control cannot mark those checks complete on your behalf.

## 5. Enable and verify daily backups

In the PostgreSQL volume settings, enable a daily backup schedule with six days of retention. Backup storage is billable. Railway restores are restricted to the same project and environment, and deleting a volume also deletes its backups. The alpha recovery target is at most 24 hours of lost progress; restore work occurs when the owner is available.

Before creating the backup to test, use the app service SSH session:

```sh
npm run backup:prepare
```

This creates or reuses one synthetic `did:plc:backuprestorecheck` hog, stores a fresh challenge, and clears the previous verification timestamp. Create a manual volume backup after the command completes. Restore that backup to a temporary PostgreSQL service in the same project and environment. Give the temporary service and volume a named owner and deletion deadline.

Temporarily add `RESTORE_DATABASE_URL=${{RestoredPostgres.DATABASE_URL}}` to the app service, using the restored service's actual name, and redeploy the same reviewed commit. In an app SSH session run:

```sh
npm run backup:verify
```

The verifier requires both databases to contain the prepared challenge and identical synthetic hog state. It writes a random probe to the restore target and refuses verification if the source can see that probe, preventing the production database from being accepted as its own restore. A successful result records the verification time and both measured database sizes in production for `/owner`, then consumes the challenge so the same restore cannot refresh that timestamp. Run `backup:prepare` again before every later restore test.

Remove `RESTORE_DATABASE_URL`, delete the temporary restored service and its volume, and confirm they no longer appear in project resources. Do not delete the production volume or retained synthetic fixture. Record the backup schedule, backup timestamp, restore verification timestamp, and cleanup in operating notes. Repeat the restore test before risky migrations and periodically while the alpha contains valued progress.

## 6. Verify live OAuth and launch controls

On the generated HTTPS origin, test an invited owner login, an invited non-owner login, a non-invited denial, logout, and a malformed or replayed callback rejection. Confirm the app requests identity only and cannot post.

The app measures PostgreSQL size during startup, at most every 15 minutes on registration or game writes, and whenever an owner opens `/owner`. The 1 GB internal budget warns at 70%, blocks registrations and future card creation at 85%, and rejects new game state changes at 95%. Existing idempotent action receipts remain readable. Provider volume capacity and backup storage need separate Railway headroom.

To close signup, set `features.registrations` to `false` in `config/cost-policy.json`, run the checks, and manually deploy that reviewed commit. To block registration, future card creation, and new game state changes together, set `features.readOnlyMode` to `true` and do the same. Do not edit the thresholds upward: validation allows only the approved ceilings. Record why and when a control changed.

## Operating record

Keep this outside the repository if it contains private project details. Record the Railway workspace, project, environment, service identifiers, generated URL, deployed commit, resource settings, spending controls, restart results, daily backup retention, restore verification, temporary-resource cleanup, and first-day and first-week usage reviews.

## Failed deployment and recovery

If migrations fail, inspect their logs and leave the previous deployment running. Never automatically retry migration failures or modify an applied migration. Add a corrective migration. If app startup fails, inspect preflight output and connection settings before redeploying.

For code-only regressions, select the previous successful image and verify it against the current schema. New migration history makes the old migration runner refuse to run, intentionally. If needed, override the old deployment's pre-deploy command with policy validation plus db:check only after verifying backward schema compatibility, then restore the normal pre-deploy command for future deployments. Never reverse SQL blindly.

If the spending cutoff fires, inspect usage and stop the cause before resuming. Do not raise the cap automatically. Pausing the app does not remove database, volume, or backup charges.

For a database incident, set read-only mode before recovery if the current database is still writable. Restore only after identifying the correct backup and preserving the current volume when practical. Run `backup:verify` against the candidate restore before switching any connection. Never modify an applied migration or reverse SQL blindly.

Before inviting players, every live item above must be recorded, including a demonstrated restore. A later domain change requires updating `APP_ORIGIN`, OAuth metadata, and callbacks together.
