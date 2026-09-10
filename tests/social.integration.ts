import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createDatabase } from "../src/lib/server/database.ts";
import { issueSession, provisionHog } from "../src/lib/server/hogs.ts";
import { migrate } from "../src/lib/server/migrations.ts";
import {
  acceptGift,
  declineGift,
  getPenManagement,
  getPublicPen,
  GiftLimitError,
  GiftStateError,
  GiftUnavailableError,
  sendGift,
  setAccountBlock,
  setPenSetting,
} from "../src/lib/server/social.ts";

const operationalPolicy = {
  database: {
    maxBytes: 1_000_000_000,
    warningPercent: 70,
    restrictPercent: 85,
    readOnlyPercent: 95,
  },
  readOnlyMode: false,
};

const socialPolicy = {
  limits: {
    giftsPerSenderPerDay: 3,
    giftsPerRecipientPerDay: 10,
    pendingGiftsPerRecipient: 20,
  },
  operationalPolicy,
};

test("public pens keep visitor gifts bounded and owner-controlled", async () => {
  assert.ok(process.env.TEST_DATABASE_URL, "Set TEST_DATABASE_URL to a disposable PostgreSQL database");
  const pool = createDatabase(process.env.TEST_DATABASE_URL);
  const dids = Array.from({ length: 5 }, () => `did:plc:test${randomUUID().replaceAll("-", "")}`);
  const [ownerDid, senderDid, secondSenderDid, thirdSenderDid, otherOwnerDid] = dids;
  try {
    await migrate(pool);
    const hogIds = await Promise.all(dids.map(did => provisionHog(pool, did)));
    const tokens = await Promise.all(dids.map(did => issueSession(pool, did)));
    const [ownerHog, , , , otherOwnerHog] = hogIds;
    const [ownerToken, senderToken, secondSenderToken, thirdSenderToken, otherOwnerToken] = tokens;
    const management = await getPenManagement(pool, ownerToken);
    const otherManagement = await getPenManagement(pool, otherOwnerToken);
    assert.ok(management);
    assert.ok(otherManagement);
    assert.equal(management.isPublic, true);
    assert.equal(management.giftsEnabled, true);
    assert.deepEqual(management.pendingGifts, []);
    const publicPen = await getPublicPen(pool, management.penId);
    assert.ok(publicPen);
    assert.equal(publicPen.hogId, ownerHog);

    const beforeGift = await pool.query("SELECT state FROM hog_lives WHERE id=$1", [ownerHog]);
    const giftId = randomUUID();
    const gift = await sendGift(pool, senderToken, management.penId, giftId, "ai_image", socialPolicy);
    assert.equal(gift.id, giftId);
    assert.deepEqual(
      await sendGift(pool, senderToken, management.penId, giftId, "ai_image", socialPolicy),
      gift,
      "a retried gift returns its original receipt",
    );
    assert.deepEqual(
      (await pool.query("SELECT state FROM hog_lives WHERE id=$1", [ownerHog])).rows,
      beforeGift.rows,
      "sending a treat cannot change protected hog state",
    );
    await assert.rejects(
      sendGift(pool, senderToken, management.penId, randomUUID(), "shitpost", socialPolicy),
      GiftLimitError,
      "one sender cannot fill the same pen repeatedly in one day",
    );
    await assert.rejects(
      acceptGift(pool, otherOwnerToken, giftId, randomUUID(), operationalPolicy),
      /Unauthorized/,
    );

    const acceptRequestId = randomUUID();
    const accepted = await acceptGift(pool, ownerToken, giftId, acceptRequestId, operationalPolicy);
    assert.equal(accepted.result.state.mealsEaten, 1);
    assert.equal(accepted.result.state.mealsAvailable, 5);
    assert.deepEqual(
      await acceptGift(pool, ownerToken, giftId, acceptRequestId, operationalPolicy),
      accepted,
      "an acceptance retry returns its original game receipt",
    );
    await assert.rejects(
      acceptGift(pool, ownerToken, giftId, randomUUID(), operationalPolicy),
      GiftStateError,
    );
    await assert.rejects(
      sendGift(pool, senderToken, otherManagement.penId, randomUUID(), "shitpost", {
        ...socialPolicy,
        limits: { ...socialPolicy.limits, giftsPerSenderPerDay: 1 },
      }),
      GiftLimitError,
      "the sender allowance applies across recipient pens",
    );

    const blockedGiftId = randomUUID();
    await sendGift(pool, secondSenderToken, management.penId, blockedGiftId, "human_post", socialPolicy);
    await setAccountBlock(pool, ownerToken, secondSenderDid, true, operationalPolicy);
    assert.deepEqual((await getPenManagement(pool, ownerToken))?.blockedDids, [secondSenderDid]);
    assert.deepEqual((await getPenManagement(pool, ownerToken))?.pendingGifts, []);
    await assert.rejects(
      acceptGift(pool, ownerToken, blockedGiftId, randomUUID(), operationalPolicy),
      GiftStateError,
    );
    await assert.rejects(
      sendGift(pool, secondSenderToken, management.penId, randomUUID(), "shitpost", socialPolicy),
      GiftUnavailableError,
    );
    await setAccountBlock(pool, ownerToken, secondSenderDid, false, operationalPolicy);

    await setPenSetting(pool, ownerToken, "gifts_enabled", false, operationalPolicy);
    await assert.rejects(
      sendGift(pool, thirdSenderToken, management.penId, randomUUID(), "shitpost", socialPolicy),
      GiftUnavailableError,
    );
    await setPenSetting(pool, ownerToken, "gifts_enabled", true, operationalPolicy);
    const declinedGift = await sendGift(
      pool,
      thirdSenderToken,
      management.penId,
      randomUUID(),
      "generated_post",
      socialPolicy,
    );
    await declineGift(pool, ownerToken, declinedGift.id, operationalPolicy);
    await assert.rejects(
      acceptGift(pool, ownerToken, declinedGift.id, randomUUID(), operationalPolicy),
      GiftStateError,
    );

    await setPenSetting(pool, ownerToken, "pen_public", false, operationalPolicy);
    assert.equal(await getPublicPen(pool, management.penId), null);
    await assert.rejects(
      sendGift(pool, thirdSenderToken, management.penId, randomUUID(), "shitpost", socialPolicy),
      GiftUnavailableError,
    );
    await setPenSetting(pool, ownerToken, "pen_public", true, operationalPolicy);

    const recipientLimitedPolicy = {
      ...socialPolicy,
      limits: { ...socialPolicy.limits, giftsPerRecipientPerDay: 1 },
    };
    const concurrent = await Promise.allSettled([
      sendGift(pool, secondSenderToken, otherManagement.penId, randomUUID(), "ai_image", recipientLimitedPolicy),
      sendGift(pool, thirdSenderToken, otherManagement.penId, randomUUID(), "human_post", recipientLimitedPolicy),
    ]);
    assert.equal(concurrent.filter(result => result.status === "fulfilled").length, 1);
    assert.equal(
      concurrent.filter(result => result.status === "rejected" && result.reason instanceof GiftLimitError).length,
      1,
      "the recipient allowance is atomic across senders",
    );
    assert.equal(
      (await pool.query(
        "SELECT count(*)::integer AS count FROM gift_treats WHERE recipient_did=$1 AND status='pending'",
        [otherOwnerDid],
      )).rows[0].count,
      1,
    );
    assert.equal(
      (await pool.query("SELECT state FROM hog_lives WHERE id=$1", [otherOwnerHog])).rows[0].state.mealsEaten,
      0,
    );
  } finally {
    await pool.query("DELETE FROM gift_treats WHERE sender_did=ANY($1::text[]) OR recipient_did=ANY($1::text[])", [dids]);
    await pool.query("DELETE FROM account_blocks WHERE owner_did=ANY($1::text[]) OR blocked_did=ANY($1::text[])", [dids]);
    await pool.query("DELETE FROM hog_actions WHERE hog_id IN (SELECT id FROM hog_lives WHERE owner_did=ANY($1::text[]))", [dids]);
    await pool.query("DELETE FROM app_sessions WHERE owner_did=ANY($1::text[])", [dids]);
    await pool.query("DELETE FROM hog_lives WHERE owner_did=ANY($1::text[])", [dids]);
    await pool.query("DELETE FROM accounts WHERE did=ANY($1::text[])", [dids]);
    await pool.end();
  }
});
