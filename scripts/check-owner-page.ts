import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { createDatabase } from "../src/lib/server/database.ts";
import { issueSession, provisionHog } from "../src/lib/server/hogs.ts";
import { migrate } from "../src/lib/server/migrations.ts";
import { deleteTestData } from "../src/lib/server/test-data-cleanup.ts";

assert.ok(process.env.TEST_DATABASE_URL, "Set TEST_DATABASE_URL to a disposable PostgreSQL database");
const pool = createDatabase(process.env.TEST_DATABASE_URL);
const ownerDid = `did:plc:ownertest${randomUUID().replaceAll("-", "")}`;
const nonOwnerDid = `did:plc:nonownertest${randomUUID().replaceAll("-", "")}`;
const port = 4319;
let server: ReturnType<typeof spawn> | undefined;
try {
  await migrate(pool);
  await Promise.all([provisionHog(pool, ownerDid), provisionHog(pool, nonOwnerDid)]);
  const [ownerToken, nonOwnerToken] = await Promise.all([
    issueSession(pool, ownerDid),
    issueSession(pool, nonOwnerDid),
  ]);
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(port), "-H", "127.0.0.1"], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      NEXT_TELEMETRY_DISABLED: "1",
      DATABASE_URL: process.env.TEST_DATABASE_URL,
      APP_ORIGIN: "https://hogs.example",
      OAUTH_PRIVATE_KEY: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      OAUTH_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
      SLOP_HOGS_OWNER_DIDS: ownerDid,
      TRUSTED_PROXY_COUNT: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  server.stdout?.on("data", chunk => { output = (output + String(chunk)).slice(-8_000); });
  server.stderr?.on("data", chunk => { output = (output + String(chunk)).slice(-8_000); });
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (server.exitCode !== null) throw new Error(`Owner-page server exited before readiness:\n${output}`);
    try {
      const health = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1_000) });
      if (health.status === 200) {
        ready = true;
        break;
      }
    } catch {
      await delay(250);
    }
  }
  if (!ready) throw new Error(`Owner-page server did not become ready:\n${output}`);

  const request = (token?: string) => fetch(`http://127.0.0.1:${port}/owner`, {
    headers: token ? { cookie: `slop_hogs_session=${token}` } : undefined,
    signal: AbortSignal.timeout(5_000),
  });
  assert.equal((await request()).status, 404, "anonymous owner access");
  assert.equal((await request(nonOwnerToken)).status, 404, "non-owner access");
  const ownerResponse = await request(ownerToken);
  assert.equal(ownerResponse.status, 200, "allowlisted owner access");
  assert.match(await ownerResponse.text(), /Launch controls/);
  console.log("Owner route rejects anonymous and non-owner sessions and accepts the configured owner.");
} finally {
  if (server && server.exitCode === null) {
    const exited = once(server, "exit");
    server.kill("SIGTERM");
    const force = setTimeout(() => server?.kill("SIGKILL"), 3_000);
    force.unref();
    await exited;
    clearTimeout(force);
  }
  await deleteTestData(pool, [ownerDid, nonOwnerDid]);
  await pool.end();
}
