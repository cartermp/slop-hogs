import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { applyGameAction, createGameState, parseGameAction, parseGameState, type GameResult } from "../game.ts";
import { transaction } from "./database.ts";
import { isValidDid } from "./dids.ts";

const hash = (token: string) => createHash("sha256").update(token).digest("hex");
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sessionToken = /^[0-9a-f]{64}$/;

export class RegistrationClosedError extends Error {}
export class AccountLimitError extends Error {}

async function ensureHog(client: PoolClient, verifiedDid: string): Promise<string> {
  const existing = await client.query("SELECT id FROM hog_lives WHERE owner_did=$1 AND ended_at IS NULL", [verifiedDid]);
  if (existing.rowCount) return existing.rows[0].id as string;
  const id = randomUUID();
  const state = createGameState(Date.now(), randomBytes(4).readUInt32BE() || 1);
  await client.query("INSERT INTO hog_lives(id, owner_did, state) VALUES ($1,$2,$3)", [id, verifiedDid, state]);
  return id;
}

// Trusted server entry point only. SH-005 must supply a DID verified by OAuth.
// No HTTP endpoint exposes provisioning or accepts a DID as authentication.
export async function provisionHog(pool: Pool, verifiedDid: string): Promise<string> {
  if (!isValidDid(verifiedDid)) throw new Error("Invalid DID");
  return transaction(pool, async client => {
    await client.query("INSERT INTO accounts(did) VALUES ($1) ON CONFLICT DO NOTHING", [verifiedDid]);
    await client.query("SELECT did FROM accounts WHERE did=$1 FOR UPDATE", [verifiedDid]);
    return ensureHog(client, verifiedDid);
  });
}

// Session issuance is reserved for the verified OAuth callback in SH-005.
export async function issueSession(pool: Pool, verifiedDid: string): Promise<string> {
  if (!isValidDid(verifiedDid)) throw new Error("Invalid DID");
  const token = randomBytes(32).toString("hex");
  await pool.query(
    "INSERT INTO app_sessions(token_hash, owner_did, expires_at) VALUES ($1,$2,clock_timestamp() + interval '7 days')",
    [hash(token), verifiedDid],
  );
  return token;
}

export interface AppSession {
  ownerDid: string;
  hogId: string;
}

export async function getAppSession(pool: Pool, token: string): Promise<AppSession | null> {
  if (!sessionToken.test(token)) return null;
  const result = await pool.query<{ owner_did: string; hog_id: string }>(
    `SELECT session.owner_did, hog.id AS hog_id
       FROM app_sessions session
       JOIN hog_lives hog ON hog.owner_did=session.owner_did AND hog.ended_at IS NULL
      WHERE session.token_hash=$1 AND session.expires_at > clock_timestamp()`,
    [hash(token)],
  );
  if (!result.rowCount) return null;
  return { ownerDid: result.rows[0].owner_did, hogId: result.rows[0].hog_id };
}

export async function revokeSession(pool: Pool, token: string): Promise<string | null> {
  if (!sessionToken.test(token)) return null;
  const result = await pool.query<{ owner_did: string }>(
    "DELETE FROM app_sessions WHERE token_hash=$1 RETURNING owner_did",
    [hash(token)],
  );
  return result.rows[0]?.owner_did ?? null;
}

export async function completeOAuthSignIn(
  pool: Pool,
  verifiedDid: string,
  options: {
    registrationsEnabled: boolean;
    accountLimit: number;
    invitedDids: ReadonlySet<string>;
  },
): Promise<{ token: string; hogId: string }> {
  if (!isValidDid(verifiedDid)) throw new Error("Invalid DID");
  return transaction(pool, async client => {
    // One global admission lock makes the account cap exact under concurrent callbacks.
    await client.query("SELECT pg_advisory_xact_lock(734005)");
    const existing = await client.query("SELECT did FROM accounts WHERE did=$1 FOR UPDATE", [verifiedDid]);
    if (!existing.rowCount) {
      if (!options.registrationsEnabled || !options.invitedDids.has(verifiedDid)) {
        throw new RegistrationClosedError("This account is not invited");
      }
      const count = await client.query<{ count: string }>("SELECT count(*)::text AS count FROM accounts");
      if (Number(count.rows[0].count) >= options.accountLimit) {
        throw new AccountLimitError("The account limit has been reached");
      }
      await client.query("INSERT INTO accounts(did) VALUES ($1)", [verifiedDid]);
    }

    const hogId = await ensureHog(client, verifiedDid);
    const token = randomBytes(32).toString("hex");
    await client.query("DELETE FROM app_sessions WHERE owner_did=$1", [verifiedDid]);
    await client.query(
      "INSERT INTO app_sessions(token_hash, owner_did, expires_at) VALUES ($1,$2,clock_timestamp() + interval '7 days')",
      [hash(token), verifiedDid],
    );
    return { token, hogId };
  });
}

export async function feedHog(pool: Pool, token: string, hogId: string, requestId: string, input: unknown): Promise<GameResult> {
  if (!uuid.test(hogId) || !uuid.test(requestId)) throw new Error("Invalid action identifiers");
  if (!sessionToken.test(token)) throw new Error("Unauthorized");
  const action = parseGameAction(input);
  return transaction(pool, async client => {
    // Serialize each hog before checking expiry/time. Waiting requests cannot use stale time.
    const hog = await client.query("SELECT owner_did, state, ended_at FROM hog_lives WHERE id=$1 FOR UPDATE", [hogId]);
    const session = await client.query("SELECT owner_did FROM app_sessions WHERE token_hash=$1 AND expires_at > clock_timestamp() FOR SHARE", [hash(token)]);
    if (!hog.rowCount || !session.rowCount || hog.rows[0].owner_did !== session.rows[0].owner_did) throw new Error("Unauthorized");
    const previous = await client.query("SELECT action, result FROM hog_actions WHERE hog_id=$1 AND request_id=$2", [hogId, requestId]);
    if (previous.rowCount) {
      if (JSON.stringify(parseGameAction(previous.rows[0].action)) !== JSON.stringify(action)) throw new Error("Request ID already used for a different action");
      return previous.rows[0].result as GameResult;
    }
    if (hog.rows[0].ended_at) throw new Error("Hog life has ended");
    const clock = await client.query("SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::float8 AS now");
    const state = parseGameState(hog.rows[0].state);
    const result = applyGameAction(state, action, Math.max(clock.rows[0].now, state.updatedAtMs));
    await client.query("UPDATE hog_lives SET state=$2 WHERE id=$1", [hogId, result.state]);
    // State and ordered events are committed together in the same action receipt.
    await client.query("INSERT INTO hog_actions(hog_id, request_id, action, result) VALUES ($1,$2,$3,$4)", [hogId, requestId, action, result]);
    return result;
  });
}
