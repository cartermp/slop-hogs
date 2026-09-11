import type { AchievementState } from "./achievements.ts";

export const FARM_WIDTH = 960;
export const FARM_HEIGHT = 576;
export const STARTING_MASS = 24;
export const POPPING_MASS = 100;
export const MAX_HEALTH = 100;
export const ONLINE_WINDOW_MS = 20_000;
export const PSYCHOSIS_DECAY_INTERVAL_MS = 2_000;
export const ATTACK_COOLDOWN_MS = 900;
export const BITE_PSYCHOSIS = 7;
export const FART_PSYCHOSIS_RELEASE = 10;

export const SLOP_KINDS = [
  "hallucinated_citation",
  "context_overflow",
  "recursive_prompt",
  "model_collapse",
  "premium_tokens",
] as const;

export type SlopKind = (typeof SLOP_KINDS)[number];
export type HogEffect = "turbo" | "glitchy" | "recursive" | "collapsed" | "premium";
export type BattleMove = "bite" | "fart";
export type Facing = "left" | "right";
export type FarmPlayerStatus = "alive" | "popped" | "defeated";

export interface SlopDefinition {
  label: string;
  shortLabel: string;
  description: string;
  mass: number;
  points: number;
  effect: HogEffect;
  effectLabel: string;
  effectDurationMs: number;
  battleBonus: string;
}

export const SLOP_CATALOG: Record<SlopKind, SlopDefinition> = {
  hallucinated_citation: {
    label: "Hallucinated Citation",
    shortLabel: "404",
    description: "Confidently wrong. Briefly faster.",
    mass: 10,
    points: 100,
    effect: "turbo",
    effectLabel: "CONFIDENTLY FAST",
    effectDurationMs: 5_000,
    battleBonus: "Bite range +40",
  },
  context_overflow: {
    label: "Context Overflow",
    shortLabel: "32K",
    description: "Huge, dense, and hard to move.",
    mass: 18,
    points: 180,
    effect: "glitchy",
    effectLabel: "CONTEXT LEAK",
    effectDurationMs: 6_000,
    battleBonus: "Absorbs 4 incoming damage",
  },
  recursive_prompt: {
    label: "Recursive Prompt",
    shortLabel: "LOOP",
    description: "Slop eating slop eating slop.",
    mass: 14,
    points: 160,
    effect: "recursive",
    effectLabel: "RECURSING...",
    effectDurationMs: 7_000,
    battleBonus: "Fart damage +6",
  },
  model_collapse: {
    label: "Model Collapse",
    shortLabel: "ERR",
    description: "Very filling. Movement gets mushy.",
    mass: 22,
    points: 240,
    effect: "collapsed",
    effectLabel: "MODEL COLLAPSE",
    effectDurationMs: 6_000,
    battleBonus: "Bite damage +7",
  },
  premium_tokens: {
    label: "Premium Tokens",
    shortLabel: "$$$",
    description: "Lightweight slop with venture-scale points.",
    mass: 7,
    points: 300,
    effect: "premium",
    effectLabel: "SERIES A HOG",
    effectDurationMs: 5_000,
    battleBonus: "All damage +3",
  },
};

export interface FarmPlayer {
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
  updatedAtMs: number;
  isYou: boolean;
}

export interface FarmSlop {
  id: string;
  kind: SlopKind;
  x: number;
  y: number;
  expiresAtMs: number;
}

export interface FarmSnapshot {
  serverNowMs: number;
  players: FarmPlayer[];
  slop: FarmSlop[];
  achievements: AchievementState;
}

export type FarmAction =
  | { type: "move"; dx: -1 | 0 | 1; dy: -1 | 0 | 1 }
  | { type: "bite"; targetId: string }
  | { type: "fart"; targetId: string }
  | { type: "restart" };

export type FarmEvent =
  | { type: "slop_eaten"; kind: SlopKind; massGained: number; pointsGained: number }
  | {
    type: "battle_attack";
    move: BattleMove;
    targetName: string;
    damage: number;
    targetHealth: number;
    psychosisDelta: number;
    targetDefeated: boolean;
  }
  | { type: "popped" }
  | { type: "restarted" }
  | { type: "achievements_unlocked"; achievementIds: string[] };

export interface FarmActionResult {
  snapshot: FarmSnapshot;
  events: FarmEvent[];
}

export interface MovablePlayer {
  x: number;
  y: number;
  facing: Facing;
  mass: number;
  status: FarmPlayerStatus;
  effect: HogEffect | null;
  effectExpiresAtMs: number | null;
  lastMovedAtMs: number;
}

export interface PsychosisState {
  mass: number;
  status: FarmPlayerStatus;
  psychosisUpdatedAtMs: number;
}

export interface BattleCombatant {
  mass: number;
  health: number;
  status: FarmPlayerStatus;
  effect: HogEffect | null;
}

export interface BattleResult {
  attacker: BattleCombatant;
  target: BattleCombatant;
  damage: number;
  psychosisDelta: number;
  targetDefeated: boolean;
  attackerPopped: boolean;
}

const playerIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseFarmAction(value: unknown): FarmAction {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid farm action");
  }
  const action = value as Record<string, unknown>;
  if (action.type === "restart" && Object.keys(action).length === 1) return { type: "restart" };
  if (
    (action.type === "bite" || action.type === "fart")
    && Object.keys(action).length === 2
    && typeof action.targetId === "string"
    && playerIdPattern.test(action.targetId)
  ) {
    return { type: action.type, targetId: action.targetId };
  }
  if (
    action.type === "move"
    && Object.keys(action).length === 3
    && (action.dx === -1 || action.dx === 0 || action.dx === 1)
    && (action.dy === -1 || action.dy === 0 || action.dy === 1)
    && (action.dx !== 0 || action.dy !== 0)
  ) {
    return { type: "move", dx: action.dx, dy: action.dy };
  }
  throw new Error("Invalid farm action");
}

export function hogDiameter(mass: number): number {
  return 30 + ((Math.min(POPPING_MASS, Math.max(STARTING_MASS, mass)) - STARTING_MASS) / 76) * 38;
}

export function psychosisLevel(mass: number): number {
  return (Math.min(POPPING_MASS, Math.max(STARTING_MASS, mass)) - STARTING_MASS)
    / (POPPING_MASS - STARTING_MASS);
}

export function battleRange(
  move: BattleMove,
  attacker: Pick<BattleCombatant, "mass" | "effect">,
  target: Pick<BattleCombatant, "mass">,
): number {
  const bodyReach = (hogDiameter(attacker.mass) + hogDiameter(target.mass)) / 2;
  if (move === "fart") return bodyReach + 105;
  return bodyReach + 24 + (attacker.effect === "turbo" ? 40 : 0);
}

export function resolveBattleAttack(
  attacker: BattleCombatant,
  target: BattleCombatant,
  move: BattleMove,
): BattleResult {
  let damage = move === "bite"
    ? 18 + Math.floor((attacker.mass - STARTING_MASS) / 12)
    : 8;
  if (attacker.effect === "collapsed" && move === "bite") damage += 7;
  if (attacker.effect === "recursive" && move === "fart") damage += 6;
  if (attacker.effect === "premium") damage += 3;
  if (target.effect === "glitchy") damage -= 4;
  damage = Math.max(1, damage);

  const mass = move === "bite"
    ? Math.min(POPPING_MASS, attacker.mass + BITE_PSYCHOSIS)
    : Math.max(STARTING_MASS, attacker.mass - FART_PSYCHOSIS_RELEASE);
  const health = Math.max(0, target.health - damage);
  const attackerPopped = mass >= POPPING_MASS;
  const targetDefeated = health === 0;
  return {
    attacker: {
      ...attacker,
      mass,
      status: attackerPopped ? "popped" : attacker.status,
      effect: attackerPopped ? null : attacker.effect,
    },
    target: {
      ...target,
      health,
      status: targetDefeated ? "defeated" : target.status,
      effect: targetDefeated ? null : target.effect,
    },
    damage,
    psychosisDelta: mass - attacker.mass,
    targetDefeated,
    attackerPopped,
  };
}

export function decayPsychosis<T extends PsychosisState>(player: T, nowMs: number): T {
  if (player.status !== "alive") return player;
  if (player.mass <= STARTING_MASS) {
    return { ...player, mass: STARTING_MASS, psychosisUpdatedAtMs: nowMs };
  }
  const elapsedMs = Math.max(0, nowMs - player.psychosisUpdatedAtMs);
  const decay = Math.floor(elapsedMs / PSYCHOSIS_DECAY_INTERVAL_MS);
  if (decay === 0) return player;
  const mass = Math.max(STARTING_MASS, player.mass - decay);
  return {
    ...player,
    mass,
    psychosisUpdatedAtMs: mass === STARTING_MASS
      ? nowMs
      : player.psychosisUpdatedAtMs + decay * PSYCHOSIS_DECAY_INTERVAL_MS,
  };
}

export function movePlayer<T extends MovablePlayer>(
  player: T,
  action: Extract<FarmAction, { type: "move" }>,
  nowMs: number,
): T {
  if (player.status !== "alive") return player;
  const elapsedMs = Math.max(0, Math.min(240, nowMs - player.lastMovedAtMs));
  const activeEffect = player.effectExpiresAtMs !== null && player.effectExpiresAtMs > nowMs
    ? player.effect
    : null;
  const effectSpeed = activeEffect === "turbo" ? 1.4
    : activeEffect === "collapsed" ? 0.58
      : activeEffect === "glitchy" ? 0.78
        : 1;
  const fatSpeed = Math.max(0.52, 1 - (player.mass - STARTING_MASS) / 150);
  const chaos = Math.max(0, (psychosisLevel(player.mass) - 0.5) * 2);
  const wobble = chaos * (
    Math.sin(nowMs / 83 + player.x * 0.031 + player.y * 0.047) * 1.05
    + Math.sin(nowMs / 31) * 0.4
  );
  const stutter = 1 - chaos * 0.3 * (0.5 + 0.5 * Math.sin(nowMs / 47 + player.y));
  const distance = 0.095 * elapsedMs * effectSpeed * fatSpeed * stutter;
  const magnitude = Math.hypot(action.dx, action.dy);
  const intendedAngle = Math.atan2(action.dy / magnitude, action.dx / magnitude);
  const dx = Math.cos(intendedAngle + wobble);
  const dy = Math.sin(intendedAngle + wobble);
  const radius = hogDiameter(player.mass) / 2;
  return {
    ...player,
    x: Math.max(radius, Math.min(FARM_WIDTH - radius, player.x + dx * distance)),
    y: Math.max(radius, Math.min(FARM_HEIGHT - radius, player.y + dy * distance)),
    facing: dx < 0 ? "left" : dx > 0 ? "right" : player.facing,
    effect: activeEffect,
    effectExpiresAtMs: activeEffect ? player.effectExpiresAtMs : null,
    lastMovedAtMs: nowMs,
  };
}

export function touchingSlop(player: Pick<MovablePlayer, "x" | "y" | "mass">, slop: FarmSlop[]): FarmSlop | null {
  const reach = hogDiameter(player.mass) / 2 + 12;
  return slop
    .map(item => ({ item, distance: Math.hypot(item.x - player.x, item.y - player.y) }))
    .filter(candidate => candidate.distance <= reach)
    .sort((left, right) => left.distance - right.distance)[0]?.item ?? null;
}

export function applySlop(
  player: Pick<FarmPlayer, "mass" | "score" | "slopEaten" | "status" | "effect" | "effectExpiresAtMs">,
  kind: SlopKind,
  nowMs: number,
): {
  player: typeof player;
  events: FarmEvent[];
} {
  if (player.status !== "alive") return { player, events: [] };
  const definition = SLOP_CATALOG[kind];
  const mass = Math.min(POPPING_MASS, player.mass + definition.mass);
  const massGained = mass - player.mass;
  const popped = mass >= POPPING_MASS;
  return {
    player: {
      ...player,
      mass,
      score: player.score + definition.points,
      slopEaten: player.slopEaten + 1,
      status: popped ? "popped" : "alive",
      effect: popped ? null : definition.effect,
      effectExpiresAtMs: popped ? null : nowMs + definition.effectDurationMs,
    },
    events: [
      {
        type: "slop_eaten",
        kind,
        massGained,
        pointsGained: definition.points,
      },
      ...(popped ? [{ type: "popped" } as const] : []),
    ],
  };
}
