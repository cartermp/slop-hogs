# Database development

SH-004 adds storage functions, not public feeding or login routes. Provisioning and session issuance are trusted server functions reserved for the verified OAuth callback in SH-005. Do not expose either function using a browser-supplied DID. Registration limits and feature gates must be enforced when that callback is implemented.

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

The integration test uses actual row locks and concurrent requests. Eight provisioning requests must create one active hog. Eight identical feeds must consume one meal and return identical saved events. Twelve further feeds must accept exactly five. A forced transaction failure must preserve saved state. A new connection pool must read identical state and return the original retry receipt. Expired, revoked, and other-owner sessions must fail.

This reconnect check is not a PostgreSQL crash/restore test. Railway restart and backup restore checks belong to SH-006.

Migrations run explicitly, never on web startup or build. Numbered SQL files are applied in one transaction under an advisory lock, with checksums that reject edits to applied files. Add a new migration for changes. Before deployment, back up the database and test each migration against a copy. These initial tables have no existing player data to migrate.

Each application pool allows four connections, with finite connection, lock, query, and idle transaction timeouts. Reuse one pool per process when HTTP routes arrive. The transaction helper holds one client for BEGIN through COMMIT, as required by the [pg transaction API](https://node-postgres.com/features/transactions).

Only SHA-256 hashes of random 256-bit session tokens are stored. Cookies, CSRF defenses, verified OAuth, session cleanup, and signup controls arrive in SH-005. No browser receives database credentials. Action receipts hold the resulting state and ordered events atomically, without source post content. Receipts are retained for idempotency and history; storage thresholds and monitoring must be enabled before public exposure.

No Railway resources are created here. CI starts a temporary PostgreSQL service within each existing ten-minute job. The only new runtime package is `pg`; its TypeScript declarations are development-only.
