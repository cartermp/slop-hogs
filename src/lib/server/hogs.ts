import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { applyGameAction, createGameState, parseGameAction, parseGameState, type GameResult } from "../game.ts";
import { transaction } from "./database.ts";
import { isValidDid } from "./dids.ts";

const hash = (token: string) => createHash("sha256").update(token).digest("hex");
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Trusted server entry point only. SH-005 must supply a DID verified by OAuth.
// No HTTP endpoint exposes provisioning or accepts a DID as authentication.
export async function provisionHog(pool: Pool, verifiedDid: string): Promise<string> {
  if (!isValidDid(verifiedDid)) throw new Error("Invalid DID");
  return transaction(pool, async client => {
    await client.query("INSERT INTO accounts(did) VALUES ($1) ON CONFLICT DO NOTHING", [verifiedDid]);
    await client.query("SELECT did FROM accounts WHERE did=$1 FOR UPDATE", [verifiedDid]);
    const existing = await client.query("SELECT id FROM hog_lives WHERE owner_did=$1 AND ended_at IS NULL", [verifiedDid]);
    if (existing.rowCount) return existing.rows[0].id as string;
    const id = randomUUID();
    const state = createGameState(Date.now(), randomBytes(4).readUInt32BE() || 1);
    await client.query("INSERT INTO hog_lives(id, owner_did, state) VALUES ($1,$2,$3)", [id, verifiedDid, state]);
    return id;
  });
}

// Session issuance is reserved for the verified OAuth callback in SH-005.
export async function issueSession(pool: Pool, verifiedDid: string): Promise<string> {
  const token = randomBytes(32).toString("hex");
  await pool.query("INSERT INTO app_sessions VALUES ($1,$2,clock_timestamp() + interval '7 days')", [hash(token), verifiedDid]);
  return token;
}

export async function revokeSession(pool: Pool, token: string): Promise<void> {
  await pool.query("DELETE FROM app_sessions WHERE token_hash=$1", [hash(token)]);
}

export async function feedHog(pool: Pool, token: string, hogId: string, requestId: string, input: unknown): Promise<GameResult> {
  if (!uuid.test(hogId) || !uuid.test(requestId)) throw new Error("Invalid action identifiers");
  if (!/^[0-9a-f]{64}$/.test(token)) throw new Error("Unauthorized");
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
