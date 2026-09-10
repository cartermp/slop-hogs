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
  const input = JSON.parse(readFileSync("config/cost-policy.json", "utf8"));
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
  console.log("Direct Next production startup terminates for unsafe policy.");
} finally {
  rmSync(directory, { recursive: true, force: true });
}
