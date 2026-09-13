import {
  FARM_HEIGHT,
  FARM_WIDTH,
  KNOCKOUT_RUSH_DAMAGE_BONUS,
  KNOCKOUT_RUSH_DURATION_MS,
  KNOCKOUT_RUSH_SPEED_MULTIPLIER,
  MAX_HEALTH,
  SLOP_KINDS,
  STARTING_MASS,
  applySlop,
  attackCooldownMs,
  battleRange,
  decayPsychosis,
  hogDiameter,
  movePlayer,
  parseFarmAction,
  resolveBattleAttack,
  touchingSlop,
  type FarmAction,
  type FarmEvent,
  type FarmPlayer,
  type FarmPlayerStatus,
  type FarmSlop,
  type Facing,
  type HogEffect,
  type SlopKind,
} from "./farm-game.ts";

export const SINGLE_PLAYER_STATE_VERSION = 1 as const;

export const SINGLE_PLAYER_DIFFICULTIES = ["easy", "medium", "hard"] as const;
export type SinglePlayerDifficulty = (typeof SINGLE_PLAYER_DIFFICULTIES)[number];
export type SinglePlayerRunStatus = "playing" | "won" | "lost";

export interface SinglePlayerDifficultyDefinition {
  label: string;
  description: string;
  botCount: number;
  botHealth: number;
  botDamage: number;
  botSpeed: number;
  botThinkMs: number;
  activeSlop: number;
  playerHunters: number;
}

export const SINGLE_PLAYER_DIFFICULTY: Record<SinglePlayerDifficulty, SinglePlayerDifficultyDefinition> = {
  easy: {
    label: "EASY",
    description: "2 scrappy hogs // 68 HP // one hunts you",
    botCount: 2,
    botHealth: 68,
    botDamage: 7,
    botSpeed: 40,
    botThinkMs: 1_250,
    activeSlop: 17,
    playerHunters: 1,
  },
  medium: {
    label: "MEDIUM",
    description: "3 mean hogs // 82 HP // two hunt you",
    botCount: 3,
    botHealth: 82,
    botDamage: 9,
    botSpeed: 48,
    botThinkMs: 1_100,
    activeSlop: 15,
    playerHunters: 2,
  },
  hard: {
    label: "HARD",
    description: "4 feral hogs // 96 HP // two hunt you",
    botCount: 4,
    botHealth: 96,
    botDamage: 11,
    botSpeed: 55,
    botThinkMs: 900,
    activeSlop: 13,
    playerHunters: 2,
  },
};

const LEGACY_SINGLE_PLAYER_LIMITS: Record<
  SinglePlayerDifficulty,
  { botCount: number; activeSlop: number }
> = {
  easy: { botCount: 1, activeSlop: 18 },
  medium: { botCount: 2, activeSlop: 15 },
  hard: { botCount: 3, activeSlop: 11 },
};

interface SinglePlayerCombatant {
  id: string;
  name: string;
  x: number;
  y: number;
  facing: Facing;
  mass: number;
  score: number;
  slopEaten: number;
  health: number;
  knockouts: number;
  status: FarmPlayerStatus;
  effect: HogEffect | null;
  effectExpiresAtMs: number | null;
  knockoutRushExpiresAtMs: number | null;
  lastMovedAtMs: number;
  lastAttackAtMs: number | null;
  psychosisMovementMs: number;
  updatedAtMs: number;
}

export interface SinglePlayerState {
  version: typeof SINGLE_PLAYER_STATE_VERSION;
  difficulty: SinglePlayerDifficulty;
  rngState: number;
  startedAtMs: number;
  updatedAtMs: number;
  lastBotStepAtMs: number;
  nextSlopId: number;
  playerDamageTaken: number;
  player: SinglePlayerCombatant;
  bots: SinglePlayerCombatant[];
  slop: FarmSlop[];
}

export type SinglePlayerAction =
  | FarmAction
  | { type: "start"; difficulty: SinglePlayerDifficulty };

export type SinglePlayerEvent = FarmEvent
  | {
    type: "bot_attack";
    botName: string;
    damage: number;
    playerHealth: number;
    playerDefeated: boolean;
  }
  | {
    type: "bot_battle";
    botName: string;
    targetName: string;
    damage: number;
    targetHealth: number;
    targetDefeated: boolean;
  }
  | { type: "victory"; difficulty: SinglePlayerDifficulty; score: number }
  | { type: "single_player_achievements_unlocked"; achievementIds: string[] };

export interface SinglePlayerAchievementProgress {
  gamesStarted: number;
  wins: number;
  easyWins: number;
  mediumWins: number;
  hardWins: number;
  totalKnockouts: number;
  bestRunScore: number;
  flawlessWins: number;
}

export interface SinglePlayerAchievementState {
  progress: SinglePlayerAchievementProgress;
  unlocks: Array<{ id: string; unlockedAt: string }>;
}

export interface SinglePlayerSnapshot {
  serverNowMs: number;
  players: FarmPlayer[];
  slop: FarmSlop[];
  singlePlayer: {
    difficulty: SinglePlayerDifficulty;
    status: SinglePlayerRunStatus;
    botsRemaining: number;
    achievements: SinglePlayerAchievementState;
  };
}

export interface SinglePlayerResult {
  snapshot: SinglePlayerSnapshot;
  events: SinglePlayerEvent[];
}

export interface SinglePlayerResolution {
  state: SinglePlayerState;
  events: SinglePlayerEvent[];
}

const BOT_NAMES = ["SLOP-BOT 01", "SLOP-BOT 02", "SLOP-BOT 03", "SLOP-BOT 04"] as const;
const BOT_SPAWNS = [
  { x: 790, y: 288 },
  { x: 690, y: 118 },
  { x: 690, y: 462 },
  { x: 500, y: 90 },
] as const;
const SLOP_LIFETIME_MS = 20_000;
const MAX_BOT_STEPS_PER_REQUEST = 5;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

export function isSinglePlayerDifficulty(value: unknown): value is SinglePlayerDifficulty {
  return typeof value === "string" && SINGLE_PLAYER_DIFFICULTIES.includes(value as SinglePlayerDifficulty);
}

export function parseSinglePlayerAction(value: unknown): SinglePlayerAction {
  if (isRecord(value) && value.type === "start") {
    if (!hasExactKeys(value, ["type", "difficulty"]) || !isSinglePlayerDifficulty(value.difficulty)) {
      throw new Error("Invalid single-player action");
    }
    return { type: "start", difficulty: value.difficulty };
  }
  if (
    isRecord(value)
    && (value.type === "bite" || value.type === "fart")
    && hasExactKeys(value, ["type", "targetId"])
    && typeof value.targetId === "string"
    && /^bot-[1-4]$/.test(value.targetId)
  ) {
    return { type: value.type, targetId: value.targetId };
  }
  try {
    return parseFarmAction(value);
  } catch {
    throw new Error("Invalid single-player action");
  }
}

function nextRandom(rngState: number): [number, number] {
  let next = rngState >>> 0;
  next ^= next << 13;
  next ^= next >>> 17;
  next ^= next << 5;
  next >>>= 0;
  if (next === 0) next = 0x9e37_79b9;
  return [next, next / 0x1_0000_0000];
}

function randomBetween(state: SinglePlayerState, minimum: number, maximum: number): number {
  const [rngState, fraction] = nextRandom(state.rngState);
  state.rngState = rngState;
  return minimum + fraction * (maximum - minimum);
}

function spawnSlop(state: SinglePlayerState, nowMs: number): FarmSlop {
  const kindIndex = Math.floor(randomBetween(state, 0, SLOP_KINDS.length));
  const id = `solo-${state.startedAtMs}-${state.nextSlopId}`;
  state.nextSlopId += 1;
  return {
    id,
    kind: SLOP_KINDS[Math.min(SLOP_KINDS.length - 1, kindIndex)],
    x: randomBetween(state, 70, FARM_WIDTH - 70),
    y: randomBetween(state, 70, FARM_HEIGHT - 70),
    expiresAtMs: nowMs + SLOP_LIFETIME_MS,
  };
}

function maintainSlop(state: SinglePlayerState, nowMs: number): void {
  const activeSlop = SINGLE_PLAYER_DIFFICULTY[state.difficulty].activeSlop;
  state.slop = state.slop.filter(item => item.expiresAtMs > nowMs);
  while (state.slop.length < activeSlop) state.slop.push(spawnSlop(state, nowMs));
}

function createCombatant(
  id: string,
  name: string,
  x: number,
  y: number,
  health: number,
  nowMs: number,
): SinglePlayerCombatant {
  return {
    id,
    name,
    x,
    y,
    facing: x > FARM_WIDTH / 2 ? "left" : "right",
    mass: STARTING_MASS,
    score: 0,
    slopEaten: 0,
    health,
    knockouts: 0,
    status: "alive",
    effect: null,
    effectExpiresAtMs: null,
    knockoutRushExpiresAtMs: null,
    lastMovedAtMs: nowMs,
    lastAttackAtMs: null,
    psychosisMovementMs: 0,
    updatedAtMs: nowMs,
  };
}

export function createSinglePlayerState(
  difficulty: SinglePlayerDifficulty,
  nowMs: number,
  seed: number,
): SinglePlayerState {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) throw new Error("Invalid single-player time");
  if (!Number.isSafeInteger(seed) || seed <= 0 || seed > 0xffff_ffff) {
    throw new Error("Invalid single-player seed");
  }
  const definition = SINGLE_PLAYER_DIFFICULTY[difficulty];
  const state: SinglePlayerState = {
    version: SINGLE_PLAYER_STATE_VERSION,
    difficulty,
    rngState: seed >>> 0,
    startedAtMs: nowMs,
    updatedAtMs: nowMs,
    lastBotStepAtMs: nowMs,
    nextSlopId: 1,
    playerDamageTaken: 0,
    player: createCombatant("solo-player", "YOU", 150, FARM_HEIGHT / 2, MAX_HEALTH, nowMs),
    bots: Array.from({ length: definition.botCount }, (_, index) => (
      createCombatant(`bot-${index + 1}`, BOT_NAMES[index], BOT_SPAWNS[index].x, BOT_SPAWNS[index].y, definition.botHealth, nowMs)
    )),
    slop: [],
  };
  maintainSlop(state, nowMs);
  return state;
}

function validStatus(value: unknown): value is FarmPlayerStatus {
  return value === "alive" || value === "popped" || value === "defeated";
}

function parseCombatant(value: unknown): SinglePlayerCombatant {
  if (!isRecord(value)) throw new Error("Invalid single-player state");
  const numericKeys = [
    "x", "y", "mass", "score", "slopEaten", "health", "knockouts",
    "lastMovedAtMs", "psychosisMovementMs", "updatedAtMs",
  ] as const;
  const invalidNumber = numericKeys.some(key => typeof value[key] !== "number" || !Number.isFinite(value[key]));
  const radius = typeof value.mass === "number" && Number.isFinite(value.mass)
    ? hogDiameter(value.mass) / 2
    : Number.NaN;
  const knockoutRushExpiresAtMs = value.knockoutRushExpiresAtMs ?? null;
  if (
    typeof value.id !== "string"
    || typeof value.name !== "string"
    || (value.facing !== "left" && value.facing !== "right")
    || !validStatus(value.status)
    || invalidNumber
    || (value.x as number) < radius || (value.x as number) > FARM_WIDTH - radius
    || (value.y as number) < radius || (value.y as number) > FARM_HEIGHT - radius
    || (value.mass as number) < STARTING_MASS || (value.mass as number) > 100
    || (value.health as number) < 0 || (value.health as number) > MAX_HEALTH
    || (value.score as number) < 0 || (value.slopEaten as number) < 0 || (value.knockouts as number) < 0
    || (value.effect !== null && !["turbo", "glitchy", "recursive", "collapsed", "premium"].includes(String(value.effect)))
    || (value.effectExpiresAtMs !== null && typeof value.effectExpiresAtMs !== "number")
    || (knockoutRushExpiresAtMs !== null
      && (typeof knockoutRushExpiresAtMs !== "number" || !Number.isFinite(knockoutRushExpiresAtMs)))
    || (value.lastAttackAtMs !== null && typeof value.lastAttackAtMs !== "number")
  ) throw new Error("Invalid single-player state");
  return { ...value, knockoutRushExpiresAtMs } as unknown as SinglePlayerCombatant;
}

export function parseSinglePlayerState(value: unknown): SinglePlayerState {
  if (
    !isRecord(value)
    || value.version !== SINGLE_PLAYER_STATE_VERSION
    || !isSinglePlayerDifficulty(value.difficulty)
    || typeof value.rngState !== "number"
    || typeof value.startedAtMs !== "number"
    || typeof value.updatedAtMs !== "number"
    || typeof value.lastBotStepAtMs !== "number"
    || typeof value.nextSlopId !== "number"
    || typeof value.playerDamageTaken !== "number"
    || !Array.isArray(value.bots)
    || !Array.isArray(value.slop)
  ) throw new Error("Invalid single-player state");
  const player = parseCombatant(value.player);
  const bots = value.bots.map(parseCombatant);
  const slop = value.slop.map(item => {
    if (
      !isRecord(item)
      || typeof item.id !== "string"
      || !SLOP_KINDS.includes(item.kind as SlopKind)
      || typeof item.x !== "number"
      || typeof item.y !== "number"
      || typeof item.expiresAtMs !== "number"
    ) throw new Error("Invalid single-player state");
    return item as unknown as FarmSlop;
  });
  const definition = SINGLE_PLAYER_DIFFICULTY[value.difficulty];
  const legacyLimits = LEGACY_SINGLE_PLAYER_LIMITS[value.difficulty];
  if (
    !Number.isSafeInteger(value.rngState) || value.rngState <= 0 || value.rngState > 0xffff_ffff
    || !Number.isSafeInteger(value.startedAtMs) || value.startedAtMs < 0
    || !Number.isSafeInteger(value.updatedAtMs) || value.updatedAtMs < value.startedAtMs
    || !Number.isSafeInteger(value.lastBotStepAtMs) || value.lastBotStepAtMs < value.startedAtMs
    || !Number.isSafeInteger(value.nextSlopId) || value.nextSlopId < 1
    || !Number.isFinite(value.playerDamageTaken) || value.playerDamageTaken < 0
    || player.id !== "solo-player"
    || (bots.length !== definition.botCount && bots.length !== legacyLimits.botCount)
    || bots.some((bot, index) => bot.id !== `bot-${index + 1}`)
    || slop.length > Math.max(definition.activeSlop, legacyLimits.activeSlop)
  ) throw new Error("Invalid single-player state");
  return {
    version: SINGLE_PLAYER_STATE_VERSION,
    difficulty: value.difficulty,
    rngState: value.rngState,
    startedAtMs: value.startedAtMs,
    updatedAtMs: value.updatedAtMs,
    lastBotStepAtMs: value.lastBotStepAtMs,
    nextSlopId: value.nextSlopId,
    playerDamageTaken: value.playerDamageTaken,
    player,
    bots,
    slop,
  };
}

export function singlePlayerRunStatus(state: SinglePlayerState): SinglePlayerRunStatus {
  if (state.player.status !== "alive") return "lost";
  return state.bots.some(bot => bot.status === "alive") ? "playing" : "won";
}

function cloneState(state: SinglePlayerState): SinglePlayerState {
  return {
    ...state,
    player: { ...state.player },
    bots: state.bots.map(bot => ({ ...bot })),
    slop: state.slop.map(item => ({ ...item })),
  };
}

function expireEffect(combatant: SinglePlayerCombatant, nowMs: number): void {
  if (combatant.effectExpiresAtMs !== null && combatant.effectExpiresAtMs <= nowMs) {
    combatant.effect = null;
    combatant.effectExpiresAtMs = null;
  }
  if (combatant.knockoutRushExpiresAtMs !== null && combatant.knockoutRushExpiresAtMs <= nowMs) {
    combatant.knockoutRushExpiresAtMs = null;
  }
}

function clampCombatantPosition(combatant: SinglePlayerCombatant): void {
  const radius = hogDiameter(combatant.mass) / 2;
  combatant.x = Math.max(radius, Math.min(FARM_WIDTH - radius, combatant.x));
  combatant.y = Math.max(radius, Math.min(FARM_HEIGHT - radius, combatant.y));
}

function advanceBots(state: SinglePlayerState, nowMs: number): SinglePlayerEvent[] {
  const events: SinglePlayerEvent[] = [];
  if (singlePlayerRunStatus(state) !== "playing") return events;
  const definition = SINGLE_PLAYER_DIFFICULTY[state.difficulty];
  const elapsed = Math.max(0, nowMs - state.lastBotStepAtMs);
  const steps = Math.min(MAX_BOT_STEPS_PER_REQUEST, Math.floor(elapsed / definition.botThinkMs));
  if (steps === 0) return events;
  const firstStepAt = state.lastBotStepAtMs + definition.botThinkMs;
  for (let step = 0; step < steps && state.player.status === "alive"; step += 1) {
    const stepAt = firstStepAt + step * definition.botThinkMs;
    const livingBots = state.bots.filter(bot => bot.status === "alive");
    const hunterIds = new Set<string>();
    if (livingBots.length > 1) {
      const firstHunter = Math.floor(randomBetween(state, 0, livingBots.length));
      for (let index = 0; index < Math.min(definition.playerHunters, livingBots.length); index += 1) {
        hunterIds.add(livingBots[(firstHunter + index) % livingBots.length].id);
      }
    } else if (livingBots[0]) {
      hunterIds.add(livingBots[0].id);
    }
    const turnOrder = [...livingBots].sort(
      (left, right) => Number(hunterIds.has(right.id)) - Number(hunterIds.has(left.id)),
    );
    for (const bot of turnOrder) {
      if (bot.status !== "alive" || state.player.status !== "alive") continue;
      expireEffect(bot, stepAt);
      expireEffect(state.player, stepAt);
      const otherBots = state.bots.filter(candidate => candidate.id !== bot.id && candidate.status === "alive");
      const target = hunterIds.has(bot.id) || otherBots.length === 0
        ? state.player
        : otherBots.reduce((nearest, candidate) => {
          const distance = Math.hypot(candidate.x - bot.x, candidate.y - bot.y);
          const nearestDistance = Math.hypot(nearest.x - bot.x, nearest.y - bot.y);
          return distance < nearestDistance ? candidate : nearest;
        });
      expireEffect(target, stepAt);
      const beforeDistance = Math.hypot(target.x - bot.x, target.y - bot.y);
      if (beforeDistance > battleRange("bite", bot, target) * 0.9) {
        const rushSpeed = bot.knockoutRushExpiresAtMs !== null
          ? KNOCKOUT_RUSH_SPEED_MULTIPLIER
          : 1;
        const ratio = Math.min(1, definition.botSpeed * rushSpeed / Math.max(1, beforeDistance));
        const dx = (target.x - bot.x) * ratio;
        const dy = (target.y - bot.y) * ratio;
        bot.x += dx;
        bot.y += dy;
        clampCombatantPosition(bot);
        if (Math.abs(dx) > 0.1) bot.facing = dx < 0 ? "left" : "right";
        bot.updatedAtMs = stepAt;
      }
      const distance = Math.hypot(target.x - bot.x, target.y - bot.y);
      if (distance <= battleRange("bite", bot, target)) {
        const blockedDamage = target.effect === "glitchy" ? 4 : 0;
        const rushDamage = bot.knockoutRushExpiresAtMs !== null ? KNOCKOUT_RUSH_DAMAGE_BONUS : 0;
        const requestedDamage = Math.max(1, definition.botDamage + rushDamage - blockedDamage);
        const health = Math.max(0, target.health - requestedDamage);
        const damage = target.health - health;
        const targetDefeated = health === 0;
        target.health = health;
        target.status = targetDefeated ? "defeated" : target.status;
        target.effect = targetDefeated ? null : target.effect;
        target.effectExpiresAtMs = targetDefeated ? null : target.effectExpiresAtMs;
        target.knockoutRushExpiresAtMs = targetDefeated ? null : target.knockoutRushExpiresAtMs;
        target.updatedAtMs = stepAt;
        bot.lastAttackAtMs = stepAt;
        if (targetDefeated) {
          bot.knockouts += 1;
          bot.score += 250;
          bot.knockoutRushExpiresAtMs = stepAt + KNOCKOUT_RUSH_DURATION_MS;
        }
        if (target.id === state.player.id) {
          state.playerDamageTaken += damage;
          events.push({
            type: "bot_attack",
            botName: bot.name,
            damage,
            playerHealth: health,
            playerDefeated: targetDefeated,
          });
        } else {
          events.push({
            type: "bot_battle",
            botName: bot.name,
            targetName: target.name,
            damage,
            targetHealth: health,
            targetDefeated,
          });
        }
      }
    }
  }
  state.lastBotStepAtMs += steps * definition.botThinkMs;
  return events;
}

function applyPlayerMovement(
  state: SinglePlayerState,
  action: Extract<FarmAction, { type: "move" }>,
  nowMs: number,
): FarmEvent[] {
  const player = state.player;
  const moved = movePlayer({
    x: player.x,
    y: player.y,
    facing: player.facing,
    mass: player.mass,
    status: player.status,
    effect: player.effect,
    effectExpiresAtMs: player.effectExpiresAtMs,
    knockoutRushExpiresAtMs: player.knockoutRushExpiresAtMs,
    lastMovedAtMs: player.lastMovedAtMs,
  }, action, nowMs);
  const distance = Math.hypot(moved.x - player.x, moved.y - player.y);
  const movementElapsedMs = distance > 0
    ? Math.max(0, Math.min(240, nowMs - player.lastMovedAtMs))
    : 0;
  const psychosis = decayPsychosis({
    mass: moved.mass,
    status: moved.status,
    psychosisMovementMs: player.psychosisMovementMs,
  }, movementElapsedMs);
  const pickup = touchingSlop(moved, state.slop);
  let events: FarmEvent[] = [];
  let consumed: ReturnType<typeof applySlop> | null = null;
  if (pickup) {
    state.slop = state.slop.filter(item => item.id !== pickup.id);
    consumed = applySlop({
      mass: psychosis.mass,
      score: player.score,
      slopEaten: player.slopEaten,
      status: moved.status,
      effect: moved.effect,
      effectExpiresAtMs: moved.effectExpiresAtMs,
    }, pickup.kind, nowMs);
    events = consumed.events;
  }
  const next = consumed?.player ?? {
    mass: psychosis.mass,
    score: player.score,
    slopEaten: player.slopEaten,
    status: moved.status,
    effect: moved.effect,
    effectExpiresAtMs: moved.effectExpiresAtMs,
  };
  Object.assign(player, {
    x: moved.x,
    y: moved.y,
    facing: moved.facing,
    mass: next.mass,
    score: next.score,
    slopEaten: next.slopEaten,
    status: next.status,
    effect: next.effect,
    effectExpiresAtMs: next.effectExpiresAtMs,
    psychosisMovementMs: consumed ? 0 : psychosis.psychosisMovementMs,
    lastMovedAtMs: nowMs,
    updatedAtMs: nowMs,
  });
  clampCombatantPosition(player);
  return events;
}

function applyPlayerAttack(
  state: SinglePlayerState,
  action: Extract<FarmAction, { type: "bite" | "fart" }>,
  nowMs: number,
): FarmEvent[] {
  const player = state.player;
  if (
    player.lastAttackAtMs !== null
    && nowMs - player.lastAttackAtMs < attackCooldownMs(player.knockoutRushExpiresAtMs, nowMs)
  ) {
    throw new Error("Attack is cooling down");
  }
  expireEffect(player, nowMs);
  if (action.type === "fart" && !action.targetId) {
    const battle = resolveBattleAttack(
      { mass: player.mass, health: player.health, status: player.status, effect: player.effect },
      { mass: STARTING_MASS, health: MAX_HEALTH, status: "alive", effect: null },
      "fart",
    );
    const amount = player.mass - battle.attacker.mass;
    player.mass = battle.attacker.mass;
    player.status = battle.attacker.status;
    player.effect = battle.attacker.effect;
    player.lastAttackAtMs = nowMs;
    player.psychosisMovementMs = 0;
    player.updatedAtMs = nowMs;
    return [{ type: "psychosis_released", amount }];
  }
  const target = state.bots.find(bot => bot.id === action.targetId);
  if (!target || target.status !== "alive") throw new Error("That opponent is no longer in the battle");
  expireEffect(target, nowMs);
  if (Math.hypot(player.x - target.x, player.y - target.y) > battleRange(action.type, player, target)) {
    throw new Error("That opponent is out of range");
  }
  const battle = resolveBattleAttack(
    {
      ...player,
      knockoutRush: player.knockoutRushExpiresAtMs !== null,
    },
    target,
    action.type,
  );
  const knockoutRushExpiresAtMs = battle.attacker.status === "alive"
    ? battle.targetDefeated
      ? nowMs + KNOCKOUT_RUSH_DURATION_MS
      : player.knockoutRushExpiresAtMs
    : null;
  Object.assign(player, {
    mass: battle.attacker.mass,
    status: battle.attacker.status,
    effect: battle.attacker.effect,
    effectExpiresAtMs: battle.attacker.effect ? player.effectExpiresAtMs : null,
    knockoutRushExpiresAtMs,
    knockouts: player.knockouts + (battle.targetDefeated ? 1 : 0),
    score: player.score + (battle.targetDefeated ? 250 : 0),
    lastAttackAtMs: nowMs,
    psychosisMovementMs: 0,
    updatedAtMs: nowMs,
  });
  clampCombatantPosition(player);
  Object.assign(target, {
    mass: battle.target.mass,
    health: battle.target.health,
    status: battle.target.status,
    effect: battle.target.effect,
    effectExpiresAtMs: battle.target.effect ? target.effectExpiresAtMs : null,
    knockoutRushExpiresAtMs: battle.targetDefeated ? null : target.knockoutRushExpiresAtMs,
    updatedAtMs: nowMs,
  });
  const events: FarmEvent[] = [{
    type: "battle_attack",
    move: action.type,
    targetName: target.name,
    damage: battle.damage,
    targetHealth: battle.target.health,
    psychosisDelta: battle.psychosisDelta,
    targetDefeated: battle.targetDefeated,
  }];
  if (battle.targetDefeated && knockoutRushExpiresAtMs !== null) {
    events.push({ type: "knockout_rush", expiresAtMs: knockoutRushExpiresAtMs });
  }
  if (battle.attackerPopped) events.push({ type: "popped" });
  return events;
}

export function advanceSinglePlayerState(
  savedState: SinglePlayerState,
  nowMs: number,
): SinglePlayerResolution {
  if (!Number.isSafeInteger(nowMs) || nowMs < savedState.updatedAtMs) {
    throw new Error("Invalid single-player time");
  }
  const state = cloneState(savedState);
  const events = advanceBots(state, nowMs);
  state.updatedAtMs = nowMs;
  maintainSlop(state, nowMs);
  return { state, events };
}

export function applySinglePlayerAction(
  savedState: SinglePlayerState,
  action: Exclude<SinglePlayerAction, { type: "start" }>,
  nowMs: number,
): SinglePlayerResolution {
  if (action.type === "restart") throw new Error("Start a fresh single-player run");
  const advanced = advanceSinglePlayerState(savedState, nowMs);
  const state = advanced.state;
  const events: SinglePlayerEvent[] = [...advanced.events];
  if (singlePlayerRunStatus(state) !== "playing") return { state, events };
  if (action.type === "move") {
    events.push(...applyPlayerMovement(state, action, nowMs));
  } else {
    events.push(...applyPlayerAttack(state, action, nowMs));
  }
  if (singlePlayerRunStatus(state) === "won") {
    events.push({ type: "victory", difficulty: state.difficulty, score: state.player.score });
  }
  maintainSlop(state, nowMs);
  return { state, events };
}

export function singlePlayerFarmPlayers(state: SinglePlayerState, playerName: string): FarmPlayer[] {
  return [state.player, ...state.bots].map((combatant, index) => ({
    id: combatant.id,
    name: index === 0 ? playerName : combatant.name,
    x: combatant.x,
    y: combatant.y,
    facing: combatant.facing,
    mass: combatant.mass,
    score: combatant.score,
    slopEaten: combatant.slopEaten,
    health: combatant.health,
    knockouts: combatant.knockouts,
    status: combatant.status,
    effect: combatant.effectExpiresAtMs !== null && combatant.effectExpiresAtMs > state.updatedAtMs
      ? combatant.effect
      : null,
    effectExpiresAtMs: combatant.effectExpiresAtMs,
    knockoutRushExpiresAtMs: combatant.knockoutRushExpiresAtMs !== null
      && combatant.knockoutRushExpiresAtMs > state.updatedAtMs
      ? combatant.knockoutRushExpiresAtMs
      : null,
    updatedAtMs: combatant.updatedAtMs,
    isYou: index === 0,
  }));
}
