import type { Pool } from "pg";
import { transaction } from "./database.ts";
import { isValidDid } from "./dids.ts";

export interface CleanupCounts {
  accounts: number;
  hogLives: number;
  appSessions: number;
  oauthSessions: number;
  hogActions: number;
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
}

const protectedDidPrefix = "did:plc:deploymentcheck";

export function parseCleanupArguments(args: string[]): CleanupArguments {
  const execute = args.includes("--execute");
  const unknownOptions = args.filter(arg => arg.startsWith("--") && arg !== "--execute");
  if (unknownOptions.length) throw new Error(`Unknown option: ${unknownOptions[0]}`);

  const dids = [...new Set(args.filter(arg => arg !== "--execute"))];
  if (!dids.length) throw new Error("Provide at least one test account DID");
  for (const did of dids) {
    if (!isValidDid(did)) throw new Error(`Invalid DID: ${did}`);
    if (did.startsWith(protectedDidPrefix)) {
      throw new Error(`Refusing to delete the retained persistence fixture: ${did}`);
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
        WHERE hog_id IN (SELECT id FROM hog_lives WHERE owner_did=ANY($1::text[]))) AS hog_actions
  `, [dids]);
  const row = result.rows[0];
  return {
    accounts: row.accounts,
    hogLives: row.hog_lives,
    appSessions: row.app_sessions,
    oauthSessions: row.oauth_sessions,
    hogActions: row.hog_actions,
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
    };
  });
}
