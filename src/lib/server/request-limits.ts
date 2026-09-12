import { createHash } from "node:crypto";

export interface TokenBucketPolicy {
  refillPerMinute: number;
  burst: number;
}

interface TokenBucket {
  tokens: number;
  updatedAtMs: number;
}

export class TokenBucketRateLimiter {
  private readonly buckets = new Map<string, TokenBucket>();
  private readonly maximumKeys: number;

  constructor(maximumKeys = 10_000) {
    if (!Number.isSafeInteger(maximumKeys) || maximumKeys <= 0) {
      throw new Error("Token bucket capacity must be a positive integer");
    }
    this.maximumKeys = maximumKeys;
  }

  reserve(key: string, policy: TokenBucketPolicy, nowMs = Date.now()): boolean {
    if (
      !key
      || !Number.isFinite(nowMs)
      || policy.refillPerMinute <= 0
      || policy.burst <= 0
    ) {
      throw new Error("Invalid token bucket input");
    }
    let bucket = this.buckets.get(key);
    if (!bucket) {
      if (this.buckets.size >= this.maximumKeys) this.removeOldestBucket();
      bucket = { tokens: policy.burst, updatedAtMs: nowMs };
    }
    const elapsedMs = Math.max(0, nowMs - bucket.updatedAtMs);
    bucket.tokens = Math.min(
      policy.burst,
      bucket.tokens + elapsedMs * policy.refillPerMinute / 60_000,
    );
    bucket.updatedAtMs = Math.max(bucket.updatedAtMs, nowMs);
    this.buckets.delete(key);
    this.buckets.set(key, bucket);
    if (bucket.tokens < 1) return false;
    bucket.tokens -= 1;
    return true;
  }

  private removeOldestBucket(): void {
    const oldestKey = this.buckets.keys().next().value;
    if (oldestKey !== undefined) this.buckets.delete(oldestKey);
  }
}

export class RequestBodyTooLargeError extends Error {}

export function rateLimitKey(namespace: string, source: string): string {
  if (!namespace || !source) throw new Error("Rate-limit key input is required");
  return createHash("sha256").update(`${namespace}:${source}`).digest("hex");
}

export async function readBoundedJson(request: Request, maxBytes: number): Promise<unknown> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0 || parsedLength > maxBytes) {
      throw new RequestBodyTooLargeError("Request body exceeds the configured size limit");
    }
  }
  if (!request.body) throw new SyntaxError("Request body is empty");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel();
      throw new RequestBodyTooLargeError("Request body exceeds the configured size limit");
    }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
