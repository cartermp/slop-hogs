import assert from "node:assert/strict";
import { test } from "node:test";
import {
  fetchPostPreview,
  InvalidPostUrlError,
  parseBlueskyPostUrl,
  PostLookupError,
  PostUnavailableError,
} from "../src/lib/server/posts.ts";

const limits = {
  externalRequestTimeoutMs: 50,
  externalResponseMaxBytes: 1_000,
};

function remotePost(uri = "at://did:plc:alice/app.bsky.feed.post/3ltest") {
  return {
    posts: [{
      uri,
      cid: "bafyreialice",
      author: {
        did: "did:plc:alice",
        handle: "Alice.Bsky.Social",
        displayName: "Alice",
      },
      record: { text: "fresh slop" },
      indexedAt: "2026-09-10T12:00:00.000Z",
    }],
  };
}

test("supported Bluesky post URLs normalize to an AT URI", () => {
  assert.deepEqual(
    parseBlueskyPostUrl("https://bsky.app/profile/Alice.Bsky.Social/post/3ltest"),
    {
      lookupUrl: "https://bsky.app/profile/alice.bsky.social/post/3ltest",
      atUri: "at://alice.bsky.social/app.bsky.feed.post/3ltest",
      actor: "alice.bsky.social",
      recordKey: "3ltest",
    },
  );
  assert.equal(
    parseBlueskyPostUrl("https://bsky.app/profile/did:plc:alice/post/3ltest").atUri,
    "at://did:plc:alice/app.bsky.feed.post/3ltest",
  );
  for (const input of [
    "http://bsky.app/profile/alice.bsky.social/post/3ltest",
    "https://example.com/profile/alice.bsky.social/post/3ltest",
    "https://bsky.app/profile/alice.bsky.social",
    "https://bsky.app/profile/alice.bsky.social/post/3ltest?ref=1",
    "https://bsky.app/profile/alice.bsky.social/post/%33ltest",
    "https://bsky.app/profile/not-a-handle/post/3ltest",
  ]) {
    assert.throws(() => parseBlueskyPostUrl(input), InvalidPostUrlError, input);
  }
});

test("remote previews use the fixed public endpoint and accept its canonical identity", async () => {
  const target = parseBlueskyPostUrl("https://bsky.app/profile/alice.bsky.social/post/3ltest");
  let requested = "";
  const mockFetch: typeof fetch = async (input, init) => {
    requested = String(input);
    assert.equal(init?.redirect, "error");
    assert.equal(init?.cache, "no-store");
    return Response.json(remotePost());
  };
  const preview = await fetchPostPreview(target, limits, mockFetch);
  assert.equal(
    requested,
    "https://public.api.bsky.app/xrpc/app.bsky.feed.getPosts?uris=at%3A%2F%2Falice.bsky.social%2Fapp.bsky.feed.post%2F3ltest",
  );
  assert.deepEqual(preview, {
    canonicalUri: "at://did:plc:alice/app.bsky.feed.post/3ltest",
    cid: "bafyreialice",
    authorDid: "did:plc:alice",
    authorHandle: "alice.bsky.social",
    authorDisplayName: "Alice",
    text: "fresh slop",
    indexedAt: "2026-09-10T12:00:00.000Z",
    postUrl: "https://bsky.app/profile/alice.bsky.social/post/3ltest",
  });
});

test("unavailable, inconsistent, oversized, and timed-out previews fail explicitly", async () => {
  const target = parseBlueskyPostUrl("https://bsky.app/profile/alice.bsky.social/post/3ltest");
  const empty: typeof fetch = async () => Response.json({ posts: [] });
  await assert.rejects(fetchPostPreview(target, limits, empty), PostUnavailableError);

  const wrongRecord: typeof fetch = async () => Response.json(
    remotePost("at://did:plc:alice/app.bsky.feed.post/different"),
  );
  await assert.rejects(fetchPostPreview(target, limits, wrongRecord), /canonical post identity/);

  const wrongAuthorPayload = remotePost();
  wrongAuthorPayload.posts[0].author.handle = "bob.bsky.social";
  const wrongAuthor: typeof fetch = async () => Response.json(wrongAuthorPayload);
  await assert.rejects(fetchPostPreview(target, limits, wrongAuthor), /different post author/);

  const oversized: typeof fetch = async () => new Response("x".repeat(1_001));
  await assert.rejects(fetchPostPreview(target, limits, oversized), /size limit/);

  const hanging: typeof fetch = async (_input, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
  });
  await assert.rejects(fetchPostPreview(target, limits, hanging), (error: unknown) => {
    assert.ok(error instanceof PostLookupError);
    assert.match(error.message, /too long/);
    return true;
  });

  const hangingBody: typeof fetch = async (_input, init) => new Response(new ReadableStream({
    start(controller) {
      init?.signal?.addEventListener(
        "abort",
        () => controller.error(new DOMException("Aborted", "AbortError")),
        { once: true },
      );
    },
  }));
  await assert.rejects(fetchPostPreview(target, limits, hangingBody), /too long/);
});
