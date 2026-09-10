import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { createGameState } from "../game.ts";
import { transaction } from "./database.ts";

const fixtureDid = "did:plc:backuprestorecheck";
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

interface BackupCheckRow {
  challenge: string;
  fixture_hog_id: string;
  fixture_digest: string;
  prepared_at: Date;
}

async function readCheck(pool: Pool): Promise<BackupCheckRow> {
  const result = await pool.query<BackupCheckRow>(
    `SELECT challenge, fixture_hog_id, fixture_digest, prepared_at
       FROM backup_restore_checks
      WHERE id=true AND verified_at IS NULL`,
  );
  if (!result.rowCount) throw new Error("Run backup:prepare before creating the backup");
  return result.rows[0];
}

export async function prepareBackupRestoreCheck(pool: Pool): Promise<BackupCheckRow> {
  return transaction(pool, async client => {
    await client.query("SELECT pg_advisory_xact_lock(734007)");
    await client.query(
      `DELETE FROM restore_verification_probes WHERE id IN (
         SELECT id FROM restore_verification_probes
          WHERE created_at < clock_timestamp() - interval '1 day'
          ORDER BY created_at
          LIMIT 100
       )`,
    );
    await client.query("INSERT INTO accounts(did) VALUES ($1) ON CONFLICT DO NOTHING", [fixtureDid]);
    let hog = await client.query<{ id: string; state: unknown }>(
      "SELECT id, state FROM hog_lives WHERE owner_did=$1 AND ended_at IS NULL FOR UPDATE",
      [fixtureDid],
    );
    if (!hog.rowCount) {
      const id = randomUUID();
      const state = createGameState(Date.now(), randomBytes(4).readUInt32BE() || 1);
      hog = await client.query<{ id: string; state: unknown }>(
        "INSERT INTO hog_lives(id, owner_did, state) VALUES ($1,$2,$3) RETURNING id, state",
        [id, fixtureDid, state],
      );
    }
    const row = {
      challenge: randomUUID(),
      fixture_hog_id: hog.rows[0].id,
      fixture_digest: digest(hog.rows[0].state),
      prepared_at: new Date(),
    };
    await client.query(
      `INSERT INTO backup_restore_checks(
         id, challenge, fixture_hog_id, fixture_digest, prepared_at, verified_at,
         source_database_size_bytes, restored_database_size_bytes
       ) VALUES (true,$1,$2,$3,$4,NULL,NULL,NULL)
       ON CONFLICT (id) DO UPDATE SET
         challenge=EXCLUDED.challenge,
         fixture_hog_id=EXCLUDED.fixture_hog_id,
         fixture_digest=EXCLUDED.fixture_digest,
         prepared_at=EXCLUDED.prepared_at,
         verified_at=NULL,
         source_database_size_bytes=NULL,
         restored_database_size_bytes=NULL`,
      [row.challenge, row.fixture_hog_id, row.fixture_digest, row.prepared_at],
    );
    return row;
  });
}

export async function verifyRestoredBackup(source: Pool, restored: Pool): Promise<{
  challenge: string;
  verifiedAt: Date;
  sourceDatabaseSizeBytes: number;
  restoredDatabaseSizeBytes: number;
}> {
  const sourceCheck = await readCheck(source);
  const restoredCheck = await readCheck(restored);
  if (JSON.stringify(restoredCheck) !== JSON.stringify(sourceCheck)) {
    throw new Error("The restored database does not contain the prepared backup challenge");
  }
  const restoredHog = await restored.query<{ state: unknown }>(
    "SELECT state FROM hog_lives WHERE id=$1",
    [sourceCheck.fixture_hog_id],
  );
  if (!restoredHog.rowCount || digest(restoredHog.rows[0].state) !== sourceCheck.fixture_digest) {
    throw new Error("The restored backup fixture is missing or changed");
  }

  const probe = randomUUID();
  await restored.query("INSERT INTO restore_verification_probes(id) VALUES ($1)", [probe]);
  let result: {
    challenge: string;
    verifiedAt: Date;
    sourceDatabaseSizeBytes: number;
    restoredDatabaseSizeBytes: number;
  };
  try {
    const leaked = await source.query("SELECT id FROM restore_verification_probes WHERE id=$1", [probe]);
    if (leaked.rowCount) throw new Error("RESTORE_DATABASE_URL points to the source database");
    const [sourceSize, restoredSize] = await Promise.all([
      source.query<{ size: string }>("SELECT pg_database_size(current_database())::text AS size"),
      restored.query<{ size: string }>("SELECT pg_database_size(current_database())::text AS size"),
    ]);
    const verifiedAt = new Date();
    const sourceDatabaseSizeBytes = Number(sourceSize.rows[0].size);
    const restoredDatabaseSizeBytes = Number(restoredSize.rows[0].size);
    result = { challenge: sourceCheck.challenge, verifiedAt, sourceDatabaseSizeBytes, restoredDatabaseSizeBytes };
  } finally {
    await restored.query("DELETE FROM restore_verification_probes WHERE id=$1", [probe]);
  }
  const updated = await source.query(
    `UPDATE backup_restore_checks
        SET verified_at=$2, source_database_size_bytes=$3, restored_database_size_bytes=$4
      WHERE id=true AND challenge=$1 AND verified_at IS NULL`,
    [result.challenge, result.verifiedAt, result.sourceDatabaseSizeBytes, result.restoredDatabaseSizeBytes],
  );
  if (updated.rowCount !== 1) throw new Error("Backup challenge changed during verification");
  return result;
}
