import assert from "node:assert/strict";
import { test } from "node:test";
import {
  FARM_HEIGHT,
  FARM_WIDTH,
  MAX_HEALTH,
  POPPING_MASS,
  SLOP_CATALOG,
  applySlop,
  decayPsychosis,
  hogDiameter,
  battleRange,
  movePlayer,
  parseFarmAction,
  resolveBattleAttack,
  touchingSlop,
  type FarmPlayer,
} from "../src/lib/farm-game.ts";

const NOW = Date.UTC(2026, 8, 11);

function player(overrides: Partial<FarmPlayer> = {}): FarmPlayer {
  return {
    id: "8f22dca7-6df0-4a8c-aee6-60bc86b4866c",
    name: "HOG-8F22",
    x: 480,
    y: 288,
    facing: "right",
    mass: 24,
    score: 0,
    slopEaten: 0,
    health: MAX_HEALTH,
    knockouts: 0,
    status: "alive",
    effect: null,
    effectExpiresAtMs: null,
    updatedAtMs: NOW,
    isYou: true,
    ...overrides,
  };
}

test("farm actions accept only bounded directional input and restart", () => {
  assert.deepEqual(parseFarmAction({ type: "move", dx: -1, dy: 1 }), { type: "move", dx: -1, dy: 1 });
  assert.deepEqual(
    parseFarmAction({ type: "bite", targetId: "8f22dca7-6df0-4a8c-aee6-60bc86b4866c" }),
    { type: "bite", targetId: "8f22dca7-6df0-4a8c-aee6-60bc86b4866c" },
  );
  assert.deepEqual(parseFarmAction({ type: "restart" }), { type: "restart" });
  for (const action of [
    null,
    {},
    { type: "move", dx: 2, dy: 0 },
    { type: "move", dx: 0, dy: 0 },
    { type: "move", dx: 1, dy: 0, x: 500 },
    { type: "fart", targetId: "not-a-player" },
    { type: "bite", targetId: "8f22dca7-6df0-4a8c-aee6-60bc86b4866c", damage: 99 },
    { type: "restart", now: NOW },
  ]) assert.throws(() => parseFarmAction(action), /Invalid farm action/);
});

test("movement is normalized, time-capped, effect-aware, and kept inside the farm", () => {
  const base = { ...player(), lastMovedAtMs: NOW - 100 };
  const straight = movePlayer(base, { type: "move", dx: 1, dy: 0 }, NOW);
  const diagonal = movePlayer(base, { type: "move", dx: 1, dy: 1 }, NOW);
  assert.ok(Math.abs((straight.x - base.x) - Math.hypot(diagonal.x - base.x, diagonal.y - base.y)) < 0.001);
  const turbo = movePlayer(
    { ...base, effect: "turbo" as const, effectExpiresAtMs: NOW + 1_000 },
    { type: "move", dx: 1, dy: 0 },
    NOW,
  );
  assert.ok(turbo.x > straight.x);
  const tooSoon = movePlayer(
    { ...base, lastMovedAtMs: NOW },
    { type: "move", dx: 1, dy: 0 },
    NOW,
  );
  assert.equal(tooSoon.x, base.x, "rapid requests cannot manufacture extra movement time");
  const bounded = movePlayer(
    { ...base, x: FARM_WIDTH - 1, y: FARM_HEIGHT - 1, lastMovedAtMs: NOW - 10_000 },
    { type: "move", dx: 1, dy: 1 },
    NOW,
  );
  const radius = hogDiameter(base.mass) / 2;
  assert.equal(bounded.x, FARM_WIDTH - radius);
  assert.equal(bounded.y, FARM_HEIGHT - radius);
});

test("movement becomes increasingly erratic above 50 percent psychosis", () => {
  const halfwayMass = 24 + (POPPING_MASS - 24) / 2;
  const calm = { ...player({ mass: halfwayMass }), lastMovedAtMs: NOW - 100 };
  const calmMove = movePlayer(calm, { type: "move", dx: 1, dy: 0 }, NOW);
  assert.equal(calmMove.y, calm.y);

  const frantic = { ...player({ mass: 99 }), lastMovedAtMs: NOW - 100 };
  const first = movePlayer(frantic, { type: "move", dx: 1, dy: 0 }, NOW);
  const second = movePlayer(
    { ...frantic, lastMovedAtMs: NOW + 20 },
    { type: "move", dx: 1, dy: 0 },
    NOW + 120,
  );
  assert.notEqual(first.y, frantic.y);
  assert.notEqual(second.y - frantic.y, first.y - frantic.y);
});

test("psychosis decays over elapsed time without dropping below the starting level", () => {
  const elevated = {
    mass: 40,
    status: "alive" as const,
    psychosisUpdatedAtMs: NOW,
  };
  assert.deepEqual(decayPsychosis(elevated, NOW + 1_999), elevated);
  assert.deepEqual(decayPsychosis(elevated, NOW + 4_500), {
    ...elevated,
    mass: 38,
    psychosisUpdatedAtMs: NOW + 4_000,
  });
  assert.deepEqual(decayPsychosis(
    { ...elevated, mass: 25 },
    NOW + 10_000,
  ), {
    ...elevated,
    mass: 24,
    psychosisUpdatedAtMs: NOW + 10_000,
  });
  const popped = { ...elevated, mass: 100, status: "popped" as const };
  assert.deepEqual(decayPsychosis(popped, NOW + 10_000), popped);
});
test("slop collision chooses the nearest pickup within the hog radius", () => {
  const near = { id: "near", kind: "premium_tokens" as const, x: 500, y: 288, expiresAtMs: NOW + 1_000 };
  const nearer = { id: "nearer", kind: "model_collapse" as const, x: 490, y: 288, expiresAtMs: NOW + 1_000 };
  const far = { id: "far", kind: "recursive_prompt" as const, x: 800, y: 288, expiresAtMs: NOW + 1_000 };
  assert.equal(touchingSlop(player(), [near, nearer, far])?.id, "nearer");
  assert.equal(touchingSlop(player(), [far]), null);
});

test("every slop kind has a distinct effect and enough mass pops the hog exactly once", () => {
  assert.equal(new Set(Object.values(SLOP_CATALOG).map(item => item.effect)).size, 5);
  const almostPopped = player({ mass: 90, score: 20, slopEaten: 4 });
  const result = applySlop(almostPopped, "context_overflow", NOW);
  assert.equal(result.player.mass, POPPING_MASS);
  assert.equal(result.player.status, "popped");
  assert.equal(result.player.effect, null);
  assert.deepEqual(result.events.map(event => event.type), ["slop_eaten", "popped"]);
  assert.equal(result.events[0].type === "slop_eaten" && result.events[0].massGained, 10);
  assert.deepEqual(applySlop(result.player, "premium_tokens", NOW), { player: result.player, events: [] });
});

test("bite hits harder at the cost of psychosis while fart releases it", () => {
  const attacker = { mass: 60, health: 100, status: "alive" as const, effect: null };
  const target = { mass: 24, health: 100, status: "alive" as const, effect: null };
  const bite = resolveBattleAttack(attacker, target, "bite");
  const fart = resolveBattleAttack(attacker, target, "fart");
  assert.ok(bite.damage > fart.damage);
  assert.equal(bite.psychosisDelta, 7);
  assert.equal(fart.psychosisDelta, -10);
  assert.equal(bite.target.health, 100 - bite.damage);
  assert.equal(fart.target.health, 100 - fart.damage);
});

test("slop effects grant distinct battle bonuses", () => {
  const base = { mass: 48, health: 100, status: "alive" as const, effect: null };
  const target = { ...base };
  const bite = resolveBattleAttack(base, target, "bite");
  const fart = resolveBattleAttack(base, target, "fart");
  assert.equal(resolveBattleAttack({ ...base, effect: "collapsed" }, target, "bite").damage, bite.damage + 7);
  assert.equal(resolveBattleAttack({ ...base, effect: "recursive" }, target, "fart").damage, fart.damage + 6);
  assert.equal(resolveBattleAttack({ ...base, effect: "premium" }, target, "bite").damage, bite.damage + 3);
  assert.equal(resolveBattleAttack(base, { ...target, effect: "glitchy" }, "bite").damage, bite.damage - 4);
  assert.equal(
    battleRange("bite", { mass: base.mass, effect: "turbo" }, target),
    battleRange("bite", base, target) + 40,
  );
});

test("battle attacks can defeat a target or pop the attacker", () => {
  const fragile = { mass: 24, health: 1, status: "alive" as const, effect: null };
  const knockout = resolveBattleAttack(
    { mass: 50, health: 100, status: "alive" as const, effect: null },
    fragile,
    "fart",
  );
  assert.equal(knockout.target.status, "defeated");
  assert.equal(knockout.targetDefeated, true);

  const pop = resolveBattleAttack(
    { mass: 96, health: 100, status: "alive" as const, effect: null },
    { ...fragile, health: 100 },
    "bite",
  );
  assert.equal(pop.attacker.mass, POPPING_MASS);
  assert.equal(pop.attacker.status, "popped");
  assert.equal(pop.attackerPopped, true);
});
