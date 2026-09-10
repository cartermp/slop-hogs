# Database development

SH-005 exposes login and callback routes but keeps provisioning and session issuance behind the verified OAuth callback. The callback uses the SDK-returned DID, never a browser-supplied DID, and atomically enforces the registration flag, invite list, account cap, one active hog, and application-session rotation.

Use PostgreSQL 17. For a disposable local test database with Docker:

```sh
docker run --name slophog-test -p 127.0.0.1:5432:5432 -e POSTGRES_USER=slophog -e POSTGRES_PASSWORD=test-only -e POSTGRES_DB=slophog_test -d postgres:17
```

Put these local-only values in `.env.local`:

```sh
DATABASE_URL=postgres://slophog:test-only@localhost:5432/slophog_test
TEST_DATABASE_URL=postgres://slophog:test-only@localhost:5432/slophog_test
```

Run `npm run db:migrate`, then `npm run test:db`. Tests require the separate test URL and fail if absent. They create uniquely named fixtures and delete only those fixtures. Do not point them at production. Stop the test container with `docker stop slophog-test` when finished. Its data remains in the stopped container.

To remove accounts created while manually testing an app deployment, pass their exact DIDs to the cleanup command. It previews the affected rows by default:

```sh
npm run db:clean-test-data -- did:plc:TEST_ACCOUNT
npm run db:clean-test-data -- --execute did:plc:TEST_ACCOUNT
```

Pass additional DIDs as separate arguments when needed. The command deletes only those accounts and their hog lives, application and OAuth sessions, action receipts, visitor treats, account blocks, and gift quota rows in one transaction. It refuses unknown options, malformed DIDs, and the retained deployment and backup-check fixtures. Run the preview first and verify its counts before adding `--execute`.

The integration tests use actual row locks and concurrent requests. Eight provisioning requests must create one active hog. Eight identical feeds must consume one meal and return identical saved events. Twelve further feeds must accept exactly five. A forced transaction failure must preserve saved state. A new connection pool must read identical state and return the original retry receipt. Expired, revoked, and other-owner sessions must fail. OAuth admission must reject closed or storage-blocked registration, preserve a returning account's hog, and rotate its application session. Mutation discovery and cleaning share the same atomic, idempotent receipt path. Opening a hog displays elapsed time without writing or rolling discoveries. Public-pen tests prove that queued gifts do not change state, recipient and sender limits remain atomic, only the owner can accept a gift, and blocks and visibility controls stop interaction. Read-only mode rejects new state changes while preserving an existing idempotent receipt. Restore verification must reject the source database as its own restore target.

This reconnect check is not a PostgreSQL crash/restore test. Use `backup:prepare` and `backup:verify` against a distinct Railway-restored database as documented in the deployment runbook.

Migrations run explicitly, never on web startup or build. Numbered SQL files are applied in one transaction under an advisory lock, with checksums that reject edits to applied files. Add a new migration for changes. Migration 005 upgrades every active and ended rules-version-1 hog state with the version-2 mutation, recent-diet, and cleaning fields; historical action receipts remain immutable. Migration 006 adds opaque public pen IDs, per-account pen controls, gift and block records, and daily sender and recipient gift counters. Migration 007 adds durable share events and speech drafts, immutable PNG storage, render state, and daily account and global card counters. Before deployment, back up the database and test each migration against a copy.

Each application pool allows four connections, with finite connection, lock, query, and idle transaction timeouts. Reuse one pool per process when HTTP routes arrive. The transaction helper holds one client for BEGIN through COMMIT, as required by the [pg transaction API](https://node-postgres.com/features/transactions). `operational_status` stores the latest bounded database-size measurement and enforced growth state. `backup_restore_checks` records only the latest synthetic challenge and successful restore timestamp; it contains no player or provider secrets.

Only SHA-256 hashes of random 256-bit application-session tokens are stored. Cookies are HttpOnly, SameSite=Lax, HTTPS-only in production, expire after seven days, and are revoked on logout or a newer login. OAuth SDK state expires after ten minutes; provider tokens and DPoP keys are encrypted with AES-256-GCM under `OAUTH_ENCRYPTION_KEY`. No browser receives provider tokens or database credentials. Action receipts hold the resulting state and ordered events atomically, without source post content.

No Railway resources are created here. CI starts a temporary PostgreSQL service within each existing ten-minute job. The only new runtime package is `pg`; its TypeScript declarations are development-only.
