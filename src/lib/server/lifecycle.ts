import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import {
  appearanceForState,
  parseHogAppearance,
  type HogAppearance,
} from "../../components/hog/appearance.ts";
import {
  ENDING_CATALOG,
  createGameState,
  advanceGameTime,
  parseGameState,
  type EndingId,
  type GameResult,
  type GameState,
} from "../game.ts";
import { loadCostPolicy } from "./cost-policy.ts";
import { transaction } from "./database.ts";
import { ReadOnlyError, refreshOperationalStatusForPool, type OperationalPolicy } from "./operations.ts";

const sessionToken = /^[0-9a-f]{64}$/;
const hash = (token: string) => createHash("sha256").update(token).digest("hex");

type EndingRow = {
  hog_id: string;
  generation: number;
  ending_id: EndingId;
  cause: string;
  epitaph: string;
  final_state: unknown;
  final_appearance: unknown;
  ended_at: Date;
};

export type TombstoneView = {
  hogId: string;
  generation: number;
  endingId: EndingId;
  endingName: string;
  cause: string;
  epitaph: string;
  finalState: GameState;
  finalAppearance: HogAppearance;
  endedAt: Date;
};

export type ActiveHogView = {
  ownerDid: string;
  hogId: string;
  generation: number;
  state: GameState;
};

export type HogProfile = {
  ownerDid: string;
  active: ActiveHogView | null;
  tombstones: TombstoneView[];
};

function mapTombstone(row: EndingRow): TombstoneView {
  const state = parseGameState(row.final_state);
  const appearance = parseHogAppearance(row.final_appearance);
  const definition = ENDING_CATALOG.find(ending => ending.id === row.ending_id);
  if (
    !definition
    || !state.ending
    || state.ending.id !== row.ending_id
    || state.ending.cause !== row.cause
    || state.ending.epitaph !== row.epitaph
    || state.ending.endedAtMs !== row.ended_at.getTime()
  ) {
    throw new Error("Stored hog ending is inconsistent");
  }
  return {
    hogId: row.hog_id,
    generation: row.generation,
    endingId: row.ending_id,
    endingName: definition.name,
    cause: row.cause,
    epitaph: row.epitaph,
    finalState: state,
    finalAppearance: appearance,
    endedAt: row.ended_at,
  };
}

export async function getTombstonesForOwner(
  pool: Pool,
  ownerDid: string,
  limit = 20,
): Promise<TombstoneView[]> {
  const result = await pool.query<EndingRow>(
    `SELECT ending.hog_id, hog.generation, ending.ending_id, ending.cause,
            ending.epitaph, ending.final_state, ending.final_appearance, ending.ended_at
       FROM hog_endings ending
       JOIN hog_lives hog ON hog.id=ending.hog_id
      WHERE hog.owner_did=$1
      ORDER BY hog.generation DESC
      LIMIT $2`,
    [ownerDid, limit],
  );
  return result.rows.map(mapTombstone);
}

export async function getHogProfile(pool: Pool, token: string): Promise<HogProfile | null> {
  if (!sessionToken.test(token)) return null;
  const account = await pool.query<{
    owner_did: string;
    hog_id: string | null;
    generation: number | null;
    state: unknown | null;
    now_ms: number;
  }>(
    `SELECT session.owner_did, hog.id AS hog_id, hog.generation, hog.state,
            floor(extract(epoch FROM clock_timestamp()) * 1000)::float8 AS now_ms
       FROM app_sessions session
       LEFT JOIN hog_lives hog
         ON hog.owner_did=session.owner_did AND hog.ended_at IS NULL
      WHERE session.token_hash=$1 AND session.expires_at > clock_timestamp()`,
    [hash(token)],
  );
  if (!account.rowCount) return null;
  const row = account.rows[0];
  let active: ActiveHogView | null = null;
  if (row.hog_id !== null && row.generation !== null && row.state !== null) {
    const saved = parseGameState(row.state);
    active = {
      ownerDid: row.owner_did,
      hogId: row.hog_id,
      generation: row.generation,
      state: advanceGameTime(saved, Math.max(row.now_ms, saved.updatedAtMs)).state,
    };
  }
  return {
    ownerDid: row.owner_did,
    active,
    tombstones: await getTombstonesForOwner(pool, row.owner_did),
  };
}

export async function recordLifeEnding(
  client: PoolClient,
  hogId: string,
  requestId: string,
  result: GameResult,
): Promise<boolean> {
  const endingEvents = result.events.filter(event => event.type === "life_ended");
  const ending = result.state.ending;
  if (!ending) {
    if (endingEvents.length) throw new Error("Ending event is missing terminal state");
    return false;
  }
  if (
    endingEvents.length !== 1
    || endingEvents[0].ending !== ending.id
    || endingEvents[0].cause !== ending.cause
    || endingEvents[0].epitaph !== ending.epitaph
  ) {
    throw new Error("Terminal state must have exactly one matching ending event");
  }
  const ended = await client.query(
    `UPDATE hog_lives
        SET ended_at=to_timestamp($2 / 1000.0)
      WHERE id=$1 AND ended_at IS NULL`,
    [hogId, ending.endedAtMs],
  );
  if (ended.rowCount !== 1) throw new Error("Hog life has already ended");
  await client.query(
    `INSERT INTO hog_endings(
       hog_id, action_request_id, ending_id, cause, epitaph,
       final_state, final_appearance, ended_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,to_timestamp($8 / 1000.0))`,
    [
      hogId,
      requestId,
      ending.id,
      ending.cause,
      ending.epitaph,
      result.state,
      appearanceForState(result.state),
      ending.endedAtMs,
    ],
  );
  await client.query(
    `UPDATE gift_treats
        SET status='declined', decided_at=clock_timestamp()
      WHERE hog_id=$1 AND status='pending'`,
    [hogId],
  );
  return true;
}

export async function startNextGeneration(
  pool: Pool,
  token: string,
  operationalPolicy?: OperationalPolicy,
): Promise<{ hogId: string; generation: number; penId: string }> {
  if (!sessionToken.test(token)) throw new Error("Unauthorized");
  const selectedPolicy = operationalPolicy ?? (() => {
    const policy = loadCostPolicy();
    return { database: policy.database, readOnlyMode: policy.features.readOnlyMode };
  })();
  const controls = await refreshOperationalStatusForPool(pool, selectedPolicy);
  if (controls.readOnly) {
    const existing = await pool.query<{ hog_id: string; generation: number; public_id: string }>(
      `SELECT hog.id AS hog_id, hog.generation, account.public_id
         FROM app_sessions session
         JOIN accounts account ON account.did=session.owner_did
         JOIN hog_lives hog ON hog.owner_did=account.did AND hog.ended_at IS NULL
        WHERE session.token_hash=$1 AND session.expires_at > clock_timestamp()`,
      [hash(token)],
    );
    if (existing.rowCount) {
      return {
        hogId: existing.rows[0].hog_id,
        generation: existing.rows[0].generation,
        penId: existing.rows[0].public_id,
      };
    }
    throw new ReadOnlyError("Slop Hogs is temporarily read-only");
  }

  return transaction(pool, async client => {
    const account = await client.query<{ owner_did: string; public_id: string }>(
      `SELECT account.did AS owner_did, account.public_id
         FROM accounts account
         JOIN app_sessions session ON session.owner_did=account.did
        WHERE session.token_hash=$1 AND session.expires_at > clock_timestamp()
        FOR UPDATE OF account`,
      [hash(token)],
    );
    if (!account.rowCount) throw new Error("Unauthorized");
    const { owner_did: ownerDid, public_id: penId } = account.rows[0];
    const active = await client.query<{ id: string; generation: number }>(
      "SELECT id, generation FROM hog_lives WHERE owner_did=$1 AND ended_at IS NULL",
      [ownerDid],
    );
    if (active.rowCount) {
      return { hogId: active.rows[0].id, generation: active.rows[0].generation, penId };
    }
    const history = await client.query<{ generation: number }>(
      `SELECT hog.generation
         FROM hog_lives hog
         JOIN hog_endings ending ON ending.hog_id=hog.id
        WHERE hog.owner_did=$1
        ORDER BY hog.generation DESC
        LIMIT 1`,
      [ownerDid],
    );
    if (!history.rowCount) throw new Error("No completed hog life can begin a new generation");
    const clock = await client.query<{ now_ms: number }>(
      "SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::float8 AS now_ms",
    );
    const hogId = randomUUID();
    const generation = history.rows[0].generation + 1;
    const state = createGameState(clock.rows[0].now_ms, randomBytes(4).readUInt32BE() || 1);
    await client.query(
      "INSERT INTO hog_lives(id, owner_did, generation, state) VALUES ($1,$2,$3,$4)",
      [hogId, ownerDid, generation, state],
    );
    return { hogId, generation, penId };
  });
}
