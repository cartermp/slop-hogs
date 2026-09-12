import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { AuthProvider } from "../auth.ts";
import {
  applyGameAction,
  advanceGameTime,
  createGameState,
  parseGameAction,
  parseGameState,
  type FoodKind,
  type GameState,
  type GameResult,
} from "../game.ts";
import { isValidBlueskyHandle } from "../bluesky-handles.ts";
import { loadCostPolicy } from "./cost-policy.ts";
import { transaction } from "./database.ts";
import { isValidDid } from "./dids.ts";
import { isValidGitHubLogin } from "./github-oauth.ts";
import { recordLifeEnding } from "./lifecycle.ts";
import { ReadOnlyError, refreshOperationalStatusForPool, type OperationalPolicy } from "./operations.ts";

const hash = (token: string) => createHash("sha256").update(token).digest("hex");
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sessionToken = /^[0-9a-f]{64}$/;

export class DuplicatePostError extends Error {}
export class PostPreviewExpiredError extends Error {}

async function ensureHog(client: PoolClient, verifiedDid: string): Promise<string> {
  const existing = await client.query("SELECT id FROM hog_lives WHERE owner_did=$1 AND ended_at IS NULL", [verifiedDid]);
  if (existing.rowCount) return existing.rows[0].id as string;
  const latest = await client.query(
    "SELECT id FROM hog_lives WHERE owner_did=$1 ORDER BY generation DESC LIMIT 1",
    [verifiedDid],
  );
  if (latest.rowCount) return latest.rows[0].id as string;
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

export interface AccountSession {
  ownerDid: string;
  hogId: string | null;
  handle: string | null;
  authProvider: AuthProvider;
}

export interface HogView extends AppSession {
  state: GameState;
}

export async function getAccountSession(pool: Pool, token: string): Promise<AccountSession | null> {
  if (!sessionToken.test(token)) return null;
  const result = await pool.query<{
    owner_did: string;
    hog_id: string | null;
    handle: string | null;
    auth_provider: AuthProvider;
  }>(
    `SELECT session.owner_did, hog.id AS hog_id, account.handle, account.auth_provider
       FROM app_sessions session
       JOIN accounts account ON account.did=session.owner_did
       LEFT JOIN hog_lives hog ON hog.owner_did=session.owner_did AND hog.ended_at IS NULL
      WHERE session.token_hash=$1 AND session.expires_at > clock_timestamp()`,
    [hash(token)],
  );
  if (!result.rowCount) return null;
  return {
    ownerDid: result.rows[0].owner_did,
    hogId: result.rows[0].hog_id,
    handle: result.rows[0].handle,
    authProvider: result.rows[0].auth_provider,
  };
}

export async function getAppSession(pool: Pool, token: string): Promise<AppSession | null> {
  const session = await getAccountSession(pool, token);
  return session?.hogId ? { ownerDid: session.ownerDid, hogId: session.hogId } : null;
}

export async function setAccountHandle(pool: Pool, verifiedDid: string, handle: string): Promise<void> {
  if (!isValidDid(verifiedDid)) throw new Error("Invalid DID");
  if (!isValidBlueskyHandle(handle)) throw new Error("Invalid Bluesky handle");
  const result = await pool.query(
    "UPDATE accounts SET handle=$2 WHERE did=$1",
    [verifiedDid, handle],
  );
  if (!result.rowCount) throw new Error("Account does not exist");
}

export async function getHogView(pool: Pool, token: string): Promise<HogView | null> {
  if (!sessionToken.test(token)) return null;
  const result = await pool.query<{
    owner_did: string;
    hog_id: string;
    state: unknown;
    now_ms: number;
  }>(
    `SELECT session.owner_did, hog.id AS hog_id, hog.state,
            floor(extract(epoch FROM clock_timestamp()) * 1000)::float8 AS now_ms
       FROM app_sessions session
       JOIN hog_lives hog ON hog.owner_did=session.owner_did AND hog.ended_at IS NULL
      WHERE session.token_hash=$1 AND session.expires_at > clock_timestamp()`,
    [hash(token)],
  );
  if (!result.rowCount) return null;
  const row = result.rows[0];
  const state = parseGameState(row.state);
  return {
    ownerDid: row.owner_did,
    hogId: row.hog_id,
    state: advanceGameTime(state, Math.max(row.now_ms, state.updatedAtMs)).state,
  };
}

export interface RevokedSession {
  ownerDid: string;
  authProvider: AuthProvider;
}

export async function revokeSession(pool: Pool, token: string): Promise<RevokedSession | null> {
  if (!sessionToken.test(token)) return null;
  const result = await pool.query<{ owner_did: string; auth_provider: AuthProvider }>(
    `DELETE FROM app_sessions session
      USING accounts account
      WHERE session.token_hash=$1 AND account.did=session.owner_did
      RETURNING session.owner_did, account.auth_provider`,
    [hash(token)],
  );
  const row = result.rows[0];
  return row ? { ownerDid: row.owner_did, authProvider: row.auth_provider } : null;
}

async function completeSignIn(
  pool: Pool,
  verifiedDid: string,
  verifiedHandle: string | undefined,
  authProvider: AuthProvider,
): Promise<{ token: string; hogId: string }> {
  if (!isValidDid(verifiedDid)) throw new Error("Invalid DID");
  return transaction(pool, async client => {
    const account = await client.query<{ auth_provider: AuthProvider }>(
      `INSERT INTO accounts(did, handle, auth_provider) VALUES ($1,$2,$3)
       ON CONFLICT (did) DO UPDATE
         SET handle=COALESCE(EXCLUDED.handle, accounts.handle)
       WHERE accounts.auth_provider=EXCLUDED.auth_provider
       RETURNING auth_provider`,
      [verifiedDid, verifiedHandle ?? null, authProvider],
    );
    if (!account.rowCount) throw new Error("Account identity provider does not match");
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

export async function completeOAuthSignIn(
  pool: Pool,
  verifiedDid: string,
  verifiedHandle?: string,
): Promise<{ token: string; hogId: string }> {
  if (verifiedHandle !== undefined && !isValidBlueskyHandle(verifiedHandle)) {
    throw new Error("Invalid Bluesky handle");
  }
  return completeSignIn(pool, verifiedDid, verifiedHandle, "bluesky");
}

export async function completeGitHubSignIn(
  pool: Pool,
  githubUserId: string,
  githubLogin: string,
): Promise<{ token: string; hogId: string }> {
  if (!/^[1-9][0-9]{0,19}$/.test(githubUserId)) throw new Error("Invalid GitHub user ID");
  if (!isValidGitHubLogin(githubLogin)) {
    throw new Error("Invalid GitHub login");
  }
  return completeSignIn(pool, `did:github:${githubUserId}`, githubLogin, "github");
}

async function readOnlyAction(
  pool: Pool,
  token: string,
  hogId: string,
  requestId: string,
  action: ReturnType<typeof parseGameAction>,
  source: { uri: string; cid: string } | null,
): Promise<GameResult> {
  const existing = await pool.query<{
    ended_at: Date | null;
    receipt_id: string | null;
    action: unknown | null;
    result: GameResult | null;
    source_uri: string | null;
    observed_source_cid: string | null;
  }>(
    `SELECT hog.ended_at, receipt.hog_id::text AS receipt_id, receipt.action, receipt.result,
            receipt.source_uri, receipt.observed_source_cid
       FROM hog_lives hog
       JOIN app_sessions session
         ON session.owner_did=hog.owner_did
        AND session.token_hash=$2
        AND session.expires_at > clock_timestamp()
       LEFT JOIN hog_actions receipt
         ON receipt.hog_id=hog.id AND receipt.request_id=$3
      WHERE hog.id=$1`,
    [hogId, hash(token), requestId],
  );
  if (!existing.rowCount) throw new Error("Unauthorized");
  const row = existing.rows[0];
  if (row.receipt_id) {
    if (
      JSON.stringify(parseGameAction(row.action)) !== JSON.stringify(action)
      || row.source_uri !== (source?.uri ?? null)
      || row.observed_source_cid !== (source?.cid ?? null)
    ) {
      throw new Error("Request ID already used for a different action");
    }
    return row.result as GameResult;
  }
  if (row.ended_at) throw new Error("Hog life has ended");
  throw new ReadOnlyError("Slop Hogs is temporarily read-only");
}

export async function feedHog(
  pool: Pool,
  token: string,
  hogId: string,
  requestId: string,
  input: unknown,
  operationalPolicy?: OperationalPolicy,
): Promise<GameResult> {
  return actOnHog(pool, token, hogId, requestId, input, null, operationalPolicy);
}

export async function cleanHog(
  pool: Pool,
  token: string,
  hogId: string,
  requestId: string,
  operationalPolicy?: OperationalPolicy,
): Promise<GameResult> {
  return actOnHog(pool, token, hogId, requestId, { type: "clean" }, null, operationalPolicy);
}

export async function feedHogFromPost(
  pool: Pool,
  token: string,
  hogId: string,
  requestId: string,
  food: FoodKind,
  sourceUri: string,
  sourceCid: string,
  operationalPolicy?: OperationalPolicy,
): Promise<GameResult> {
  if (
    sourceUri.length > 2_048
    || !sourceUri.startsWith("at://")
    || !/^[A-Za-z0-9]{1,512}$/.test(sourceCid)
  ) {
    throw new Error("Invalid post source");
  }
  return actOnHog(
    pool,
    token,
    hogId,
    requestId,
    { type: "feed", food },
    { uri: sourceUri, cid: sourceCid },
    operationalPolicy,
  );
}

async function actOnHog(
  pool: Pool,
  token: string,
  hogId: string,
  requestId: string,
  input: unknown,
  source: { uri: string; cid: string } | null,
  operationalPolicy?: OperationalPolicy,
): Promise<GameResult> {
  if (!uuid.test(hogId) || !uuid.test(requestId)) throw new Error("Invalid action identifiers");
  if (!sessionToken.test(token)) throw new Error("Unauthorized");
  const action = parseGameAction(input);
  if (!operationalPolicy) {
    const costPolicy = loadCostPolicy();
    operationalPolicy = {
      database: costPolicy.database,
      readOnlyMode: costPolicy.features.readOnlyMode,
    };
  }
  const controls = await refreshOperationalStatusForPool(pool, operationalPolicy);
  if (controls.readOnly) return readOnlyAction(pool, token, hogId, requestId, action, source);
  const result = await transaction(pool, async client => {
    // Serialize each hog before checking expiry/time. Waiting requests cannot use stale time.
    const hog = await client.query("SELECT owner_did, state, ended_at FROM hog_lives WHERE id=$1 FOR UPDATE", [hogId]);
    const session = await client.query("SELECT owner_did FROM app_sessions WHERE token_hash=$1 AND expires_at > clock_timestamp() FOR SHARE", [hash(token)]);
    if (!hog.rowCount || !session.rowCount || hog.rows[0].owner_did !== session.rows[0].owner_did) throw new Error("Unauthorized");
    const previous = await client.query(
      `SELECT action, result, source_uri, observed_source_cid
         FROM hog_actions WHERE hog_id=$1 AND request_id=$2`,
      [hogId, requestId],
    );
    if (previous.rowCount) {
      if (
        JSON.stringify(parseGameAction(previous.rows[0].action)) !== JSON.stringify(action)
        || previous.rows[0].source_uri !== (source?.uri ?? null)
        || previous.rows[0].observed_source_cid !== (source?.cid ?? null)
      ) {
        throw new Error("Request ID already used for a different action");
      }
      return previous.rows[0].result as GameResult;
    }
    if (hog.rows[0].ended_at) throw new Error("Hog life has ended");
    let observedSourceCid: string | null = null;
    if (source) {
      const sourceRow = await client.query<{ observed_cid: string }>(
        `SELECT observed_cid FROM post_sources
          WHERE canonical_uri=$1 AND observed_cid=$2 AND available
            AND preview_expires_at > clock_timestamp()
          FOR SHARE`,
        [source.uri, source.cid],
      );
      if (!sourceRow.rowCount) throw new PostPreviewExpiredError("The post changed or expired. Preview it again before feeding.");
      const duplicate = await client.query(
        "SELECT 1 FROM hog_actions WHERE hog_id=$1 AND source_uri=$2",
        [hogId, source.uri],
      );
      if (duplicate.rowCount) throw new DuplicatePostError("This hog has already eaten that post");
      observedSourceCid = sourceRow.rows[0].observed_cid;
    }
    const clock = await client.query("SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::float8 AS now");
    const state = parseGameState(hog.rows[0].state);
    const result = applyGameAction(state, action, Math.max(clock.rows[0].now, state.updatedAtMs));
    await client.query("UPDATE hog_lives SET state=$2 WHERE id=$1", [hogId, result.state]);
    // State and ordered events are committed together in the same action receipt.
    await client.query(
      `INSERT INTO hog_actions(hog_id, request_id, action, result, source_uri, observed_source_cid)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [hogId, requestId, action, result, source?.uri ?? null, observedSourceCid],
    );
    await recordLifeEnding(client, hogId, requestId, result);
    return result;
  });
  return result;
}
