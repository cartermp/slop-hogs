CREATE TABLE accounts (
  did text PRIMARY KEY CHECK (length(did) BETWEEN 8 AND 2048),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE hog_lives (
  id uuid PRIMARY KEY,
  owner_did text NOT NULL REFERENCES accounts(did),
  state jsonb NOT NULL CHECK (jsonb_typeof(state) = 'object'),
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX one_active_hog ON hog_lives(owner_did) WHERE ended_at IS NULL;
CREATE TABLE app_sessions (
  token_hash text PRIMARY KEY CHECK (length(token_hash) = 64),
  owner_did text NOT NULL REFERENCES accounts(did),
  expires_at timestamptz NOT NULL
);
CREATE INDEX session_expiry ON app_sessions(expires_at);
CREATE TABLE hog_actions (
  hog_id uuid NOT NULL REFERENCES hog_lives(id),
  request_id uuid NOT NULL,
  action jsonb NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (hog_id, request_id)
);
