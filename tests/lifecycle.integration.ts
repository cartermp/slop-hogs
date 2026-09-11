import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { ENDING_MIN_MEALS, parseGameState } from "../src/lib/game.ts";
import { createDatabase } from "../src/lib/server/database.ts";
import {
  feedHog,
  getAccountSession,
  issueSession,
  provisionHog,
} from "../src/lib/server/hogs.ts";
import {
  getHogProfile,
  startNextGeneration,
} from "../src/lib/server/lifecycle.ts";
import { migrate } from "../src/lib/server/migrations.ts";
import { getPenManagement, getPublicPen } from "../src/lib/server/social.ts";

const operationalPolicy = {
  database: {
    maxBytes: 1_000_000_000,
    warningPercent: 70,
    restrictPercent: 85,
    readOnlyPercent: 95,
  },
  readOnlyMode: false,
};

test("one terminal receipt freezes a tombstone before one next generation", async () => {
  assert.ok(process.env.TEST_DATABASE_URL, "Set TEST_DATABASE_URL to a disposable PostgreSQL database");
  const pool = createDatabase(process.env.TEST_DATABASE_URL);
  const did = `did:plc:test${randomUUID().replaceAll("-", "")}`;
  try {
    await migrate(pool);
    const hogId = await provisionHog(pool, did);
    const token = await issueSession(pool, did);
    const pen = await getPenManagement(pool, token);
    assert.ok(pen);

    const saved = parseGameState(
      (await pool.query("SELECT state FROM hog_lives WHERE id=$1", [hogId])).rows[0].state,
    );
    await pool.query("UPDATE hog_lives SET state=$2 WHERE id=$1", [
      hogId,
      {
        ...saved,
        stats: { slop: 99, mass: 120, brain: 40, filth: 80, joy: 90 },
        mealsEaten: ENDING_MIN_MEALS - 1,
      },
    ]);

    const requestId = randomUUID();
    const endings = await Promise.all(Array.from({ length: 6 }, () => feedHog(
      pool,
      token,
      hogId,
      requestId,
      { type: "feed", food: "ai_image" },
      operationalPolicy,
    )));
    for (const result of endings) assert.deepEqual(result, endings[0]);
    assert.equal(endings[0].events.filter(event => event.type === "life_ended").length, 1);
    assert.deepEqual(
      (await pool.query(
        `SELECT count(*)::integer AS endings,
                count(DISTINCT action_request_id)::integer AS receipts
           FROM hog_endings WHERE hog_id=$1`,
        [hogId],
      )).rows,
      [{ endings: 1, receipts: 1 }],
    );
    assert.equal(
      (await pool.query("SELECT count(*)::integer AS count FROM hog_actions WHERE hog_id=$1", [hogId])).rows[0].count,
      1,
    );

    const endedProfile = await getHogProfile(pool, token);
    assert.ok(endedProfile);
    assert.equal(endedProfile.active, null);
    assert.equal(endedProfile.tombstones.length, 1);
    assert.equal(endedProfile.tombstones[0].hogId, hogId);
    assert.equal(endedProfile.tombstones[0].generation, 1);
    assert.equal(endedProfile.tombstones[0].finalState.stats.slop, 100);
    assert.equal(endedProfile.tombstones[0].finalAppearance.artVersion, 1);
    assert.deepEqual(await getAccountSession(pool, token), { ownerDid: did, hogId: null, handle: null });

    const publicEnding = await getPublicPen(pool, pen.penId);
    assert.ok(publicEnding);
    assert.equal(publicEnding.hogId, null);
    assert.equal(publicEnding.state, null);
    assert.equal(publicEnding.tombstones[0].hogId, hogId);
    assert.deepEqual(
      await feedHog(
        pool,
        token,
        hogId,
        requestId,
        { type: "feed", food: "ai_image" },
        operationalPolicy,
      ),
      endings[0],
      "the terminal action remains idempotent after the life is closed",
    );
    await assert.rejects(
      feedHog(
        pool,
        token,
        hogId,
        randomUUID(),
        { type: "feed", food: "ai_image" },
        operationalPolicy,
      ),
      /Hog life has ended/,
    );
    assert.equal(await provisionHog(pool, did), hogId, "sign-in provisioning cannot skip the tombstone");

    const nextLives = await Promise.all(Array.from({ length: 6 }, () => (
      startNextGeneration(pool, token, operationalPolicy)
    )));
    assert.equal(new Set(nextLives.map(life => life.hogId)).size, 1);
    assert.equal(nextLives[0].generation, 2);
    assert.equal(nextLives[0].penId, pen.penId);
    assert.deepEqual(
      await startNextGeneration(pool, token, { ...operationalPolicy, readOnlyMode: true }),
      nextLives[0],
      "a retry returns the committed generation after read-only mode activates",
    );

    const replayingProfile = await getHogProfile(pool, token);
    assert.ok(replayingProfile?.active);
    assert.equal(replayingProfile.active.hogId, nextLives[0].hogId);
    assert.equal(replayingProfile.active.generation, 2);
    assert.equal(replayingProfile.tombstones[0].hogId, hogId);
    const publicNextLife = await getPublicPen(pool, pen.penId);
    assert.equal(publicNextLife?.hogId, nextLives[0].hogId);
    assert.equal(publicNextLife?.tombstones[0].hogId, hogId);
    assert.equal(
      (await pool.query("SELECT count(*)::integer AS count FROM hog_lives WHERE owner_did=$1", [did])).rows[0].count,
      2,
    );
  } finally {
    await pool.query("DELETE FROM hog_actions WHERE hog_id IN (SELECT id FROM hog_lives WHERE owner_did=$1)", [did]);
    await pool.query("DELETE FROM app_sessions WHERE owner_did=$1", [did]);
    await pool.query("DELETE FROM hog_lives WHERE owner_did=$1", [did]);
    await pool.query("DELETE FROM accounts WHERE did=$1", [did]);
    await pool.end();
  }
});
