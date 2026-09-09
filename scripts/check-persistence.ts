import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createDatabase } from "../src/lib/server/database.ts";
import { feedHog, issueSession, provisionHog, revokeSession } from "../src/lib/server/hogs.ts";

const pool = createDatabase();
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
try {
  const [mode, hogId, expected] = process.argv.slice(2);
  if (mode === "seed") {
    // One retained operator fixture. Run once before the first player signup.
    const did = `did:plc:deploymentcheck${randomUUID().replaceAll("-", "")}`;
    const id = await provisionHog(pool, did);
    const token = await issueSession(pool, did);
    try { await feedHog(pool, token, id, randomUUID(), {type:"feed", food:"ai_image"}); }
    finally { await revokeSession(pool, token); }
    const result = await pool.query("SELECT state FROM hog_lives WHERE id=$1", [id]);
    console.log(`node scripts/check-persistence.ts verify ${id} ${digest(result.rows[0].state)}`);
  } else {
    assert.equal(mode, "verify", "Use seed once, or verify <hog-id> <digest>");
    assert.match(hogId ?? "", /^[a-f0-9-]{36}$/);
    assert.match(expected ?? "", /^[a-f0-9]{64}$/);
    const result = await pool.query("SELECT state FROM hog_lives WHERE id=$1", [hogId]);
    assert.equal(result.rowCount, 1, "Persistence fixture is missing");
    assert.equal(digest(result.rows[0].state), expected, "Saved state changed across restart");
    console.log("Saved hog state matches the pre-restart digest.");
  }
} finally { await pool.end(); }
