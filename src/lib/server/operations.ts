import type { Pool, PoolClient } from "pg";
import type { CostPolicy } from "../cost-policy.ts";
import { transaction } from "./database.ts";

const measurementIntervalMinutes = 15;

export interface StorageControls {
  databaseSizeBytes: number;
  usedPercent: number;
  warning: boolean;
  registrationsBlocked: boolean;
  cardsBlocked: boolean;
  readOnly: boolean;
  measuredAt: Date;
}

interface OperationalStatusRow {
  database_size_bytes: string | null;
  database_used_percent: string | null;
  warning: boolean;
  registrations_blocked: boolean;
  cards_blocked: boolean;
  read_only: boolean;
  measured_at: Date | null;
  fresh: boolean;
}

export class ReadOnlyError extends Error {}

export interface OperationalPolicy {
  database: CostPolicy["database"];
  readOnlyMode: boolean;
}

export function deriveStorageControls(
  databaseSizeBytes: number,
  policy: CostPolicy["database"],
  manualReadOnly: boolean,
  measuredAt = new Date(),
): StorageControls {
  if (!Number.isSafeInteger(databaseSizeBytes) || databaseSizeBytes < 0) {
    throw new Error("Database size must be a nonnegative safe integer");
  }
  const scaledSize = BigInt(databaseSizeBytes) * 100n;
  const budget = BigInt(policy.maxBytes);
  const exactUsedPercent = scaledSize / budget;
  const usedPercent = Number(
    exactUsedPercent > BigInt(Number.MAX_SAFE_INTEGER) ? BigInt(Number.MAX_SAFE_INTEGER) : exactUsedPercent,
  );
  return {
    databaseSizeBytes,
    usedPercent,
    warning: scaledSize >= budget * BigInt(policy.warningPercent),
    registrationsBlocked: manualReadOnly || scaledSize >= budget * BigInt(policy.restrictPercent),
    cardsBlocked: manualReadOnly || scaledSize >= budget * BigInt(policy.restrictPercent),
    readOnly: manualReadOnly || scaledSize >= budget * BigInt(policy.readOnlyPercent),
    measuredAt,
  };
}

function mapStatus(row: OperationalStatusRow): StorageControls | null {
  if (row.database_size_bytes === null || row.database_used_percent === null || !row.measured_at) return null;
  return {
    databaseSizeBytes: Number(row.database_size_bytes),
    usedPercent: Number(row.database_used_percent),
    warning: row.warning,
    registrationsBlocked: row.registrations_blocked,
    cardsBlocked: row.cards_blocked,
    readOnly: row.read_only,
    measuredAt: row.measured_at,
  };
}

function controlsMatch(left: StorageControls, right: StorageControls): boolean {
  return left.databaseSizeBytes === right.databaseSizeBytes
    && left.usedPercent === right.usedPercent
    && left.warning === right.warning
    && left.registrationsBlocked === right.registrationsBlocked
    && left.cardsBlocked === right.cardsBlocked
    && left.readOnly === right.readOnly
    && left.measuredAt.getTime() === right.measuredAt.getTime();
}

async function readOperationalStatus(client: PoolClient, lock: boolean): Promise<OperationalStatusRow | null> {
  const result = await client.query<OperationalStatusRow>(
    `SELECT database_size_bytes, database_used_percent, warning, registrations_blocked,
            cards_blocked, read_only, measured_at,
            measured_at > clock_timestamp() - ($1 * interval '1 minute') AS fresh
       FROM operational_status
      WHERE id=true
      ${lock ? "FOR UPDATE" : ""}`,
    [measurementIntervalMinutes],
  );
  return result.rows[0] ?? null;
}

export async function refreshOperationalStatus(
  client: PoolClient,
  policy: OperationalPolicy,
  force = false,
): Promise<StorageControls> {
  let row = await readOperationalStatus(client, false);
  let previous = row ? mapStatus(row) : null;
  if (!force && row?.fresh && previous) {
    const controls = deriveStorageControls(
      previous.databaseSizeBytes,
      policy.database,
      policy.readOnlyMode,
      previous.measuredAt,
    );
    if (controlsMatch(controls, previous)) return controls;
  }

  await client.query("SELECT pg_advisory_xact_lock(734006)");
  row = await readOperationalStatus(client, true);
  previous = row ? mapStatus(row) : null;
  if (!force && row?.fresh && previous) {
    const controls = deriveStorageControls(
      previous.databaseSizeBytes,
      policy.database,
      policy.readOnlyMode,
      previous.measuredAt,
    );
    if (controlsMatch(controls, previous)) return controls;
  }

  let databaseSizeBytes = previous?.databaseSizeBytes;
  let measuredAt = previous?.measuredAt;
  if (force || !row?.fresh || databaseSizeBytes === undefined || !measuredAt) {
    const measured = await client.query<{ size: string; measured_at: Date }>(
      "SELECT pg_database_size(current_database())::text AS size, clock_timestamp() AS measured_at",
    );
    databaseSizeBytes = Number(measured.rows[0].size);
    measuredAt = measured.rows[0].measured_at;
  }
  const controls = deriveStorageControls(databaseSizeBytes, policy.database, policy.readOnlyMode, measuredAt);
  await client.query(
    `INSERT INTO operational_status(
       id, database_size_bytes, database_used_percent, warning,
       registrations_blocked, cards_blocked, read_only, measured_at
     ) VALUES (true,$1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (id) DO UPDATE SET
       database_size_bytes=EXCLUDED.database_size_bytes,
       database_used_percent=EXCLUDED.database_used_percent,
       warning=EXCLUDED.warning,
       registrations_blocked=EXCLUDED.registrations_blocked,
       cards_blocked=EXCLUDED.cards_blocked,
       read_only=EXCLUDED.read_only,
       measured_at=EXCLUDED.measured_at`,
    [
      controls.databaseSizeBytes,
      controls.usedPercent,
      controls.warning,
      controls.registrationsBlocked,
      controls.cardsBlocked,
      controls.readOnly,
      controls.measuredAt,
    ],
  );
  return controls;
}

export function refreshOperationalStatusForPool(
  pool: Pool,
  policy: OperationalPolicy,
  force = false,
): Promise<StorageControls> {
  return transaction(pool, client => refreshOperationalStatus(client, policy, force));
}

export interface OwnerOperations {
  storage: StorageControls;
  accountCount: number;
  loginAttemptsThisHour: number;
  postLookupsThisHour: number;
  giftsToday: number;
  pendingGifts: number;
  cardsToday: number;
  cardStorageBytes: number;
  backupPreparedAt: Date | null;
  backupVerifiedAt: Date | null;
  restoredDatabaseSizeBytes: number | null;
}

export async function getOwnerOperations(
  pool: Pool,
  policy: OperationalPolicy,
): Promise<OwnerOperations> {
  return transaction(pool, async client => {
    const storage = await refreshOperationalStatus(client, policy, true);
    const metrics = await client.query<{
      account_count: number;
      login_attempts: number;
      post_lookups: number;
      gifts_today: number;
      pending_gifts: number;
      prepared_at: Date | null;
      verified_at: Date | null;
      restored_size: string | null;
      cards_today: number;
      card_storage_bytes: string;
    }>(`
      SELECT
        (SELECT count(*)::integer FROM accounts) AS account_count,
        COALESCE((
          SELECT attempts FROM oauth_login_attempts
           WHERE bucket_start=date_trunc('hour', clock_timestamp()) AND source_hash='global'
        ), 0)::integer AS login_attempts,
        COALESCE((
          SELECT lookups FROM post_lookup_global_hourly
           WHERE bucket_start=date_trunc('hour', clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
        ), 0)::integer AS post_lookups,
        COALESCE((
         SELECT sum(gifts) FROM gift_recipient_daily
          WHERE bucket_start=(clock_timestamp() AT TIME ZONE 'UTC')::date
        ), 0)::integer AS gifts_today,
        (SELECT count(*)::integer FROM gift_treats WHERE status='pending') AS pending_gifts,
        (SELECT prepared_at FROM backup_restore_checks WHERE id=true) AS prepared_at,
        (SELECT verified_at FROM backup_restore_checks WHERE id=true) AS verified_at,
        (SELECT restored_database_size_bytes::text FROM backup_restore_checks WHERE id=true) AS restored_size,
        COALESCE((
          SELECT cards FROM card_global_daily
           WHERE bucket_start=(clock_timestamp() AT TIME ZONE 'UTC')::date
        ), 0)::integer AS cards_today,
        COALESCE((SELECT sum(byte_length) FROM share_cards), 0)::text AS card_storage_bytes
    `);
    const row = metrics.rows[0];
    return {
      storage,
      accountCount: row.account_count,
      loginAttemptsThisHour: row.login_attempts,
      postLookupsThisHour: row.post_lookups,
      giftsToday: row.gifts_today,
      pendingGifts: row.pending_gifts,
      cardsToday: row.cards_today,
      cardStorageBytes: Number(row.card_storage_bytes),
      backupPreparedAt: row.prepared_at,
      backupVerifiedAt: row.verified_at,
      restoredDatabaseSizeBytes: row.restored_size === null ? null : Number(row.restored_size),
    };
  });
}
