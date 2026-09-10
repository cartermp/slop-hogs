import { createDatabase } from "../src/lib/server/database.ts";
import {
  deleteTestData,
  parseCleanupArguments,
  previewTestDataCleanup,
  type CleanupCounts,
} from "../src/lib/server/test-data-cleanup.ts";

function describeCounts(counts: CleanupCounts): string {
  return [
    `${counts.accounts} account(s)`,
    `${counts.hogLives} hog life/lives`,
    `${counts.appSessions} session(s)`,
    `${counts.oauthSessions} OAuth session(s)`,
    `${counts.hogActions} action receipt(s)`,
  ].join(", ");
}

const pool = createDatabase();
try {
  const { dids, execute } = parseCleanupArguments(process.argv.slice(2));
  if (execute) {
    const counts = await deleteTestData(pool, dids);
    console.log(`Deleted ${describeCounts(counts)} for ${dids.length} test DID(s).`);
  } else {
    const counts = await previewTestDataCleanup(pool, dids);
    console.log(`Would delete ${describeCounts(counts)} for ${dids.length} test DID(s).`);
    console.log("Preview only. Re-run with --execute to delete these rows.");
  }
} catch (error) {
  const detail = error instanceof Error ? error.message : String(error);
  console.error(`Test data cleanup failed: ${detail}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
