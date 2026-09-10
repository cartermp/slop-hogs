import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createDatabase, transaction } from "../src/lib/server/database.ts";
import { migrate } from "../src/lib/server/migrations.ts";
import {
  completeOAuthSignIn,
  feedHog,
  getAppSession,
  issueSession,
  provisionHog,
  RegistrationClosedError,
  revokeSession,
} from "../src/lib/server/hogs.ts";
import { ReadOnlyError } from "../src/lib/server/operations.ts";
import { prepareBackupRestoreCheck, verifyRestoredBackup } from "../src/lib/server/backup-restore.ts";
import { deleteTestData, previewTestDataCleanup } from "../src/lib/server/test-data-cleanup.ts";

const operationalPolicy = {
  database: {
    maxBytes: 1_000_000_000,
    warningPercent: 70,
    restrictPercent: 85,
    readOnlyPercent: 95,
  },
  readOnlyMode: false,
};

test("real PostgreSQL persistence, retries, isolation and rollback", async () => {
  // Explicit separate URL. Never silently use an application database for tests.
  assert.ok(process.env.TEST_DATABASE_URL, "Set TEST_DATABASE_URL to a disposable PostgreSQL database");
  let pool = createDatabase(process.env.TEST_DATABASE_URL);
  const did = `did:plc:test${randomUUID().replaceAll("-", "")}`;
  const otherDid = `did:plc:test${randomUUID().replaceAll("-", "")}`;
  const oauthDid = `did:plc:test${randomUUID().replaceAll("-", "")}`;
  const closedDid = `did:plc:test${randomUUID().replaceAll("-", "")}`;
  const action = { type: "feed", food: "ai_image" };
  try {
    await Promise.all([migrate(pool), migrate(pool)]);
    const ids = await Promise.all(Array.from({length: 8}, () => provisionHog(pool, did)));
    assert.equal(new Set(ids).size, 1, "concurrent provisioning creates one active life");
    const hog = ids[0];
    const token = await issueSession(pool, did);
    await provisionHog(pool, otherDid);
    const otherToken = await issueSession(pool, otherDid);
    await assert.rejects(feedHog(pool, otherToken, hog, randomUUID(), action), /Unauthorized/);
    const request = randomUUID();
    const duplicates = await Promise.all(Array.from({length: 8}, () => feedHog(pool, token, hog, request, action)));
    for (const result of duplicates) assert.deepEqual(result, duplicates[0]);
    assert.equal(duplicates[0].state.mealsEaten, 1);
    await assert.rejects(feedHog(pool, token, hog, request, {type:"feed", food:"human_post"}), /different action/);
    const burst = await Promise.allSettled(Array.from({length: 12}, () => feedHog(pool, token, hog, randomUUID(), action)));
    assert.equal(burst.filter(result => result.status === "fulfilled").length, 5);
    const saved = await pool.query("SELECT state FROM hog_lives WHERE id=$1", [hog]);
    assert.equal(saved.rows[0].state.mealsEaten, 6);
    assert.equal(saved.rows[0].state.mealsAvailable, 0);
    assert.equal((await pool.query("SELECT * FROM hog_actions WHERE hog_id=$1", [hog])).rowCount, 6);
    await assert.rejects(transaction(pool, async client => {
      await client.query("UPDATE hog_lives SET state='{}' WHERE id=$1", [hog]);
      throw new Error("forced failure");
    }), /forced failure/);
    assert.deepEqual((await pool.query("SELECT state FROM hog_lives WHERE id=$1", [hog])).rows, saved.rows);
    const reconnected = createDatabase(process.env.TEST_DATABASE_URL);
    try {
      assert.deepEqual((await reconnected.query("SELECT state FROM hog_lives WHERE id=$1", [hog])).rows, saved.rows);
      assert.deepEqual(await feedHog(reconnected, token, hog, request, action), duplicates[0]);
    } finally { await reconnected.end(); }
    await pool.query("UPDATE app_sessions SET expires_at=clock_timestamp() - interval '1 second' WHERE owner_did=$1", [did]);
    await assert.rejects(feedHog(pool, token, hog, request, action), /Unauthorized/);
    const newToken = await issueSession(pool, did);
    await revokeSession(pool, newToken);
    await assert.rejects(feedHog(pool, newToken, hog, request, action), /Unauthorized/);
    await assert.rejects(
      completeOAuthSignIn(pool, closedDid, {
        registrationsEnabled: false,
        accountLimit: 50,
        invitedDids: new Set([closedDid]),
        operationalPolicy,
      }),
      RegistrationClosedError,
    );
    const authenticated = await completeOAuthSignIn(pool, oauthDid, {
      registrationsEnabled: true,
      accountLimit: 50,
      invitedDids: new Set([oauthDid]),
      operationalPolicy,
    });
    assert.deepEqual(await getAppSession(pool, authenticated.token), {
      ownerDid: oauthDid,
      hogId: authenticated.hogId,
    });
    const rotated = await completeOAuthSignIn(pool, oauthDid, {
      registrationsEnabled: true,
      accountLimit: 50,
      invitedDids: new Set(),
      operationalPolicy,
    });
    assert.equal(rotated.hogId, authenticated.hogId, "returning verified accounts retain their active hog");
    assert.equal(await getAppSession(pool, authenticated.token), null, "a new login rotates the app session");
    assert.equal((await getAppSession(pool, rotated.token))?.ownerDid, oauthDid);
    const oauthRequest = randomUUID();
    const oauthResult = await feedHog(pool, rotated.token, rotated.hogId, oauthRequest, action);
    await assert.rejects(
      feedHog(pool, rotated.token, rotated.hogId, randomUUID(), action, {
        ...operationalPolicy,
        readOnlyMode: true,
      }),
      ReadOnlyError,
    );
    assert.deepEqual(
      await feedHog(pool, rotated.token, rotated.hogId, oauthRequest, action, {
        ...operationalPolicy,
        readOnlyMode: true,
      }),
      oauthResult,
      "read-only mode preserves idempotent receipts",
    );
    const storageBlockedDid = `did:plc:test${randomUUID().replaceAll("-", "")}`;
    await assert.rejects(
      completeOAuthSignIn(pool, storageBlockedDid, {
        registrationsEnabled: true,
        accountLimit: 50,
        invitedDids: new Set([storageBlockedDid]),
        operationalPolicy: {
          ...operationalPolicy,
          database: { ...operationalPolicy.database, maxBytes: 1 },
        },
      }),
      RegistrationClosedError,
    );
    await pool.query(
      "INSERT INTO oauth_sessions(did, encrypted_data) VALUES ($1,$2)",
      [oauthDid, Buffer.alloc(30)],
    );
    const testDids = [did, otherDid, oauthDid, closedDid, storageBlockedDid];
    assert.deepEqual(await previewTestDataCleanup(pool, testDids), {
      accounts: 3,
      hogLives: 3,
      appSessions: 3,
      oauthSessions: 1,
      hogActions: 7,
    });
    assert.deepEqual(await deleteTestData(pool, testDids), {
      accounts: 3,
      hogLives: 3,
      appSessions: 3,
      oauthSessions: 1,
      hogActions: 7,
    });
    assert.deepEqual(await previewTestDataCleanup(pool, testDids), {
      accounts: 0,
      hogLives: 0,
      appSessions: 0,
      oauthSessions: 0,
      hogActions: 0,
    });
    const backupCheck = await prepareBackupRestoreCheck(pool);
    assert.match(backupCheck.challenge, /^[0-9a-f-]{36}$/);
    await assert.rejects(verifyRestoredBackup(pool, pool), /source database/);

    const sourceUrl = new URL(process.env.TEST_DATABASE_URL);
    const sourceDatabase = decodeURIComponent(sourceUrl.pathname.slice(1));
    const restoredDatabase = `slophog_restore_${randomUUID().replaceAll("-", "")}`;
    assert.match(sourceDatabase, /^[A-Za-z0-9_]+$/, "Test database name must be a simple identifier");
    const adminUrl = new URL(sourceUrl);
    adminUrl.pathname = "/postgres";
    const restoredUrl = new URL(sourceUrl);
    restoredUrl.pathname = `/${restoredDatabase}`;
    const admin = createDatabase(adminUrl.toString());
    let cloneCreated = false;
    try {
      await pool.end();
      try {
        await admin.query(`CREATE DATABASE "${restoredDatabase}" TEMPLATE "${sourceDatabase}"`);
        cloneCreated = true;
      } finally {
        pool = createDatabase(process.env.TEST_DATABASE_URL);
      }
      const restored = createDatabase(restoredUrl.toString());
      try {
        const verified = await verifyRestoredBackup(pool, restored);
        assert.equal(verified.challenge, backupCheck.challenge);
        assert.ok(verified.sourceDatabaseSizeBytes > 0);
        assert.ok(verified.restoredDatabaseSizeBytes > 0);
        const recorded = await pool.query(
          `SELECT verified_at, source_database_size_bytes, restored_database_size_bytes
             FROM backup_restore_checks WHERE id=true`,
        );
        assert.ok(recorded.rows[0].verified_at instanceof Date);
        assert.ok(Number(recorded.rows[0].source_database_size_bytes) > 0);
        assert.ok(Number(recorded.rows[0].restored_database_size_bytes) > 0);

        await restored.query("UPDATE backup_restore_checks SET challenge=$1 WHERE id=true", [randomUUID()]);
        await assert.rejects(verifyRestoredBackup(pool, restored), /prepared backup challenge/);
        await restored.query("UPDATE backup_restore_checks SET challenge=$1 WHERE id=true", [backupCheck.challenge]);
        const restoredState = await restored.query("SELECT state FROM hog_lives WHERE id=$1", [backupCheck.fixture_hog_id]);
        await restored.query("UPDATE hog_lives SET state=$2 WHERE id=$1", [
          backupCheck.fixture_hog_id,
          { ...restoredState.rows[0].state, mealsEaten: 999 },
        ]);
        await assert.rejects(verifyRestoredBackup(pool, restored), /fixture is missing or changed/);
      } finally {
        await restored.end();
      }
    } finally {
      if (cloneCreated) await admin.query(`DROP DATABASE "${restoredDatabase}" WITH (FORCE)`);
      await admin.end();
    }
  } finally {
    // Remove only this test's uniquely named accounts and dependent fixtures.
    const testDids = [did, otherDid, oauthDid, closedDid];
    await pool.query("DELETE FROM oauth_sessions WHERE did=ANY($1)", [testDids]);
    await pool.query("DELETE FROM hog_actions WHERE hog_id IN (SELECT id FROM hog_lives WHERE owner_did=ANY($1))", [testDids]);
    await pool.query("DELETE FROM app_sessions WHERE owner_did=ANY($1)", [testDids]);
    await pool.query("DELETE FROM hog_lives WHERE owner_did=ANY($1)", [testDids]);
    await pool.query("DELETE FROM accounts WHERE did=ANY($1)", [testDids]);
    await pool.end();
  }
});
