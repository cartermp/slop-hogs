ALTER TABLE farm_players
  DROP CONSTRAINT farm_players_status_check;

DO $$
DECLARE
  terminal_constraint name;
BEGIN
  SELECT constraint_row.conname
    INTO terminal_constraint
    FROM pg_constraint constraint_row
   WHERE constraint_row.conrelid = 'farm_players'::regclass
     AND constraint_row.contype = 'c'
     AND pg_get_constraintdef(constraint_row.oid) LIKE '%popped_at%'
     AND pg_get_constraintdef(constraint_row.oid) LIKE '%status%'
   LIMIT 1;
  IF terminal_constraint IS NULL THEN
    RAISE EXCEPTION 'farm_players terminal-state constraint is missing';
  END IF;
  EXECUTE format('ALTER TABLE farm_players DROP CONSTRAINT %I', terminal_constraint);
END
$$;

ALTER TABLE farm_players
  ADD COLUMN health integer NOT NULL DEFAULT 100 CHECK (health BETWEEN 0 AND 100),
  ADD COLUMN knockouts integer NOT NULL DEFAULT 0 CHECK (knockouts >= 0),
  ADD COLUMN last_attack_at timestamptz,
  ADD COLUMN defeated_at timestamptz,
  ADD COLUMN defeat_cause text CHECK (defeat_cause IN ('battle')),
  ADD CONSTRAINT farm_players_status_check
    CHECK (status IN ('alive', 'popped', 'defeated')),
  ADD CONSTRAINT farm_players_terminal_state_check CHECK (
    (status = 'alive' AND popped_at IS NULL AND defeated_at IS NULL AND defeat_cause IS NULL AND health > 0)
    OR (
      status = 'popped'
      AND mass = 100
      AND popped_at IS NOT NULL
      AND defeated_at IS NULL
      AND defeat_cause IS NULL
      AND health > 0
    )
    OR (
      status = 'defeated'
      AND health = 0
      AND popped_at IS NULL
      AND defeated_at IS NOT NULL
      AND defeat_cause = 'battle'
    )
  );
