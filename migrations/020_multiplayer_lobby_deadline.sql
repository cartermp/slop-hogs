ALTER TABLE farm_fields
  ADD COLUMN lobby_closes_at timestamptz;

UPDATE farm_fields
   SET lobby_closes_at=(
     CASE WHEN round_number = 1 THEN created_at ELSE last_joined_at END
   ) + interval '30 seconds'
 WHERE round_started_at IS NULL
   AND round_finished_at IS NULL;

ALTER TABLE farm_fields
  ADD CONSTRAINT farm_fields_lobby_state_check CHECK (
    (
      round_started_at IS NULL
      AND round_finished_at IS NULL
      AND lobby_closes_at IS NOT NULL
    )
    OR (
      round_started_at IS NOT NULL
      AND lobby_closes_at IS NULL
    )
  );
