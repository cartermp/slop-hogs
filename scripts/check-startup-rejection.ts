import assert from "node:assert/strict";
import { generateKeyPairSync, randomBytes } from "node:crypto";
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
  writeFileSync(join(directory, "config/cost-policy.json"), JSON.stringify(input));
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const baseEnv: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: "production",
    NEXT_TELEMETRY_DISABLED: "1",
    APP_ORIGIN: "https://hogs.example",
    OAUTH_PRIVATE_KEY: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    OAUTH_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    TRUSTED_PROXY_COUNT: "1",
  };

  function rejectedStartup(overrides: Record<string, string | undefined> = {}) {
    const result = spawnSync(
      process.execPath,
      [resolve("node_modules/next/dist/bin/next"), "start", "-p", "4318", "-H", "127.0.0.1"],
      {
        cwd: directory,
        env: { ...baseEnv, ...overrides },
        encoding: "utf8",
        timeout: 10_000,
      },
    );
    assert.ifError(result.error);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    const event = JSON.parse(result.stderr.trim());
    assert.equal(event.event, "server.activity");
    assert.equal(event.activity, "service.startup");
    assert.equal(event.outcome, "failure");
    return event;
  }

  const oauthEvent = rejectedStartup({ OAUTH_PRIVATE_KEY: "" });
  assert.equal(oauthEvent.startup_stage, "oauth_configuration_validation");
  assert.equal(oauthEvent.error_message, "OAUTH_PRIVATE_KEY is required");

  input.paidAiMonthlyBudgetCents = 1;
  writeFileSync(join(directory, "config/cost-policy.json"), JSON.stringify(input));
  const policyEvent = rejectedStartup();
  assert.equal(policyEvent.startup_stage, "cost_policy_validation");
  assert.equal(policyEvent.error_message, "Paid AI budget must be zero");
  console.log("Direct Next production startup rejects unsafe policy and incomplete OAuth configuration.");
} finally {
  rmSync(directory, { recursive: true, force: true });
}
