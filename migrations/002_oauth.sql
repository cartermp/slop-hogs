CREATE TABLE oauth_states (
  state_key text PRIMARY KEY CHECK (length(state_key) BETWEEN 16 AND 512),
  encrypted_data bytea NOT NULL CHECK (length(encrypted_data) > 29),
  expires_at timestamptz NOT NULL
);
CREATE INDEX oauth_state_expiry ON oauth_states(expires_at);

CREATE TABLE oauth_sessions (
  did text PRIMARY KEY CHECK (length(did) BETWEEN 8 AND 2048),
  encrypted_data bytea NOT NULL CHECK (length(encrypted_data) > 29),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE oauth_login_attempts (
  bucket_start timestamptz NOT NULL,
  source_hash text NOT NULL CHECK (length(source_hash) BETWEEN 6 AND 64),
  attempts integer NOT NULL CHECK (attempts > 0),
  PRIMARY KEY (bucket_start, source_hash)
);

CREATE TABLE oauth_locks (
  lock_hash text PRIMARY KEY CHECK (length(lock_hash) = 64),
  owner_token uuid NOT NULL,
  expires_at timestamptz NOT NULL
);
