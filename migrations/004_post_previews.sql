CREATE TABLE post_sources (
  canonical_uri text PRIMARY KEY CHECK (
    canonical_uri ~ '^at://did:[a-z]+:[A-Za-z0-9._:%-]+/app\.bsky\.feed\.post/[A-Za-z0-9._~:-]+$'
  ),
  observed_cid text NOT NULL CHECK (observed_cid ~ '^[A-Za-z0-9]{1,512}$'),
  author_did text NOT NULL CHECK (length(author_did) BETWEEN 8 AND 2048),
  author_handle text CHECK (author_handle IS NULL OR length(author_handle) BETWEEN 1 AND 253),
  author_display_name text CHECK (author_display_name IS NULL OR length(author_display_name) <= 640),
  post_text text CHECK (post_text IS NULL OR length(post_text) <= 10000),
  indexed_at timestamptz,
  preview_expires_at timestamptz NOT NULL,
  available boolean NOT NULL DEFAULT true,
  fetched_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX post_source_expiry ON post_sources(preview_expires_at);

CREATE TABLE post_preview_aliases (
  lookup_url text PRIMARY KEY CHECK (length(lookup_url) BETWEEN 1 AND 2048),
  canonical_uri text REFERENCES post_sources(canonical_uri),
  available_until timestamptz,
  unavailable_until timestamptz,
  checked_at timestamptz NOT NULL,
  CHECK (
    (canonical_uri IS NOT NULL AND available_until IS NOT NULL AND unavailable_until IS NULL)
    OR (available_until IS NULL AND unavailable_until IS NOT NULL)
  )
);
CREATE INDEX post_preview_alias_available_expiry ON post_preview_aliases(available_until);
CREATE INDEX post_preview_alias_expiry ON post_preview_aliases(unavailable_until);

CREATE TABLE post_lookup_account_daily (
  bucket_start timestamptz NOT NULL,
  owner_did text NOT NULL REFERENCES accounts(did) ON DELETE CASCADE,
  lookups integer NOT NULL CHECK (lookups > 0),
  PRIMARY KEY (bucket_start, owner_did)
);

CREATE TABLE post_lookup_global_hourly (
  bucket_start timestamptz PRIMARY KEY,
  lookups integer NOT NULL CHECK (lookups > 0)
);

ALTER TABLE hog_actions
  ADD COLUMN source_uri text REFERENCES post_sources(canonical_uri),
  ADD COLUMN observed_source_cid text,
  ADD CONSTRAINT source_receipt_complete CHECK (
    (source_uri IS NULL AND observed_source_cid IS NULL)
    OR (source_uri IS NOT NULL AND observed_source_cid IS NOT NULL)
  );
CREATE UNIQUE INDEX one_post_per_hog_life
  ON hog_actions(hog_id, source_uri)
  WHERE source_uri IS NOT NULL;
