import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createDatabase } from "../src/lib/server/database.ts";
import { actOnFarm, syncFarm } from "../src/lib/server/farm.ts";
import { provisionHog } from "../src/lib/server/hogs.ts";
import { migrate } from "../src/lib/server/migrations.ts";

test("the shared farm persists players, claims slop once, pops, and restarts", async () => {
  assert.ok(process.env.TEST_DATABASE_URL, "Set TEST_DATABASE_URL to a disposable PostgreSQL database");
  const pool = createDatabase(process.env.TEST_DATABASE_URL);
  const dids = Array.from({ length: 2 }, () => `did:plc:test${randomUUID().replaceAll("-", "")}`);
  let now = Date.now();
  try {
    await migrate(pool);
    await Promise.all(dids.map(did => provisionHog(pool, did)));
    await syncFarm(pool, dids[0], now);
    const joined = await syncFarm(pool, dids[1], now + 1);
    assert.equal(joined.players.length, 2);
    assert.equal(joined.players.filter(player => player.isYou).length, 1);
    assert.equal(joined.slop.length, 16);
    await pool.query("UPDATE accounts SET handle='phillipcarter.dev' WHERE did=$1", [dids[0]]);
    assert.equal(
      (await syncFarm(pool, dids[0], now + 2)).players.find(player => player.isYou)?.name,
      "phillipcarter.dev",
    );

    const first = joined.players.find(player => !player.isYou)!;
    await pool.query("DELETE FROM farm_slop");
    await pool.query(
      `INSERT INTO farm_slop(id, kind, x, y, expires_at)
       VALUES ($1,'premium_tokens',$2,$3,clock_timestamp() + interval '1 minute')`,
      [randomUUID(), first.x, first.y],
    );
    now += 100;
    const ate = await actOnFarm(pool, dids[0], { type: "move", dx: 1, dy: 0 }, now);
    assert.deepEqual(ate.events.map(event => event.type), ["slop_eaten", "achievements_unlocked"]);
    assert.ok(ate.snapshot.achievements.unlocks.some(unlock => unlock.id === "slop-1"));
    assert.ok(ate.snapshot.achievements.unlocks.some(unlock => unlock.id === "score-1"));
    assert.equal(ate.snapshot.achievements.progress.kindCounts.premium_tokens, 1);
    assert.equal(ate.snapshot.players.find(player => player.isYou)?.mass, 31);

    await pool.query(
      `UPDATE farm_players
          SET mass=40, psychosis_updated_at=to_timestamp($2 / 1000.0)
        WHERE owner_did=$1`,
      [dids[0], now],
    );
    now += 4_000;
    assert.equal(
      (await syncFarm(pool, dids[0], now)).players.find(player => player.isYou)?.mass,
      38,
    );

    await pool.query("DELETE FROM farm_slop");
    await pool.query(
      `UPDATE farm_players
          SET x=400, y=300, mass=24, score=0, slop_eaten=0, status='alive',
              effect=NULL, effect_expires_at=NULL, popped_at=NULL,
              last_moved_at=to_timestamp($2 / 1000.0)
        WHERE owner_did=ANY($1)`,
      [dids, now],
    );
    await pool.query(
      `INSERT INTO farm_slop(id, kind, x, y, expires_at)
       VALUES ($1,'hallucinated_citation',400,300,clock_timestamp() + interval '1 minute')`,
      [randomUUID()],
    );
    now += 200;
    const race = await Promise.all(
      dids.map(did => actOnFarm(pool, did, { type: "move", dx: 1, dy: 0 }, now)),
    );
    assert.equal(
      race.flatMap(result => result.events).filter(event => event.type === "slop_eaten").length,
      1,
      "one slop drop can only be claimed by one player",
    );

    const targetId = joined.players.find(player => player.isYou)!.id;
    await pool.query(
      `UPDATE farm_players
          SET x=400, y=300, mass=48, health=100, status='alive',
              effect=NULL, effect_expires_at=NULL, popped_at=NULL, defeated_at=NULL,
              defeat_cause=NULL, last_attack_at=NULL,
              psychosis_updated_at=to_timestamp($2 / 1000.0),
              updated_at=to_timestamp($2 / 1000.0)
        WHERE owner_did=ANY($1)`,
      [dids, now],
    );
    now += 100;
    const bitten = await actOnFarm(pool, dids[0], { type: "bite", targetId }, now);
    assert.equal(bitten.events[0].type, "battle_attack");
    assert.equal(
      bitten.events[0].type === "battle_attack" && bitten.events[0].damage,
      20,
    );
    assert.equal(bitten.snapshot.players.find(player => player.isYou)?.mass, 55);
    assert.equal(bitten.snapshot.players.find(player => player.id === targetId)?.health, 80);

    now += 900;
    const farted = await actOnFarm(pool, dids[0], { type: "fart", targetId }, now);
    assert.equal(
      farted.events[0].type === "battle_attack" && farted.events[0].damage,
      8,
    );
    assert.equal(farted.snapshot.players.find(player => player.isYou)?.mass, 45);

    now += 900;
    const vented = await actOnFarm(pool, dids[0], { type: "fart" }, now);
    assert.equal(vented.events[0].type, "psychosis_released");
    assert.equal(
      vented.events[0].type === "psychosis_released" && vented.events[0].amount,
      10,
    );
    assert.equal(vented.snapshot.players.find(player => player.isYou)?.mass, 35);

    await pool.query("UPDATE farm_players SET health=1 WHERE player_id=$1", [targetId]);
    now += 900;
    const defeated = await actOnFarm(pool, dids[0], { type: "fart", targetId }, now);
    assert.equal(
      defeated.events[0].type === "battle_attack" && defeated.events[0].targetDefeated,
      true,
    );
    assert.equal(defeated.snapshot.players.find(player => player.id === targetId)?.status, "defeated");
    assert.equal(defeated.snapshot.players.find(player => player.isYou)?.knockouts, 1);
    assert.equal(defeated.snapshot.achievements.progress.knockouts, 1);
    assert.ok(defeated.snapshot.achievements.unlocks.some(unlock => unlock.id === "knockout-1"));

    now += 1;
    const redeployed = await actOnFarm(pool, dids[1], { type: "restart" }, now);
    assert.equal(redeployed.snapshot.players.find(player => player.isYou)?.status, "alive");
    assert.equal(redeployed.snapshot.players.find(player => player.isYou)?.health, 100);

    await pool.query("DELETE FROM farm_slop");
    await pool.query(
      `UPDATE farm_players
          SET x=400, y=300, mass=90, status='alive', effect=NULL,
              effect_expires_at=NULL, popped_at=NULL,
              last_moved_at=to_timestamp($2 / 1000.0)
        WHERE owner_did=$1`,
      [dids[0], now],
    );
    await pool.query(
      `INSERT INTO farm_slop(id, kind, x, y, expires_at)
       VALUES ($1,'context_overflow',400,300,clock_timestamp() + interval '1 minute')`,
      [randomUUID()],
    );
    now += 200;
    const popped = await actOnFarm(pool, dids[0], { type: "move", dx: -1, dy: 0 }, now);
    assert.deepEqual(popped.events.slice(0, 2).map(event => event.type), ["slop_eaten", "popped"]);
    assert.equal(popped.snapshot.players.find(player => player.isYou)?.status, "popped");
    assert.equal(popped.snapshot.achievements.progress.pops, 1);

    now += 1;
    const restarted = await actOnFarm(pool, dids[0], { type: "restart" }, now);
    const fresh = restarted.snapshot.players.find(player => player.isYou)!;
    assert.equal(restarted.events[0].type, "restarted");
    assert.ok(restarted.snapshot.achievements.unlocks.some(unlock => unlock.id === "run-1"));
    assert.equal(restarted.snapshot.achievements.progress.runs, 2);
    assert.equal(fresh.status, "alive");
    assert.equal(fresh.mass, 24);
    assert.equal(fresh.score, 0);
  } finally {
    await pool.query("DELETE FROM farm_slop");
    await pool.query("DELETE FROM app_sessions WHERE owner_did=ANY($1)", [dids]);
    await pool.query("DELETE FROM hog_lives WHERE owner_did=ANY($1)", [dids]);
    await pool.query("DELETE FROM accounts WHERE did=ANY($1)", [dids]);
    await pool.end();
  }
});
