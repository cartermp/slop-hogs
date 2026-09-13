import { randomInt } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import {
  eligibleSinglePlayerAchievements,
  emptySinglePlayerAchievementProgress,
  newlyEligibleSinglePlayerAchievements,
  recordSinglePlayerVictory,
  singlePlayerAchievementValue,
  type SinglePlayerAchievementDefinition,
} from "../single-player-achievements.ts";
import {
  advanceSinglePlayerState,
  applySinglePlayerAction,
  createSinglePlayerState,
  parseSinglePlayerState,
  singlePlayerFarmPlayers,
  singlePlayerRunStatus,
  type SinglePlayerAction,
  type SinglePlayerAchievementProgress,
  type SinglePlayerAchievementState,
  type SinglePlayerDifficulty,
  type SinglePlayerEvent,
  type SinglePlayerResult,
  type SinglePlayerSnapshot,
  type SinglePlayerState,
} from "../single-player.ts";
import { loadCostPolicy } from "./cost-policy.ts";
import { transaction } from "./database.ts";
import { ReadOnlyError, refreshOperationalStatusForPool } from "./operations.ts";

interface AchievementProgressRow {
  games_started: number;
  wins: number;
  easy_wins: number;
  medium_wins: number;
  hard_wins: number;
  total_knockouts: number;
  best_run_score: number;
  flawless_wins: number;
}

async function currentTimeMs(client: PoolClient, supplied?: number): Promise<number> {
  if (supplied !== undefined) {
    if (!Number.isSafeInteger(supplied) || supplied < 0) throw new Error("Invalid single-player time");
    return supplied;
  }
  return (await client.query<{ now_ms: number }>(
    "SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::float8 AS now_ms",
  )).rows[0].now_ms;
}

async function ensureAchievementProgress(client: PoolClient, ownerDid: string): Promise<void> {
  await client.query(
    `INSERT INTO single_player_achievement_progress(owner_did)
     VALUES ($1)
     ON CONFLICT (owner_did) DO NOTHING`,
    [ownerDid],
  );
}

function mapAchievementProgress(row: AchievementProgressRow): SinglePlayerAchievementProgress {
  return {
    gamesStarted: row.games_started,
    wins: row.wins,
    easyWins: row.easy_wins,
    mediumWins: row.medium_wins,
    hardWins: row.hard_wins,
    totalKnockouts: row.total_knockouts,
    bestRunScore: row.best_run_score,
    flawlessWins: row.flawless_wins,
  };
}

async function readAchievementProgress(
  client: PoolClient,
  ownerDid: string,
  lock = false,
): Promise<SinglePlayerAchievementProgress> {
  const result = await client.query<AchievementProgressRow>(
    `SELECT games_started, wins, easy_wins, medium_wins, hard_wins,
            total_knockouts, best_run_score, flawless_wins
       FROM single_player_achievement_progress
      WHERE owner_did=$1
      ${lock ? "FOR UPDATE" : ""}`,
    [ownerDid],
  );
  return result.rows[0] ? mapAchievementProgress(result.rows[0]) : emptySinglePlayerAchievementProgress();
}

async function persistAchievementProgress(
  client: PoolClient,
  ownerDid: string,
  progress: SinglePlayerAchievementProgress,
): Promise<void> {
  await client.query(
    `UPDATE single_player_achievement_progress
        SET games_started=$2, wins=$3, easy_wins=$4, medium_wins=$5,
            hard_wins=$6, total_knockouts=$7, best_run_score=$8,
            flawless_wins=$9, updated_at=clock_timestamp()
      WHERE owner_did=$1`,
    [
      ownerDid,
      progress.gamesStarted,
      progress.wins,
      progress.easyWins,
      progress.mediumWins,
      progress.hardWins,
      progress.totalKnockouts,
      progress.bestRunScore,
      progress.flawlessWins,
    ],
  );
}

async function unlockAchievements(
  client: PoolClient,
  ownerDid: string,
  progress: SinglePlayerAchievementProgress,
  achievements: readonly SinglePlayerAchievementDefinition[],
): Promise<string[]> {
  if (!achievements.length) return [];
  const result = await client.query<{ achievement_id: string }>(
    `INSERT INTO single_player_achievement_unlocks(owner_did, achievement_id, progress_value)
     SELECT $1, candidate.id, candidate.value
       FROM unnest($2::text[], $3::double precision[]) AS candidate(id, value)
     ON CONFLICT (owner_did, achievement_id) DO NOTHING
     RETURNING achievement_id`,
    [
      ownerDid,
      achievements.map(achievement => achievement.id),
      achievements.map(achievement => singlePlayerAchievementValue(achievement, progress)),
    ],
  );
  return result.rows.map(row => row.achievement_id);
}

async function readAchievementState(
  client: PoolClient,
  ownerDid: string,
  progress?: SinglePlayerAchievementProgress,
): Promise<SinglePlayerAchievementState> {
  const [resolvedProgress, unlocks] = await Promise.all([
    progress ?? readAchievementProgress(client, ownerDid),
    client.query<{ achievement_id: string; unlocked_at: Date }>(
      `SELECT achievement_id, unlocked_at
         FROM single_player_achievement_unlocks
        WHERE owner_did=$1
        ORDER BY unlocked_at, achievement_id`,
      [ownerDid],
    ),
  ]);
  return {
    progress: resolvedProgress,
    unlocks: unlocks.rows.map(row => ({
      id: row.achievement_id,
      unlockedAt: row.unlocked_at.toISOString(),
    })),
  };
}

async function readPlayerName(client: PoolClient, ownerDid: string): Promise<string> {
  const result = await client.query<{ handle: string | null }>(
    "SELECT handle FROM accounts WHERE did=$1",
    [ownerDid],
  );
  return result.rows[0]?.handle ?? ownerDid;
}

async function snapshot(
  client: PoolClient,
  ownerDid: string,
  state: SinglePlayerState,
  achievements?: SinglePlayerAchievementState,
): Promise<SinglePlayerSnapshot> {
  const [playerName, achievementState] = await Promise.all([
    readPlayerName(client, ownerDid),
    achievements ?? readAchievementState(client, ownerDid),
  ]);
  return {
    serverNowMs: state.updatedAtMs,
    players: singlePlayerFarmPlayers(state, playerName),
    slop: state.slop,
    singlePlayer: {
      difficulty: state.difficulty,
      status: singlePlayerRunStatus(state),
      botsRemaining: state.bots.filter(bot => bot.status === "alive").length,
      achievements: achievementState,
    },
  };
}

async function saveState(client: PoolClient, ownerDid: string, state: SinglePlayerState): Promise<void> {
  await client.query(
    `INSERT INTO single_player_games(owner_did, difficulty, state, updated_at)
     VALUES ($1,$2,$3,to_timestamp($4 / 1000.0))
     ON CONFLICT (owner_did) DO UPDATE
       SET difficulty=EXCLUDED.difficulty, state=EXCLUDED.state, updated_at=EXCLUDED.updated_at`,
    [ownerDid, state.difficulty, state, state.updatedAtMs],
  );
}

async function readState(
  client: PoolClient,
  ownerDid: string,
  lock = false,
): Promise<SinglePlayerState | null> {
  const result = await client.query<{ state: unknown }>(
    `SELECT state
       FROM single_player_games
      WHERE owner_did=$1
      ${lock ? "FOR UPDATE" : ""}`,
    [ownerDid],
  );
  return result.rows[0] ? parseSinglePlayerState(result.rows[0].state) : null;
}

async function operationalReadOnly(pool: Pool): Promise<boolean> {
  const policy = loadCostPolicy();
  return (await refreshOperationalStatusForPool(pool, {
    database: policy.database,
    readOnlyMode: policy.features.readOnlyMode,
  })).readOnly;
}

async function startRun(
  client: PoolClient,
  ownerDid: string,
  difficulty: SinglePlayerDifficulty,
  nowMs: number,
): Promise<SinglePlayerResult> {
  await ensureAchievementProgress(client, ownerDid);
  const previous = await readAchievementProgress(client, ownerDid, true);
  const progress = { ...previous, gamesStarted: previous.gamesStarted + 1 };
  const state = createSinglePlayerState(difficulty, nowMs, randomInt(1, 0x1_0000_0000));
  await saveState(client, ownerDid, state);
  await persistAchievementProgress(client, ownerDid, progress);
  const unlocked = await unlockAchievements(
    client,
    ownerDid,
    progress,
    newlyEligibleSinglePlayerAchievements(previous, progress),
  );
  const events: SinglePlayerEvent[] = unlocked.length
    ? [{ type: "single_player_achievements_unlocked", achievementIds: unlocked }]
    : [];
  return {
    snapshot: await snapshot(client, ownerDid, state, await readAchievementState(client, ownerDid, progress)),
    events,
  };
}

export async function syncSinglePlayer(
  pool: Pool,
  ownerDid: string,
  suppliedNowMs?: number,
): Promise<SinglePlayerResult> {
  const readOnly = await operationalReadOnly(pool);
  return transaction(pool, async client => {
    const nowMs = await currentTimeMs(client, suppliedNowMs);
    if (!readOnly) await ensureAchievementProgress(client, ownerDid);
    const saved = await readState(client, ownerDid, !readOnly);
    if (!saved) throw new Error("Start a single-player game");
    const resolution = readOnly
      ? { state: saved, events: [] as SinglePlayerEvent[] }
      : advanceSinglePlayerState(saved, nowMs);
    if (!readOnly) await saveState(client, ownerDid, resolution.state);
    return {
      snapshot: await snapshot(client, ownerDid, resolution.state),
      events: resolution.events,
    };
  });
}

export async function actOnSinglePlayer(
  pool: Pool,
  ownerDid: string,
  action: SinglePlayerAction,
  suppliedNowMs?: number,
): Promise<SinglePlayerResult> {
  if (await operationalReadOnly(pool)) throw new ReadOnlyError("Slop Hogs is temporarily read-only");
  return transaction(pool, async client => {
    const nowMs = await currentTimeMs(client, suppliedNowMs);
    if (action.type === "start") return startRun(client, ownerDid, action.difficulty, nowMs);
    await ensureAchievementProgress(client, ownerDid);
    const saved = await readState(client, ownerDid, true);
    if (!saved) throw new Error("Start a single-player game");
    if (action.type === "restart") {
      if (singlePlayerRunStatus(saved) === "playing") throw new Error("Finish the current run first");
      const restarted = await startRun(client, ownerDid, saved.difficulty, nowMs);
      restarted.events.unshift({ type: "restarted" });
      return restarted;
    }

    const previous = await readAchievementProgress(client, ownerDid, true);
    const resolution = applySinglePlayerAction(saved, action, nowMs);
    const knockouts = resolution.events.filter(
      event => event.type === "battle_attack" && event.targetDefeated,
    ).length;
    let progress: SinglePlayerAchievementProgress = {
      ...previous,
      totalKnockouts: previous.totalKnockouts + knockouts,
      bestRunScore: Math.max(previous.bestRunScore, resolution.state.player.score),
    };
    if (resolution.events.some(event => event.type === "victory")) {
      progress = recordSinglePlayerVictory(
        progress,
        resolution.state.difficulty,
        resolution.state.playerDamageTaken === 0,
      );
    }
    await saveState(client, ownerDid, resolution.state);
    await persistAchievementProgress(client, ownerDid, progress);
    const candidates = previous.gamesStarted === 0
      ? eligibleSinglePlayerAchievements(progress)
      : newlyEligibleSinglePlayerAchievements(previous, progress);
    const unlocked = await unlockAchievements(client, ownerDid, progress, candidates);
    if (unlocked.length) {
      resolution.events.push({ type: "single_player_achievements_unlocked", achievementIds: unlocked });
    }
    return {
      snapshot: await snapshot(client, ownerDid, resolution.state, await readAchievementState(client, ownerDid, progress)),
      events: resolution.events,
    };
  });
}
