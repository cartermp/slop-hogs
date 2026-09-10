export const BLUESKY_PUBLIC_API = "https://public.api.bsky.app";

const handlePattern = /^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;

export function normalizeBlueskyHandle(value: string): string {
  return value.trim().replace(/^@/, "").toLowerCase();
}

export function isValidBlueskyHandle(value: string): boolean {
  return handlePattern.test(value);
}

export function parseBlueskyHandle(value: string): string | null {
  const handle = normalizeBlueskyHandle(value);
  return isValidBlueskyHandle(handle) ? handle : null;
}

export function parseBlueskyHandleQuery(value: string): string | null {
  const query = normalizeBlueskyHandle(value);
  if (
    query.length < 2
    || query.length > 253
    || !/^[a-z0-9][a-z0-9.-]*$/.test(query)
    || query.includes("..")
  ) {
    return null;
  }
  return query;
}
