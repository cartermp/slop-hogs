import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SINGLE_PLAYER_ACHIEVEMENTS,
  eligibleSinglePlayerAchievements,
  emptySinglePlayerAchievementProgress,
  newlyEligibleSinglePlayerAchievements,
  recordSinglePlayerVictory,
} from "../src/lib/single-player-achievements.ts";
import {
  SINGLE_PLAYER_DIFFICULTY,
  advanceSinglePlayerState,
  applySinglePlayerAction,
  createSinglePlayerState,
  parseSinglePlayerAction,
  parseSinglePlayerState,
  singlePlayerRunStatus,
} from "../src/lib/single-player.ts";
import { KNOCKOUT_RUSH_DURATION_MS } from "../src/lib/farm-game.ts";

const NOW = 2_000_000;

test("single-player actions require a supported difficulty and bot target", () => {
  assert.deepEqual(parseSinglePlayerAction({ type: "start", difficulty: "hard" }), {
    type: "start",
    difficulty: "hard",
  });
  assert.deepEqual(parseSinglePlayerAction({ type: "bite", targetId: "bot-2" }), {
    type: "bite",
    targetId: "bot-2",
  });
  assert.deepEqual(parseSinglePlayerAction({ type: "fart" }), { type: "fart" });
  assert.throws(
    () => parseSinglePlayerAction({ type: "start", difficulty: "nightmare" }),
    /Invalid single-player action/,
  );
  assert.throws(
    () => parseSinglePlayerAction({ type: "bite", targetId: "another-player" }),
    /Invalid single-player action/,
  );
});

test("difficulty ramps bot count, durability, aggression, and slop supply gradually", () => {
  const easy = createSinglePlayerState("easy", NOW, 10);
  const medium = createSinglePlayerState("medium", NOW, 10);
  const hard = createSinglePlayerState("hard", NOW, 10);

  assert.deepEqual([easy.bots.length, medium.bots.length, hard.bots.length], [2, 3, 4]);
  assert.deepEqual([easy.bots[0].health, medium.bots[0].health, hard.bots[0].health], [68, 82, 96]);
  assert.deepEqual(
    [
      SINGLE_PLAYER_DIFFICULTY.easy.botDamage,
      SINGLE_PLAYER_DIFFICULTY.medium.botDamage,
      SINGLE_PLAYER_DIFFICULTY.hard.botDamage,
    ],
    [7, 9, 11],
  );
  assert.deepEqual(
    [
      SINGLE_PLAYER_DIFFICULTY.easy.botThinkMs,
      SINGLE_PLAYER_DIFFICULTY.medium.botThinkMs,
      SINGLE_PLAYER_DIFFICULTY.hard.botThinkMs,
    ],
    [1_250, 1_100, 900],
  );
  assert.deepEqual([easy.slop.length, medium.slop.length, hard.slop.length], [17, 15, 13]);
  assert.deepEqual(parseSinglePlayerState(JSON.parse(JSON.stringify(hard))), hard);
});

test("legacy easy runs remain loadable after the rebalance", () => {
  const legacy = createSinglePlayerState("easy", NOW, 11);
  legacy.bots.splice(1);
  legacy.slop.push({
    id: "legacy-extra-slop",
    kind: "premium_tokens",
    x: 480,
    y: 288,
    expiresAtMs: NOW + 10_000,
  });

  assert.deepEqual(parseSinglePlayerState(JSON.parse(JSON.stringify(legacy))), legacy);
});

test("CPU movement retains partial think time between syncs", () => {
  const state = createSinglePlayerState("easy", NOW, 22);
  const originalX = state.bots[0].x;
  const early = advanceSinglePlayerState(state, NOW + 900).state;
  assert.equal(early.bots[0].x, originalX);
  const moved = advanceSinglePlayerState(early, NOW + 1_600).state;
  assert.ok(moved.bots[0].x < originalX);
});

test("single-player state accepts positions clamped to the hog's actual radius", () => {
  const state = createSinglePlayerState("easy", NOW, 23);
  state.player.x = 15;
  state.player.y = 15;

  assert.deepEqual(parseSinglePlayerState(JSON.parse(JSON.stringify(state))), state);
  state.player.x = 14.99;
  assert.throws(() => parseSinglePlayerState(state), /Invalid single-player state/);
});

test("gaining mass at the boundary keeps persisted coordinates valid", () => {
  const state = createSinglePlayerState("easy", NOW, 25);
  state.player.x = 15;
  state.player.y = 15;
  state.slop = [{
    id: "boundary-slop",
    kind: "context_overflow",
    x: 15,
    y: 15,
    expiresAtMs: NOW + 10_000,
  }];

  const result = applySinglePlayerAction(state, { type: "move", dx: -1, dy: 0 }, NOW + 240);
  assert.ok(result.state.player.x > 15);
  assert.doesNotThrow(() => parseSinglePlayerState(JSON.parse(JSON.stringify(result.state))));
});

test("context overflow blocks four points of CPU attack damage", () => {
  const state = createSinglePlayerState("easy", NOW, 24);
  state.player.effect = "glitchy";
  state.player.effectExpiresAtMs = NOW + 10_000;
  state.bots[0].x = state.player.x + 10;
  state.bots[0].y = state.player.y;

  const result = advanceSinglePlayerState(state, NOW + SINGLE_PLAYER_DIFFICULTY.easy.botThinkMs);
  const attack = result.events.find(event => event.type === "bot_attack");
  const expectedDamage = SINGLE_PLAYER_DIFFICULTY.easy.botDamage - 4;
  assert.equal(attack?.type === "bot_attack" && attack.damage, expectedDamage);
  assert.equal(result.state.player.health, 100 - expectedDamage);
  assert.equal(result.state.playerDamageTaken, expectedDamage);
});

test("CPU hogs fight each other while a hunter pressures the player", () => {
  const state = createSinglePlayerState("easy", NOW, 31);
  for (const combatant of [state.player, ...state.bots]) {
    combatant.x = 480;
    combatant.y = 288;
  }

  const result = advanceSinglePlayerState(state, NOW + SINGLE_PLAYER_DIFFICULTY.easy.botThinkMs);
  assert.ok(result.events.some(event => event.type === "bot_attack"));
  assert.ok(result.events.some(event => event.type === "bot_battle"));
  assert.ok(result.state.player.health < 100);
  assert.ok(result.state.bots.some(bot => bot.health < SINGLE_PLAYER_DIFFICULTY.easy.botHealth));
});

test("CPU hogs earn a knockout rush for defeating each other", () => {
  const state = createSinglePlayerState("easy", NOW, 32);
  for (const combatant of [state.player, ...state.bots]) {
    combatant.x = 480;
    combatant.y = 288;
  }
  for (const bot of state.bots) bot.health = 1;

  const stepAt = NOW + SINGLE_PLAYER_DIFFICULTY.easy.botThinkMs;
  const result = advanceSinglePlayerState(state, stepAt);
  const survivor = result.state.bots.find(bot => bot.status === "alive");
  assert.ok(result.events.some(event => event.type === "bot_battle" && event.targetDefeated));
  assert.equal(survivor?.knockouts, 1);
  assert.equal(survivor?.score, 250);
  assert.equal(survivor?.knockoutRushExpiresAtMs, stepAt + KNOCKOUT_RUSH_DURATION_MS);
});

test("defeating every CPU hog wins the run and awards a knockout rush", () => {
  const state = createSinglePlayerState("easy", NOW, 33);
  for (const bot of state.bots.slice(1)) {
    bot.health = 0;
    bot.status = "defeated";
  }
  state.bots[0].x = state.player.x + 10;
  state.bots[0].y = state.player.y;
  state.bots[0].health = 1;
  const attackAt = NOW + 100;
  const result = applySinglePlayerAction(state, { type: "fart", targetId: "bot-1" }, attackAt);

  assert.equal(singlePlayerRunStatus(result.state), "won");
  assert.equal(result.state.player.knockouts, 1);
  assert.equal(result.state.player.score, 250);
  assert.equal(result.state.player.knockoutRushExpiresAtMs, attackAt + KNOCKOUT_RUSH_DURATION_MS);
  assert.ok(result.events.some(event => event.type === "knockout_rush"));
  assert.ok(result.events.some(event => event.type === "victory"));
});

test("single-player achievements are separate and track all three difficulties", () => {
  assert.equal(SINGLE_PLAYER_ACHIEVEMENTS.length, 12);
  assert.equal(new Set(SINGLE_PLAYER_ACHIEVEMENTS.map(achievement => achievement.id)).size, 12);
  const empty = emptySinglePlayerAchievementProgress();
  const easy = recordSinglePlayerVictory({ ...empty, gamesStarted: 1 }, "easy", true);
  const medium = recordSinglePlayerVictory(easy, "medium", false);
  const hard = recordSinglePlayerVictory(medium, "hard", false);
  const newUnlocks = newlyEligibleSinglePlayerAchievements(medium, hard);

  assert.ok(eligibleSinglePlayerAchievements(hard).some(item => item.id === "solo-difficulty-spike"));
  assert.ok(newUnlocks.some(item => item.id === "solo-difficulty-spike"));
  assert.ok(eligibleSinglePlayerAchievements(easy).some(item => item.id === "solo-clean-plate"));
});
