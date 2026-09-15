ALTER TABLE farm_fields
  ADD COLUMN round_number integer NOT NULL DEFAULT 1 CHECK (round_number > 0),
  ADD COLUMN round_started_at timestamptz,
  ADD COLUMN round_finished_at timestamptz,
  ADD COLUMN winner_owner_did text REFERENCES accounts(did) ON DELETE SET NULL,
  ADD CONSTRAINT farm_fields_round_state_check CHECK (
    (round_started_at IS NULL AND round_finished_at IS NULL AND winner_owner_did IS NULL)
    OR (round_started_at IS NOT NULL AND round_finished_at IS NULL AND winner_owner_did IS NULL)
    OR (
      round_started_at IS NOT NULL
      AND round_finished_at IS NOT NULL
      AND round_finished_at >= round_started_at
    )
  );

ALTER TABLE farm_achievement_progress
  ADD COLUMN wins bigint NOT NULL DEFAULT 0 CHECK (wins >= 0);

CREATE TABLE farm_victories (
  field_id uuid NOT NULL REFERENCES farm_fields(id) ON DELETE CASCADE,
  round_number integer NOT NULL CHECK (round_number > 0),
  winner_owner_did text NOT NULL REFERENCES accounts(did) ON DELETE CASCADE,
  winner_score integer NOT NULL CHECK (winner_score >= 0),
  winner_knockouts integer NOT NULL CHECK (winner_knockouts >= 0),
  won_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (field_id, round_number)
);

CREATE INDEX farm_victories_by_winner
  ON farm_victories(winner_owner_did, won_at DESC);
