import { createDatabase } from "../src/lib/server/database.ts";
import { migrate } from "../src/lib/server/migrations.ts";

const pool = createDatabase();
try { await migrate(pool); console.log("Database migrations applied."); }
finally { await pool.end(); }
