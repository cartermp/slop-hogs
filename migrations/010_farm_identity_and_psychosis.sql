ALTER TABLE accounts
  ADD COLUMN handle text CHECK (handle IS NULL OR length(handle) BETWEEN 1 AND 253);

ALTER TABLE farm_players
  ADD COLUMN psychosis_updated_at timestamptz NOT NULL DEFAULT clock_timestamp();
