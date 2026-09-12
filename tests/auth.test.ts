import assert from "node:assert/strict";
import { test } from "node:test";
import { canShareToBluesky } from "../src/lib/auth.ts";

test("only Bluesky-authenticated accounts can use Bluesky sharing", () => {
  assert.equal(canShareToBluesky("bluesky"), true);
  assert.equal(canShareToBluesky("github"), false);
});
