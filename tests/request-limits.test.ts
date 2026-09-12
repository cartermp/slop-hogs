import assert from "node:assert/strict";
import { test } from "node:test";
import {
  rateLimitKey,
  readBoundedJson,
  RequestBodyTooLargeError,
  TokenBucketRateLimiter,
} from "../src/lib/server/request-limits.ts";

test("token buckets allow a burst, refill gradually, and isolate accounts", () => {
  const limiter = new TokenBucketRateLimiter();
  const policy = { refillPerMinute: 60, burst: 2 };
  assert.equal(limiter.reserve("alice", policy, 1_000), true);
  assert.equal(limiter.reserve("alice", policy, 1_000), true);
  assert.equal(limiter.reserve("alice", policy, 1_000), false);
  assert.equal(limiter.reserve("bob", policy, 1_000), true);
  assert.equal(limiter.reserve("alice", policy, 1_999), false);
  assert.equal(limiter.reserve("alice", policy, 2_000), true);
});

test("token buckets evict the oldest key instead of blocking new clients", () => {
  const limiter = new TokenBucketRateLimiter(2);
  const policy = { refillPerMinute: 1, burst: 1 };
  assert.equal(limiter.reserve("alice", policy, 0), true);
  assert.equal(limiter.reserve("bob", policy, 1), true);
  assert.equal(limiter.reserve("alice", policy, 2), false);
  assert.equal(limiter.reserve("carol", policy, 3), true);
  assert.equal(limiter.reserve("bob", policy, 3), true, "least recently used key was evicted");
  assert.throws(() => new TokenBucketRateLimiter(0), /positive integer/);
});

test("rate-limit keys are namespaced hashes that do not retain source addresses", () => {
  const source = "203.0.113.8";
  const key = rateLimitKey("farm", source);
  assert.match(key, /^[0-9a-f]{64}$/);
  assert.notEqual(key, source);
  assert.notEqual(key, rateLimitKey("login", source));
  assert.throws(() => rateLimitKey("", source), /required/);
});

test("bounded JSON accepts small bodies and rejects declared or streamed excess", async () => {
  const body = JSON.stringify({ type: "move", dx: 1, dy: 0 });
  const parsed = await readBoundedJson(new Request("https://example.test", {
    method: "POST",
    body,
  }), 1_024);
  assert.deepEqual(parsed, { type: "move", dx: 1, dy: 0 });

  await assert.rejects(
    readBoundedJson(new Request("https://example.test", {
      method: "POST",
      body,
      headers: { "content-length": "1025" },
    }), 1_024),
    RequestBodyTooLargeError,
  );
  await assert.rejects(
    readBoundedJson(new Request("https://example.test", {
      method: "POST",
      body: "x".repeat(1_025),
    }), 1_024),
    RequestBodyTooLargeError,
  );
});
