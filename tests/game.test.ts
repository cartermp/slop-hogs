import assert from "node:assert/strict";
import { test } from "node:test";
import {
  FOOD_KINDS,
  MUTATION_IDS,
  ENDING_MIN_MEALS,
  GameError,
  advanceGameTime,
  applyGameAction,
  createGameState,
  favoriteFood,
  parseGameAction,
  parseGameState,
  type FoodKind,
  type GameState,
} from "../src/lib/game.ts";

const START = Date.UTC(2026, 0, 1);
const HOUR = 60 * 60 * 1_000;

test("the same state, action, time, and seed replay exactly", () => {
  const state = createGameState(START, 42);
  const first = applyGameAction(state, { type: "feed", food: "ai_image" }, START);
  const savedAndLoaded = JSON.parse(JSON.stringify(state));
  const replay = applyGameAction(savedAndLoaded, { type: "feed", food: "ai_image" }, START);
  assert.deepEqual(first, replay);
  assert.deepEqual(state, createGameState(START, 42), "the input state remains unchanged");
});

test("five diets produce distinct outcomes", () => {
  const outcomes = new Map<string, FoodKind>();
  for (const food of FOOD_KINDS) {
    const { state } = applyGameAction(createGameState(START, 42), { type: "feed", food }, START);
    const signature = JSON.stringify(state.stats);
    assert.equal(outcomes.has(signature), false, `${food} duplicated ${outcomes.get(signature)}`);
    outcomes.set(signature, food);
    assert.equal(favoriteFood(state.taste), food);
  }
  assert.equal(outcomes.size, 5);
});

test("the first session discovers mutations and sustained diets control equipped slots", () => {
  let state = createGameState(START, 23);
  state = applyGameAction(state, { type: "feed", food: "ai_image" }, START).state;
  assert.deepEqual(state.discoveries, []);
  const second = applyGameAction(state, { type: "feed", food: "ai_image" }, START);
  assert.deepEqual(second.state.discoveries, ["glazed_eyes"]);
  assert.deepEqual(second.state.equippedMutations, ["glazed_eyes"]);
  assert.deepEqual(second.events.at(-1), {
    type: "mutation_discovered",
    mutation: "glazed_eyes",
    text: "Its eyes glaze over. Somehow, this counts as polish.",
  });

  state = applyGameAction(second.state, { type: "feed", food: "generated_post" }, START).state;
  assert.ok(state.equippedMutations.includes("glazed_eyes"), "one off-diet meal cannot remove a mutation");
  state = applyGameAction(state, { type: "feed", food: "chatbot_screenshot" }, START).state;
  state = applyGameAction(state, { type: "feed", food: "chatbot_screenshot" }, START).state;
  assert.ok(state.discoveries.includes("cursor_eyes"));
  assert.ok(state.equippedMutations.includes("cursor_eyes"));
  assert.equal(state.equippedMutations.includes("glazed_eyes"), false, "incompatible eyes use slot priority");
});

test("all eight authored mutations are collectable across deliberate diets", () => {
  let state = createGameState(START, 101);
  let now = START;
  const meals: FoodKind[] = [
    ...Array<FoodKind>(4).fill("ai_image"),
    ...Array<FoodKind>(4).fill("generated_post"),
    ...Array<FoodKind>(4).fill("chatbot_screenshot"),
    ...Array<FoodKind>(2).fill("human_post"),
    ...Array<FoodKind>(2).fill("shitpost"),
  ];
  for (const food of meals) {
    if (state.mealsAvailable === 0) {
      now += 24 * HOUR;
      state = advanceGameTime(state, now).state;
    }
    state = applyGameAction(state, { type: "feed", food }, now).state;
  }
  assert.deepEqual(state.discoveries, MUTATION_IDS);
  assert.ok(state.equippedMutations.includes("mud_crown"));
  assert.ok(state.equippedMutations.includes("free_range_frame"));
});

test("cleaning is useful, paced, and does not consume a meal", () => {
  const fed = applyGameAction(
    createGameState(START, 12),
    { type: "feed", food: "shitpost" },
    START,
  ).state;
  const cleaned = applyGameAction(fed, { type: "clean" }, START);
  assert.equal(cleaned.state.mealsAvailable, fed.mealsAvailable);
  assert.equal(cleaned.state.stats.filth, 0);
  assert.deepEqual(cleaned.events, [{ type: "cleaned", filthRemoved: 7, joyGained: 4 }]);
  assert.throws(
    () => applyGameAction(cleaned.state, { type: "clean" }, START),
    (error: unknown) => error instanceof GameError && error.code === "CLEANING_COOLDOWN",
  );
  assert.throws(
    () => applyGameAction(createGameState(START, 12), { type: "clean" }, START),
    (error: unknown) => error instanceof GameError && error.code === "ALREADY_CLEAN",
  );
});

test("sustained slop records one ending and freezes the terminal state", () => {
  const nearlyFinished: GameState = {
    ...createGameState(START, 91),
    stats: { slop: 99, mass: 120, brain: 40, filth: 80, joy: 90 },
    mealsEaten: ENDING_MIN_MEALS - 1,
  };
  const ended = applyGameAction(
    nearlyFinished,
    { type: "feed", food: "ai_image" },
    START,
  );
  assert.deepEqual(ended.state.ending, {
    id: "slop_overload",
    endedAtMs: START,
    cause: "One hundred percent slop",
    epitaph: "It ate the feed. The feed ate back.",
  });
  assert.deepEqual(ended.events.filter(event => event.type === "life_ended"), [{
    type: "life_ended",
    ending: "slop_overload",
    name: "Slop Overload",
    cause: "One hundred percent slop",
    epitaph: "It ate the feed. The feed ate back.",
  }]);
  assert.deepEqual(
    advanceGameTime(ended.state, START + 30 * 24 * HOUR),
    { state: ended.state, events: [] },
    "elapsed reads cannot alter a terminal state",
  );
  assert.throws(
    () => applyGameAction(ended.state, { type: "feed", food: "shitpost" }, START),
    (error: unknown) => error instanceof GameError && error.code === "LIFE_ENDED",
  );
});

test("meal capacity is enforced and refills one meal every four hours", () => {
  let state = createGameState(START, 7);
  for (let meal = 0; meal < 6; meal += 1) {
    state = applyGameAction(state, { type: "feed", food: "shitpost" }, START).state;
  }
  assert.equal(state.mealsAvailable, 0);
  assert.throws(
    () => applyGameAction(state, { type: "feed", food: "shitpost" }, START),
    (error: unknown) => error instanceof GameError && error.code === "NO_MEALS_AVAILABLE",
  );
  assert.equal(advanceGameTime(state, START + 4 * HOUR - 1).state.mealsAvailable, 0);
  const refilled = advanceGameTime(state, START + 4 * HOUR);
  assert.equal(refilled.state.mealsAvailable, 1);
  assert.deepEqual(refilled.events, [{ type: "time_passed", hungerGained: 12, mealsRegenerated: 1 }]);
});

test("long elapsed time caps hunger and does not bank a refill at full capacity", () => {
  const initial = createGameState(START, 11);
  const afterWeek = advanceGameTime(initial, START + 7 * 24 * HOUR).state;
  assert.equal(afterWeek.hunger, 100);
  assert.equal(afterWeek.mealsAvailable, 6);
  const fed = applyGameAction(afterWeek, { type: "feed", food: "human_post" }, START + 7 * 24 * HOUR).state;
  assert.equal(fed.mealsAvailable, 5);
  assert.equal(advanceGameTime(fed, START + 7 * 24 * HOUR + 1).state.mealsAvailable, 5);
});

test("time cannot go backward", () => {
  const state = createGameState(START, 1);
  assert.throws(
    () => advanceGameTime(state, START - 1),
    (error: unknown) => error instanceof GameError && error.code === "INVALID_TIME",
  );
});

test("actions and saved states reject missing, unknown, and inconsistent data", () => {
  for (const action of [
    null,
    {},
    { type: "feed" },
    { type: "feed", food: "money" },
    { type: "feed", food: "ai_image", extra: true },
    { type: "clean", extra: true },
  ]) {
    assert.throws(() => parseGameAction(action), /action|food/);
  }
  assert.deepEqual(parseGameAction({ type: "clean" }), { type: "clean" });
  const valid = createGameState(START, 9);
  for (const state of [
    null,
    { ...valid, rulesVersion: 1 },
    { ...valid, extra: true },
    { ...valid, hunger: 101 },
    { ...valid, rngState: -1 },
    { ...valid, stats: { ...valid.stats, mass: 0 } },
    { ...valid, taste: { ...valid.taste, ai_image: -1 } },
    { ...valid, recentMeals: ["money"] },
    { ...valid, discoveries: ["glazed_eyes", "glazed_eyes"] },
    { ...valid, equippedMutations: ["glazed_eyes"] },
    {
      ...valid,
      recentMeals: ["ai_image", "ai_image", "chatbot_screenshot", "chatbot_screenshot"],
      discoveries: ["glazed_eyes", "cursor_eyes"],
      equippedMutations: ["glazed_eyes", "cursor_eyes"],
    },
  ]) assert.throws(() => parseGameState(state));
});

test("favorite requires a unique lifetime leader", () => {
  let state: GameState = createGameState(START, 5);
  assert.equal(favoriteFood(state.taste), null);
  state = applyGameAction(state, { type: "feed", food: "ai_image" }, START).state;
  assert.equal(favoriteFood(state.taste), "ai_image");
  state = applyGameAction(state, { type: "feed", food: "human_post" }, START).state;
  assert.equal(favoriteFood(state.taste), null);
});
