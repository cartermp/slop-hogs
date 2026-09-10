import assert from "node:assert/strict";
import { createDatabase } from "../src/lib/server/database.ts";
import { prepareBackupRestoreCheck, verifyRestoredBackup } from "../src/lib/server/backup-restore.ts";

const mode = process.argv[2];
assert.ok(mode === "prepare" || mode === "verify", "Use prepare or verify");

const source = createDatabase();
try {
  if (mode === "prepare") {
    const check = await prepareBackupRestoreCheck(source);
    console.log(`Backup challenge ${check.challenge} prepared for hog ${check.fixture_hog_id}.`);
    console.log("Create a Railway volume backup now, restore it to a temporary PostgreSQL service, then run npm run backup:verify with RESTORE_DATABASE_URL set to that service.");
  } else {
    const restoreUrl = process.env.RESTORE_DATABASE_URL;
    assert.ok(restoreUrl, "RESTORE_DATABASE_URL is required for verification");
    if (restoreUrl === process.env.DATABASE_URL) {
      throw new Error("RESTORE_DATABASE_URL must differ from DATABASE_URL");
    }
    const restored = createDatabase(restoreUrl);
    try {
      const result = await verifyRestoredBackup(source, restored);
      console.log(`Backup challenge ${result.challenge} verified against a distinct restored database.`);
      console.log(`Source bytes: ${result.sourceDatabaseSizeBytes}; restored bytes: ${result.restoredDatabaseSizeBytes}.`);
    } finally {
      await restored.end();
    }
  }
} finally {
  await source.end();
}
