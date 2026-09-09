import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import type { Pool } from "pg";
import { transaction } from "./database.ts";

export async function migrate(pool: Pool): Promise<void> {
  const directory = new URL("../../../migrations/", import.meta.url);
  const files = (await readdir(directory)).filter(name => /^\d{3}_[a-z0-9_]+\.sql$/.test(name)).sort();
  await transaction(pool, async client => {
    await client.query("SELECT pg_advisory_xact_lock(734004)");
    await client.query("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, checksum text NOT NULL)");
    const applied = await client.query<{name: string; checksum: string}>("SELECT name, checksum FROM schema_migrations ORDER BY name");
    if (applied.rows.some((row, index) => row.name !== files[index])) throw new Error("Migration history does not match this checkout");
    for (const name of files) {
      const sql = await readFile(new URL(name, directory), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      const existing = applied.rows.find(row => row.name === name);
      if (existing) {
        if (existing.checksum !== checksum) throw new Error(`Applied migration changed: ${name}`);
        continue;
      }
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations VALUES ($1, $2)", [name, checksum]);
    }
  });
}
