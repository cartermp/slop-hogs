import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createDatabase, transaction } from "../src/lib/server/database.ts";
import { migrate } from "../src/lib/server/migrations.ts";
import { provisionHog, issueSession, revokeSession, feedHog } from "../src/lib/server/hogs.ts";

test("real PostgreSQL persistence, retries, isolation and rollback", async () => {
  // Explicit separate URL. Never silently use an application database for tests.
  assert.ok(process.env.TEST_DATABASE_URL, "Set TEST_DATABASE_URL to a disposable PostgreSQL database");
  const pool = createDatabase(process.env.TEST_DATABASE_URL);
  const did = `did:plc:test${randomUUID().replaceAll("-", "")}`;
  const otherDid = `did:plc:test${randomUUID().replaceAll("-", "")}`;
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
  } finally {
    // Remove only this test's uniquely named accounts and dependent fixtures.
    await pool.query("DELETE FROM hog_actions WHERE hog_id IN (SELECT id FROM hog_lives WHERE owner_did=ANY($1))", [[did, otherDid]]);
    await pool.query("DELETE FROM app_sessions WHERE owner_did=ANY($1)", [[did, otherDid]]);
    await pool.query("DELETE FROM hog_lives WHERE owner_did=ANY($1)", [[did, otherDid]]);
    await pool.query("DELETE FROM accounts WHERE did=ANY($1)", [[did, otherDid]]);
    await pool.end();
  }
});
