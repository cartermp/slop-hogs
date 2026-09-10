import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { advanceGameTime, applyGameAction, parseGameState, type FoodKind, type GameResult } from "../game.ts";
import type { CostPolicy } from "../cost-policy.ts";
import type { GiftAcceptance, GiftReceipt, PenManagement, PublicPen } from "../social.ts";
import { loadCostPolicy } from "./cost-policy.ts";
import { transaction } from "./database.ts";
import { isValidDid } from "./dids.ts";
import { getTombstonesForOwner, recordLifeEnding } from "./lifecycle.ts";
import { ReadOnlyError, refreshOperationalStatusForPool, type OperationalPolicy } from "./operations.ts";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sessionToken = /^[0-9a-f]{64}$/;
const hash = (token: string) => createHash("sha256").update(token).digest("hex");

export class GiftUnavailableError extends Error {}
export class GiftLimitError extends Error {}
export class GiftStateError extends Error {}

interface GiftLimits {
  giftsPerSenderPerDay: number;
  giftsPerRecipientPerDay: number;
  pendingGiftsPerRecipient: number;
}

interface SocialPolicy {
  limits: GiftLimits;
  operationalPolicy: OperationalPolicy;
}

function policyOrDefault(policy?: SocialPolicy): SocialPolicy {
  if (policy) return policy;
  const costPolicy = loadCostPolicy();
  return {
    limits: costPolicy.limits,
    operationalPolicy: {
      database: costPolicy.database,
      readOnlyMode: costPolicy.features.readOnlyMode,
    },
  };
}

function assertIdentifiers(...values: string[]): void {
  if (values.some(value => !uuid.test(value))) throw new Error("Invalid social action identifier");
}

async function ownerDidForToken(client: PoolClient, token: string, lock = false): Promise<string> {
  if (!sessionToken.test(token)) throw new Error("Unauthorized");
  const session = await client.query<{ owner_did: string }>(
    `SELECT owner_did FROM app_sessions
      WHERE token_hash=$1 AND expires_at > clock_timestamp()
      ${lock ? "FOR SHARE" : ""}`,
    [hash(token)],
  );
  if (!session.rowCount) throw new Error("Unauthorized");
  return session.rows[0].owner_did;
}

export async function getPublicPen(pool: Pool, penId: string): Promise<PublicPen | null> {
  if (!uuid.test(penId)) return null;
  const result = await pool.query<{
    public_id: string;
    owner_did: string;
    hog_id: string | null;
    state: unknown | null;
    gifts_enabled: boolean;
    now_ms: number;
  }>(
    `SELECT account.public_id, account.did AS owner_did, hog.id AS hog_id, hog.state,
            account.gifts_enabled,
            floor(extract(epoch FROM clock_timestamp()) * 1000)::float8 AS now_ms
       FROM accounts account
       LEFT JOIN hog_lives hog ON hog.owner_did=account.did AND hog.ended_at IS NULL
      WHERE account.public_id=$1 AND account.pen_public`,
    [penId],
  );
  if (!result.rowCount) return null;
  const row = result.rows[0];
  const state = row.state === null ? null : parseGameState(row.state);
  return {
    penId: row.public_id,
    hogId: row.hog_id,
    state: state ? advanceGameTime(state, Math.max(row.now_ms, state.updatedAtMs)).state : null,
    giftsEnabled: row.gifts_enabled,
    tombstones: await getTombstonesForOwner(pool, row.owner_did),
  };
}

export async function getPenManagement(pool: Pool, token: string): Promise<PenManagement | null> {
  if (!sessionToken.test(token)) return null;
  const account = await pool.query<{
    owner_did: string;
    public_id: string;
    pen_public: boolean;
    gifts_enabled: boolean;
  }>(
    `SELECT session.owner_did, account.public_id, account.pen_public, account.gifts_enabled
       FROM app_sessions session
       JOIN accounts account ON account.did=session.owner_did
      WHERE session.token_hash=$1 AND session.expires_at > clock_timestamp()`,
    [hash(token)],
  );
  if (!account.rowCount) return null;
  const row = account.rows[0];
  const [pending, blocked] = await Promise.all([
    pool.query<{ id: string; sender_did: string; food: FoodKind; created_at: Date }>(
      `SELECT gift.id, gift.sender_did, gift.food, gift.created_at
         FROM gift_treats gift
         JOIN hog_lives hog ON hog.id=gift.hog_id AND hog.ended_at IS NULL
        WHERE gift.recipient_did=$1 AND gift.status='pending'
        ORDER BY gift.created_at, gift.id
        LIMIT 20`,
      [row.owner_did],
    ),
    pool.query<{ blocked_did: string }>(
      "SELECT blocked_did FROM account_blocks WHERE owner_did=$1 ORDER BY blocked_did",
      [row.owner_did],
    ),
  ]);
  return {
    penId: row.public_id,
    isPublic: row.pen_public,
    giftsEnabled: row.gifts_enabled,
    pendingGifts: pending.rows.map(gift => ({
      id: gift.id,
      senderDid: gift.sender_did,
      food: gift.food,
      createdAt: gift.created_at,
    })),
    blockedDids: blocked.rows.map(entry => entry.blocked_did),
  };
}

async function reserveDailyGift(
  client: PoolClient,
  table: "gift_sender_daily" | "gift_recipient_daily",
  didColumn: "sender_did" | "recipient_did",
  day: string,
  did: string,
  limit: number,
): Promise<void> {
  const result = await client.query(
    `INSERT INTO ${table}(bucket_start, ${didColumn}, gifts) VALUES ($1,$2,1)
     ON CONFLICT (bucket_start, ${didColumn}) DO UPDATE
       SET gifts=${table}.gifts + 1
       WHERE ${table}.gifts < $3
     RETURNING gifts`,
    [day, did, limit],
  );
  if (!result.rowCount) throw new GiftLimitError("The daily treat allowance has been used");
}

async function readExistingGift(
  pool: Pool,
  token: string,
  penId: string,
  requestId: string,
  food: FoodKind,
): Promise<GiftReceipt | null> {
  const result = await pool.query<{
    id: string;
    food: FoodKind;
    created_at: Date;
  }>(
    `SELECT gift.id, gift.food, gift.created_at
       FROM gift_treats gift
       JOIN accounts recipient ON recipient.did=gift.recipient_did
       JOIN app_sessions session ON session.owner_did=gift.sender_did
      WHERE gift.id=$1 AND recipient.public_id=$2 AND gift.food=$3
        AND session.token_hash=$4 AND session.expires_at > clock_timestamp()`,
    [requestId, penId, food, hash(token)],
  );
  if (!result.rowCount) return null;
  return { id: result.rows[0].id, food: result.rows[0].food, createdAt: result.rows[0].created_at };
}

export async function sendGift(
  pool: Pool,
  token: string,
  penId: string,
  requestId: string,
  food: FoodKind,
  policy?: SocialPolicy,
): Promise<GiftReceipt> {
  assertIdentifiers(penId, requestId);
  if (!sessionToken.test(token)) throw new Error("Unauthorized");
  const selectedPolicy = policyOrDefault(policy);
  const controls = await refreshOperationalStatusForPool(pool, selectedPolicy.operationalPolicy);
  if (controls.readOnly) {
    const existing = await readExistingGift(pool, token, penId, requestId, food);
    if (existing) return existing;
    throw new ReadOnlyError("Slop Hogs is temporarily read-only");
  }

  return transaction(pool, async client => {
    const senderDid = await ownerDidForToken(client, token);
    const target = await client.query<{ recipient_did: string }>(
      "SELECT did AS recipient_did FROM accounts WHERE public_id=$1",
      [penId],
    );
    if (!target.rowCount || target.rows[0].recipient_did === senderDid) {
      throw new GiftUnavailableError("This pen is not accepting your treat");
    }
    const recipientDid = target.rows[0].recipient_did;
    await client.query(
      "SELECT did FROM accounts WHERE did=ANY($1::text[]) ORDER BY did FOR UPDATE",
      [[senderDid, recipientDid]],
    );

    const existing = await client.query<{
      sender_did: string;
      recipient_did: string;
      food: FoodKind;
      created_at: Date;
    }>("SELECT sender_did, recipient_did, food, created_at FROM gift_treats WHERE id=$1", [requestId]);
    if (existing.rowCount) {
      const row = existing.rows[0];
      if (row.sender_did === senderDid && row.recipient_did === recipientDid && row.food === food) {
        return { id: requestId, food, createdAt: row.created_at };
      }
      throw new Error("Request ID already used for a different gift");
    }

    const pen = await client.query<{
      hog_id: string;
      pen_public: boolean;
      gifts_enabled: boolean;
      gift_day: string;
    }>(
      `SELECT hog.id AS hog_id, account.pen_public, account.gifts_enabled,
              (clock_timestamp() AT TIME ZONE 'UTC')::date::text AS gift_day
         FROM accounts account
         JOIN hog_lives hog ON hog.owner_did=account.did AND hog.ended_at IS NULL
        WHERE account.did=$1`,
      [recipientDid],
    );
    if (!pen.rowCount || !pen.rows[0].pen_public || !pen.rows[0].gifts_enabled) {
      throw new GiftUnavailableError("This pen is not accepting your treat");
    }
    const blocked = await client.query(
      `SELECT 1 FROM account_blocks
        WHERE (owner_did=$1 AND blocked_did=$2) OR (owner_did=$2 AND blocked_did=$1)
        LIMIT 1`,
      [senderDid, recipientDid],
    );
    if (blocked.rowCount) throw new GiftUnavailableError("This pen is not accepting your treat");
    const duplicatePair = await client.query(
      "SELECT 1 FROM gift_treats WHERE sender_did=$1 AND recipient_did=$2 AND gift_day=$3",
      [senderDid, recipientDid, pen.rows[0].gift_day],
    );
    if (duplicatePair.rowCount) throw new GiftLimitError("You already sent this pen a treat today");
    const pending = await client.query<{ count: number }>(
      "SELECT count(*)::integer AS count FROM gift_treats WHERE recipient_did=$1 AND hog_id=$2 AND status='pending'",
      [recipientDid, pen.rows[0].hog_id],
    );
    if (pending.rows[0].count >= selectedPolicy.limits.pendingGiftsPerRecipient) {
      throw new GiftLimitError("This pen's treat basket is full");
    }
    await reserveDailyGift(
      client,
      "gift_sender_daily",
      "sender_did",
      pen.rows[0].gift_day,
      senderDid,
      selectedPolicy.limits.giftsPerSenderPerDay,
    );
    await reserveDailyGift(
      client,
      "gift_recipient_daily",
      "recipient_did",
      pen.rows[0].gift_day,
      recipientDid,
      selectedPolicy.limits.giftsPerRecipientPerDay,
    );
    const inserted = await client.query<{ created_at: Date }>(
      `INSERT INTO gift_treats(id, sender_did, recipient_did, hog_id, food, gift_day)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING created_at`,
      [requestId, senderDid, recipientDid, pen.rows[0].hog_id, food, pen.rows[0].gift_day],
    );
    return { id: requestId, food, createdAt: inserted.rows[0].created_at };
  });
}

async function readAcceptedGift(
  pool: Pool,
  token: string,
  giftId: string,
  requestId: string,
): Promise<GiftAcceptance | null> {
  const result = await pool.query<{ result: GameResult }>(
    `SELECT action.result
       FROM gift_treats gift
       JOIN app_sessions session ON session.owner_did=gift.recipient_did
       JOIN hog_actions action ON action.hog_id=gift.hog_id AND action.request_id=gift.accepted_request_id
      WHERE gift.id=$1 AND gift.status='accepted' AND gift.accepted_request_id=$2
        AND session.token_hash=$3 AND session.expires_at > clock_timestamp()`,
    [giftId, requestId, hash(token)],
  );
  return result.rowCount ? { giftId, result: result.rows[0].result } : null;
}

export async function acceptGift(
  pool: Pool,
  token: string,
  giftId: string,
  requestId: string,
  operationalPolicy?: OperationalPolicy,
): Promise<GiftAcceptance> {
  assertIdentifiers(giftId, requestId);
  if (!sessionToken.test(token)) throw new Error("Unauthorized");
  const costPolicy: CostPolicy | null = operationalPolicy ? null : loadCostPolicy();
  const selectedPolicy = operationalPolicy ?? {
    database: costPolicy!.database,
    readOnlyMode: costPolicy!.features.readOnlyMode,
  };
  const controls = await refreshOperationalStatusForPool(pool, selectedPolicy);
  if (controls.readOnly) {
    const existing = await readAcceptedGift(pool, token, giftId, requestId);
    if (existing) return existing;
    throw new ReadOnlyError("Slop Hogs is temporarily read-only");
  }

  return transaction(pool, async client => {
    const ownerDid = await ownerDidForToken(client, token);
    const initial = await client.query<{ recipient_did: string; hog_id: string }>(
      "SELECT recipient_did, hog_id FROM gift_treats WHERE id=$1",
      [giftId],
    );
    if (!initial.rowCount || initial.rows[0].recipient_did !== ownerDid) throw new Error("Unauthorized");
    const hog = await client.query<{ owner_did: string; state: unknown; ended_at: Date | null }>(
      "SELECT owner_did, state, ended_at FROM hog_lives WHERE id=$1 FOR UPDATE",
      [initial.rows[0].hog_id],
    );
    await ownerDidForToken(client, token, true);
    const gift = await client.query<{
      recipient_did: string;
      hog_id: string;
      food: FoodKind;
      status: "pending" | "accepted" | "declined";
      accepted_request_id: string | null;
    }>(
      `SELECT recipient_did, hog_id, food, status, accepted_request_id
         FROM gift_treats WHERE id=$1 FOR UPDATE`,
      [giftId],
    );
    if (!gift.rowCount || gift.rows[0].recipient_did !== ownerDid) throw new Error("Unauthorized");
    const giftRow = gift.rows[0];
    if (giftRow.status === "accepted") {
      if (giftRow.accepted_request_id !== requestId) {
        throw new GiftStateError("This treat was already accepted");
      }
      const existing = await client.query<{ result: GameResult }>(
        "SELECT result FROM hog_actions WHERE hog_id=$1 AND request_id=$2",
        [giftRow.hog_id, requestId],
      );
      if (!existing.rowCount) throw new Error("Accepted gift receipt is missing");
      return { giftId, result: existing.rows[0].result };
    }
    if (giftRow.status !== "pending") throw new GiftStateError("This treat is no longer pending");
    if (
      !hog.rowCount
      || hog.rows[0].owner_did !== ownerDid
      || hog.rows[0].ended_at
    ) {
      throw new GiftStateError("This treat belongs to an ended hog life");
    }
    const collision = await client.query(
      "SELECT 1 FROM hog_actions WHERE hog_id=$1 AND request_id=$2",
      [giftRow.hog_id, requestId],
    );
    if (collision.rowCount) throw new Error("Request ID already used for a different action");
    const clock = await client.query<{ now: number }>(
      "SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::float8 AS now",
    );
    const state = parseGameState(hog.rows[0].state);
    const action = { type: "feed", food: giftRow.food } as const;
    const result = applyGameAction(state, action, Math.max(clock.rows[0].now, state.updatedAtMs));
    await client.query("UPDATE hog_lives SET state=$2 WHERE id=$1", [giftRow.hog_id, result.state]);
    await client.query(
      "INSERT INTO hog_actions(hog_id, request_id, action, result) VALUES ($1,$2,$3,$4)",
      [giftRow.hog_id, requestId, action, result],
    );
    await recordLifeEnding(client, giftRow.hog_id, requestId, result);
    await client.query(
      `UPDATE gift_treats
          SET status='accepted', accepted_request_id=$2, decided_at=clock_timestamp()
        WHERE id=$1`,
      [giftId, requestId],
    );
    return { giftId, result };
  });
}

export async function declineGift(
  pool: Pool,
  token: string,
  giftId: string,
  operationalPolicy?: OperationalPolicy,
): Promise<void> {
  assertIdentifiers(giftId);
  const selectedPolicy = operationalPolicy ?? (() => {
    const policy = loadCostPolicy();
    return { database: policy.database, readOnlyMode: policy.features.readOnlyMode };
  })();
  const controls = await refreshOperationalStatusForPool(pool, selectedPolicy);
  if (controls.readOnly) throw new ReadOnlyError("Slop Hogs is temporarily read-only");
  await transaction(pool, async client => {
    const ownerDid = await ownerDidForToken(client, token);
    const gift = await client.query<{ status: "pending" | "accepted" | "declined" }>(
      "SELECT status FROM gift_treats WHERE id=$1 AND recipient_did=$2 FOR UPDATE",
      [giftId, ownerDid],
    );
    if (!gift.rowCount) throw new Error("Unauthorized");
    if (gift.rows[0].status === "accepted") throw new GiftStateError("This treat was already accepted");
    if (gift.rows[0].status === "pending") {
      await client.query(
        "UPDATE gift_treats SET status='declined', decided_at=clock_timestamp() WHERE id=$1",
        [giftId],
      );
    }
  });
}

export async function setPenSetting(
  pool: Pool,
  token: string,
  setting: "pen_public" | "gifts_enabled",
  enabled: boolean,
  operationalPolicy?: OperationalPolicy,
): Promise<string> {
  const selectedPolicy = operationalPolicy ?? (() => {
    const policy = loadCostPolicy();
    return { database: policy.database, readOnlyMode: policy.features.readOnlyMode };
  })();
  const controls = await refreshOperationalStatusForPool(pool, selectedPolicy);
  if (controls.readOnly) throw new ReadOnlyError("Slop Hogs is temporarily read-only");
  return transaction(pool, async client => {
    const ownerDid = await ownerDidForToken(client, token);
    const result = await client.query<{ public_id: string }>(
      `UPDATE accounts SET ${setting}=$2 WHERE did=$1 RETURNING public_id`,
      [ownerDid, enabled],
    );
    if (!result.rowCount) throw new Error("Unauthorized");
    return result.rows[0].public_id;
  });
}

export async function setAccountBlock(
  pool: Pool,
  token: string,
  blockedDid: string,
  blocked: boolean,
  operationalPolicy?: OperationalPolicy,
): Promise<void> {
  if (!isValidDid(blockedDid)) throw new Error("Invalid DID");
  const selectedPolicy = operationalPolicy ?? (() => {
    const policy = loadCostPolicy();
    return { database: policy.database, readOnlyMode: policy.features.readOnlyMode };
  })();
  const controls = await refreshOperationalStatusForPool(pool, selectedPolicy);
  if (controls.readOnly) throw new ReadOnlyError("Slop Hogs is temporarily read-only");
  await transaction(pool, async client => {
    const ownerDid = await ownerDidForToken(client, token);
    if (ownerDid === blockedDid) throw new Error("You cannot block your own account");
    const accounts = await client.query(
      "SELECT did FROM accounts WHERE did=ANY($1::text[]) ORDER BY did FOR UPDATE",
      [[ownerDid, blockedDid]],
    );
    if (accounts.rowCount !== 2) throw new Error("That Slop Hogs account does not exist");
    if (blocked) {
      await client.query(
        "INSERT INTO account_blocks(owner_did, blocked_did) VALUES ($1,$2) ON CONFLICT DO NOTHING",
        [ownerDid, blockedDid],
      );
      await client.query(
        `UPDATE gift_treats
            SET status='declined', decided_at=clock_timestamp()
          WHERE status='pending'
            AND ((sender_did=$1 AND recipient_did=$2) OR (sender_did=$2 AND recipient_did=$1))`,
        [ownerDid, blockedDid],
      );
    } else {
      await client.query(
        "DELETE FROM account_blocks WHERE owner_did=$1 AND blocked_did=$2",
        [ownerDid, blockedDid],
      );
    }
  });
}
