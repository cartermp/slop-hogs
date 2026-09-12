import assert from "node:assert/strict";
import { test } from "node:test";
import {
  readBoundedJson,
  RequestBodyTooLargeError,
  sessionRateLimitKey,
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

test("token buckets fail closed when the bounded key set is full", () => {
  const limiter = new TokenBucketRateLimiter(1);
  const policy = { refillPerMinute: 1, burst: 1 };
  assert.equal(limiter.reserve("alice", policy, 0), true);
  assert.equal(limiter.reserve("bob", policy, 1), false);
  assert.equal(limiter.reserve("bob", policy, 10 * 60 * 1_000), true);
});

test("session rate-limit keys accept only valid tokens and do not retain secrets", () => {
  const token = "a".repeat(64);
  const key = sessionRateLimitKey(token);
  assert.match(key ?? "", /^[0-9a-f]{64}$/);
  assert.notEqual(key, token);
  for (const invalid of ["", "a".repeat(63), "A".repeat(64), "g".repeat(64)]) {
    assert.equal(sessionRateLimitKey(invalid), null);
  }
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
