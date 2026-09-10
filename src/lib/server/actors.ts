import type { Pool } from "pg";
import { BLUESKY_PUBLIC_API, isValidBlueskyHandle, parseBlueskyHandleQuery } from "../bluesky-handles.ts";
import { isValidDid } from "./dids.ts";
import { reserveHourlyAttempt } from "./hourly-rate-limit.ts";

const SEARCH_LIMIT = 5;

export interface ActorSuggestion {
  did: string;
  handle: string;
  displayName: string | null;
}

export class ActorSearchRateLimitError extends Error {}

export async function reserveActorSearch(
  pool: Pool,
  source: string,
  limits: { actorSearchesPerIpPerHour: number; actorSearchesGlobalPerHour: number },
): Promise<void> {
  const allowed = await reserveHourlyAttempt(pool, "actor-search", source, {
    perSource: limits.actorSearchesPerIpPerHour,
    global: limits.actorSearchesGlobalPerHour,
  });
  if (!allowed) throw new ActorSearchRateLimitError("Too many actor searches");
}

type FetchImplementation = typeof fetch;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readBoundedBody(response: Response, maxBytes: number): Promise<string> {
  const declaredSize = Number(response.headers.get("content-length") ?? "0");
  if (!Number.isFinite(declaredSize) || declaredSize > maxBytes) {
    await response.body?.cancel();
    throw new Error("Bluesky response exceeds the configured size limit");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel();
      throw new Error("Bluesky response exceeds the configured size limit");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function parseActors(payload: unknown): ActorSuggestion[] {
  if (!isRecord(payload) || !Array.isArray(payload.actors)) {
    throw new Error("Bluesky returned an invalid actor search response");
  }
  const actors: ActorSuggestion[] = [];
  const seen = new Set<string>();
  for (const actor of payload.actors) {
    if (!isRecord(actor) || typeof actor.did !== "string" || typeof actor.handle !== "string") {
      throw new Error("Bluesky returned an invalid actor");
    }
    const handle = actor.handle.toLowerCase();
    const displayName = actor.displayName;
    if (
      !isValidDid(actor.did)
      || !isValidBlueskyHandle(handle)
      || (displayName !== undefined && (typeof displayName !== "string" || displayName.length > 640))
    ) {
      throw new Error("Bluesky returned an invalid actor");
    }
    if (!seen.has(actor.did)) {
      seen.add(actor.did);
      actors.push({ did: actor.did, handle, displayName: displayName || null });
    }
    if (actors.length === SEARCH_LIMIT) break;
  }
  return actors;
}

export async function searchBlueskyActors(
  input: string,
  limits: { externalRequestTimeoutMs: number; externalResponseMaxBytes: number },
  fetchImplementation: FetchImplementation = fetch,
): Promise<ActorSuggestion[]> {
  const query = parseBlueskyHandleQuery(input);
  if (!query) return [];
  const url = new URL("/xrpc/app.bsky.actor.searchActorsTypeahead", BLUESKY_PUBLIC_API);
  url.searchParams.set("q", query);
  url.searchParams.set("limit", String(SEARCH_LIMIT));
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), limits.externalRequestTimeoutMs);
  try {
    const response = await fetchImplementation(url, {
      headers: { accept: "application/json" },
      cache: "no-store",
      redirect: "error",
      signal: timeout.signal,
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Bluesky actor search returned HTTP ${response.status}`);
    }
    const text = await readBoundedBody(response, limits.externalResponseMaxBytes);
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error("Bluesky returned invalid actor search JSON");
    }
    return parseActors(payload);
  } finally {
    clearTimeout(timer);
  }
}
