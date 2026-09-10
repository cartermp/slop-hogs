import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCleanupArguments } from "../src/lib/server/test-data-cleanup.ts";

test("cleanup arguments default to a deduplicated preview", () => {
  assert.deepEqual(parseCleanupArguments(["did:plc:testaccount", "did:plc:testaccount"]), {
    dids: ["did:plc:testaccount"],
    execute: false,
  });
});

test("cleanup arguments require explicit execution and reject unsafe targets", () => {
  assert.deepEqual(parseCleanupArguments(["--execute", "did:plc:testaccount"]), {
    dids: ["did:plc:testaccount"],
    execute: true,
  });
  assert.throws(() => parseCleanupArguments([]), /at least one test account DID/);
  assert.throws(() => parseCleanupArguments(["--all"]), /Unknown option/);
  assert.throws(() => parseCleanupArguments(["not-a-did"]), /Invalid DID/);
  assert.throws(
    () => parseCleanupArguments(["did:plc:deploymentcheck123"]),
    /retained operations fixture/,
  );
  assert.throws(
    () => parseCleanupArguments(["did:plc:backuprestorecheck"]),
    /retained operations fixture/,
  );
});
