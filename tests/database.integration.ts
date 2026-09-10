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
import { deleteTestData, previewTestDataCleanup } from "../src/lib/server/test-data-cleanup.ts";

test("real PostgreSQL persistence, retries, isolation and rollback", async () => {
  // Explicit separate URL. Never silently use an application database for tests.
  assert.ok(process.env.TEST_DATABASE_URL, "Set TEST_DATABASE_URL to a disposable PostgreSQL database");
  const pool = createDatabase(process.env.TEST_DATABASE_URL);
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
      }),
      RegistrationClosedError,
    );
    const authenticated = await completeOAuthSignIn(pool, oauthDid, {
      registrationsEnabled: true,
      accountLimit: 50,
      invitedDids: new Set([oauthDid]),
    });
    assert.deepEqual(await getAppSession(pool, authenticated.token), {
      ownerDid: oauthDid,
      hogId: authenticated.hogId,
    });
    const rotated = await completeOAuthSignIn(pool, oauthDid, {
      registrationsEnabled: true,
      accountLimit: 50,
      invitedDids: new Set(),
    });
    assert.equal(rotated.hogId, authenticated.hogId, "returning verified accounts retain their active hog");
    assert.equal(await getAppSession(pool, authenticated.token), null, "a new login rotates the app session");
    assert.equal((await getAppSession(pool, rotated.token))?.ownerDid, oauthDid);
    await pool.query(
      "INSERT INTO oauth_sessions(did, encrypted_data) VALUES ($1,$2)",
      [oauthDid, Buffer.alloc(30)],
    );
    const testDids = [did, otherDid, oauthDid, closedDid];
    assert.deepEqual(await previewTestDataCleanup(pool, testDids), {
      accounts: 3,
      hogLives: 3,
      appSessions: 3,
      oauthSessions: 1,
      hogActions: 6,
    });
    assert.deepEqual(await deleteTestData(pool, testDids), {
      accounts: 3,
      hogLives: 3,
      appSessions: 3,
      oauthSessions: 1,
      hogActions: 6,
    });
    assert.deepEqual(await previewTestDataCleanup(pool, testDids), {
      accounts: 0,
      hogLives: 0,
      appSessions: 0,
      oauthSessions: 0,
      hogActions: 0,
    });
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
