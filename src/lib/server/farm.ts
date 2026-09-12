import { randomInt, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import {
  ACHIEVEMENT_CATALOG_VERSION,
  HIGH_PSYCHOSIS_MASS,
  advanceAchievementProgress,
  achievementValue,
  eligibleAchievements,
  emptyAchievementProgress,
  newlyEligibleAchievements,
  type AchievementDefinition,
  type AchievementProgress,
  type AchievementState,
} from "../achievements.ts";
import {
  ATTACK_COOLDOWN_MS,
  MAX_HEALTH,
  ONLINE_WINDOW_MS,
  SLOP_KINDS,
  STARTING_MASS,
  applySlop,
  battlePsychosis,
  battleRange,
  decayPsychosis,
  movePlayer,
  resolveBattleAttack,
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
const FIELD_CAPACITY = 8;
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
  field_id: string;
  x: number;
  y: number;
  facing: Facing;
  mass: number;
  score: number;
  slop_eaten: number;
  health: number;
  knockouts: number;
  status: FarmPlayerStatus;
  effect: HogEffect | null;
  effect_expires_at: Date | null;
  last_moved_at: Date;
  last_attack_at: Date | null;
  psychosis_movement_ms: number;
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

interface AchievementProgressRow {
  total_slop: string;
  total_score: string;
  knockouts: string;
  total_distance: number;
  high_psychosis_distance: number;
  current_high_psychosis_ms: string;
  best_high_psychosis_ms: string;
  last_high_move_at: Date | null;
  pops: number;
  runs: number;
  best_run_score: number;
  best_run_slop: number;
  current_run_distance: number;
  best_run_distance: number;
  kind_counts: unknown;
  run_kind_mask: number;
  max_run_variety: number;
  last_slop_kind: SlopKind | null;
  same_kind_streak: number;
  best_same_kind_streak: number;
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

async function ensurePlayer(client: PoolClient, ownerDid: string, nowMs: number): Promise<string> {
  const activeAfterMs = nowMs - ONLINE_WINDOW_MS;
  let current = await client.query<{ field_id: string; updated_at: Date }>(
    "SELECT field_id, updated_at FROM farm_players WHERE owner_did=$1 FOR UPDATE",
    [ownerDid],
  );
  if (current.rows[0]?.updated_at.getTime() >= activeAfterMs) {
    return current.rows[0].field_id;
  }

  // Serialize matchmaking so a burst of arrivals packs into one field.
  await client.query("SELECT pg_advisory_xact_lock(734009)");
  current = await client.query<{ field_id: string; updated_at: Date }>(
    "SELECT field_id, updated_at FROM farm_players WHERE owner_did=$1 FOR UPDATE",
    [ownerDid],
  );
  if (current.rows[0]?.updated_at.getTime() >= activeAfterMs) {
    return current.rows[0].field_id;
  }

  const available = await client.query<{ field_id: string }>(
    `SELECT field.id AS field_id
       FROM farm_fields field
       JOIN farm_players player ON player.field_id=field.id
      WHERE player.updated_at >= to_timestamp($1 / 1000.0)
        AND player.owner_did<>$2
      GROUP BY field.id, field.last_joined_at
     HAVING count(*) < $3
      ORDER BY field.last_joined_at DESC, field.id
      LIMIT 1`,
    [activeAfterMs, ownerDid, FIELD_CAPACITY],
  );
  const fieldId = available.rows[0]?.field_id ?? randomUUID();
  if (!available.rowCount) {
    await client.query("INSERT INTO farm_fields(id) VALUES ($1)", [fieldId]);
  }
  const spawn = randomSpawn();
  await client.query(
    `INSERT INTO farm_players(owner_did, field_id, x, y, updated_at)
     VALUES ($1,$2,$3,$4,to_timestamp($5 / 1000.0))
     ON CONFLICT (owner_did) DO UPDATE
       SET field_id=EXCLUDED.field_id, x=EXCLUDED.x, y=EXCLUDED.y,
           updated_at=EXCLUDED.updated_at`,
    [ownerDid, fieldId, spawn.x, spawn.y, nowMs],
  );
  await client.query(
    "UPDATE farm_fields SET last_joined_at=clock_timestamp() WHERE id=$1",
    [fieldId],
  );
  return fieldId;
}

async function ensureAchievementProgress(client: PoolClient, ownerDid: string): Promise<void> {
  await client.query(
    `INSERT INTO farm_achievement_progress(owner_did, catalog_version)
     VALUES ($1,$2)
     ON CONFLICT (owner_did) DO NOTHING`,
    [ownerDid, ACHIEVEMENT_CATALOG_VERSION],
  );
}

async function initializeAchievementCatalog(client: PoolClient, ownerDid: string): Promise<boolean> {
  const result = await client.query(
    `UPDATE farm_achievement_progress
        SET catalog_version=$2
      WHERE owner_did=$1 AND catalog_version < $2
      RETURNING owner_did`,
    [ownerDid, ACHIEVEMENT_CATALOG_VERSION],
  );
  return Boolean(result.rowCount);
}

function mapAchievementProgress(row: AchievementProgressRow): AchievementProgress {
  const empty = emptyAchievementProgress();
  const storedCounts = row.kind_counts && typeof row.kind_counts === "object" && !Array.isArray(row.kind_counts)
    ? row.kind_counts as Record<string, unknown>
    : {};
  const kindCounts = { ...empty.kindCounts };
  for (const kind of SLOP_KINDS) {
    const value = storedCounts[kind];
    kindCounts[kind] = typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
  }
  return {
    totalSlop: Number(row.total_slop),
    totalScore: Number(row.total_score),
    knockouts: Number(row.knockouts),
    totalDistance: row.total_distance,
    highPsychosisDistance: row.high_psychosis_distance,
    currentHighPsychosisMs: Number(row.current_high_psychosis_ms),
    bestHighPsychosisMs: Number(row.best_high_psychosis_ms),
    lastHighMoveAtMs: row.last_high_move_at?.getTime() ?? null,
    pops: row.pops,
    runs: row.runs,
    bestRunScore: row.best_run_score,
    bestRunSlop: row.best_run_slop,
    currentRunDistance: row.current_run_distance,
    bestRunDistance: row.best_run_distance,
    kindCounts,
    runKindMask: row.run_kind_mask,
    maxRunVariety: row.max_run_variety,
    lastSlopKind: row.last_slop_kind,
    sameKindStreak: row.same_kind_streak,
    bestSameKindStreak: row.best_same_kind_streak,
  };
}

async function readAchievementProgress(
  client: PoolClient,
  ownerDid: string,
  lock = false,
): Promise<AchievementProgress> {
  const result = await client.query<AchievementProgressRow>(
    `SELECT total_slop, total_score, knockouts, total_distance, high_psychosis_distance,
            current_high_psychosis_ms, best_high_psychosis_ms, last_high_move_at,
            pops, runs, best_run_score, best_run_slop, current_run_distance,
            best_run_distance, kind_counts, run_kind_mask, max_run_variety,
            last_slop_kind, same_kind_streak, best_same_kind_streak
       FROM farm_achievement_progress
      WHERE owner_did=$1
      ${lock ? "FOR UPDATE" : ""}`,
    [ownerDid],
  );
  if (!result.rowCount) throw new Error("Achievement progress is missing");
  return mapAchievementProgress(result.rows[0]);
}

async function persistAchievementProgress(
  client: PoolClient,
  ownerDid: string,
  progress: AchievementProgress,
): Promise<void> {
  await client.query(
    `UPDATE farm_achievement_progress
        SET total_slop=$2, total_score=$3, total_distance=$4,
            high_psychosis_distance=$5, current_high_psychosis_ms=$6,
            best_high_psychosis_ms=$7,
            last_high_move_at=CASE WHEN $8::float8 IS NULL THEN NULL ELSE to_timestamp($8 / 1000.0) END,
            pops=$9, runs=$10, best_run_score=$11, best_run_slop=$12,
            current_run_distance=$13, best_run_distance=$14, kind_counts=$15,
            run_kind_mask=$16, max_run_variety=$17, last_slop_kind=$18,
            same_kind_streak=$19, best_same_kind_streak=$20, knockouts=$21,
            updated_at=clock_timestamp()
      WHERE owner_did=$1`,
    [
      ownerDid,
      progress.totalSlop,
      progress.totalScore,
      progress.totalDistance,
      progress.highPsychosisDistance,
      progress.currentHighPsychosisMs,
      progress.bestHighPsychosisMs,
      progress.lastHighMoveAtMs,
      progress.pops,
      progress.runs,
      progress.bestRunScore,
      progress.bestRunSlop,
      progress.currentRunDistance,
      progress.bestRunDistance,
      progress.kindCounts,
      progress.runKindMask,
      progress.maxRunVariety,
      progress.lastSlopKind,
      progress.sameKindStreak,
      progress.bestSameKindStreak,
      progress.knockouts,
    ],
  );
}

async function unlockEligibleAchievements(
  client: PoolClient,
  ownerDid: string,
  progress: AchievementProgress,
  achievements: readonly AchievementDefinition[] = eligibleAchievements(progress),
): Promise<string[]> {
  if (!achievements.length) return [];
  const result = await client.query<{ achievement_id: string }>(
    `INSERT INTO farm_achievement_unlocks(owner_did, achievement_id, progress_value)
     SELECT $1, candidate.id, candidate.value
       FROM unnest($2::text[], $3::double precision[]) AS candidate(id, value)
     ON CONFLICT (owner_did, achievement_id) DO NOTHING
     RETURNING achievement_id`,
    [
      ownerDid,
      achievements.map(achievement => achievement.id),
      achievements.map(achievement => achievementValue(achievement, progress)),
    ],
  );
  return result.rows.map(row => row.achievement_id);
}

async function readAchievementState(client: PoolClient, ownerDid: string): Promise<AchievementState> {
  const [progress, unlocks] = await Promise.all([
    readAchievementProgress(client, ownerDid),
    client.query<{ achievement_id: string; unlocked_at: Date }>(
      `SELECT achievement_id, unlocked_at
         FROM farm_achievement_unlocks
        WHERE owner_did=$1
        ORDER BY unlocked_at, achievement_id`,
      [ownerDid],
    ),
  ]);
  return {
    progress,
    unlocks: unlocks.rows.map(row => ({
      id: row.achievement_id,
      unlockedAt: row.unlocked_at.toISOString(),
    })),
  };
}

async function maintainSlop(client: PoolClient, fieldId: string, nowMs: number): Promise<void> {
  await client.query("DELETE FROM farm_slop WHERE expires_at <= to_timestamp($1 / 1000.0)", [nowMs]);
  await client.query("SELECT pg_advisory_xact_lock(734005)");
  const count = Number((await client.query<{ count: string }>(
    `SELECT count(*)::text AS count
       FROM farm_slop
      WHERE field_id=$1 AND expires_at > to_timestamp($2 / 1000.0)`,
    [fieldId, nowMs],
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
      `INSERT INTO farm_slop(id, field_id, kind, x, y, spawned_at, expires_at)
       VALUES ($1,$2,$3,$4,$5,to_timestamp($6 / 1000.0),to_timestamp($7 / 1000.0))`,
      [
        randomUUID(),
        fieldId,
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
  return {
    id: row.player_id,
    name: row.handle ?? row.owner_did,
    x: row.x,
    y: row.y,
    facing: row.facing,
    mass: row.mass,
    score: row.score,
    slopEaten: row.slop_eaten,
    health: row.health,
    knockouts: row.knockouts,
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

async function readSnapshot(
  client: PoolClient,
  ownerDid: string,
  fieldId: string,
  nowMs: number,
): Promise<FarmSnapshot> {
  const [players, slop, achievements] = await Promise.all([
    client.query<PlayerRow>(
      `SELECT player.owner_did, player.player_id, player.field_id,
              player.x, player.y, player.facing,
              player.mass, player.score, player.slop_eaten, player.health, player.knockouts,
              player.status, player.effect, player.effect_expires_at, player.last_moved_at,
              player.last_attack_at, player.psychosis_movement_ms,
              player.updated_at, account.handle
         FROM farm_players player
         JOIN accounts account ON account.did=player.owner_did
        WHERE player.field_id=$2
          AND (player.owner_did=$1
            OR player.updated_at >= to_timestamp($3 / 1000.0))
        ORDER BY (player.owner_did=$1) DESC, player.updated_at DESC, player.player_id
        LIMIT $4`,
      [ownerDid, fieldId, nowMs - ONLINE_WINDOW_MS, MAX_VISIBLE_PLAYERS],
    ),
    client.query<SlopRow>(
      `SELECT id, kind, x, y, expires_at
         FROM farm_slop
        WHERE field_id=$1 AND expires_at > to_timestamp($2 / 1000.0)
        ORDER BY id`,
      [fieldId, nowMs],
    ),
    readAchievementState(client, ownerDid),
  ]);
  return {
    serverNowMs: nowMs,
    players: players.rows.map(row => mapPlayer(row, ownerDid, nowMs)),
    slop: slop.rows.map(mapSlop),
    achievements,
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
      const existing = await client.query<{ field_id: string }>(
        "SELECT field_id FROM farm_players WHERE owner_did=$1",
        [ownerDid],
      );
      if (!existing.rowCount) throw new ReadOnlyError("Slop Hogs is temporarily read-only");
      return readSnapshot(client, ownerDid, existing.rows[0].field_id, nowMs);
    }
    const fieldId = await ensurePlayer(client, ownerDid, nowMs);
    await ensureAchievementProgress(client, ownerDid);
    await client.query(
      `UPDATE farm_players
          SET updated_at=to_timestamp($2 / 1000.0)
        WHERE owner_did=$1`,
      [ownerDid, nowMs],
    );
    const initializeCatalog = await initializeAchievementCatalog(client, ownerDid);
    await maintainSlop(client, fieldId, nowMs);
    if (initializeCatalog) {
      const progress = await readAchievementProgress(client, ownerDid);
      await unlockEligibleAchievements(client, ownerDid, progress);
    }
    return readSnapshot(client, ownerDid, fieldId, nowMs);
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
    if (action.type === "bite" || action.type === "fart") {
      await client.query("SELECT pg_advisory_xact_lock(734008)");
    }
    const fieldId = await ensurePlayer(client, ownerDid, nowMs);
    await ensureAchievementProgress(client, ownerDid);
    const selected = await client.query<ActionPlayerRow>(
      `SELECT owner_did, player_id, field_id, x, y, facing, mass, score, slop_eaten, health,
              knockouts, status, effect, effect_expires_at, last_moved_at,
              last_attack_at, psychosis_movement_ms, updated_at
         FROM farm_players
        WHERE owner_did=$1
        FOR UPDATE`,
      [ownerDid],
    );
    const row = selected.rows[0];
    const initializeCatalog = await initializeAchievementCatalog(client, ownerDid);
    const achievementProgress = await readAchievementProgress(client, ownerDid, true);
    let nextAchievementProgress = achievementProgress;
    let events: FarmEvent[] = [];

    if (action.type === "restart") {
      if (row.status === "alive") throw new Error("Only a stopped hog can redeploy");
      const spawn = randomSpawn();
      await client.query(
        `UPDATE farm_players
            SET x=$2, y=$3, facing='right', mass=$4, score=0, slop_eaten=0, health=$5,
                status='alive', effect=NULL, effect_expires_at=NULL,
                last_moved_at=to_timestamp($6 / 1000.0), last_attack_at=NULL,
                psychosis_movement_ms=0,
                updated_at=to_timestamp($6 / 1000.0), popped_at=NULL,
                defeated_at=NULL, defeat_cause=NULL
          WHERE owner_did=$1`,
        [ownerDid, spawn.x, spawn.y, STARTING_MASS, MAX_HEALTH, nowMs],
      );
      events = [{ type: "restarted" }];
      nextAchievementProgress = advanceAchievementProgress(achievementProgress, {
        distance: 0,
        movementElapsedMs: 0,
        movedAtHighPsychosis: false,
        nowMs,
        slopKind: null,
        pointsGained: 0,
        runScore: 0,
        runSlop: 0,
        popped: false,
        knockouts: 0,
        restarted: true,
      });
    } else if (action.type === "bite" || action.type === "fart") {
      if (row.status !== "alive") throw new Error("Only living hogs can battle");
      if (row.last_attack_at && nowMs - row.last_attack_at.getTime() < ATTACK_COOLDOWN_MS) {
        throw new Error("Attack is cooling down");
      }
      const attackerEffect = row.effect_expires_at?.getTime() && row.effect_expires_at.getTime() > nowMs
        ? row.effect
        : null;
      if (action.type === "fart" && !action.targetId) {
        const mass = battlePsychosis(row.mass, "fart");
        await client.query(
          `UPDATE farm_players
              SET mass=$2, effect=$3,
                  effect_expires_at=CASE WHEN $3::text IS NULL THEN NULL ELSE effect_expires_at END,
                  last_attack_at=to_timestamp($4 / 1000.0),
                  psychosis_movement_ms=0,
                  updated_at=to_timestamp($4 / 1000.0)
            WHERE owner_did=$1`,
          [ownerDid, mass, attackerEffect, nowMs],
        );
        events = [{ type: "psychosis_released", amount: row.mass - mass }];
        nextAchievementProgress = advanceAchievementProgress(achievementProgress, {
          distance: 0,
          movementElapsedMs: 0,
          movedAtHighPsychosis: false,
          nowMs,
          slopKind: null,
          pointsGained: 0,
          runScore: row.score,
          runSlop: row.slop_eaten,
          popped: false,
          knockouts: 0,
          restarted: false,
        });
      } else {
        const targetId = action.targetId;
        if (!targetId) throw new Error("Invalid farm action");
        const targetResult = await client.query<ActionPlayerRow & { handle: string | null }>(
          `SELECT player.owner_did, player.player_id, player.field_id,
                  player.x, player.y, player.facing,
                  player.mass, player.score, player.slop_eaten, player.health, player.knockouts,
                  player.status, player.effect, player.effect_expires_at, player.last_moved_at,
                  player.last_attack_at, player.psychosis_movement_ms, player.updated_at,
                  account.handle
             FROM farm_players player
             JOIN accounts account ON account.did=player.owner_did
            WHERE player.player_id=$1 AND player.owner_did<>$2 AND player.field_id=$3
            FOR UPDATE OF player`,
          [targetId, ownerDid, fieldId],
        );
        const storedTarget = targetResult.rows[0];
        if (
          !storedTarget
          || storedTarget.status !== "alive"
          || storedTarget.updated_at.getTime() < nowMs - ONLINE_WINDOW_MS
        ) {
          throw new Error("That opponent is no longer in the battle");
        }
        const targetEffect = storedTarget.effect_expires_at?.getTime()
          && storedTarget.effect_expires_at.getTime() > nowMs
          ? storedTarget.effect
          : null;
        const distance = Math.hypot(row.x - storedTarget.x, row.y - storedTarget.y);
        if (
          distance > battleRange(
            action.type,
            { mass: row.mass, effect: attackerEffect },
            { mass: storedTarget.mass },
          )
        ) {
          throw new Error("That opponent is out of range");
        }
        const battle = resolveBattleAttack(
          { mass: row.mass, health: row.health, status: row.status, effect: attackerEffect },
          {
            mass: storedTarget.mass,
            health: storedTarget.health,
            status: storedTarget.status,
            effect: targetEffect,
          },
          action.type,
        );
        await client.query(
          `UPDATE farm_players
              SET mass=$2, status=$3, effect=$4,
                  effect_expires_at=CASE WHEN $4::text IS NULL THEN NULL ELSE effect_expires_at END,
                  knockouts=knockouts+$5, last_attack_at=to_timestamp($6 / 1000.0),
                  psychosis_movement_ms=0,
                  updated_at=to_timestamp($6 / 1000.0),
                  popped_at=CASE WHEN $3='popped' THEN to_timestamp($6 / 1000.0) ELSE NULL END
            WHERE owner_did=$1`,
          [
            ownerDid,
            battle.attacker.mass,
            battle.attacker.status,
            battle.attacker.effect,
            battle.targetDefeated ? 1 : 0,
            nowMs,
          ],
        );
        await client.query(
          `UPDATE farm_players
              SET mass=$2, health=$3, status=$4, effect=$5,
                  effect_expires_at=CASE WHEN $5::text IS NULL THEN NULL ELSE effect_expires_at END,
                  updated_at=to_timestamp($6 / 1000.0),
                  defeated_at=CASE WHEN $4='defeated' THEN to_timestamp($6 / 1000.0) ELSE NULL END,
                  defeat_cause=CASE WHEN $4='defeated' THEN 'battle' ELSE NULL END
            WHERE owner_did=$1`,
          [
            storedTarget.owner_did,
            battle.target.mass,
            battle.target.health,
            battle.target.status,
            battle.target.effect,
            nowMs,
          ],
        );
        events = [{
          type: "battle_attack",
          move: action.type,
          targetName: storedTarget.handle ?? storedTarget.owner_did,
          damage: battle.damage,
          targetHealth: battle.target.health,
          psychosisDelta: battle.psychosisDelta,
          targetDefeated: battle.targetDefeated,
        }];
        if (battle.attackerPopped) events.push({ type: "popped" });
        nextAchievementProgress = advanceAchievementProgress(achievementProgress, {
          distance: 0,
          movementElapsedMs: 0,
          movedAtHighPsychosis: false,
          nowMs,
          slopKind: null,
          pointsGained: 0,
          runScore: row.score,
          runSlop: row.slop_eaten,
          popped: battle.attackerPopped,
          knockouts: battle.targetDefeated ? 1 : 0,
          restarted: false,
        });
      }
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
          WHERE field_id=$1 AND expires_at > to_timestamp($2 / 1000.0)`,
        [fieldId, nowMs],
      );
      const pickup = touchingSlop(moved, activeSlop.rows.map(mapSlop));
      const distance = Math.hypot(moved.x - row.x, moved.y - row.y);
      const movementElapsedMs = distance > 0
        ? Math.max(0, Math.min(240, nowMs - row.last_moved_at.getTime()))
        : 0;
      const psychosis = decayPsychosis({
        mass: moved.mass,
        status: moved.status,
        psychosisMovementMs: row.psychosis_movement_ms,
      }, movementElapsedMs);
      let consumed: ReturnType<typeof applySlop> | null = null;
      if (pickup) {
        const deleted = await client.query(
          `DELETE FROM farm_slop
            WHERE id=$1 AND field_id=$2 AND expires_at > to_timestamp($3 / 1000.0)`,
          [pickup.id, fieldId, nowMs],
        );
        if (deleted.rowCount === 1) {
          consumed = applySlop({
            mass: psychosis.mass,
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
        mass: psychosis.mass,
        score: row.score,
        slopEaten: row.slop_eaten,
        status: moved.status,
        effect: moved.effect,
        effectExpiresAtMs: moved.effectExpiresAtMs,
      };
      const eaten = events.find(event => event.type === "slop_eaten");
      nextAchievementProgress = advanceAchievementProgress(achievementProgress, {
        distance,
        movementElapsedMs,
        movedAtHighPsychosis: row.status === "alive"
          && row.mass >= HIGH_PSYCHOSIS_MASS
          && distance > 0,
        nowMs,
        slopKind: eaten?.type === "slop_eaten" ? eaten.kind : null,
        pointsGained: eaten?.type === "slop_eaten" ? eaten.pointsGained : 0,
        runScore: state.score,
        runSlop: state.slopEaten,
        popped: events.some(event => event.type === "popped"),
        knockouts: 0,
        restarted: false,
      });
      const psychosisMovementMs = consumed ? 0 : psychosis.psychosisMovementMs;
      await client.query(
        `UPDATE farm_players
            SET x=$2, y=$3, facing=$4, mass=$5, score=$6, slop_eaten=$7,
                status=$8, effect=$9, effect_expires_at=CASE
                  WHEN $10::float8 IS NULL THEN NULL
                  ELSE to_timestamp($10 / 1000.0)
                END,
                psychosis_movement_ms=$11,
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
          psychosisMovementMs,
          nowMs,
        ],
      );
    }

    await persistAchievementProgress(client, ownerDid, nextAchievementProgress);
    const unlockCandidates = initializeCatalog
      ? eligibleAchievements(nextAchievementProgress)
      : newlyEligibleAchievements(achievementProgress, nextAchievementProgress);
    const unlocked = await unlockEligibleAchievements(
      client,
      ownerDid,
      nextAchievementProgress,
      unlockCandidates,
    );
    if (unlocked.length) events.push({ type: "achievements_unlocked", achievementIds: unlocked });
    await maintainSlop(client, fieldId, nowMs);
    return { snapshot: await readSnapshot(client, ownerDid, fieldId, nowMs), events };
  });
}
