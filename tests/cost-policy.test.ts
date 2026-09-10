import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { parseCostPolicy } from "../src/lib/cost-policy.ts";

const fixture = () => JSON.parse(readFileSync(new URL("../config/cost-policy.json", import.meta.url), "utf8"));

test("committed policy enables only enforced registration and keeps paid AI closed", () => {
  const policy = parseCostPolicy(fixture());
  assert.equal(policy.features.registrations, true);
  assert.ok(Object.entries(policy.features).filter(([name]) => name !== "registrations").every(([, value]) => value === false));
  assert.equal(policy.paidAiMonthlyBudgetCents, 0);
  assert.equal(policy.railway.computeHardLimitCents, 3_000);
});

test("every quota rejects zero, negative, fractional, nonnumeric and excessive values", () => {
  const base = fixture();
  for (const key of Object.keys(base.limits)) {
    for (const value of [0, -1, 0.5, null, "12", NaN, Infinity, Number.MAX_SAFE_INTEGER, base.limits[key] + 1]) {
      const input = fixture();
      input.limits[key] = value;
      assert.throws(() => parseCostPolicy(input), /positive integer/, `${key}: ${String(value)}`);
    }
  }
});

test("unfinished features reject true and every feature rejects invalid booleans", () => {
  for (const key of Object.keys(fixture().features).filter(key => key !== "registrations")) {
    const enabled = fixture();
    enabled.features[key] = true;
    assert.throws(() => parseCostPolicy(enabled), /must remain false/);
  }
  for (const key of Object.keys(fixture().features)) {
    for (const value of ["false", "true", null, undefined]) {
      const input = fixture();
      input.features[key] = value;
      assert.throws(() => parseCostPolicy(input));
    }
  }
});

test("missing and unknown keys fail instead of falling back", () => {
  for (const section of [null, "railway", "limits", "features"]) {
    const input = fixture();
    const target = section ? input[section] : input;
    target.typo = 1;
    assert.throws(() => parseCostPolicy(input));
    delete target.typo;
    delete target[Object.keys(target)[0]];
    assert.throws(() => parseCostPolicy(input));
  }
  for (const input of [null, [], "policy", 1]) assert.throws(() => parseCostPolicy(input));
});

test("provider budgets cannot exceed the approved amount or invert alert and cutoff", () => {
  for (const railway of [
    { usageAlertCents: 1_500, computeHardLimitCents: 3_001 },
    { usageAlertCents: 1_501, computeHardLimitCents: 3_000 },
    { usageAlertCents: 1_500, computeHardLimitCents: 1_500 },
    { usageAlertCents: 1_500, computeHardLimitCents: 1_000 },
    { usageAlertCents: 0, computeHardLimitCents: 3_000 },
  ]) assert.throws(() => parseCostPolicy({ ...fixture(), railway }));
});

test("policy version, AI budget and image storage relationships are checked", () => {
  assert.throws(() => parseCostPolicy({ ...fixture(), version: 2 }));
  for (const paidAiMonthlyBudgetCents of [1, -1, "0", null]) {
    assert.throws(() => parseCostPolicy({ ...fixture(), paidAiMonthlyBudgetCents }));
  }
  const input = fixture();
  input.limits.cardStorageMaxBytes = input.limits.cardMaxBytes - 1;
  assert.throws(() => parseCostPolicy(input));
});

test("lower finite limits are allowed without enabling features", () => {
  const input = fixture();
  input.limits.accounts = 10;
  input.railway = { usageAlertCents: 500, computeHardLimitCents: 1_000 };
  assert.equal(parseCostPolicy(input).limits.accounts, 10);
  input.features.registrations = false;
  assert.equal(parseCostPolicy(input).features.registrations, false);
});

test("startup check exits nonzero for missing, malformed, or unsafe files", () => {
  const directory = mkdtempSync(join(tmpdir(), "slop-hogs-policy-"));
  const check = resolve("scripts/check-cost-policy.ts");
  const run = () => spawnSync(process.execPath, [check], { cwd: directory, encoding: "utf8", timeout: 5_000 });
  try {
    assert.equal(run().status, 1);
    mkdirSync(join(directory, "config"));
    for (const text of ["not json", JSON.stringify({ ...fixture(), paidAiMonthlyBudgetCents: 1 })]) {
      writeFileSync(join(directory, "config/cost-policy.json"), text);
      assert.equal(run().status, 1);
    }
    writeFileSync(join(directory, "config/cost-policy.json"), JSON.stringify(fixture()));
    assert.equal(run().status, 0);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
