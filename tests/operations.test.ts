import assert from "node:assert/strict";
import { test } from "node:test";
import { deriveStorageControls } from "../src/lib/server/operations.ts";

const policy = {
  maxBytes: 1_000,
  warningPercent: 70,
  restrictPercent: 85,
  readOnlyPercent: 95,
};

test("database growth thresholds warn, restrict cards, then make writes read-only", () => {
  assert.deepEqual(
    deriveStorageControls(700, policy, false, new Date(0)),
    {
      databaseSizeBytes: 700,
      usedPercent: 70,
      warning: true,
      cardsBlocked: false,
      readOnly: false,
      measuredAt: new Date(0),
    },
  );
  const restricted = deriveStorageControls(850, policy, false);
  assert.equal(restricted.cardsBlocked, true);
  assert.equal(restricted.readOnly, false);
  assert.equal(deriveStorageControls(950, policy, false).readOnly, true);
});

test("manual read-only mode overrides storage and invalid measurements fail closed", () => {
  const manual = deriveStorageControls(1, policy, true);
  assert.equal(manual.readOnly, true);
  assert.equal(manual.cardsBlocked, true);
  for (const size of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => deriveStorageControls(size, policy, false), /nonnegative safe integer/);
  }
});
