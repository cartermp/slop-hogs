import { FOOD_KINDS, type FoodKind } from "./food.ts";

export { FOOD_KINDS, type FoodKind } from "./food.ts";

export const RULES_VERSION = 2 as const;

export const MUTATION_IDS = [
  "glazed_eyes",
  "sparkle_sweats",
  "thought_leader_blazer",
  "veneer_grin",
  "cursor_eyes",
  "keyboard_spine",
  "free_range_frame",
  "mud_crown",
] as const;

export type MutationId = (typeof MUTATION_IDS)[number];
export type MutationSlot = "body" | "eyes" | "mouth" | "outfit" | "back" | "effect";

export const MUTATION_CATALOG: ReadonlyArray<{
  id: MutationId;
  name: string;
  description: string;
  slot: MutationSlot;
}> = [
  { id: "glazed_eyes", name: "Glazed Eyes", description: "Two enormous wet eyes, optimized for looking expensive.", slot: "eyes" },
  { id: "sparkle_sweats", name: "Sparkle Sweats", description: "An aura that insists every pore is premium.", slot: "effect" },
  { id: "thought_leader_blazer", name: "Thought Leader Blazer", description: "A tiny blazer with absolutely no sleeves or expertise.", slot: "outfit" },
  { id: "veneer_grin", name: "Veneer Grin", description: "A full set of confidence where the teeth should be.", slot: "mouth" },
  { id: "cursor_eyes", name: "Cursor Eyes", description: "One eye is still waiting for the rest of the answer.", slot: "eyes" },
  { id: "keyboard_spine", name: "Keyboard Spine", description: "A mechanical keyboard has become load-bearing.", slot: "back" },
  { id: "free_range_frame", name: "Free-Range Frame", description: "Alarmingly lean and burdened with situational awareness.", slot: "body" },
  { id: "mud_crown", name: "Mud Crown", description: "A green cap bestowed by the worst people online.", slot: "outfit" },
];

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
  recentMeals: FoodKind[];
  discoveries: MutationId[];
  equippedMutations: MutationId[];
  lastCleanedAtMs: number | null;
};

export type GameAction =
  | { type: "feed"; food: FoodKind }
  | { type: "clean" };

export type GameEvent =
  | { type: "time_passed"; hungerGained: number; mealsRegenerated: number }
  | { type: "fed"; food: FoodKind; digestionBonus: number }
  | { type: "favorite_changed"; favorite: FoodKind | null }
  | { type: "mutation_discovered"; mutation: MutationId; text: string }
  | { type: "cleaned"; filthRemoved: number; joyGained: number };

export type GameResult = { state: GameState; events: GameEvent[] };

export type GameErrorCode =
  | "INVALID_ACTION"
  | "INVALID_STATE"
  | "INVALID_TIME"
  | "NO_MEALS_AVAILABLE"
  | "ALREADY_CLEAN"
  | "CLEANING_COOLDOWN"
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
const RECENT_MEAL_LIMIT = 6;
const MEAL_REFILL_MS = 4 * 60 * 60 * 1_000;
const HUNGER_TICK_MS = 60 * 60 * 1_000;
export const CLEANING_COOLDOWN_MS = 4 * 60 * 60 * 1_000;
const UINT32_MAX = 0xffff_ffff;
const MAX_COUNTER = Number.MAX_SAFE_INTEGER;

const FOOD_EFFECTS: Record<FoodKind, HogStats> = {
  ai_image: { slop: 14, mass: 8, brain: -4, filth: 8, joy: 6 },
  generated_post: { slop: 12, mass: 6, brain: -5, filth: 5, joy: 7 },
  chatbot_screenshot: { slop: 10, mass: 5, brain: -3, filth: 6, joy: 5 },
  human_post: { slop: -5, mass: 2, brain: 4, filth: 1, joy: 1 },
  shitpost: { slop: 2, mass: 4, brain: 0, filth: 7, joy: 8 },
};

type MutationDefinition = {
  id: MutationId;
  slot: MutationSlot;
  food: FoodKind;
  discoverAt: number;
  retainAt: number;
  priority: number;
  incompatibleWith: readonly MutationId[];
  eventText: string;
};

// Recipes stay in this server-side rules module; only the recipe-free catalog is rendered.
const MUTATION_DEFINITIONS: readonly MutationDefinition[] = [
  {
    id: "glazed_eyes", slot: "eyes", food: "ai_image", discoverAt: 2, retainAt: 1, priority: 10,
    incompatibleWith: ["cursor_eyes"], eventText: "Its eyes glaze over. Somehow, this counts as polish.",
  },
  {
    id: "sparkle_sweats", slot: "effect", food: "ai_image", discoverAt: 4, retainAt: 3, priority: 10,
    incompatibleWith: [], eventText: "The hog begins sweating sparkles. They are not biodegradable.",
  },
  {
    id: "thought_leader_blazer", slot: "outfit", food: "generated_post", discoverAt: 2, retainAt: 1, priority: 10,
    incompatibleWith: ["mud_crown"], eventText: "A blazer forms around the hog before it has a single thought.",
  },
  {
    id: "veneer_grin", slot: "mouth", food: "generated_post", discoverAt: 4, retainAt: 3, priority: 10,
    incompatibleWith: [], eventText: "Every tooth becomes a talking point.",
  },
  {
    id: "cursor_eyes", slot: "eyes", food: "chatbot_screenshot", discoverAt: 2, retainAt: 1, priority: 20,
    incompatibleWith: ["glazed_eyes"], eventText: "A cursor starts blinking behind one eye.",
  },
  {
    id: "keyboard_spine", slot: "back", food: "chatbot_screenshot", discoverAt: 4, retainAt: 3, priority: 10,
    incompatibleWith: [], eventText: "Its spine rearranges into keys nobody should press.",
  },
  {
    id: "free_range_frame", slot: "body", food: "human_post", discoverAt: 2, retainAt: 1, priority: 10,
    incompatibleWith: [], eventText: "The hog develops posture and immediately regrets it.",
  },
  {
    id: "mud_crown", slot: "outfit", food: "shitpost", discoverAt: 2, retainAt: 1, priority: 20,
    incompatibleWith: ["thought_leader_blazer"], eventText: "The mud recognizes one of its own and grants a crown.",
  },
];

const definitionById = new Map(MUTATION_DEFINITIONS.map(definition => [definition.id, definition]));

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
    recentMeals: [],
    discoveries: [],
    equippedMutations: [],
    lastCleanedAtMs: null,
  };
}

export function parseGameAction(input: unknown): GameAction {
  if (!isRecord(input) || typeof input.type !== "string") {
    throw new GameError("INVALID_ACTION", "action must be an object with a supported type");
  }
  if (input.type === "clean") {
    if (!hasExactKeys(input, ["type"])) {
      throw new GameError("INVALID_ACTION", "clean action must contain only its type");
    }
    return { type: "clean" };
  }
  if (input.type !== "feed" || !hasExactKeys(input, ["type", "food"])) {
    throw new GameError("INVALID_ACTION", "feed action must contain exactly type and food");
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
  if (action.type === "clean") return applyCleanAction(advanced, serverTimeMs);
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
  const recentMeals = [...advanced.state.recentMeals, action.food].slice(-RECENT_MEAL_LIMIT);
  const events: GameEvent[] = [...advanced.events, { type: "fed", food: action.food, digestionBonus }];
  if (favorite !== previousFavorite) events.push({ type: "favorite_changed", favorite });

  const fedState: GameState = {
    ...advanced.state,
    rngState,
    updatedAtMs: serverTimeMs,
    mealsAvailable: advanced.state.mealsAvailable - 1,
    hunger: clamp(advanced.state.hunger - 18, 0, 100),
    stats,
    taste,
    mealsEaten: Math.min(MAX_COUNTER, advanced.state.mealsEaten + 1),
    recentMeals,
  };
  const resolved = resolveMutations(fedState);
  for (const mutation of resolved.newDiscoveries) {
    events.push({
      type: "mutation_discovered",
      mutation,
      text: definitionById.get(mutation)!.eventText,
    });
  }
  return { state: resolved.state, events };
}

function applyCleanAction(advanced: GameResult, serverTimeMs: number): GameResult {
  const { state } = advanced;
  if (state.lastCleanedAtMs !== null && serverTimeMs - state.lastCleanedAtMs < CLEANING_COOLDOWN_MS) {
    throw new GameError("CLEANING_COOLDOWN", "the wash trough needs time to drain");
  }
  if (state.stats.filth === 0) {
    throw new GameError("ALREADY_CLEAN", "the hog is already suspiciously clean");
  }
  const filthRemoved = Math.min(30, state.stats.filth);
  const joyGained = Math.min(4, 100 - state.stats.joy);
  return {
    state: {
      ...state,
      updatedAtMs: serverTimeMs,
      stats: {
        ...state.stats,
        filth: state.stats.filth - filthRemoved,
        joy: state.stats.joy + joyGained,
      },
      lastCleanedAtMs: serverTimeMs,
    },
    events: [...advanced.events, { type: "cleaned", filthRemoved, joyGained }],
  };
}

function resolveMutations(state: GameState): {
  state: GameState;
  newDiscoveries: MutationId[];
} {
  const counts = new Map<FoodKind, number>(FOOD_KINDS.map(food => [food, 0]));
  for (const food of state.recentMeals) counts.set(food, counts.get(food)! + 1);
  const discovered = new Set(state.discoveries);
  const equipped = new Set(state.equippedMutations);
  const newDiscoveries: MutationId[] = [];
  for (const definition of MUTATION_DEFINITIONS) {
    if (!discovered.has(definition.id) && counts.get(definition.food)! >= definition.discoverAt) {
      discovered.add(definition.id);
      newDiscoveries.push(definition.id);
    }
  }

  const candidates = MUTATION_DEFINITIONS
    .filter(definition => {
      if (!discovered.has(definition.id)) return false;
      const threshold = equipped.has(definition.id) ? definition.retainAt : definition.discoverAt;
      return counts.get(definition.food)! >= threshold;
    })
    .sort((left, right) => right.priority - left.priority);
  const selected: MutationDefinition[] = [];
  for (const candidate of candidates) {
    if (
      selected.some(existing => existing.slot === candidate.slot)
      || selected.some(existing => (
        existing.incompatibleWith.includes(candidate.id)
        || candidate.incompatibleWith.includes(existing.id)
      ))
    ) continue;
    selected.push(candidate);
  }
  const selectedIds = new Set(selected.map(definition => definition.id));
  return {
    state: {
      ...state,
      discoveries: MUTATION_IDS.filter(id => discovered.has(id)),
      equippedMutations: MUTATION_IDS.filter(id => selectedIds.has(id)),
    },
    newDiscoveries,
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
    "mealsAvailable", "hunger", "stats", "taste", "mealsEaten", "recentMeals",
    "discoveries", "equippedMutations", "lastCleanedAtMs",
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
  if (input.lastCleanedAtMs !== null) {
    assertTime(input.lastCleanedAtMs);
    if (input.lastCleanedAtMs > input.updatedAtMs) {
      throw new GameError("INVALID_STATE", "last cleaning cannot be in the future");
    }
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
  if (
    !Array.isArray(input.recentMeals)
    || input.recentMeals.length > RECENT_MEAL_LIMIT
    || input.recentMeals.some(food => typeof food !== "string" || !FOOD_KINDS.includes(food as FoodKind))
  ) {
    throw new GameError("INVALID_STATE", "recent meals are invalid");
  }
  const discoveries = parseMutationIds(input.discoveries, "discoveries");
  const equippedMutations = parseMutationIds(input.equippedMutations, "equippedMutations");
  const discovered = new Set(discoveries);
  if (equippedMutations.some(id => !discovered.has(id))) {
    throw new GameError("INVALID_STATE", "equipped mutations must be discovered");
  }
  const equippedDefinitions = equippedMutations.map(id => definitionById.get(id)!);
  if (new Set(equippedDefinitions.map(definition => definition.slot)).size !== equippedDefinitions.length) {
    throw new GameError("INVALID_STATE", "equipped mutations cannot share an appearance slot");
  }
  for (const definition of equippedDefinitions) {
    if (equippedMutations.some(id => definition.incompatibleWith.includes(id))) {
      throw new GameError("INVALID_STATE", "equipped mutations are incompatible");
    }
    const exposure = input.recentMeals.filter(food => food === definition.food).length;
    if (exposure < definition.retainAt) {
      throw new GameError("INVALID_STATE", "equipped mutation lacks recent food exposure");
    }
  }
  const state = input as GameState;
  const canonical = resolveMutations(state).state;
  if (
    JSON.stringify(canonical.discoveries) !== JSON.stringify(state.discoveries)
    || JSON.stringify(canonical.equippedMutations) !== JSON.stringify(state.equippedMutations)
  ) {
    throw new GameError("INVALID_STATE", "mutation state is not canonical for recent food exposure");
  }
  return state;
}

function parseMutationIds(input: unknown, name: string): MutationId[] {
  if (
    !Array.isArray(input)
    || input.length > MUTATION_IDS.length
    || input.some(id => typeof id !== "string" || !MUTATION_IDS.includes(id as MutationId))
    || new Set(input).size !== input.length
  ) {
    throw new GameError("INVALID_STATE", `${name} are invalid`);
  }
  return input as MutationId[];
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
