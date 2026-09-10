import assert from "node:assert/strict";
import { test } from "node:test";
import { createClientMetadata, parseAppOrigin, parseEncryptionKey, parseInvitedDids, parseOwnerDids } from "../src/lib/server/oauth-config.ts";
import { loginSource } from "../src/lib/server/oauth.ts";

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

test("OAuth secrets, invites, and trusted proxy addresses are validated", () => {
  const encoded = Buffer.alloc(32, 7).toString("base64");
  assert.deepEqual(parseEncryptionKey(encoded), Buffer.alloc(32, 7));
  assert.throws(() => parseEncryptionKey(Buffer.alloc(31).toString("base64")), /32 bytes/);
  assert.deepEqual([...parseInvitedDids("did:plc:alice, did:web:example.com")], [
    "did:plc:alice",
    "did:web:example.com",
  ]);
  assert.throws(() => parseInvitedDids("alice.bsky.social"), /invalid DID/);
  assert.deepEqual([...parseOwnerDids("did:plc:owner")], ["did:plc:owner"]);
  assert.throws(() => parseOwnerDids("owner.bsky.social"), /invalid DID/);

  const request = new Request("https://hogs.example", { headers: { "x-forwarded-for": "spoofed, 203.0.113.8" } });
  assert.equal(loginSource(request, 1), "203.0.113.8");
  assert.equal(loginSource(request, 2), "spoofed");
  assert.equal(loginSource(request, 0), "direct");
  assert.throws(() => loginSource(new Request("https://hogs.example"), 1), /missing/);
});
