import type { Pool, PoolClient } from "pg";
import type { CostPolicy } from "../cost-policy.ts";
import type { PreviewSummary } from "../post-form.ts";
import { BLUESKY_PUBLIC_API, isValidBlueskyHandle } from "../bluesky-handles.ts";
import { transaction } from "./database.ts";
import { isValidDid } from "./dids.ts";
import { getAppSession } from "./hogs.ts";

const POST_COLLECTION = "app.bsky.feed.post";
const PREVIEW_RETENTION_DAYS = 7;
const recordKeyPattern = /^[A-Za-z0-9._~:-]{1,512}$/;
const canonicalUriPattern = /^at:\/\/(did:[a-z]+:[A-Za-z0-9._:%-]+)\/app\.bsky\.feed\.post\/([A-Za-z0-9._~:-]{1,512})$/;
const cidPattern = /^[A-Za-z0-9]{1,512}$/;

export class InvalidPostUrlError extends Error {}
export class PreviewDisabledError extends Error {}
export class PostLookupRateLimitError extends Error {}
export class PostUnavailableError extends Error {}
export class PostLookupError extends Error {}

export interface PostPreview extends PreviewSummary {}

interface PostTarget {
  lookupUrl: string;
  atUri: string;
  actor: string;
  recordKey: string;
}

interface PreviewPolicy {
  enabled: boolean;
  limits: Pick<
    CostPolicy["limits"],
    "postLookupsPerAccountPerDay" | "postLookupsGlobalPerHour"
      | "externalRequestTimeoutMs" | "externalResponseMaxBytes"
  >;
}

type FetchImplementation = typeof fetch;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseBlueskyPostUrl(input: string): PostTarget {
  if (input.length > 2_048) throw new InvalidPostUrlError("Post URL is too long");
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new InvalidPostUrlError("Enter a valid Bluesky post URL");
  }
  if (
    url.protocol !== "https:"
    || url.hostname !== "bsky.app"
    || url.port
    || url.username
    || url.password
    || url.search
    || url.hash
    || url.pathname.includes("%")
  ) {
    throw new InvalidPostUrlError("Only standard https://bsky.app/profile/.../post/... URLs are supported");
  }
  const parts = url.pathname.split("/");
  if (parts.length !== 5 || parts[1] !== "profile" || parts[3] !== "post") {
    throw new InvalidPostUrlError("Only Bluesky post URLs are supported");
  }
  const actor = parts[2];
  const recordKey = parts[4];
  if ((!isValidDid(actor) && !isValidBlueskyHandle(actor)) || !recordKeyPattern.test(recordKey)) {
    throw new InvalidPostUrlError("The Bluesky post URL has an invalid account or post identifier");
  }
  const normalizedActor = isValidDid(actor) ? actor : actor.toLowerCase();
  return {
    lookupUrl: `https://bsky.app/profile/${normalizedActor}/post/${recordKey}`,
    atUri: `at://${normalizedActor}/${POST_COLLECTION}/${recordKey}`,
    actor: normalizedActor,
    recordKey,
  };
}

function parseRemotePost(input: unknown, target: PostTarget): PostPreview {
  if (!isRecord(input) || !Array.isArray(input.posts) || input.posts.length !== 1) {
    throw new PostUnavailableError("That post is unavailable");
  }
  const post = input.posts[0];
  if (!isRecord(post) || typeof post.uri !== "string" || typeof post.cid !== "string" || !isRecord(post.author)) {
    throw new PostLookupError("Bluesky returned an invalid post preview");
  }
  const canonical = canonicalUriPattern.exec(post.uri);
  const authorDid = post.author.did;
  const authorHandle = post.author.handle;
  if (
    !canonical
    || canonical[2] !== target.recordKey
    || typeof authorDid !== "string"
    || authorDid !== canonical[1]
    || !isValidDid(authorDid)
    || typeof authorHandle !== "string"
    || !isValidBlueskyHandle(authorHandle)
    || !cidPattern.test(post.cid)
  ) {
    throw new PostLookupError("Bluesky returned an invalid canonical post identity");
  }
  if (
    (isValidDid(target.actor) && authorDid !== target.actor)
    || (!isValidDid(target.actor) && authorHandle.toLowerCase() !== target.actor)
  ) {
    throw new PostLookupError("Bluesky returned a different post author");
  }
  const record = post.record;
  if (!isRecord(record) || typeof record.text !== "string" || record.text.length > 10_000) {
    throw new PostLookupError("Bluesky returned invalid post content");
  }
  const displayName = post.author.displayName;
  if (displayName !== undefined && (typeof displayName !== "string" || displayName.length > 640)) {
    throw new PostLookupError("Bluesky returned an invalid author name");
  }
  const indexedAt = post.indexedAt;
  if (indexedAt !== undefined && (typeof indexedAt !== "string" || !Number.isFinite(Date.parse(indexedAt)))) {
    throw new PostLookupError("Bluesky returned an invalid post timestamp");
  }
  const normalizedHandle = authorHandle.toLowerCase();
  return {
    canonicalUri: post.uri,
    cid: post.cid,
    authorDid,
    authorHandle: normalizedHandle,
    authorDisplayName: displayName ?? null,
    text: record.text,
    indexedAt: indexedAt ?? null,
    postUrl: `https://bsky.app/profile/${normalizedHandle}/post/${canonical[2]}`,
  };
}

async function readBoundedBody(response: Response, maxBytes: number): Promise<string> {
  const declaredSize = Number(response.headers.get("content-length") ?? "0");
  if (!Number.isFinite(declaredSize) || declaredSize > maxBytes) {
    await response.body?.cancel();
    throw new PostLookupError("Bluesky response exceeds the configured size limit");
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
      throw new PostLookupError("Bluesky response exceeds the configured size limit");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function fetchPostPreview(
  target: PostTarget,
  limits: Pick<CostPolicy["limits"], "externalRequestTimeoutMs" | "externalResponseMaxBytes">,
  fetchImplementation: FetchImplementation = fetch,
): Promise<PostPreview> {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), limits.externalRequestTimeoutMs);
  try {
    const response = await fetchImplementation(
      `${BLUESKY_PUBLIC_API}/xrpc/app.bsky.feed.getPosts?uris=${encodeURIComponent(target.atUri)}`,
      {
        headers: { accept: "application/json" },
        redirect: "error",
        cache: "no-store",
        signal: timeout.signal,
      },
    );
    if (response.status === 400 || response.status === 404) {
      await response.body?.cancel();
      throw new PostUnavailableError("That post is unavailable");
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new PostLookupError("Bluesky could not return that post");
    }
    const text = await readBoundedBody(response, limits.externalResponseMaxBytes);
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch (error) {
      throw new PostLookupError("Bluesky returned an invalid response", { cause: error });
    }
    return parseRemotePost(payload, target);
  } catch (error) {
    if (timeout.signal.aborted) throw new PostLookupError("Bluesky took too long to return the post");
    if (error instanceof PostUnavailableError || error instanceof PostLookupError) throw error;
    throw new PostLookupError("Bluesky could not be reached", { cause: error });
  } finally {
    clearTimeout(timer);
  }
}

function mapSourceRow(row: {
  canonical_uri: string;
  observed_cid: string;
  author_did: string;
  author_handle: string;
  author_display_name: string | null;
  post_text: string;
  indexed_at: Date | null;
}): PostPreview {
  const recordKey = canonicalUriPattern.exec(row.canonical_uri)?.[2];
  if (!recordKey) throw new PostLookupError("Stored post identity is invalid");
  return {
    canonicalUri: row.canonical_uri,
    cid: row.observed_cid,
    authorDid: row.author_did,
    authorHandle: row.author_handle,
    authorDisplayName: row.author_display_name,
    text: row.post_text,
    indexedAt: row.indexed_at?.toISOString() ?? null,
    postUrl: `https://bsky.app/profile/${row.author_handle}/post/${recordKey}`,
  };
}

async function readCachedPreview(pool: Pool, lookupUrl: string): Promise<PostPreview | "unavailable" | null> {
  const result = await pool.query<{
    canonical_uri: string | null;
    available_until: Date | null;
    unavailable_until: Date | null;
    observed_cid: string | null;
    author_did: string | null;
    author_handle: string | null;
    author_display_name: string | null;
    post_text: string | null;
    indexed_at: Date | null;
    preview_expires_at: Date | null;
    available: boolean | null;
  }>(
    `SELECT alias.canonical_uri, alias.available_until, alias.unavailable_until,
            source.observed_cid, source.author_did,
            source.author_handle, source.author_display_name, source.post_text, source.indexed_at,
            source.preview_expires_at, source.available
       FROM post_preview_aliases alias
       LEFT JOIN post_sources source ON source.canonical_uri=alias.canonical_uri
      WHERE alias.lookup_url=$1`,
    [lookupUrl],
  );
  if (!result.rowCount) return null;
  const row = result.rows[0];
  const now = Date.now();
  if (row.unavailable_until && row.unavailable_until.getTime() > now) return "unavailable";
  if (
    row.canonical_uri
    && row.available_until
    && row.available_until.getTime() > now
    && row.available
    && row.preview_expires_at
    && row.preview_expires_at.getTime() > now
    && row.observed_cid
    && row.author_did
    && row.author_handle
    && row.post_text !== null
  ) {
    return mapSourceRow({
      canonical_uri: row.canonical_uri,
      observed_cid: row.observed_cid,
      author_did: row.author_did,
      author_handle: row.author_handle,
      author_display_name: row.author_display_name,
      post_text: row.post_text,
      indexed_at: row.indexed_at,
    });
  }
  return null;
}

export async function expirePostPreviews(pool: Pool): Promise<void> {
  await pool.query(
    `WITH expired AS (
       SELECT canonical_uri FROM post_sources
        WHERE preview_expires_at <= clock_timestamp()
          AND (author_handle IS NOT NULL OR post_text IS NOT NULL OR author_display_name IS NOT NULL OR indexed_at IS NOT NULL)
        ORDER BY preview_expires_at LIMIT 100
     )
     UPDATE post_sources source
        SET author_handle=NULL, author_display_name=NULL, post_text=NULL, indexed_at=NULL
       FROM expired
      WHERE source.canonical_uri=expired.canonical_uri
        AND source.preview_expires_at <= clock_timestamp()`,
  );
  await pool.query(
    `DELETE FROM post_preview_aliases WHERE lookup_url IN (
       SELECT lookup_url FROM post_preview_aliases
        WHERE COALESCE(available_until, unavailable_until) <= clock_timestamp()
        ORDER BY COALESCE(available_until, unavailable_until) LIMIT 100
     )
       AND COALESCE(available_until, unavailable_until) <= clock_timestamp()`,
  );
  await pool.query(
    `DELETE FROM post_sources WHERE canonical_uri IN (
       SELECT source.canonical_uri
         FROM post_sources source
        WHERE source.preview_expires_at <= clock_timestamp()
          AND NOT EXISTS (
            SELECT 1 FROM hog_actions action WHERE action.source_uri=source.canonical_uri
          )
          AND NOT EXISTS (
            SELECT 1 FROM post_preview_aliases alias WHERE alias.canonical_uri=source.canonical_uri
          )
        ORDER BY source.preview_expires_at
        LIMIT 100
     )`,
  );
}

async function reservePostLookup(
  client: PoolClient,
  ownerDid: string,
  limits: PreviewPolicy["limits"],
): Promise<Date> {
  const clock = await client.query<{ reserved_at: Date }>("SELECT clock_timestamp() AS reserved_at");
  await client.query(
    `DELETE FROM post_lookup_account_daily WHERE (bucket_start, owner_did) IN (
       SELECT bucket_start, owner_did FROM post_lookup_account_daily
        WHERE bucket_start < date_trunc('day', clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' - interval '8 days'
        ORDER BY bucket_start LIMIT 100
     )`,
  );
  await client.query(
    `DELETE FROM post_lookup_global_hourly WHERE bucket_start IN (
       SELECT bucket_start FROM post_lookup_global_hourly
        WHERE bucket_start < date_trunc('hour', clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' - interval '24 hours'
        ORDER BY bucket_start LIMIT 100
     )`,
  );
  const account = await client.query(
    `INSERT INTO post_lookup_account_daily(bucket_start, owner_did, lookups)
     VALUES (date_trunc('day', clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC',$1,1)
     ON CONFLICT (bucket_start, owner_did) DO UPDATE
       SET lookups=post_lookup_account_daily.lookups + 1
       WHERE post_lookup_account_daily.lookups < $2
     RETURNING lookups`,
    [ownerDid, limits.postLookupsPerAccountPerDay],
  );
  const global = await client.query(
    `INSERT INTO post_lookup_global_hourly(bucket_start, lookups)
     VALUES (date_trunc('hour', clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC',1)
     ON CONFLICT (bucket_start) DO UPDATE
       SET lookups=post_lookup_global_hourly.lookups + 1
       WHERE post_lookup_global_hourly.lookups < $1
     RETURNING lookups`,
    [limits.postLookupsGlobalPerHour],
  );
  if (!account.rowCount || !global.rowCount) {
    throw new PostLookupRateLimitError("The post preview quota has been reached");
  }
  return clock.rows[0].reserved_at;
}

async function storeAvailableAlias(
  client: PoolClient,
  lookupUrl: string,
  canonicalUri: string,
  checkedAt: Date,
): Promise<void> {
  await client.query(
    `INSERT INTO post_preview_aliases(
       lookup_url, canonical_uri, available_until, unavailable_until, checked_at
     ) VALUES ($1,$2,$3::timestamptz + ($4 * interval '1 day'),NULL,$3)
     ON CONFLICT (lookup_url) DO UPDATE
       SET canonical_uri=EXCLUDED.canonical_uri,
           available_until=EXCLUDED.available_until,
           unavailable_until=NULL,
           checked_at=EXCLUDED.checked_at
       WHERE post_preview_aliases.checked_at <= EXCLUDED.checked_at`,
    [lookupUrl, canonicalUri, checkedAt, PREVIEW_RETENTION_DAYS],
  );
}

async function storePreview(
  pool: Pool,
  lookupUrl: string,
  preview: PostPreview,
  checkedAt: Date,
): Promise<void> {
  await transaction(pool, async client => {
    const source = await client.query(
      `INSERT INTO post_sources(
         canonical_uri, observed_cid, author_did, author_handle, author_display_name,
         post_text, indexed_at, preview_expires_at, available, fetched_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::timestamptz + ($9 * interval '1 day'),true,$8)
       ON CONFLICT (canonical_uri) DO UPDATE SET
         observed_cid=EXCLUDED.observed_cid,
         author_did=EXCLUDED.author_did,
         author_handle=EXCLUDED.author_handle,
         author_display_name=EXCLUDED.author_display_name,
         post_text=EXCLUDED.post_text,
         indexed_at=EXCLUDED.indexed_at,
         preview_expires_at=EXCLUDED.preview_expires_at,
         available=true,
         fetched_at=EXCLUDED.fetched_at
         WHERE post_sources.fetched_at <= EXCLUDED.fetched_at
       RETURNING canonical_uri`,
      [
        preview.canonicalUri,
        preview.cid,
        preview.authorDid,
        preview.authorHandle,
        preview.authorDisplayName,
        preview.text,
        preview.indexedAt,
        checkedAt,
        PREVIEW_RETENTION_DAYS,
      ],
    );
    if (!source.rowCount) return;
    await storeAvailableAlias(client, lookupUrl, preview.canonicalUri, checkedAt);
    const recordKey = canonicalUriPattern.exec(preview.canonicalUri)?.[2];
    if (!recordKey) throw new PostLookupError("Canonical post identity is invalid");
    const canonicalUrl = `https://bsky.app/profile/${preview.authorDid}/post/${recordKey}`;
    const handleUrl = `https://bsky.app/profile/${preview.authorHandle}/post/${recordKey}`;
    await storeAvailableAlias(
      client,
      canonicalUrl,
      preview.canonicalUri,
      checkedAt,
    );
    await storeAvailableAlias(
      client,
      handleUrl,
      preview.canonicalUri,
      checkedAt,
    );
    await client.query(
      `DELETE FROM post_preview_aliases
        WHERE canonical_uri=$1
          AND lookup_url <> ALL($2::text[])
          AND checked_at <= $3`,
      [preview.canonicalUri, [canonicalUrl, handleUrl], checkedAt],
    );
  });
}

async function storeUnavailable(pool: Pool, target: PostTarget, checkedAt: Date): Promise<void> {
  await transaction(pool, async client => {
    const existing = await client.query<{ canonical_uri: string | null; checked_at: Date }>(
      "SELECT canonical_uri, checked_at FROM post_preview_aliases WHERE lookup_url=$1 FOR UPDATE",
      [target.lookupUrl],
    );
    if (existing.rows[0]?.checked_at.getTime() > checkedAt.getTime()) return;
    let canonicalUri = existing.rows[0]?.canonical_uri ?? null;
    if (!canonicalUri && isValidDid(target.actor)) {
      const known = await client.query(
        "SELECT canonical_uri FROM post_sources WHERE canonical_uri=$1 FOR UPDATE",
        [target.atUri],
      );
      if (known.rowCount) canonicalUri = target.atUri;
    }
    if (canonicalUri && isValidDid(target.actor)) {
      const invalidated = await client.query(
        `UPDATE post_sources
            SET available=false, author_handle=NULL, author_display_name=NULL, post_text=NULL, indexed_at=NULL,
                preview_expires_at=$2, fetched_at=$2
          WHERE canonical_uri=$1 AND fetched_at <= $2
          RETURNING canonical_uri`,
        [canonicalUri, checkedAt],
      );
      if (invalidated.rowCount) await client.query(
        `UPDATE post_preview_aliases
            SET available_until=NULL,
                unavailable_until=$2::timestamptz + ($3 * interval '1 day'),
                checked_at=$2
          WHERE canonical_uri=$1 AND checked_at <= $2`,
        [canonicalUri, checkedAt, PREVIEW_RETENTION_DAYS],
      );
    }
    await client.query(
      `INSERT INTO post_preview_aliases(
         lookup_url, canonical_uri, available_until, unavailable_until, checked_at
       ) VALUES ($1,$2,NULL,$3::timestamptz + ($4 * interval '1 day'),$3)
       ON CONFLICT (lookup_url) DO UPDATE
         SET canonical_uri=COALESCE(post_preview_aliases.canonical_uri, EXCLUDED.canonical_uri),
             available_until=NULL,
             unavailable_until=EXCLUDED.unavailable_until,
             checked_at=EXCLUDED.checked_at
          WHERE post_preview_aliases.checked_at <= EXCLUDED.checked_at`,
      [target.lookupUrl, canonicalUri, checkedAt, PREVIEW_RETENTION_DAYS],
    );
  });
}

export async function previewPost(
  pool: Pool,
  token: string,
  inputUrl: string,
  policy: PreviewPolicy,
  fetchImplementation: FetchImplementation = fetch,
): Promise<PostPreview> {
  if (!policy.enabled) throw new PreviewDisabledError("Post previews are disabled");
  const session = await getAppSession(pool, token);
  if (!session) throw new Error("Unauthorized");
  const target = parseBlueskyPostUrl(inputUrl.trim());
  await expirePostPreviews(pool);
  const cached = await readCachedPreview(pool, target.lookupUrl);
  if (cached === "unavailable") throw new PostUnavailableError("That post is unavailable");
  if (cached) return cached;

  const checkedAt = await transaction(pool, client => reservePostLookup(client, session.ownerDid, policy.limits));
  let preview: PostPreview;
  try {
    preview = await fetchPostPreview(target, policy.limits, fetchImplementation);
  } catch (error) {
    if (error instanceof PostUnavailableError) await storeUnavailable(pool, target, checkedAt);
    throw error;
  }
  await storePreview(pool, target.lookupUrl, preview, checkedAt);
  return preview;
}
