CREATE TABLE farm_players (
  owner_did text PRIMARY KEY REFERENCES accounts(did) ON DELETE CASCADE,
  player_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  x double precision NOT NULL CHECK (x BETWEEN 24 AND 936),
  y double precision NOT NULL CHECK (y BETWEEN 24 AND 552),
  facing text NOT NULL DEFAULT 'right' CHECK (facing IN ('left', 'right')),
  mass integer NOT NULL DEFAULT 24 CHECK (mass BETWEEN 24 AND 100),
  score integer NOT NULL DEFAULT 0 CHECK (score >= 0),
  slop_eaten integer NOT NULL DEFAULT 0 CHECK (slop_eaten >= 0),
  status text NOT NULL DEFAULT 'alive' CHECK (status IN ('alive', 'popped')),
  effect text CHECK (effect IN ('turbo', 'glitchy', 'recursive', 'collapsed', 'premium')),
  effect_expires_at timestamptz,
  last_moved_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  popped_at timestamptz,
  CHECK ((effect IS NULL) = (effect_expires_at IS NULL)),
  CHECK (
    (status = 'alive' AND popped_at IS NULL)
    OR (status = 'popped' AND mass = 100 AND popped_at IS NOT NULL)
  )
);

CREATE INDEX online_farm_players ON farm_players(updated_at DESC);

CREATE TABLE farm_slop (
  id uuid PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN (
    'hallucinated_citation',
    'context_overflow',
    'recursive_prompt',
    'model_collapse',
    'premium_tokens'
  )),
  x double precision NOT NULL CHECK (x BETWEEN 24 AND 936),
  y double precision NOT NULL CHECK (y BETWEEN 24 AND 552),
  spawned_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  CHECK (expires_at > spawned_at)
);

CREATE INDEX farm_slop_expiry ON farm_slop(expires_at);
