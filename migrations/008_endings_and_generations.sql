UPDATE hog_lives
   SET state = state || jsonb_build_object(
     'rulesVersion', 3,
     'ending', NULL
   )
 WHERE state->>'rulesVersion' = '2';

ALTER TABLE hog_lives ADD COLUMN generation integer;

WITH ranked_lives AS (
  SELECT id, row_number() OVER (
    PARTITION BY owner_did
    ORDER BY created_at, id
  ) AS generation
  FROM hog_lives
)
UPDATE hog_lives
   SET generation=ranked_lives.generation
  FROM ranked_lives
 WHERE hog_lives.id=ranked_lives.id;

ALTER TABLE hog_lives
  ALTER COLUMN generation SET DEFAULT 1,
  ALTER COLUMN generation SET NOT NULL,
  ADD CONSTRAINT hog_lives_generation_positive CHECK (generation > 0),
  ADD CONSTRAINT hog_lives_owner_generation_unique UNIQUE (owner_did, generation);

CREATE TABLE hog_endings (
  hog_id uuid PRIMARY KEY REFERENCES hog_lives(id) ON DELETE CASCADE,
  action_request_id uuid NOT NULL,
  ending_id text NOT NULL CHECK (ending_id IN ('slop_overload')),
  cause text NOT NULL CHECK (length(cause) BETWEEN 1 AND 200),
  epitaph text NOT NULL CHECK (length(epitaph) BETWEEN 1 AND 280),
  final_state jsonb NOT NULL CHECK (jsonb_typeof(final_state) = 'object'),
  final_appearance jsonb NOT NULL CHECK (jsonb_typeof(final_appearance) = 'object'),
  ended_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (hog_id, action_request_id)
    REFERENCES hog_actions(hog_id, request_id) ON DELETE CASCADE
);
