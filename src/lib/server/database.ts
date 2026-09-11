import { Pool, type PoolClient } from "pg";
import { logOperationalEvent } from "./logging.ts";

const databaseGlobal = globalThis as typeof globalThis & { slopHogsPool?: Pool };

export function createDatabase(connectionString = process.env.DATABASE_URL): Pool {
  if (!connectionString) throw new Error("DATABASE_URL is required for database operations");
  const pool = new Pool({
    connectionString, max: 4, connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 10_000, statement_timeout: 5_000,
    lock_timeout: 3_000, idle_in_transaction_session_timeout: 10_000,
  });
  pool.on("error", error => {
    logOperationalEvent("database.pool.idle_error", "failure", {
      database_pool_max: 4,
    }, error);
  });
  return pool;
}

export function getDatabase(): Pool {
  return databaseGlobal.slopHogsPool ??= createDatabase();
}

export async function transaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  let destroy = false;
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { destroy = true; }
    throw error;
  } finally { client.release(destroy); }
}
