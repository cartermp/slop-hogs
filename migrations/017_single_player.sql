CREATE TABLE single_player_games (
  owner_did text PRIMARY KEY REFERENCES accounts(did) ON DELETE CASCADE,
  difficulty text NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard')),
  state jsonb NOT NULL CHECK (jsonb_typeof(state) = 'object'),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE single_player_achievement_progress (
  owner_did text PRIMARY KEY REFERENCES accounts(did) ON DELETE CASCADE,
  games_started integer NOT NULL DEFAULT 0 CHECK (games_started >= 0),
  wins integer NOT NULL DEFAULT 0 CHECK (wins >= 0),
  easy_wins integer NOT NULL DEFAULT 0 CHECK (easy_wins >= 0),
  medium_wins integer NOT NULL DEFAULT 0 CHECK (medium_wins >= 0),
  hard_wins integer NOT NULL DEFAULT 0 CHECK (hard_wins >= 0),
  total_knockouts integer NOT NULL DEFAULT 0 CHECK (total_knockouts >= 0),
  best_run_score integer NOT NULL DEFAULT 0 CHECK (best_run_score >= 0),
  flawless_wins integer NOT NULL DEFAULT 0 CHECK (flawless_wins >= 0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE single_player_achievement_unlocks (
  owner_did text NOT NULL REFERENCES accounts(did) ON DELETE CASCADE,
  achievement_id text NOT NULL CHECK (
    length(achievement_id) BETWEEN 3 AND 100
    AND achievement_id ~ '^[a-z0-9-]+$'
  ),
  progress_value double precision NOT NULL CHECK (progress_value >= 0),
  unlocked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (owner_did, achievement_id)
);

CREATE INDEX single_player_achievement_unlocks_recent
  ON single_player_achievement_unlocks(owner_did, unlocked_at DESC);
