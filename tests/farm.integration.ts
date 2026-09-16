import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createDatabase } from "../src/lib/server/database.ts";
import { actOnFarm, syncFarm } from "../src/lib/server/farm.ts";
import { MULTIPLAYER_LOBBY_WINDOW_MS } from "../src/lib/farm-game.ts";
import { actOnSinglePlayer, syncSinglePlayer } from "../src/lib/server/single-player.ts";
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
    now += MULTIPLAYER_LOBBY_WINDOW_MS / 2;
    await Promise.all(dids.map(did => syncFarm(pool, did, now)));
    now += MULTIPLAYER_LOBBY_WINDOW_MS / 2 + 2;
    await Promise.all(dids.map(did => syncFarm(pool, did, now)));
    assert.equal((await syncFarm(pool, dids[0], now + 1)).multiplayer.status, "playing");

    const first = joined.players.find(player => !player.isYou)!;
    await pool.query("DELETE FROM farm_slop");
    await pool.query(
      `INSERT INTO farm_slop(id, field_id, kind, x, y, expires_at)
       SELECT $1, field_id, 'premium_tokens', $2, $3, clock_timestamp() + interval '1 minute'
         FROM farm_players
        WHERE owner_did=$4`,
      [randomUUID(), first.x, first.y, dids[0]],
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
          SET x=400, y=300, mass=40, psychosis_movement_ms=0,
              last_moved_at=to_timestamp($2 / 1000.0)
        WHERE owner_did=$1`,
      [dids[0], now],
    );
    now += 4_000;
    assert.equal(
      (await syncFarm(pool, dids[0], now)).players.find(player => player.isYou)?.mass,
      40,
      "idle hogs retain psychosis",
    );
    await pool.query("DELETE FROM farm_slop");
    for (let index = 0; index < 9; index += 1) {
      now += 240;
      await actOnFarm(pool, dids[0], { type: "move", dx: 1, dy: 0 }, now);
    }
    assert.equal(
      (await syncFarm(pool, dids[0], now)).players.find(player => player.isYou)?.mass,
      39,
      "psychosis decays after enough movement",
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
      `INSERT INTO farm_slop(id, field_id, kind, x, y, expires_at)
       SELECT $1, field_id, 'hallucinated_citation', 400, 300,
              clock_timestamp() + interval '1 minute'
         FROM farm_players
        WHERE owner_did=$2`,
      [randomUUID(), dids[0]],
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
              psychosis_movement_ms=0,
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
    assert.equal(defeated.snapshot.achievements.progress.wins, 1);
    assert.equal(defeated.snapshot.multiplayer.status, "finished");
    assert.equal(
      defeated.snapshot.multiplayer.winnerId,
      defeated.snapshot.players.find(player => player.isYou)?.id,
    );
    assert.ok(defeated.snapshot.achievements.unlocks.some(unlock => unlock.id === "knockout-1"));
    assert.ok(defeated.snapshot.achievements.unlocks.some(unlock => unlock.id === "victory-1"));
    assert.ok(defeated.events.some(event => event.type === "multiplayer_victory"));
    assert.equal(
      Number((await pool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM farm_victories WHERE winner_owner_did=$1",
        [dids[0]],
      )).rows[0].count),
      1,
    );

    now += 1;
    await assert.rejects(
      actOnFarm(pool, dids[1], { type: "restart" }, now),
      /Only the winning hog can reset the round/,
    );
    const resetByWinner = await actOnFarm(pool, dids[0], { type: "restart" }, now + 1);
    assert.equal(resetByWinner.snapshot.multiplayer.status, "waiting");
    assert.ok(resetByWinner.snapshot.players.every(player => player.status === "alive"));
    assert.ok(resetByWinner.snapshot.players.every(player => player.health === 100));
    assert.equal(resetByWinner.snapshot.achievements.progress.runs, 2);
    assert.ok(resetByWinner.snapshot.achievements.unlocks.some(unlock => unlock.id === "run-1"));
    assert.equal(
      Number((await pool.query<{ runs: number }>(
        "SELECT runs FROM farm_achievement_progress WHERE owner_did=$1",
        [dids[1]],
      )).rows[0].runs),
      2,
    );
    const resetLobbyClosesAtMs = resetByWinner.snapshot.multiplayer.lobbyClosesAtMs!;
    await Promise.all(dids.map(did => syncFarm(pool, did, resetLobbyClosesAtMs - 15_000)));
    now = resetLobbyClosesAtMs;
    await Promise.all(dids.map(did => syncFarm(pool, did, now)));
    assert.equal((await syncFarm(pool, dids[0], now + 1)).multiplayer.status, "playing");

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
      `INSERT INTO farm_slop(id, field_id, kind, x, y, expires_at)
       SELECT $1, field_id, 'context_overflow', 400, 300,
              clock_timestamp() + interval '1 minute'
         FROM farm_players
        WHERE owner_did=$2`,
      [randomUUID(), dids[0]],
    );
    now += 200;
    const popped = await actOnFarm(pool, dids[0], { type: "move", dx: -1, dy: 0 }, now);
    assert.deepEqual(popped.events.slice(0, 2).map(event => event.type), ["slop_eaten", "popped"]);
    assert.equal(popped.snapshot.players.find(player => player.isYou)?.status, "popped");
    assert.equal(popped.snapshot.achievements.progress.pops, 1);
    assert.equal(popped.snapshot.multiplayer.status, "finished");

    now += 1;
    await assert.rejects(
      actOnFarm(pool, dids[0], { type: "restart" }, now),
      /Only the winning hog can reset the round/,
    );
    const restarted = await actOnFarm(pool, dids[1], { type: "restart" }, now + 1);
    const fresh = restarted.snapshot.players.find(player => player.isYou)!;
    assert.equal(restarted.events[0].type, "restarted");
    assert.ok(restarted.snapshot.achievements.unlocks.some(unlock => unlock.id === "run-1"));
    assert.equal(restarted.snapshot.achievements.progress.runs, 3);
    assert.equal(fresh.status, "alive");
    assert.equal(fresh.mass, 24);
    assert.equal(fresh.score, 0);

    await pool.query(
      `UPDATE farm_players
          SET x=400, y=300, mass=CASE WHEN owner_did=$1 THEN 96 ELSE 24 END,
              health=CASE WHEN owner_did=$2 THEN 1 ELSE 100 END,
              status='alive', effect=NULL, effect_expires_at=NULL,
              popped_at=NULL, defeated_at=NULL, defeat_cause=NULL, last_attack_at=NULL,
              updated_at=to_timestamp($3 / 1000.0)
        WHERE owner_did=ANY($4)`,
      [dids[0], dids[1], now + 1, dids],
    );
    now += 901;
    const draw = await actOnFarm(pool, dids[0], { type: "bite", targetId }, now);
    assert.ok(draw.events.some(event => event.type === "popped"));
    assert.equal(
      draw.events[0].type === "battle_attack" && draw.events[0].targetDefeated,
      true,
    );
    assert.equal(draw.snapshot.multiplayer.status, "finished");
    assert.equal(draw.snapshot.multiplayer.winnerId, null);
    assert.equal(
      Number((await pool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM farm_victories WHERE winner_owner_did=ANY($1)",
        [dids],
      )).rows[0].count),
      2,
      "a draw does not register a victory",
    );
    const resetDraw = await actOnFarm(pool, dids[0], { type: "restart" }, now + 1);
    assert.equal(resetDraw.snapshot.multiplayer.status, "waiting");
    assert.equal(
      resetDraw.snapshot.multiplayer.lobbyClosesAtMs,
      now + 1 + MULTIPLAYER_LOBBY_WINDOW_MS,
    );
    assert.ok(resetDraw.snapshot.players.every(player => player.status === "alive"));
  } finally {
    await pool.query("DELETE FROM farm_slop");
    await pool.query("DELETE FROM app_sessions WHERE owner_did=ANY($1)", [dids]);
    await pool.query("DELETE FROM hog_lives WHERE owner_did=ANY($1)", [dids]);
    await pool.query("DELETE FROM accounts WHERE did=ANY($1)", [dids]);
    await pool.end();
  }
});

test("the lobby starts at capacity or its original deadline and active rounds reject new players", async () => {
  assert.ok(process.env.TEST_DATABASE_URL, "Set TEST_DATABASE_URL to a disposable PostgreSQL database");
  const pool = createDatabase(process.env.TEST_DATABASE_URL);
  const dids = Array.from({ length: 17 }, () => `did:plc:test${randomUUID().replaceAll("-", "")}`);
  let now = Date.now();
  try {
    await migrate(pool);
    await Promise.all(dids.map(did => provisionHog(pool, did)));

    const lobbyOpenedAtMs = now;
    const firstLobby = await syncFarm(pool, dids[0], now++);
    const lobbyClosesAtMs = firstLobby.multiplayer.lobbyClosesAtMs!;
    assert.equal(lobbyClosesAtMs, lobbyOpenedAtMs + MULTIPLAYER_LOBBY_WINDOW_MS);
    for (const did of dids.slice(1, 4)) await syncFarm(pool, did, now++);
    now += 15_000;
    await Promise.all(dids.slice(4, 7).map(did => syncFarm(pool, did, now)));
    const friends = await Promise.all(dids.slice(4, 7).map(did => syncFarm(pool, did, now + 1)));
    assert.ok(friends.every(snapshot => snapshot.players.length === 7));
    assert.ok(friends.every(snapshot => snapshot.multiplayer.status === "waiting"));
    assert.ok(friends.every(
      snapshot => snapshot.multiplayer.lobbyClosesAtMs === lobbyClosesAtMs,
    ));
    await Promise.all(dids.slice(0, 7).map(did => syncFarm(pool, did, lobbyClosesAtMs - 1)));
    assert.equal(
      (await syncFarm(pool, dids[0], lobbyClosesAtMs - 1)).multiplayer.status,
      "waiting",
      "new arrivals do not extend the lobby deadline",
    );
    const firstNewLobby = await syncFarm(pool, dids[7], lobbyClosesAtMs);
    assert.equal(firstNewLobby.players.length, 1, "an expired lobby does not admit new arrivals");
    await Promise.all(dids.slice(0, 7).map(did => syncFarm(pool, did, lobbyClosesAtMs + 1)));
    assert.equal(
      (await syncFarm(pool, dids[0], lobbyClosesAtMs + 1)).multiplayer.status,
      "playing",
    );

    const firstField = await pool.query<{ field_id: string }>(
      "SELECT DISTINCT field_id FROM farm_players WHERE owner_did=ANY($1)",
      [dids.slice(0, 7)],
    );
    assert.equal(firstField.rowCount, 1, "the existing hogs and concurrent arrivals share one field");

    const assignments = await pool.query<{ field_id: string; count: string }>(
      `SELECT field_id, count(*)::text AS count
         FROM farm_players
        WHERE owner_did=ANY($1)
        GROUP BY field_id
        ORDER BY count(*) DESC`,
      [dids],
    );
    assert.deepEqual(assignments.rows.map(row => Number(row.count)), [7, 1]);
    assert.equal(
      (await syncFarm(pool, dids[0], lobbyClosesAtMs + 2)).players.length,
      7,
    );
    const singletonClosesAtMs = firstNewLobby.multiplayer.lobbyClosesAtMs!;
    await syncFarm(pool, dids[7], singletonClosesAtMs - 15_000);
    const singletonMatch = await syncFarm(pool, dids[8], singletonClosesAtMs);
    assert.equal(singletonMatch.players.length, 2);
    assert.equal(
      singletonMatch.multiplayer.status,
      "playing",
      "an expired singleton admits a second player and starts immediately",
    );

    await Promise.all(dids.slice(9).map(did => syncFarm(pool, did, singletonClosesAtMs + 1)));
    const fullLobby = await syncFarm(pool, dids[9], singletonClosesAtMs + 2);
    assert.equal(fullLobby.players.length, 8);
    assert.equal(fullLobby.multiplayer.status, "playing", "a full lobby starts before its deadline");
    assert.equal(fullLobby.multiplayer.lobbyClosesAtMs, null);
  } finally {
    await pool.query("DELETE FROM farm_slop WHERE field_id IN (SELECT field_id FROM farm_players WHERE owner_did=ANY($1))", [dids]);
    await pool.query("DELETE FROM app_sessions WHERE owner_did=ANY($1)", [dids]);
    await pool.query("DELETE FROM hog_lives WHERE owner_did=ANY($1)", [dids]);
    await pool.query("DELETE FROM accounts WHERE did=ANY($1)", [dids]);
    await pool.query("DELETE FROM farm_fields WHERE NOT EXISTS (SELECT 1 FROM farm_players WHERE farm_players.field_id=farm_fields.id)");
    await pool.end();
  }
});

test("single-player runs and achievements persist separately", async () => {
  assert.ok(process.env.TEST_DATABASE_URL, "Set TEST_DATABASE_URL to a disposable PostgreSQL database");
  const pool = createDatabase(process.env.TEST_DATABASE_URL);
  const did = `did:plc:test${randomUUID().replaceAll("-", "")}`;
  const now = Date.now();
  try {
    await migrate(pool);
    await provisionHog(pool, did);
    const started = await actOnSinglePlayer(pool, did, { type: "start", difficulty: "easy" }, now);
    assert.equal(started.snapshot.singlePlayer.difficulty, "easy");
    assert.equal(started.snapshot.players.length, 3);
    assert.ok(started.snapshot.singlePlayer.achievements.unlocks.some(
      unlock => unlock.id === "solo-table-for-one",
    ));
    await assert.rejects(
      actOnSinglePlayer(pool, did, { type: "start", difficulty: "hard" }, now + 1),
      /Resume or finish the current run first/,
    );
    assert.equal(
      (await syncSinglePlayer(pool, did, now + 2)).snapshot.singlePlayer.difficulty,
      "easy",
    );

    const stored = (await pool.query<{ state: Record<string, unknown> }>(
      "SELECT state FROM single_player_games WHERE owner_did=$1",
      [did],
    )).rows[0].state;
    const player = stored.player as { x: number; y: number };
    const bots = stored.bots as Array<{
      x: number;
      y: number;
      health: number;
      status: "alive" | "popped" | "defeated";
    }>;
    for (const bot of bots.slice(1)) {
      bot.health = 0;
      bot.status = "defeated";
    }
    bots[0].x = player.x + 10;
    bots[0].y = player.y;
    bots[0].health = 1;
    await pool.query(
      "UPDATE single_player_games SET state=$2 WHERE owner_did=$1",
      [did, stored],
    );

    const won = await actOnSinglePlayer(
      pool,
      did,
      { type: "fart", targetId: "bot-1" },
      now + 100,
    );
    assert.equal(won.snapshot.singlePlayer.status, "won");
    assert.equal(won.snapshot.singlePlayer.achievements.progress.easyWins, 1);
    for (const achievementId of [
      "solo-first-blood",
      "solo-survivor",
      "solo-easy-win",
      "solo-clean-plate",
    ]) {
      assert.ok(won.snapshot.singlePlayer.achievements.unlocks.some(
        unlock => unlock.id === achievementId,
      ));
    }
    assert.equal((await syncSinglePlayer(pool, did, now + 200)).snapshot.singlePlayer.status, "won");
  } finally {
    await pool.query("DELETE FROM app_sessions WHERE owner_did=$1", [did]);
    await pool.query("DELETE FROM hog_lives WHERE owner_did=$1", [did]);
    await pool.query("DELETE FROM accounts WHERE did=$1", [did]);
    await pool.end();
  }
});
