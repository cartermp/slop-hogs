import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createDatabase } from "../src/lib/server/database.ts";
import { feedHog, issueSession, provisionHog } from "../src/lib/server/hogs.ts";
import { migrate } from "../src/lib/server/migrations.ts";
import {
  CardLimitError,
  getPublicShareEvent,
  getShareEvents,
  getStoredShareCard,
  requestShareCard,
  updateShareSpeech,
} from "../src/lib/server/share-cards.ts";

const policy = {
  limits: {
    cardsPerAccountPerDay: 1,
    cardsGlobalPerDay: 10,
    cardMaxBytes: 250_000,
    cardStorageMaxBytes: 250_000_000,
    externalRequestTimeoutMs: 5_000,
  },
  database: {
    maxBytes: 1_000_000_000,
    warningPercent: 70,
    restrictPercent: 85,
    readOnlyPercent: 95,
  },
  features: { cardRendering: true, readOnlyMode: false },
};

const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

test("share events persist drafts and owner renders stay bounded while public reads stay inert", async () => {
  assert.ok(process.env.TEST_DATABASE_URL, "Set TEST_DATABASE_URL to a disposable PostgreSQL database");
  const pool = createDatabase(process.env.TEST_DATABASE_URL);
  const ownerDid = `did:plc:test${randomUUID().replaceAll("-", "")}`;
  const otherDid = `did:plc:test${randomUUID().replaceAll("-", "")}`;
  try {
    await migrate(pool);
    const hogId = await provisionHog(pool, ownerDid);
    const token = await issueSession(pool, ownerDid);
    await provisionHog(pool, otherDid);
    const otherToken = await issueSession(pool, otherDid);

    await feedHog(pool, token, hogId, randomUUID(), { type: "feed", food: "ai_image" });
    await feedHog(pool, token, hogId, randomUUID(), { type: "feed", food: "ai_image" });
    const [event] = await getShareEvents(pool, token);
    assert.ok(event);
    assert.equal(event.mutation, "glazed_eyes");
    assert.equal(event.cardReady, false);
    assert.deepEqual(await getShareEvents(pool, token), [event], "owner reads do not replace a stored draft");
    await assert.rejects(updateShareSpeech(pool, otherToken, event.id, "stolen"), /Unauthorized/);

    const edited = "My hog has seen the feed and cannot unsee it.";
    assert.equal(await updateShareSpeech(pool, token, event.id, ` ${edited} `), edited);
    assert.equal((await getPublicShareEvent(pool, event.id))?.speech, edited);

    const beforeReads = await pool.query(
      `SELECT
         (SELECT count(*)::integer FROM share_cards) AS cards,
         (SELECT count(*)::integer FROM card_global_daily) AS quotas`,
    );
    for (let index = 0; index < 3; index += 1) {
      assert.equal((await getPublicShareEvent(pool, event.id))?.cardReady, false);
      assert.equal(await getStoredShareCard(pool, event.id), null);
    }
    assert.deepEqual(
      (await pool.query(
        `SELECT
           (SELECT count(*)::integer FROM share_cards) AS cards,
           (SELECT count(*)::integer FROM card_global_daily) AS quotas`,
      )).rows,
      beforeReads.rows,
      "anonymous reads cannot render or reserve quota",
    );

    await requestShareCard(pool, token, event.id, policy, async () => tinyPng);
    const stored = await getStoredShareCard(pool, event.id);
    assert.deepEqual(stored?.png, tinyPng);
    assert.equal((await getPublicShareEvent(pool, event.id))?.cardReady, true);
    const quotaAfterFirst = await pool.query(
      "SELECT cards FROM card_account_daily WHERE owner_did=$1",
      [ownerDid],
    );
    assert.equal(quotaAfterFirst.rows[0].cards, 1);
    await requestShareCard(pool, token, event.id, policy, async () => {
      throw new Error("an existing card must not render again");
    });
    assert.equal(
      (await pool.query("SELECT cards FROM card_account_daily WHERE owner_did=$1", [ownerDid])).rows[0].cards,
      1,
      "a successful retry returns the existing card without spending quota",
    );

    await feedHog(pool, token, hogId, randomUUID(), { type: "feed", food: "generated_post" });
    await feedHog(pool, token, hogId, randomUUID(), { type: "feed", food: "generated_post" });
    const events = await getShareEvents(pool, token);
    const second = events.find(candidate => candidate.id !== event.id);
    assert.ok(second);
    await assert.rejects(
      requestShareCard(pool, token, second.id, policy, async () => tinyPng),
      CardLimitError,
      "the per-account daily render allowance is atomic and durable",
    );

    await pool.query("UPDATE accounts SET pen_public=false WHERE did=$1", [ownerDid]);
    assert.equal(await getPublicShareEvent(pool, event.id), null);
    assert.equal(await getStoredShareCard(pool, event.id), null);
  } finally {
    await pool.query("DELETE FROM card_global_daily");
    await pool.query("DELETE FROM app_sessions WHERE owner_did=ANY($1::text[])", [[ownerDid, otherDid]]);
    await pool.query(
      "DELETE FROM hog_actions WHERE hog_id IN (SELECT id FROM hog_lives WHERE owner_did=ANY($1::text[]))",
      [[ownerDid, otherDid]],
    );
    await pool.query("DELETE FROM hog_lives WHERE owner_did=ANY($1::text[])", [[ownerDid, otherDid]]);
    await pool.query("DELETE FROM accounts WHERE did=ANY($1::text[])", [[ownerDid, otherDid]]);
    await pool.end();
  }
});
