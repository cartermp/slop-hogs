import { FOOD_KINDS, applyGameAction, createGameState, favoriteFood } from "../src/lib/game.ts";

const start = Date.UTC(2026, 0, 1);
const results = FOOD_KINDS.map((food) => {
  let state = createGameState(start, 100);
  for (let meal = 0; meal < 6; meal += 1) {
    state = applyGameAction(state, { type: "feed", food }, start).state;
  }
  return {
    diet: food,
    mass: state.stats.mass,
    slop: state.stats.slop,
    brain: state.stats.brain,
    filth: state.stats.filth,
    joy: state.stats.joy,
    favorite: favoriteFood(state.taste),
  };
});

console.table(results);
