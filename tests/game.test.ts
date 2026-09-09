import assert from "node:assert/strict";
import { test } from "node:test";
import {
  FOOD_KINDS, GameError, advanceGameTime, applyGameAction, createGameState,
  favoriteFood, parseGameAction, parseGameState, type FoodKind, type GameState,
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

test("actions and saved states reject missing, unknown, and unsupported data", () => {
  for (const action of [null, {}, { type: "feed" }, { type: "feed", food: "money" }, { type: "feed", food: "ai_image", extra: true }]) {
    assert.throws(() => parseGameAction(action), /action|food/);
  }
  const valid = createGameState(START, 9);
  for (const state of [
    null,
    { ...valid, rulesVersion: 2 },
    { ...valid, extra: true },
    { ...valid, hunger: 101 },
    { ...valid, rngState: -1 },
    { ...valid, stats: { ...valid.stats, mass: 0 } },
    { ...valid, taste: { ...valid.taste, ai_image: -1 } },
  ]) assert.throws(() => parseGameState(state));
});

test("favorite requires a unique leader", () => {
  let state: GameState = createGameState(START, 5);
  assert.equal(favoriteFood(state.taste), null);
  state = applyGameAction(state, { type: "feed", food: "ai_image" }, START).state;
  assert.equal(favoriteFood(state.taste), "ai_image");
  state = applyGameAction(state, { type: "feed", food: "human_post" }, START).state;
  assert.equal(favoriteFood(state.taste), null);
});
