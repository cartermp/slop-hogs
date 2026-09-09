import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";

// One bounded production-server check. No external services or credentials.
const port = 4317;
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(port), "-H", "127.0.0.1"], {
  env: { ...process.env, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1" },
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
  assert.match(html, /The pen is under construction/);
  assert.equal(response.headers.get("x-powered-by"), null);
  console.log("Production shell and health endpoint passed.");
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
