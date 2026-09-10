import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

// Isolate an unsafe policy without modifying the working tree or production data.
const directory = mkdtempSync(join(tmpdir(), "slop-hogs-startup-"));
try {
  symlinkSync(resolve(".next"), join(directory, ".next"), "dir");
  symlinkSync(resolve("node_modules"), join(directory, "node_modules"), "dir");
  mkdirSync(join(directory, "config"));
  const validPolicy = JSON.parse(readFileSync("config/cost-policy.json", "utf8"));
  const input = structuredClone(validPolicy);
  input.paidAiMonthlyBudgetCents = 1;
  writeFileSync(join(directory, "config/cost-policy.json"), JSON.stringify(input));
  const result = spawnSync(process.execPath, [resolve("node_modules/next/dist/bin/next"), "start", "-p", "4318", "-H", "127.0.0.1"], {
    cwd: directory,
    env: { ...process.env, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1" },
    encoding: "utf8",
    timeout: 10_000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /Invalid cost policy\. Refusing startup\./);
  writeFileSync(join(directory, "config/cost-policy.json"), JSON.stringify(validPolicy));
  const missingOAuth = spawnSync(process.execPath, [resolve("node_modules/next/dist/bin/next"), "start", "-p", "4318", "-H", "127.0.0.1"], {
    cwd: directory,
    env: {
      ...process.env,
      NODE_ENV: "production",
      NEXT_TELEMETRY_DISABLED: "1",
      APP_ORIGIN: "",
      OAUTH_PRIVATE_KEY: "",
      OAUTH_ENCRYPTION_KEY: "",
      DATABASE_URL: "postgresql://test:test@127.0.0.1:1/test",
    },
    encoding: "utf8",
    timeout: 10_000,
  });
  assert.ifError(missingOAuth.error);
  assert.equal(missingOAuth.status, 1, missingOAuth.stdout + missingOAuth.stderr);
  assert.match(missingOAuth.stderr, /Invalid OAuth configuration\. Refusing startup\./);
  console.log("Direct Next production startup terminates for unsafe policy or OAuth configuration.");
} finally {
  rmSync(directory, { recursive: true, force: true });
}
