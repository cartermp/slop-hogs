import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { parseCostPolicy } from "../src/lib/cost-policy.ts";

const fixture = () => JSON.parse(readFileSync(new URL("../config/cost-policy.json", import.meta.url), "utf8"));

test("committed policy enables only enforced controls and keeps paid AI closed", () => {
  const policy = parseCostPolicy(fixture());
  assert.equal(policy.features.externalPreviews, true);
  assert.equal(policy.features.cardRendering, true);
  assert.ok(Object.entries(policy.features)
    .filter(([name]) => !["externalPreviews", "cardRendering"].includes(name))
    .every(([, value]) => value === false));
  assert.equal(policy.paidAiMonthlyBudgetCents, 0);
  assert.equal(policy.railway.computeHardLimitCents, 3_000);
  assert.deepEqual(
    {
      sender: policy.limits.giftsPerSenderPerDay,
      recipient: policy.limits.giftsPerRecipientPerDay,
      pending: policy.limits.pendingGiftsPerRecipient,
    },
    { sender: 3, recipient: 10, pending: 20 },
  );
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
  for (const key of Object.keys(fixture().features)
    .filter(key => !["readOnlyMode", "externalPreviews", "cardRendering"].includes(key))) {
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
  const readOnly = fixture();
  readOnly.features.readOnlyMode = true;
  assert.equal(parseCostPolicy(readOnly).features.readOnlyMode, true);
  const previewsDisabled = fixture();
  previewsDisabled.features.externalPreviews = false;
  assert.equal(parseCostPolicy(previewsDisabled).features.externalPreviews, false);
  const cardsDisabled = fixture();
  cardsDisabled.features.cardRendering = false;
  assert.equal(parseCostPolicy(cardsDisabled).features.cardRendering, false);
});

test("missing and unknown keys fail instead of falling back", () => {
  for (const section of [null, "railway", "limits", "database", "features"]) {
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
  assert.throws(() => parseCostPolicy({ ...fixture(), version: 1 }));
  for (const paidAiMonthlyBudgetCents of [1, -1, "0", null]) {
    assert.throws(() => parseCostPolicy({ ...fixture(), paidAiMonthlyBudgetCents }));
  }
  const input = fixture();
  input.limits.cardStorageMaxBytes = input.limits.cardMaxBytes - 1;
  assert.throws(() => parseCostPolicy(input));
});

test("database budget and thresholds can only become stricter", () => {
  for (const [key, value] of [
    ["maxBytes", 1_000_000_001],
    ["warningPercent", 71],
    ["restrictPercent", 86],
    ["readOnlyPercent", 96],
  ] as const) {
    const input = fixture();
    input.database[key] = value;
    assert.throws(() => parseCostPolicy(input), /positive integer/);
  }
  for (const database of [
    { maxBytes: 1_000_000_000, warningPercent: 70, restrictPercent: 70, readOnlyPercent: 95 },
    { maxBytes: 1_000_000_000, warningPercent: 69, restrictPercent: 85, readOnlyPercent: 85 },
  ]) assert.throws(() => parseCostPolicy({ ...fixture(), database }), /must increase/);
});

test("lower finite limits are allowed without enabling features", () => {
  const input = fixture();
  input.railway = { usageAlertCents: 500, computeHardLimitCents: 1_000 };
  input.database = { maxBytes: 500_000_000, warningPercent: 50, restrictPercent: 75, readOnlyPercent: 90 };
  assert.equal(parseCostPolicy(input).railway.computeHardLimitCents, 1_000);
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
