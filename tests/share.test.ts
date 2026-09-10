import assert from "node:assert/strict";
import { test } from "node:test";
import { DIET_APPEARANCES } from "../src/components/hog/appearance.ts";
import { createGameState } from "../src/lib/game.ts";
import { createSpeechDraft, parseShareSpeech } from "../src/lib/share.ts";
import {
  renderShareCardPng,
  SHARE_CARD_HEIGHT,
  SHARE_CARD_WIDTH,
} from "../src/lib/server/share-card-renderer.ts";

test("authored speech is deterministic, diet-aware and bounded", () => {
  const state = createGameState(1_000, 7);
  state.taste.ai_image = 2;
  const first = createSpeechDraft(state, "glazed_eyes", "event:1");
  assert.equal(createSpeechDraft(state, "glazed_eyes", "event:1"), first);
  assert.match(first, /4K|premium visual/);
  assert.match(first, /Glazed Eyes unlocked/);
  assert.ok(first.length <= 280);

  const mixed = createSpeechDraft(createGameState(1_000, 7), "mud_crown", "event:2");
  assert.match(mixed, /balanced diet|contained multitudes/);
});

test("speech edits trim safe text and reject empty or oversized drafts", () => {
  assert.equal(parseShareSpeech("  hello hog  "), "hello hog");
  assert.throws(() => parseShareSpeech("   "), /1 to 280/);
  assert.throws(() => parseShareSpeech("x".repeat(281)), /1 to 280/);
  assert.throws(() => parseShareSpeech(null), /must be text/);
});

test("local share-card rendering returns a bounded PNG without fetching assets", async () => {
  const png = await renderShareCardPng({
    appearance: DIET_APPEARANCES.ai_image,
    mutationName: "Glazed Eyes",
    speech: "The prompt was unclear, but the consequences are in 4K.",
  }, 5_000);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.ok(png.length > 1_000);
  assert.ok(png.length < 250_000);

  const sharp = (await import("sharp")).default;
  const metadata = await sharp(png).metadata();
  assert.equal(metadata.width, SHARE_CARD_WIDTH);
  assert.equal(metadata.height, SHARE_CARD_HEIGHT);
});
