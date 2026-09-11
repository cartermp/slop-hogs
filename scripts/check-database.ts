import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { loadCostPolicy } from "../src/lib/server/cost-policy.ts";
import { createDatabase, transaction } from "../src/lib/server/database.ts";
import { refreshOperationalStatus } from "../src/lib/server/operations.ts";
import { expirePostPreviews } from "../src/lib/server/posts.ts";

const pool = createDatabase();
try {
  const directory = new URL("../migrations/", import.meta.url);
  const files = (await readdir(directory)).filter(name => /^\d{3}_[a-z0-9_]+\.sql$/.test(name)).sort();
  const applied = await pool.query("SELECT name, checksum FROM schema_migrations ORDER BY name");
  // Allow later additive migrations, so rolling back application code is possible.
  for (const name of files) {
    const checksum = createHash("sha256").update(await readFile(new URL(name, directory))).digest("hex");
    if (!applied.rows.some(row => row.name === name && row.checksum === checksum)) throw new Error("Schema mismatch");
  }
  await pool.query("SELECT id FROM hog_lives LIMIT 0");
  await pool.query("SELECT player_id, health, knockouts, last_attack_at FROM farm_players LIMIT 0");
  await pool.query("SELECT id FROM farm_slop LIMIT 0");
  await pool.query("SELECT knockouts FROM farm_achievement_progress LIMIT 0");
  const policy = loadCostPolicy();
  await expirePostPreviews(pool);
  const status = await transaction(pool, client => refreshOperationalStatus(client, {
    database: policy.database,
    readOnlyMode: policy.features.readOnlyMode,
  }, true));
  console.log(`Database reachable; migrations verified; storage is ${status.usedPercent}% of the internal budget.`);
} catch (error) {
  const detail = error instanceof Error ? error.message : String(error);
  console.error(`Database preflight failed: ${detail}`);
  process.exitCode = 1;
} finally { await pool.end(); }
