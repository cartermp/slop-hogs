ALTER TABLE accounts
  ADD COLUMN auth_provider text NOT NULL DEFAULT 'bluesky'
  CHECK (auth_provider IN ('bluesky', 'github'));
