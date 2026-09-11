import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { test } from "node:test";
import {
  createClientMetadata,
  loadOAuthConfig,
  parseAppOrigin,
  parseEncryptionKey,
  parseOAuthPrivateKey,
  parseOwnerDids,
} from "../src/lib/server/oauth-config.ts";
import { loginSource } from "../src/lib/server/oauth.ts";
import { loadTrustedProxyCount } from "../src/lib/server/proxy-config.ts";

test("OAuth metadata requests identity only and publishes exact HTTPS URLs", () => {
  const origin = parseAppOrigin("https://hogs.example");
  const metadata = createClientMetadata(origin);
  assert.equal(metadata.scope, "atproto");
  assert.equal(metadata.client_id, "https://hogs.example/oauth/client-metadata.json");
  assert.deepEqual(metadata.redirect_uris, ["https://hogs.example/oauth/callback"]);
  assert.equal(metadata.token_endpoint_auth_method, "private_key_jwt");
  assert.equal(metadata.token_endpoint_auth_signing_alg, "ES256");
  assert.equal(metadata.jwks_uri, "https://hogs.example/oauth/jwks.json");
  assert.throws(() => parseAppOrigin("http://hogs.example", true), /HTTPS/);
  assert.throws(() => parseAppOrigin("https://hogs.example/path"), /must be an origin/);
});

test("OAuth secrets, owner DIDs, and trusted proxy addresses are validated", () => {
  const encoded = Buffer.alloc(32, 7).toString("base64");
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  assert.deepEqual(parseEncryptionKey(encoded), Buffer.alloc(32, 7));
  assert.throws(() => parseEncryptionKey(Buffer.alloc(31).toString("base64")), /32 bytes/);
  assert.equal(parseOAuthPrivateKey(privateKeyPem), privateKeyPem);
  assert.throws(() => parseOAuthPrivateKey("not a private key"), /valid PEM/);
  assert.throws(
    () => parseOAuthPrivateKey(
      generateKeyPairSync("ec", { namedCurve: "P-384" }).privateKey
        .export({ type: "pkcs8", format: "pem" })
        .toString(),
    ),
    /P-256/,
  );
  assert.equal(loadTrustedProxyCount({ NODE_ENV: "development" }), 0);
  assert.equal(loadTrustedProxyCount({ NODE_ENV: "production", TRUSTED_PROXY_COUNT: "1" }), 1);
  assert.throws(
    () => loadTrustedProxyCount({ NODE_ENV: "production" }),
    /TRUSTED_PROXY_COUNT/,
  );
  assert.equal(loadOAuthConfig({
    NODE_ENV: "production",
    APP_ORIGIN: "https://hogs.example",
    OAUTH_PRIVATE_KEY: privateKeyPem,
    OAUTH_ENCRYPTION_KEY: encoded,
    TRUSTED_PROXY_COUNT: "1",
  }).trustedProxyCount, 1);
  assert.deepEqual([...parseOwnerDids("did:plc:owner")], ["did:plc:owner"]);
  assert.throws(() => parseOwnerDids("owner.bsky.social"), /invalid DID/);

  const request = new Request("https://hogs.example", { headers: { "x-forwarded-for": "spoofed, 203.0.113.8" } });
  assert.equal(loginSource(request, 1), "203.0.113.8");
  assert.equal(loginSource(request, 2), "spoofed");
  assert.equal(loginSource(request, 0), "direct");
  assert.throws(() => loginSource(new Request("https://hogs.example"), 1), /missing/);
});
