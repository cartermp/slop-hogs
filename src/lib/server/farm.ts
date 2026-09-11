import { randomInt, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import {
  ONLINE_WINDOW_MS,
  STARTING_MASS,
  applySlop,
  decayPsychosis,
  movePlayer,
  touchingSlop,
  type FarmAction,
  type FarmActionResult,
  type FarmEvent,
  type FarmPlayer,
  type FarmPlayerStatus,
  type FarmSlop,
  type FarmSnapshot,
  type Facing,
  type HogEffect,
  type SlopKind,
} from "../farm-game.ts";
import { loadCostPolicy } from "./cost-policy.ts";
import { transaction } from "./database.ts";
import { ReadOnlyError, refreshOperationalStatusForPool } from "./operations.ts";

const ACTIVE_SLOP_COUNT = 16;
const MAX_VISIBLE_PLAYERS = 64;
const SLOP_MIN_LIFETIME_MS = 12_000;
const SLOP_MAX_LIFETIME_MS = 22_000;
const SPAWN_AREAS = [
  { xMin: 52, xMax: 556, yMin: 62, yMax: 242 },
  { xMin: 50, xMax: 420, yMin: 320, yMax: 526 },
  { xMin: 620, xMax: 910, yMin: 316, yMax: 526 },
] as const;

interface PlayerRow {
  owner_did: string;
  player_id: string;
  x: number;
  y: number;
  facing: Facing;
  mass: number;
  score: number;
  slop_eaten: number;
  status: FarmPlayerStatus;
  effect: HogEffect | null;
  effect_expires_at: Date | null;
  last_moved_at: Date;
  psychosis_updated_at: Date;
  updated_at: Date;
  handle: string | null;
}

type ActionPlayerRow = Omit<PlayerRow, "handle">;

interface SlopRow {
  id: string;
  kind: SlopKind;
  x: number;
  y: number;
  expires_at: Date;
}

function randomSpawn(): { x: number; y: number } {
  const area = SPAWN_AREAS[randomInt(SPAWN_AREAS.length)];
  return {
    x: randomInt(area.xMin, area.xMax + 1),
    y: randomInt(area.yMin, area.yMax + 1),
  };
}

async function currentTimeMs(client: PoolClient, supplied?: number): Promise<number> {
  if (supplied !== undefined) {
    if (!Number.isSafeInteger(supplied) || supplied < 0) throw new Error("Invalid farm time");
    return supplied;
  }
  return (await client.query<{ now_ms: number }>(
    "SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::float8 AS now_ms",
  )).rows[0].now_ms;
}

async function ensurePlayer(client: PoolClient, ownerDid: string): Promise<void> {
  const spawn = randomSpawn();
  await client.query(
    `INSERT INTO farm_players(owner_did, x, y)
     VALUES ($1,$2,$3)
     ON CONFLICT (owner_did) DO NOTHING`,
    [ownerDid, spawn.x, spawn.y],
  );
}

async function maintainSlop(client: PoolClient, nowMs: number): Promise<void> {
  await client.query("DELETE FROM farm_slop WHERE expires_at <= to_timestamp($1 / 1000.0)", [nowMs]);
  await client.query("SELECT pg_advisory_xact_lock(734005)");
  const count = Number((await client.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM farm_slop WHERE expires_at > to_timestamp($1 / 1000.0)",
    [nowMs],
  )).rows[0].count);
  for (let index = count; index < ACTIVE_SLOP_COUNT; index += 1) {
    const spawn = randomSpawn();
    const kinds: SlopKind[] = [
      "hallucinated_citation",
      "context_overflow",
      "recursive_prompt",
      "model_collapse",
      "premium_tokens",
    ];
    await client.query(
      `INSERT INTO farm_slop(id, kind, x, y, spawned_at, expires_at)
       VALUES ($1,$2,$3,$4,to_timestamp($5 / 1000.0),to_timestamp($6 / 1000.0))`,
      [
        randomUUID(),
        kinds[randomInt(kinds.length)],
        spawn.x,
        spawn.y,
        nowMs,
        nowMs + randomInt(SLOP_MIN_LIFETIME_MS, SLOP_MAX_LIFETIME_MS + 1),
      ],
    );
  }
}

function mapPlayer(row: PlayerRow, ownerDid: string, nowMs: number): FarmPlayer {
  const effectActive = row.effect_expires_at !== null && row.effect_expires_at.getTime() > nowMs;
  const psychosis = decayPsychosis({
    mass: row.mass,
    status: row.status,
    psychosisUpdatedAtMs: row.psychosis_updated_at.getTime(),
  }, nowMs);
  return {
    id: row.player_id,
    name: row.handle ?? row.owner_did,
    x: row.x,
    y: row.y,
    facing: row.facing,
    mass: psychosis.mass,
    score: row.score,
    slopEaten: row.slop_eaten,
    status: row.status,
    effect: effectActive ? row.effect : null,
    effectExpiresAtMs: effectActive ? row.effect_expires_at?.getTime() ?? null : null,
    updatedAtMs: row.updated_at.getTime(),
    isYou: row.owner_did === ownerDid,
  };
}

function mapSlop(row: SlopRow): FarmSlop {
  return {
    id: row.id,
    kind: row.kind,
    x: row.x,
    y: row.y,
    expiresAtMs: row.expires_at.getTime(),
  };
}

async function readSnapshot(client: PoolClient, ownerDid: string, nowMs: number): Promise<FarmSnapshot> {
  const [players, slop] = await Promise.all([
    client.query<PlayerRow>(
      `SELECT player.owner_did, player.player_id, player.x, player.y, player.facing,
              player.mass, player.score, player.slop_eaten, player.status, player.effect,
              player.effect_expires_at, player.last_moved_at, player.psychosis_updated_at,
              player.updated_at, account.handle
         FROM farm_players player
         JOIN accounts account ON account.did=player.owner_did
        WHERE player.owner_did=$1
           OR player.updated_at > to_timestamp($2 / 1000.0)
        ORDER BY (player.owner_did=$1) DESC, player.updated_at DESC, player.player_id
        LIMIT $3`,
      [ownerDid, nowMs - ONLINE_WINDOW_MS, MAX_VISIBLE_PLAYERS],
    ),
    client.query<SlopRow>(
      `SELECT id, kind, x, y, expires_at
         FROM farm_slop
        WHERE expires_at > to_timestamp($1 / 1000.0)
        ORDER BY id`,
      [nowMs],
    ),
  ]);
  return {
    serverNowMs: nowMs,
    players: players.rows.map(row => mapPlayer(row, ownerDid, nowMs)),
    slop: slop.rows.map(mapSlop),
  };
}

export async function syncFarm(pool: Pool, ownerDid: string, suppliedNowMs?: number): Promise<FarmSnapshot> {
  const policy = loadCostPolicy();
  const controls = await refreshOperationalStatusForPool(pool, {
    database: policy.database,
    readOnlyMode: policy.features.readOnlyMode,
  });
  return transaction(pool, async client => {
    const nowMs = await currentTimeMs(client, suppliedNowMs);
    if (controls.readOnly) {
      const existing = await client.query("SELECT 1 FROM farm_players WHERE owner_did=$1", [ownerDid]);
      if (!existing.rowCount) throw new ReadOnlyError("Slop Hogs is temporarily read-only");
      return readSnapshot(client, ownerDid, nowMs);
    }
    await ensurePlayer(client, ownerDid);
    const selected = await client.query<Pick<ActionPlayerRow, "mass" | "status" | "psychosis_updated_at">>(
      `SELECT mass, status, psychosis_updated_at
         FROM farm_players
        WHERE owner_did=$1
        FOR UPDATE`,
      [ownerDid],
    );
    const psychosis = decayPsychosis({
      mass: selected.rows[0].mass,
      status: selected.rows[0].status,
      psychosisUpdatedAtMs: selected.rows[0].psychosis_updated_at.getTime(),
    }, nowMs);
    await client.query(
      `UPDATE farm_players
          SET mass=$2, psychosis_updated_at=to_timestamp($3 / 1000.0),
              updated_at=to_timestamp($4 / 1000.0)
        WHERE owner_did=$1`,
      [ownerDid, psychosis.mass, psychosis.psychosisUpdatedAtMs, nowMs],
    );
    await maintainSlop(client, nowMs);
    return readSnapshot(client, ownerDid, nowMs);
  });
}

export async function actOnFarm(
  pool: Pool,
  ownerDid: string,
  action: FarmAction,
  suppliedNowMs?: number,
): Promise<FarmActionResult> {
  const policy = loadCostPolicy();
  const controls = await refreshOperationalStatusForPool(pool, {
    database: policy.database,
    readOnlyMode: policy.features.readOnlyMode,
  });
  if (controls.readOnly) throw new ReadOnlyError("Slop Hogs is temporarily read-only");
  return transaction(pool, async client => {
    const nowMs = await currentTimeMs(client, suppliedNowMs);
    await ensurePlayer(client, ownerDid);
    const selected = await client.query<ActionPlayerRow>(
      `SELECT owner_did, player_id, x, y, facing, mass, score, slop_eaten, status,
              effect, effect_expires_at, last_moved_at, psychosis_updated_at, updated_at
         FROM farm_players
        WHERE owner_did=$1
        FOR UPDATE`,
      [ownerDid],
    );
    const storedRow = selected.rows[0];
    const decayed = decayPsychosis({
      mass: storedRow.mass,
      status: storedRow.status,
      psychosisUpdatedAtMs: storedRow.psychosis_updated_at.getTime(),
    }, nowMs);
    const row = {
      ...storedRow,
      mass: decayed.mass,
      psychosis_updated_at: new Date(decayed.psychosisUpdatedAtMs),
    };
    let events: FarmEvent[] = [];

    if (action.type === "restart") {
      if (row.status !== "popped") throw new Error("Only a popped hog can restart");
      const spawn = randomSpawn();
      await client.query(
        `UPDATE farm_players
            SET x=$2, y=$3, facing='right', mass=$4, score=0, slop_eaten=0,
                status='alive', effect=NULL, effect_expires_at=NULL,
                last_moved_at=to_timestamp($5 / 1000.0),
                psychosis_updated_at=to_timestamp($5 / 1000.0),
                updated_at=to_timestamp($5 / 1000.0), popped_at=NULL
          WHERE owner_did=$1`,
        [ownerDid, spawn.x, spawn.y, STARTING_MASS, nowMs],
      );
      events = [{ type: "restarted" }];
    } else {
      const moved = movePlayer({
        x: row.x,
        y: row.y,
        facing: row.facing,
        mass: row.mass,
        status: row.status,
        effect: row.effect,
        effectExpiresAtMs: row.effect_expires_at?.getTime() ?? null,
        lastMovedAtMs: row.last_moved_at.getTime(),
      }, action, nowMs);
      const activeSlop = await client.query<SlopRow>(
        `SELECT id, kind, x, y, expires_at
           FROM farm_slop
          WHERE expires_at > to_timestamp($1 / 1000.0)`,
        [nowMs],
      );
      const pickup = touchingSlop(moved, activeSlop.rows.map(mapSlop));
      let consumed: ReturnType<typeof applySlop> | null = null;
      if (pickup) {
        const deleted = await client.query(
          "DELETE FROM farm_slop WHERE id=$1 AND expires_at > to_timestamp($2 / 1000.0)",
          [pickup.id, nowMs],
        );
        if (deleted.rowCount === 1) {
          consumed = applySlop({
            mass: moved.mass,
            score: row.score,
            slopEaten: row.slop_eaten,
            status: moved.status,
            effect: moved.effect,
            effectExpiresAtMs: moved.effectExpiresAtMs,
          }, pickup.kind, nowMs);
          events = consumed.events;
        }
      }
      const state = consumed?.player ?? {
        mass: moved.mass,
        score: row.score,
        slopEaten: row.slop_eaten,
        status: moved.status,
        effect: moved.effect,
        effectExpiresAtMs: moved.effectExpiresAtMs,
      };
      const psychosisUpdatedAtMs = consumed ? nowMs : row.psychosis_updated_at.getTime();
      await client.query(
        `UPDATE farm_players
            SET x=$2, y=$3, facing=$4, mass=$5, score=$6, slop_eaten=$7,
                status=$8, effect=$9, effect_expires_at=CASE
                  WHEN $10::float8 IS NULL THEN NULL
                  ELSE to_timestamp($10 / 1000.0)
                END,
                psychosis_updated_at=to_timestamp($11 / 1000.0),
                last_moved_at=to_timestamp($12 / 1000.0),
                updated_at=to_timestamp($12 / 1000.0),
                popped_at=CASE WHEN $8='popped' THEN to_timestamp($12 / 1000.0) ELSE NULL END
          WHERE owner_did=$1`,
        [
          ownerDid,
          moved.x,
          moved.y,
          moved.facing,
          state.mass,
          state.score,
          state.slopEaten,
          state.status,
          state.effect,
          state.effectExpiresAtMs,
          psychosisUpdatedAtMs,
          nowMs,
        ],
      );
    }

    await maintainSlop(client, nowMs);
    return { snapshot: await readSnapshot(client, ownerDid, nowMs), events };
  });
}
