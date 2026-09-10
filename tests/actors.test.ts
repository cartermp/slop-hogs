import assert from "node:assert/strict";
import { test } from "node:test";
import { parseBlueskyHandle, parseBlueskyHandleQuery } from "../src/lib/bluesky-handles.ts";
import { searchBlueskyActors } from "../src/lib/server/actors.ts";

const limits = {
  externalRequestTimeoutMs: 1_000,
  externalResponseMaxBytes: 10_000,
};

test("Bluesky handles normalize and reject invalid input", () => {
  assert.equal(parseBlueskyHandle(" @PhillipCarter.dev "), "phillipcarter.dev");
  assert.equal(parseBlueskyHandle("phillip"), null);
  assert.equal(parseBlueskyHandle("https://phillipcarter.dev"), null);
  assert.equal(parseBlueskyHandleQuery("@ph"), "ph");
  assert.equal(parseBlueskyHandleQuery("p"), null);
  assert.equal(parseBlueskyHandleQuery("phillip..carter"), null);
});

test("actor search uses the fixed public endpoint and returns a bounded normalized list", async () => {
  let requestedUrl = "";
  const actors = await searchBlueskyActors(" PhillipCarter.dev ", limits, async input => {
    requestedUrl = String(input);
    return Response.json({
      actors: [
        { did: "did:plc:one", handle: "PhillipCarter.dev", displayName: "Phillip Carter" },
        { did: "did:plc:one", handle: "phillipcarter.dev", displayName: "Duplicate" },
        { did: "did:plc:two", handle: "phillip.bsky.social" },
        { did: "did:plc:three", handle: "phillip.example", displayName: "" },
        { did: "did:plc:four", handle: "four.example" },
        { did: "did:plc:five", handle: "five.example" },
        { did: "did:plc:six", handle: "six.example" },
      ],
    });
  });
  assert.equal(
    requestedUrl,
    "https://public.api.bsky.app/xrpc/app.bsky.actor.searchActorsTypeahead?q=phillipcarter.dev&limit=5",
  );
  assert.deepEqual(actors, [
    { did: "did:plc:one", handle: "phillipcarter.dev", displayName: "Phillip Carter" },
    { did: "did:plc:two", handle: "phillip.bsky.social", displayName: null },
    { did: "did:plc:three", handle: "phillip.example", displayName: null },
    { did: "did:plc:four", handle: "four.example", displayName: null },
    { did: "did:plc:five", handle: "five.example", displayName: null },
  ]);
});

test("actor search rejects invalid and oversized provider responses", async () => {
  assert.deepEqual(
    await searchBlueskyActors("x", limits, async () => {
      throw new Error("fetch should not run");
    }),
    [],
  );
  await assert.rejects(
    searchBlueskyActors("valid.example", limits, async () => Response.json({
      actors: [{ did: "not-a-did", handle: "valid.example" }],
    })),
    /invalid actor/,
  );
  await assert.rejects(
    searchBlueskyActors("valid.example", { ...limits, externalResponseMaxBytes: 5 }, async () =>
      Response.json({ actors: [] })),
    /size limit/,
  );
});
