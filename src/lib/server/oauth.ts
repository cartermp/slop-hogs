import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import {
  type Fetch,
  JoseKey,
  NodeOAuthClient,
  type NodeSavedSession,
  type NodeSavedSessionStore,
  type NodeSavedState,
  type NodeSavedStateStore,
  type RuntimeLock,
} from "@atproto/oauth-client-node";
import type { Pool } from "pg";
import { BLUESKY_PUBLIC_API } from "../bluesky-handles.ts";
import { getDatabase } from "./database.ts";
import { requestSource, reserveHourlyAttempt } from "./hourly-rate-limit.ts";
import { loadCostPolicy } from "./cost-policy.ts";
import { createClientMetadata, loadOAuthConfig, type OAuthConfig } from "./oauth-config.ts";

const oauthGlobal = globalThis as typeof globalThis & { slopHogsOAuthClient?: Promise<NodeOAuthClient> };

function encryptJson(value: unknown, key: Buffer): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return Buffer.concat([Buffer.from([1]), iv, cipher.getAuthTag(), encrypted]);
}

function decryptJson<T>(value: Buffer, key: Buffer): T {
  if (value.length <= 29 || value[0] !== 1) throw new Error("Unsupported encrypted OAuth data");
  const decipher = createDecipheriv("aes-256-gcm", key, value.subarray(1, 13));
  decipher.setAuthTag(value.subarray(13, 29));
  const plaintext = Buffer.concat([decipher.update(value.subarray(29)), decipher.final()]).toString("utf8");
  return JSON.parse(plaintext) as T;
}

export function createOAuthStores(
  pool: Pool,
  key: Buffer,
): { stateStore: NodeSavedStateStore; sessionStore: NodeSavedSessionStore } {
  const stateStore: NodeSavedStateStore = {
    async set(stateKey, value) {
      await pool.query(
        `DELETE FROM oauth_states WHERE state_key IN (
           SELECT state_key FROM oauth_states
            WHERE expires_at <= clock_timestamp()
            ORDER BY expires_at
            LIMIT 100
         )`,
      );
      await pool.query(
        `INSERT INTO oauth_states(state_key, encrypted_data, expires_at)
         VALUES ($1,$2,clock_timestamp() + interval '10 minutes')
         ON CONFLICT (state_key) DO UPDATE
           SET encrypted_data=EXCLUDED.encrypted_data, expires_at=EXCLUDED.expires_at`,
        [stateKey, encryptJson(value, key)],
      );
    },
    async get(stateKey) {
      const result = await pool.query<{ encrypted_data: Buffer }>(
        "SELECT encrypted_data FROM oauth_states WHERE state_key=$1 AND expires_at > clock_timestamp()",
        [stateKey],
      );
      return result.rowCount ? decryptJson<NodeSavedState>(result.rows[0].encrypted_data, key) : undefined;
    },
    async del(stateKey) {
      await pool.query("DELETE FROM oauth_states WHERE state_key=$1", [stateKey]);
    },
  };
  const sessionStore: NodeSavedSessionStore = {
    async set(did, value) {
      await pool.query(
        `INSERT INTO oauth_sessions(did, encrypted_data) VALUES ($1,$2)
         ON CONFLICT (did) DO UPDATE
           SET encrypted_data=EXCLUDED.encrypted_data, updated_at=clock_timestamp()`,
        [did, encryptJson(value, key)],
      );
    },
    async get(did) {
      const result = await pool.query<{ encrypted_data: Buffer }>(
        "SELECT encrypted_data FROM oauth_sessions WHERE did=$1",
        [did],
      );
      return result.rowCount ? decryptJson<NodeSavedSession>(result.rows[0].encrypted_data, key) : undefined;
    },
    async del(did) {
      await pool.query("DELETE FROM oauth_sessions WHERE did=$1", [did]);
    },
  };
  return { stateStore, sessionStore };
}

function createRequestLock(pool: Pool): RuntimeLock {
  return async (name, work) => {
    const lockHash = createHash("sha256").update(name).digest("hex");
    const ownerToken = randomUUID();
    const deadline = Date.now() + 5_000;
    while (true) {
      const result = await pool.query(
        `INSERT INTO oauth_locks(lock_hash, owner_token, expires_at)
         VALUES ($1,$2,clock_timestamp() + interval '30 seconds')
         ON CONFLICT (lock_hash) DO UPDATE
           SET owner_token=EXCLUDED.owner_token, expires_at=EXCLUDED.expires_at
         WHERE oauth_locks.expires_at <= clock_timestamp()
         RETURNING owner_token`,
        [lockHash, ownerToken],
      );
      if (result.rowCount) break;
      if (Date.now() >= deadline) throw new Error("Timed out waiting for an OAuth session lock");
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    try {
      return await work();
    } finally {
      try {
        await pool.query("DELETE FROM oauth_locks WHERE lock_hash=$1 AND owner_token=$2", [lockHash, ownerToken]);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown lock cleanup failure";
        console.error(`OAuth lock cleanup failed: ${message}`);
      }
    }
  };
}

function createBoundedFetch(timeoutMs: number, maxBytes: number): Fetch {
  return async (input, init) => {
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), timeoutMs);
    const requestSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    const signal = requestSignal ? AbortSignal.any([requestSignal, timeout.signal]) : timeout.signal;
    try {
      const response = await fetch(input, { ...init, signal });
      const declaredSize = Number(response.headers.get("content-length") ?? "0");
      if (!Number.isFinite(declaredSize) || declaredSize > maxBytes) {
        await response.body?.cancel();
        throw new Error("OAuth response exceeds the configured size limit");
      }
      if (!response.body) return response;
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let received = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > maxBytes) {
          await reader.cancel();
          throw new Error("OAuth response exceeds the configured size limit");
        }
        chunks.push(value);
      }
      return new Response(Buffer.concat(chunks), {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    } finally {
      clearTimeout(timer);
    }
  };
}

async function createOAuthClient(pool: Pool, config: OAuthConfig): Promise<NodeOAuthClient> {
  const signingKey = await JoseKey.fromImportable(config.privateKey, config.keyId);
  const stores = createOAuthStores(pool, config.encryptionKey);
  const limits = loadCostPolicy().limits;
  return new NodeOAuthClient({
    clientMetadata: createClientMetadata(config.origin),
    keyset: [signingKey],
    ...stores,
    requestLock: createRequestLock(pool),
    fetch: createBoundedFetch(limits.externalRequestTimeoutMs, limits.externalResponseMaxBytes),
    handleResolver: BLUESKY_PUBLIC_API,
    allowHttp: config.origin.startsWith("http://"),
  });
}

export function getOAuthClient(): Promise<NodeOAuthClient> {
  return oauthGlobal.slopHogsOAuthClient ??= createOAuthClient(getDatabase(), loadOAuthConfig());
}

export async function deleteOAuthSession(did: string): Promise<void> {
  const config = loadOAuthConfig();
  await createOAuthStores(getDatabase(), config.encryptionKey).sessionStore.del(did);
}

export class LoginRateLimitError extends Error {}

export const loginSource = requestSource;

export async function reserveLoginAttempt(
  pool: Pool,
  source: string,
  limits: { loginAttemptsPerIpPerHour: number; loginAttemptsGlobalPerHour: number },
): Promise<void> {
  const allowed = await reserveHourlyAttempt(pool, "login", source, {
    perSource: limits.loginAttemptsPerIpPerHour,
    global: limits.loginAttemptsGlobalPerHour,
  });
  if (!allowed) throw new LoginRateLimitError("Too many login attempts");
}
