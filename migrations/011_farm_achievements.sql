CREATE TABLE farm_achievement_progress (
  owner_did text PRIMARY KEY REFERENCES accounts(did) ON DELETE CASCADE,
  total_slop bigint NOT NULL DEFAULT 0 CHECK (total_slop >= 0),
  total_score bigint NOT NULL DEFAULT 0 CHECK (total_score >= 0),
  total_distance double precision NOT NULL DEFAULT 0 CHECK (total_distance >= 0),
  high_psychosis_distance double precision NOT NULL DEFAULT 0 CHECK (high_psychosis_distance >= 0),
  current_high_psychosis_ms bigint NOT NULL DEFAULT 0 CHECK (current_high_psychosis_ms >= 0),
  best_high_psychosis_ms bigint NOT NULL DEFAULT 0 CHECK (best_high_psychosis_ms >= 0),
  last_high_move_at timestamptz,
  pops integer NOT NULL DEFAULT 0 CHECK (pops >= 0),
  runs integer NOT NULL DEFAULT 1 CHECK (runs > 0),
  best_run_score integer NOT NULL DEFAULT 0 CHECK (best_run_score >= 0),
  best_run_slop integer NOT NULL DEFAULT 0 CHECK (best_run_slop >= 0),
  current_run_distance double precision NOT NULL DEFAULT 0 CHECK (current_run_distance >= 0),
  best_run_distance double precision NOT NULL DEFAULT 0 CHECK (best_run_distance >= 0),
  kind_counts jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(kind_counts) = 'object'),
  run_kind_mask integer NOT NULL DEFAULT 0 CHECK (run_kind_mask BETWEEN 0 AND 31),
  max_run_variety smallint NOT NULL DEFAULT 0 CHECK (max_run_variety BETWEEN 0 AND 5),
  last_slop_kind text CHECK (last_slop_kind IN (
    'hallucinated_citation',
    'context_overflow',
    'recursive_prompt',
    'model_collapse',
    'premium_tokens'
  )),
  same_kind_streak integer NOT NULL DEFAULT 0 CHECK (same_kind_streak >= 0),
  best_same_kind_streak integer NOT NULL DEFAULT 0 CHECK (best_same_kind_streak >= 0),
  catalog_version smallint NOT NULL DEFAULT 1 CHECK (catalog_version >= 0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

INSERT INTO farm_achievement_progress(
  owner_did,
  total_slop,
  total_score,
  pops,
  best_run_score,
  best_run_slop,
  catalog_version
)
SELECT
  player.owner_did,
  player.slop_eaten,
  player.score,
  CASE WHEN player.status='popped' THEN 1 ELSE 0 END,
  player.score,
  player.slop_eaten,
  0
FROM farm_players player;

CREATE TABLE farm_achievement_unlocks (
  owner_did text NOT NULL REFERENCES accounts(did) ON DELETE CASCADE,
  achievement_id text NOT NULL CHECK (
    length(achievement_id) BETWEEN 3 AND 100
    AND achievement_id ~ '^[a-z0-9-]+$'
  ),
  progress_value double precision NOT NULL CHECK (progress_value >= 0),
  unlocked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (owner_did, achievement_id)
);

CREATE INDEX farm_achievement_unlocks_recent
  ON farm_achievement_unlocks(owner_did, unlocked_at DESC);
