import assert from "node:assert/strict";
import { test } from "node:test";
import {
  FARM_HEIGHT,
  FARM_WIDTH,
  POPPING_MASS,
  SLOP_CATALOG,
  applySlop,
  decayPsychosis,
  hogDiameter,
  movePlayer,
  parseFarmAction,
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
  assert.deepEqual(parseFarmAction({ type: "restart" }), { type: "restart" });
  for (const action of [
    null,
    {},
    { type: "move", dx: 2, dy: 0 },
    { type: "move", dx: 0, dy: 0 },
    { type: "move", dx: 1, dy: 0, x: 500 },
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
