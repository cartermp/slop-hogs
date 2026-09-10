import type { Pool } from "pg";
import { transaction } from "./database.ts";
import { isValidDid } from "./dids.ts";

export interface CleanupCounts {
  accounts: number;
  hogLives: number;
  appSessions: number;
  oauthSessions: number;
  hogActions: number;
  giftTreats: number;
  accountBlocks: number;
  giftQuotaRows: number;
}

export interface CleanupArguments {
  dids: string[];
  execute: boolean;
}

interface CleanupCountRow {
  accounts: number;
  hog_lives: number;
  app_sessions: number;
  oauth_sessions: number;
  hog_actions: number;
  gift_treats: number;
  account_blocks: number;
  gift_quota_rows: number;
}

const protectedDidPrefixes = ["did:plc:deploymentcheck", "did:plc:backuprestorecheck"];

export function parseCleanupArguments(args: string[]): CleanupArguments {
  const execute = args.includes("--execute");
  const unknownOptions = args.filter(arg => arg.startsWith("--") && arg !== "--execute");
  if (unknownOptions.length) throw new Error(`Unknown option: ${unknownOptions[0]}`);

  const dids = [...new Set(args.filter(arg => arg !== "--execute"))];
  if (!dids.length) throw new Error("Provide at least one test account DID");
  for (const did of dids) {
    if (!isValidDid(did)) throw new Error(`Invalid DID: ${did}`);
    if (protectedDidPrefixes.some(prefix => did.startsWith(prefix))) {
      throw new Error(`Refusing to delete a retained operations fixture: ${did}`);
    }
  }
  return { dids, execute };
}

export async function previewTestDataCleanup(pool: Pool, dids: string[]): Promise<CleanupCounts> {
  const result = await pool.query<CleanupCountRow>(`
    SELECT
      (SELECT count(*)::integer FROM accounts WHERE did=ANY($1::text[])) AS accounts,
      (SELECT count(*)::integer FROM hog_lives WHERE owner_did=ANY($1::text[])) AS hog_lives,
      (SELECT count(*)::integer FROM app_sessions WHERE owner_did=ANY($1::text[])) AS app_sessions,
      (SELECT count(*)::integer FROM oauth_sessions WHERE did=ANY($1::text[])) AS oauth_sessions,
      (SELECT count(*)::integer FROM hog_actions
        WHERE hog_id IN (SELECT id FROM hog_lives WHERE owner_did=ANY($1::text[]))) AS hog_actions,
      (SELECT count(*)::integer FROM gift_treats
        WHERE sender_did=ANY($1::text[]) OR recipient_did=ANY($1::text[])) AS gift_treats,
      (SELECT count(*)::integer FROM account_blocks
        WHERE owner_did=ANY($1::text[]) OR blocked_did=ANY($1::text[])) AS account_blocks,
      (
        (SELECT count(*) FROM gift_sender_daily WHERE sender_did=ANY($1::text[]))
        + (SELECT count(*) FROM gift_recipient_daily WHERE recipient_did=ANY($1::text[]))
      )::integer AS gift_quota_rows
  `, [dids]);
  const row = result.rows[0];
  return {
    accounts: row.accounts,
    hogLives: row.hog_lives,
    appSessions: row.app_sessions,
    oauthSessions: row.oauth_sessions,
    hogActions: row.hog_actions,
    giftTreats: row.gift_treats,
    accountBlocks: row.account_blocks,
    giftQuotaRows: row.gift_quota_rows,
  };
}

export async function deleteTestData(pool: Pool, dids: string[]): Promise<CleanupCounts> {
  return transaction(pool, async client => {
    await client.query(
      "SELECT did FROM accounts WHERE did=ANY($1::text[]) ORDER BY did FOR UPDATE",
      [dids],
    );
    await client.query(
      "SELECT id FROM hog_lives WHERE owner_did=ANY($1::text[]) ORDER BY id FOR UPDATE",
      [dids],
    );
    const giftTreats = await client.query(
      "DELETE FROM gift_treats WHERE sender_did=ANY($1::text[]) OR recipient_did=ANY($1::text[])",
      [dids],
    );
    const accountBlocks = await client.query(
      "DELETE FROM account_blocks WHERE owner_did=ANY($1::text[]) OR blocked_did=ANY($1::text[])",
      [dids],
    );
    const senderQuota = await client.query(
      "DELETE FROM gift_sender_daily WHERE sender_did=ANY($1::text[])",
      [dids],
    );
    const recipientQuota = await client.query(
      "DELETE FROM gift_recipient_daily WHERE recipient_did=ANY($1::text[])",
      [dids],
    );
    const hogActions = await client.query(
      "DELETE FROM hog_actions WHERE hog_id IN (SELECT id FROM hog_lives WHERE owner_did=ANY($1::text[]))",
      [dids],
    );
    const appSessions = await client.query(
      "DELETE FROM app_sessions WHERE owner_did=ANY($1::text[])",
      [dids],
    );
    const oauthSessions = await client.query(
      "DELETE FROM oauth_sessions WHERE did=ANY($1::text[])",
      [dids],
    );
    const hogLives = await client.query(
      "DELETE FROM hog_lives WHERE owner_did=ANY($1::text[])",
      [dids],
    );
    const accounts = await client.query(
      "DELETE FROM accounts WHERE did=ANY($1::text[])",
      [dids],
    );
    return {
      accounts: accounts.rowCount ?? 0,
      hogLives: hogLives.rowCount ?? 0,
      appSessions: appSessions.rowCount ?? 0,
      oauthSessions: oauthSessions.rowCount ?? 0,
      hogActions: hogActions.rowCount ?? 0,
      giftTreats: giftTreats.rowCount ?? 0,
      accountBlocks: accountBlocks.rowCount ?? 0,
      giftQuotaRows: (senderQuota.rowCount ?? 0) + (recipientQuota.rowCount ?? 0),
    };
  });
}
