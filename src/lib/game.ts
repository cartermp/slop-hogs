export const RULES_VERSION = 1 as const;

export const FOOD_KINDS = [
  "ai_image",
  "generated_post",
  "chatbot_screenshot",
  "human_post",
  "shitpost",
] as const;

export type FoodKind = (typeof FOOD_KINDS)[number];

export type HogStats = { slop: number; mass: number; brain: number; filth: number; joy: number };
export type Taste = Record<FoodKind, number>;

export type GameState = {
  rulesVersion: typeof RULES_VERSION;
  rngState: number;
  updatedAtMs: number;
  hungerTickAtMs: number;
  mealRefillAtMs: number;
  mealsAvailable: number;
  hunger: number;
  stats: HogStats;
  taste: Taste;
  mealsEaten: number;
};

export type GameAction = { type: "feed"; food: FoodKind };

export type GameEvent =
  | { type: "time_passed"; hungerGained: number; mealsRegenerated: number }
  | { type: "fed"; food: FoodKind; digestionBonus: number }
  | { type: "favorite_changed"; favorite: FoodKind | null };

export type GameResult = { state: GameState; events: GameEvent[] };

export type GameErrorCode =
  | "INVALID_ACTION"
  | "INVALID_STATE"
  | "INVALID_TIME"
  | "NO_MEALS_AVAILABLE"
  | "UNSUPPORTED_RULES_VERSION";

export class GameError extends Error {
  readonly code: GameErrorCode;

  constructor(code: GameErrorCode, message: string) {
    super(message);
    this.name = "GameError";
    this.code = code;
  }
}

const MAX_MEALS = 6;
const MEAL_REFILL_MS = 4 * 60 * 60 * 1_000;
const HUNGER_TICK_MS = 60 * 60 * 1_000;
const UINT32_MAX = 0xffff_ffff;
const MAX_COUNTER = Number.MAX_SAFE_INTEGER;

const FOOD_EFFECTS: Record<FoodKind, HogStats> = {
  ai_image: { slop: 14, mass: 8, brain: -4, filth: 8, joy: 6 },
  generated_post: { slop: 12, mass: 6, brain: -5, filth: 5, joy: 7 },
  chatbot_screenshot: { slop: 10, mass: 5, brain: -3, filth: 6, joy: 5 },
  human_post: { slop: -5, mass: 2, brain: 4, filth: 1, joy: 1 },
  shitpost: { slop: 2, mass: 4, brain: 0, filth: 7, joy: 8 },
};

const emptyTaste = (): Taste => ({
  ai_image: 0,
  generated_post: 0,
  chatbot_screenshot: 0,
  human_post: 0,
  shitpost: 0,
});

export function createGameState(serverTimeMs: number, seed: number): GameState {
  assertTime(serverTimeMs);
  assertUint32(seed, "seed");
  if (seed === 0) throw new GameError("INVALID_STATE", "seed must not be zero");
  return {
    rulesVersion: RULES_VERSION,
    rngState: seed,
    updatedAtMs: serverTimeMs,
    hungerTickAtMs: serverTimeMs,
    mealRefillAtMs: serverTimeMs,
    mealsAvailable: MAX_MEALS,
    hunger: 20,
    stats: { slop: 0, mass: 20, brain: 100, filth: 0, joy: 50 },
    taste: emptyTaste(),
    mealsEaten: 0,
  };
}

export function parseGameAction(input: unknown): GameAction {
  if (!isRecord(input) || Object.keys(input).length !== 2 || input.type !== "feed") {
    throw new GameError("INVALID_ACTION", "action must be a feed action with exactly type and food");
  }
  if (typeof input.food !== "string" || !FOOD_KINDS.includes(input.food as FoodKind)) {
    throw new GameError("INVALID_ACTION", "food is not supported by this rules version");
  }
  return { type: "feed", food: input.food as FoodKind };
}

export function applyGameAction(savedState: unknown, actionInput: unknown, serverTimeMs: number): GameResult {
  const state = parseGameState(savedState);
  const action = parseGameAction(actionInput);
  const advanced = advanceGameTime(state, serverTimeMs);
  if (advanced.state.mealsAvailable === 0) {
    throw new GameError("NO_MEALS_AVAILABLE", "the hog has eaten all available meals");
  }

  const previousFavorite = favoriteFood(advanced.state.taste);
  const [rngState, digestionBonus] = nextDigestionBonus(advanced.state.rngState);
  const effect = FOOD_EFFECTS[action.food];
  const stats: HogStats = {
    slop: clamp(advanced.state.stats.slop + effect.slop, 0, 100),
    mass: clamp(advanced.state.stats.mass + effect.mass + digestionBonus, 1, 10_000),
    brain: clamp(advanced.state.stats.brain + effect.brain, 0, 100),
    filth: clamp(advanced.state.stats.filth + effect.filth, 0, 100),
    joy: clamp(advanced.state.stats.joy + effect.joy, 0, 100),
  };
  const taste = {
    ...advanced.state.taste,
    [action.food]: Math.min(MAX_COUNTER, advanced.state.taste[action.food] + 1),
  };
  const favorite = favoriteFood(taste);
  const events: GameEvent[] = [...advanced.events, { type: "fed", food: action.food, digestionBonus }];
  if (favorite !== previousFavorite) events.push({ type: "favorite_changed", favorite });

  return {
    state: {
      ...advanced.state,
      rngState,
      updatedAtMs: serverTimeMs,
      mealsAvailable: advanced.state.mealsAvailable - 1,
      hunger: clamp(advanced.state.hunger - 18, 0, 100),
      stats,
      taste,
      mealsEaten: Math.min(MAX_COUNTER, advanced.state.mealsEaten + 1),
    },
    events,
  };
}

export function advanceGameTime(savedState: unknown, serverTimeMs: number): GameResult {
  const state = parseGameState(savedState);
  assertTime(serverTimeMs);
  if (serverTimeMs < state.updatedAtMs) {
    throw new GameError("INVALID_TIME", "server time cannot move backward");
  }

  const hungerTicks = Math.floor((serverTimeMs - state.hungerTickAtMs) / HUNGER_TICK_MS);
  const refillTicks = Math.floor((serverTimeMs - state.mealRefillAtMs) / MEAL_REFILL_MS);
  const mealsRegenerated = Math.min(MAX_MEALS - state.mealsAvailable, refillTicks);
  const hungerGained = Math.min(100 - state.hunger, hungerTicks * 3);
  const mealsAvailable = state.mealsAvailable + mealsRegenerated;
  const next: GameState = {
    ...state,
    updatedAtMs: serverTimeMs,
    hungerTickAtMs: state.hungerTickAtMs + hungerTicks * HUNGER_TICK_MS,
    mealRefillAtMs: mealsAvailable === MAX_MEALS ? serverTimeMs : state.mealRefillAtMs + refillTicks * MEAL_REFILL_MS,
    mealsAvailable,
    hunger: state.hunger + hungerGained,
  };
  const events: GameEvent[] = [];
  if (hungerGained > 0 || mealsRegenerated > 0) {
    events.push({ type: "time_passed", hungerGained, mealsRegenerated });
  }
  return { state: next, events };
}

export function favoriteFood(taste: Taste): FoodKind | null {
  let favorite: FoodKind | null = null;
  let highScore = 0;
  let tied = false;
  for (const food of FOOD_KINDS) {
    if (taste[food] > highScore) {
      favorite = food;
      highScore = taste[food];
      tied = false;
    } else if (taste[food] === highScore && highScore > 0) {
      tied = true;
    }
  }
  return tied ? null : favorite;
}

export function parseGameState(input: unknown): GameState {
  if (!isRecord(input)) throw new GameError("INVALID_STATE", "saved state must be an object");
  if (input.rulesVersion !== RULES_VERSION) {
    throw new GameError("UNSUPPORTED_RULES_VERSION", "saved state uses an unsupported rules version");
  }
  const expected = [
    "rulesVersion", "rngState", "updatedAtMs", "hungerTickAtMs", "mealRefillAtMs",
    "mealsAvailable", "hunger", "stats", "taste", "mealsEaten",
  ];
  if (!hasExactKeys(input, expected)) throw new GameError("INVALID_STATE", "saved state has missing or unknown fields");

  assertUint32(input.rngState, "rngState");
  assertTime(input.updatedAtMs);
  assertTime(input.hungerTickAtMs);
  assertTime(input.mealRefillAtMs);
  assertIntegerInRange(input.mealsAvailable, 0, MAX_MEALS, "mealsAvailable");
  assertIntegerInRange(input.hunger, 0, 100, "hunger");
  assertIntegerInRange(input.mealsEaten, 0, MAX_COUNTER, "mealsEaten");
  if (input.hungerTickAtMs > input.updatedAtMs || input.mealRefillAtMs > input.updatedAtMs) {
    throw new GameError("INVALID_STATE", "state clock anchors cannot be in the future");
  }

  if (!isRecord(input.stats) || !hasExactKeys(input.stats, ["slop", "mass", "brain", "filth", "joy"])) {
    throw new GameError("INVALID_STATE", "stats have missing or unknown fields");
  }
  assertIntegerInRange(input.stats.slop, 0, 100, "slop");
  assertIntegerInRange(input.stats.mass, 1, 10_000, "mass");
  assertIntegerInRange(input.stats.brain, 0, 100, "brain");
  assertIntegerInRange(input.stats.filth, 0, 100, "filth");
  assertIntegerInRange(input.stats.joy, 0, 100, "joy");

  if (!isRecord(input.taste) || !hasExactKeys(input.taste, [...FOOD_KINDS])) {
    throw new GameError("INVALID_STATE", "taste has missing or unknown food kinds");
  }
  for (const food of FOOD_KINDS) {
    assertIntegerInRange(input.taste[food], 0, MAX_COUNTER, `taste.${food}`);
  }
  return input as GameState;
}

function nextDigestionBonus(state: number): [number, number] {
  const next = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
  return [next, next % 3];
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function assertTime(value: unknown): asserts value is number {
  assertIntegerInRange(value, 0, 8_640_000_000_000_000, "server time");
}

function assertUint32(value: unknown, name: string): asserts value is number {
  assertIntegerInRange(value, 0, UINT32_MAX, name);
}

function assertIntegerInRange(value: unknown, minimum: number, maximum: number, name: string): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new GameError("INVALID_STATE", `${name} must be an integer from ${minimum} through ${maximum}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}
