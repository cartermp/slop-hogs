import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createDatabase, transaction } from "../src/lib/server/database.ts";
import { migrate } from "../src/lib/server/migrations.ts";
import {
  completeOAuthSignIn,
  DuplicatePostError,
  feedHog,
  feedHogFromPost,
  getAppSession,
  issueSession,
  NotInvitedError,
  provisionHog,
  RegistrationClosedError,
  revokeSession,
} from "../src/lib/server/hogs.ts";
import {
  PostLookupRateLimitError,
  PostUnavailableError,
  previewPost,
} from "../src/lib/server/posts.ts";
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
  const uninvitedDid = `did:plc:test${randomUUID().replaceAll("-", "")}`;
  const postDid = `did:plc:test${randomUUID().replaceAll("-", "")}`;
  const postRecordKey = randomUUID().replaceAll("-", "");
  const canonicalPostUri = `at://${postDid}/app.bsky.feed.post/${postRecordKey}`;
  const postUrl = `https://bsky.app/profile/poster.example/post/${postRecordKey}`;
  const canonicalPostUrl = `https://bsky.app/profile/${postDid}/post/${postRecordKey}`;
  const oldHandleUrl = `https://bsky.app/profile/old.poster.example/post/${postRecordKey}`;
  const concurrentPosts = [
    { did: otherDid, key: randomUUID().replaceAll("-", "") },
    { did: oauthDid, key: randomUUID().replaceAll("-", "") },
  ].map(post => ({
    ...post,
    uri: `at://${post.did}/app.bsky.feed.post/${post.key}`,
    url: `https://bsky.app/profile/${post.did}/post/${post.key}`,
  }));
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
    await assert.rejects(
      completeOAuthSignIn(pool, uninvitedDid, {
        registrationsEnabled: true,
        accountLimit: 50,
        invitedDids: new Set(),
        operationalPolicy,
      }),
      NotInvitedError,
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
    const readOnlyStatus = await pool.query(
      "SELECT xmin::text AS xmin, measured_at FROM operational_status WHERE id=true",
    );
    assert.deepEqual(
      await feedHog(pool, rotated.token, rotated.hogId, oauthRequest, action, {
        ...operationalPolicy,
        readOnlyMode: true,
      }),
      oauthResult,
      "read-only mode preserves idempotent receipts",
    );
    assert.deepEqual(
      (await pool.query("SELECT xmin::text AS xmin, measured_at FROM operational_status WHERE id=true")).rows,
      readOnlyStatus.rows,
      "fresh unchanged read-only checks do not write operational status",
    );
    const postHog = await provisionHog(pool, postDid);
    const postToken = await issueSession(pool, postDid);
    let lookupCalls = 0;
    const postFetch: typeof fetch = async () => {
      lookupCalls++;
      if (lookupCalls === 2) {
        assert.deepEqual(
          (await pool.query(
            "SELECT author_handle, author_display_name, post_text, indexed_at FROM post_sources WHERE canonical_uri=$1",
            [canonicalPostUri],
          )).rows,
          [{ author_handle: null, author_display_name: null, post_text: null, indexed_at: null }],
          "expired preview content is cleared before refresh",
        );
      }
      return Response.json({
        posts: [{
          uri: canonicalPostUri,
          cid: `bafy${postRecordKey}`,
          author: { did: postDid, handle: "poster.example", displayName: "Poster" },
          record: { text: "database-fed slop" },
          indexedAt: "2026-09-10T12:00:00.000Z",
        }],
      });
    };
    const previewPolicy = {
      enabled: true,
      limits: {
        postLookupsPerAccountPerDay: 4,
        postLookupsGlobalPerHour: 100,
        externalRequestTimeoutMs: 100,
        externalResponseMaxBytes: 10_000,
      },
    };
    const preview = await previewPost(pool, postToken, postUrl, previewPolicy, postFetch);
    assert.equal(preview.canonicalUri, canonicalPostUri);
    assert.deepEqual(await previewPost(pool, postToken, postUrl, previewPolicy, postFetch), preview);
    assert.equal(lookupCalls, 1, "a fresh preview does not spend lookup quota twice");
    await pool.query(
      "UPDATE post_sources SET preview_expires_at=clock_timestamp() - interval '1 second' WHERE canonical_uri=$1",
      [canonicalPostUri],
    );
    assert.deepEqual(await previewPost(pool, postToken, postUrl, previewPolicy, postFetch), preview);
    assert.equal(lookupCalls, 2, "an expired preview is refreshed");
    const postRequest = randomUUID();
    await assert.rejects(
      feedHogFromPost(
        pool,
        postToken,
        postHog,
        postRequest,
        "shitpost",
        canonicalPostUri,
        `changed${postRecordKey}`,
        operationalPolicy,
      ),
      /changed or expired/,
      "feeding is bound to the exact CID the player previewed",
    );
    const fedPost = await feedHogFromPost(
      pool,
      postToken,
      postHog,
      postRequest,
      "shitpost",
      canonicalPostUri,
      `bafy${postRecordKey}`,
      operationalPolicy,
    );
    assert.deepEqual(
      await feedHogFromPost(
        pool,
        postToken,
        postHog,
        postRequest,
        "shitpost",
        canonicalPostUri,
        `bafy${postRecordKey}`,
        operationalPolicy,
      ),
      fedPost,
      "a retried request returns its original post receipt",
    );
    await assert.rejects(
      feedHogFromPost(
        pool,
        postToken,
        postHog,
        postRequest,
        "shitpost",
        canonicalPostUri,
        `changed${postRecordKey}`,
        operationalPolicy,
      ),
      /different action/,
      "the preview CID is part of the idempotency key",
    );
    await assert.rejects(
      feedHogFromPost(
        pool,
        postToken,
        postHog,
        postRequest,
        "shitpost",
        canonicalPostUri,
        `changed${postRecordKey}`,
        { ...operationalPolicy, readOnlyMode: true },
      ),
      /different action/,
      "read-only idempotency checks also bind the preview CID",
    );
    await assert.rejects(
      feedHogFromPost(
        pool,
        postToken,
        postHog,
        randomUUID(),
        "shitpost",
        canonicalPostUri,
        `bafy${postRecordKey}`,
        operationalPolicy,
      ),
      DuplicatePostError,
    );
    const savedPostAction = await pool.query(
      "SELECT source_uri, observed_source_cid FROM hog_actions WHERE hog_id=$1 AND request_id=$2",
      [postHog, postRequest],
    );
    assert.deepEqual(savedPostAction.rows, [{
      source_uri: canonicalPostUri,
      observed_source_cid: `bafy${postRecordKey}`,
    }]);

    await pool.query(
      `INSERT INTO post_preview_aliases(
         lookup_url, canonical_uri, available_until, unavailable_until, checked_at
       ) VALUES ($1,$2,clock_timestamp() - interval '1 second',NULL,clock_timestamp())`,
      [oldHandleUrl, canonicalPostUri],
    );
    const unavailableFetch: typeof fetch = async () => {
      lookupCalls++;
      return Response.json({ posts: [] });
    };
    await assert.rejects(
      previewPost(pool, postToken, oldHandleUrl, previewPolicy, unavailableFetch),
      PostUnavailableError,
    );
    assert.equal(
      (await pool.query("SELECT available FROM post_sources WHERE canonical_uri=$1", [canonicalPostUri])).rows[0].available,
      true,
      "an obsolete handle does not mark the canonical source unavailable",
    );
    assert.equal(
      (await previewPost(pool, postToken, canonicalPostUrl, previewPolicy, postFetch)).canonicalUri,
      canonicalPostUri,
      "the canonical alias remains fresh after an obsolete handle fails",
    );
    assert.equal(lookupCalls, 3);
    await pool.query(
      "UPDATE post_sources SET preview_expires_at=clock_timestamp() - interval '1 second' WHERE canonical_uri=$1",
      [canonicalPostUri],
    );
    await assert.rejects(
      previewPost(pool, postToken, canonicalPostUrl, previewPolicy, unavailableFetch),
      PostUnavailableError,
    );
    await assert.rejects(
      previewPost(
        pool,
        postToken,
        canonicalPostUrl,
        previewPolicy,
        postFetch,
      ),
      PostUnavailableError,
      "unavailability invalidates every known alias for the canonical post",
    );
    await assert.rejects(
      previewPost(pool, postToken, postUrl, previewPolicy, unavailableFetch),
      PostUnavailableError,
    );
    assert.equal(lookupCalls, 4, "known unavailable posts are cached without another lookup");
    assert.deepEqual(
      (await pool.query(
        `SELECT available, author_handle, author_display_name, post_text, indexed_at
           FROM post_sources WHERE canonical_uri=$1`,
        [canonicalPostUri],
      )).rows,
      [{
        available: false,
        author_handle: null,
        author_display_name: null,
        post_text: null,
        indexed_at: null,
      }],
      "unavailable source content is removed while its private receipt remains",
    );
    let concurrentCalls = 0;
    await Promise.all(concurrentPosts.map((post, index) => previewPost(
      pool,
      index === 0 ? otherToken : rotated.token,
      post.url,
      {
        ...previewPolicy,
        limits: { ...previewPolicy.limits, postLookupsGlobalPerHour: 6 },
      },
      async () => {
        concurrentCalls++;
        return Response.json({
          posts: [{
            uri: post.uri,
            cid: `bafy${post.key}`,
            author: { did: post.did, handle: `${index}.poster.example` },
            record: { text: "concurrent quota slop" },
          }],
        });
      },
    )));
    assert.equal(concurrentCalls, 2, "two remaining global reservations can proceed concurrently");
    const limitedUrl = `https://bsky.app/profile/${otherDid}/post/${randomUUID().replaceAll("-", "")}`;
    await assert.rejects(
      previewPost(pool, otherToken, limitedUrl, {
        ...previewPolicy,
        limits: { ...previewPolicy.limits, postLookupsGlobalPerHour: 6 },
      }, postFetch),
      PostLookupRateLimitError,
      "the global hourly limit is atomic across accounts",
    );
    assert.equal(
      (await pool.query(
        `SELECT count(*)::integer AS count FROM post_lookup_account_daily
          WHERE owner_did=$1`,
        [otherDid],
      )).rows[0].count,
      1,
      "a rejected global reservation rolls back only its new per-account reservation",
    );
    await assert.rejects(
      previewPost(pool, postToken, limitedUrl, previewPolicy, postFetch),
      PostLookupRateLimitError,
    );
    assert.equal(lookupCalls, 4, "quota is reserved before remote work");
    assert.equal(
      Number((await pool.query(
        `SELECT lookups FROM post_lookup_account_daily
          WHERE owner_did=$1
            AND bucket_start=date_trunc('day', clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`,
        [postDid],
      )).rows[0].lookups),
      4,
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
    const testDids = [did, otherDid, oauthDid, closedDid, uninvitedDid, storageBlockedDid, postDid];
    assert.deepEqual(await previewTestDataCleanup(pool, testDids), {
      accounts: 4,
      hogLives: 4,
      appSessions: 4,
      oauthSessions: 1,
      hogActions: 8,
    });
    assert.deepEqual(await deleteTestData(pool, testDids), {
      accounts: 4,
      hogLives: 4,
      appSessions: 4,
      oauthSessions: 1,
      hogActions: 8,
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
        await restored.query("UPDATE backup_restore_checks SET challenge=$1 WHERE id=true", [randomUUID()]);
        await assert.rejects(verifyRestoredBackup(pool, restored), /prepared backup challenge/);
        await restored.query("UPDATE backup_restore_checks SET challenge=$1 WHERE id=true", [backupCheck.challenge]);
        const restoredState = await restored.query("SELECT state FROM hog_lives WHERE id=$1", [backupCheck.fixture_hog_id]);
        await restored.query("UPDATE hog_lives SET state=$2 WHERE id=$1", [
          backupCheck.fixture_hog_id,
          { ...restoredState.rows[0].state, mealsEaten: 999 },
        ]);
        await assert.rejects(verifyRestoredBackup(pool, restored), /fixture is missing or changed/);
        await restored.query("UPDATE hog_lives SET state=$2 WHERE id=$1", [
          backupCheck.fixture_hog_id,
          restoredState.rows[0].state,
        ]);

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
        await assert.rejects(
          verifyRestoredBackup(pool, restored),
          /Run backup:prepare/,
          "a successful backup challenge cannot be replayed",
        );
      } finally {
        await restored.end();
      }
    } finally {
      if (cloneCreated) await admin.query(`DROP DATABASE "${restoredDatabase}" WITH (FORCE)`);
      await admin.end();
    }
  } finally {
    // Remove only this test's uniquely named accounts and dependent fixtures.
    const testDids = [did, otherDid, oauthDid, closedDid, uninvitedDid, postDid];
    await pool.query("DELETE FROM oauth_sessions WHERE did=ANY($1)", [testDids]);
    await pool.query("DELETE FROM hog_actions WHERE hog_id IN (SELECT id FROM hog_lives WHERE owner_did=ANY($1))", [testDids]);
    await pool.query("DELETE FROM app_sessions WHERE owner_did=ANY($1)", [testDids]);
    await pool.query("DELETE FROM hog_lives WHERE owner_did=ANY($1)", [testDids]);
    await pool.query("DELETE FROM accounts WHERE did=ANY($1)", [testDids]);
    await pool.query(
      "DELETE FROM post_preview_aliases WHERE canonical_uri=$1 OR lookup_url=ANY($2::text[])",
      [canonicalPostUri, [postUrl, canonicalPostUrl, oldHandleUrl]],
    );
    await pool.query(
      "DELETE FROM post_preview_aliases WHERE canonical_uri=ANY($1::text[])",
      [concurrentPosts.map(post => post.uri)],
    );
    await pool.query(
      "DELETE FROM post_sources WHERE canonical_uri=$1 OR canonical_uri=ANY($2::text[])",
      [canonicalPostUri, concurrentPosts.map(post => post.uri)],
    );
    await pool.query(
      `DELETE FROM post_lookup_global_hourly
        WHERE bucket_start=date_trunc('hour', clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`,
    );
    await pool.end();
  }
});
