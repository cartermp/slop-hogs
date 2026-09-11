import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";

// One bounded production-server check with disposable OAuth credentials.
const port = 4317;
const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(port), "-H", "127.0.0.1"], {
  env: {
    ...process.env,
    NODE_ENV: "production",
    NEXT_TELEMETRY_DISABLED: "1",
    DATABASE_URL: process.env.DATABASE_URL ?? "postgresql://test:test@127.0.0.1:1/test",
    APP_ORIGIN: "https://hogs.example",
    OAUTH_PRIVATE_KEY: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    OAUTH_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    TRUSTED_PROXY_COUNT: "1",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let output = "";
server.stdout.on("data", chunk => { output = (output + String(chunk)).slice(-8_000); });
server.stderr.on("data", chunk => { output = (output + String(chunk)).slice(-8_000); });
const exited = once(server, "exit");
try {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (server.exitCode !== null) throw new Error("Production server exited before readiness");
    try {
      const health = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1_000) });
      assert.equal(health.status, 200);
      assert.deepEqual(await health.json(), { status: "ok" });
      assert.equal(health.headers.get("cache-control"), "no-store");
      ready = true;
      break;
    } catch { await delay(250); }
  }
  assert.ok(ready, "Production server must become ready within the bounded retry window");
  const response = await fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(5_000) });
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Slop Hogs/);
  assert.match(html, /SLOP SYSTEMS PRESENTS/);
  assert.match(html, /Sign in with Bluesky/);
  const issueLinks = [...html.matchAll(/href="(https:\/\/github\.com\/cartermp\/slop-hogs\/issues\/new\?[^"]+)"/g)]
    .map(match => new URL(match[1].replaceAll("&amp;", "&")));
  assert.equal(issueLinks.length, 2);
  assert.deepEqual(issueLinks.map(link => link.searchParams.get("title")), ["[Feedback] ", "[Bug] "]);
  assert.match(issueLinks[0].searchParams.get("body") ?? "", /What would make Slop Hogs better/);
  assert.match(issueLinks[1].searchParams.get("body") ?? "", /Steps to reproduce/);
  assert.doesNotMatch(html, /SLOP SYSTEMS PRESENTS \/\/ \d{4}/);
  assert.doesNotMatch(html, /ROAM THE COMMUNAL FARM|EAT UNVERIFIED AI SLOP|GET BIG\. POP SPECTACULARLY/);
  assert.doesNotMatch(html, /IDENTITY BY BLUESKY|INSERT HOG/);
  assert.equal(response.headers.get("x-powered-by"), null);
  const farm = await fetch(`http://127.0.0.1:${port}/api/farm`, { signal: AbortSignal.timeout(5_000) });
  assert.equal(farm.status, 401);
  assert.deepEqual(await farm.json(), { error: "Sign in to enter the farm" });
  const metadataResponse = await fetch(`http://127.0.0.1:${port}/oauth/client-metadata.json`, {
    signal: AbortSignal.timeout(5_000),
  });
  assert.equal(metadataResponse.status, 200);
  const metadata = await metadataResponse.json();
  assert.equal(metadata.scope, "atproto");
  assert.equal(metadata.token_endpoint_auth_signing_alg, "ES256");
  assert.deepEqual(metadata.redirect_uris, ["https://hogs.example/oauth/callback"]);
  const jwksResponse = await fetch(`http://127.0.0.1:${port}/oauth/jwks.json`, {
    signal: AbortSignal.timeout(5_000),
  });
  assert.equal(jwksResponse.status, 200);
  const jwks = await jwksResponse.json();
  assert.equal(jwks.keys.length, 1);
  assert.equal(jwks.keys[0].d, undefined, "JWKS must expose only the public key");
  const gallery = await fetch(`http://127.0.0.1:${port}/gallery`, { signal: AbortSignal.timeout(5_000) });
  assert.equal(gallery.status, 404, "The development art gallery must stay out of production");
  const owner = await fetch(`http://127.0.0.1:${port}/owner`, { signal: AbortSignal.timeout(5_000) });
  assert.equal(owner.status, 404, "The owner page must reject anonymous requests");
  console.log("Production game shell, farm auth, health, OAuth metadata and anonymous owner denial passed.");
} catch (error) {
  console.error(output);
  throw error;
} finally {
  server.kill("SIGTERM");
  const force = setTimeout(() => server.kill("SIGKILL"), 3_000);
  force.unref();
  await exited;
  clearTimeout(force);
}
