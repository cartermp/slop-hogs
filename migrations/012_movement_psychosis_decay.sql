ALTER TABLE farm_players
  DROP COLUMN psychosis_updated_at,
  ADD COLUMN psychosis_movement_ms integer NOT NULL DEFAULT 0
    CHECK (psychosis_movement_ms BETWEEN 0 AND 1999);
