import { createPrivateKey } from "node:crypto";
import type { OAuthClientMetadataInput } from "@atproto/oauth-client-node";
import { isValidDid } from "./dids.ts";
import { loadTrustedProxyCount } from "./proxy-config.ts";

export interface OAuthConfig {
  origin: string;
  privateKey: string;
  encryptionKey: Buffer;
  keyId: string;
  trustedProxyCount: number;
}

export function parseAppOrigin(value: string | undefined, production = process.env.NODE_ENV === "production"): string {
  if (!value) throw new Error("APP_ORIGIN is required");
  const url = new URL(value);
  const localHttp = !production && url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
  if (url.protocol !== "https:" && !localHttp) throw new Error("APP_ORIGIN must use HTTPS");
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("APP_ORIGIN must be an origin without credentials, path, query, or fragment");
  }
  return url.origin;
}

export function parseEncryptionKey(value: string | undefined): Buffer {
  if (!value || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new Error("OAUTH_ENCRYPTION_KEY must be base64");
  }
  const key = Buffer.from(value, "base64");
  if (key.length !== 32) throw new Error("OAUTH_ENCRYPTION_KEY must decode to 32 bytes");
  return key;
}

export function parseOAuthPrivateKey(value: string | undefined): string {
  if (!value) throw new Error("OAUTH_PRIVATE_KEY is required");
  let key: ReturnType<typeof createPrivateKey>;
  try {
    key = createPrivateKey(value);
  } catch {
    throw new Error("OAUTH_PRIVATE_KEY must be a valid PEM private key");
  }
  if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") {
    throw new Error("OAUTH_PRIVATE_KEY must be a P-256 EC private key");
  }
  return value;
}

export function parseOwnerDids(value = ""): ReadonlySet<string> {
  const owners = new Set(value.split(",").map(item => item.trim()).filter(Boolean));
  for (const owner of owners) {
    if (!isValidDid(owner)) throw new Error("SLOP_HOGS_OWNER_DIDS contains an invalid DID");
  }
  return owners;
}

export function loadOAuthConfig(env: NodeJS.ProcessEnv = process.env): OAuthConfig {
  const production = env.NODE_ENV === "production";
  const keyId = env.OAUTH_KEY_ID ?? "slop-hogs-1";
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(keyId)) throw new Error("OAUTH_KEY_ID is invalid");
  return {
    origin: parseAppOrigin(env.APP_ORIGIN, production),
    privateKey: parseOAuthPrivateKey(env.OAUTH_PRIVATE_KEY),
    encryptionKey: parseEncryptionKey(env.OAUTH_ENCRYPTION_KEY),
    keyId,
    trustedProxyCount: loadTrustedProxyCount(env),
  };
}

export function createClientMetadata(origin: string): OAuthClientMetadataInput {
  return {
    client_id: `${origin}/oauth/client-metadata.json`,
    client_name: "Slop Hogs",
    client_uri: origin,
    redirect_uris: [`${origin}/oauth/callback`],
    grant_types: ["authorization_code", "refresh_token"],
    scope: "atproto",
    response_types: ["code"],
    application_type: "web",
    token_endpoint_auth_method: "private_key_jwt",
    token_endpoint_auth_signing_alg: "ES256",
    dpop_bound_access_tokens: true,
    jwks_uri: `${origin}/oauth/jwks.json`,
  };
}
