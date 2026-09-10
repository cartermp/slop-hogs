CREATE TABLE share_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hog_id uuid NOT NULL,
  action_request_id uuid NOT NULL,
  event_index smallint NOT NULL CHECK (event_index >= 0),
  mutation text NOT NULL CHECK (mutation IN (
    'glazed_eyes',
    'sparkle_sweats',
    'thought_leader_blazer',
    'veneer_grin',
    'cursor_eyes',
    'keyboard_spine',
    'free_range_frame',
    'mud_crown'
  )),
  event_text text NOT NULL CHECK (length(event_text) BETWEEN 1 AND 500),
  state jsonb NOT NULL CHECK (jsonb_typeof(state) = 'object'),
  speech text NOT NULL CHECK (length(speech) BETWEEN 1 AND 280),
  render_status text NOT NULL DEFAULT 'not_requested'
    CHECK (render_status IN ('not_requested', 'rendering', 'failed', 'ready')),
  render_attempts integer NOT NULL DEFAULT 0 CHECK (render_attempts >= 0),
  render_started_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (hog_id, action_request_id, event_index),
  FOREIGN KEY (hog_id, action_request_id)
    REFERENCES hog_actions(hog_id, request_id) ON DELETE CASCADE,
  CHECK (
    (render_status = 'rendering' AND render_started_at IS NOT NULL)
    OR (render_status <> 'rendering' AND render_started_at IS NULL)
  )
);
CREATE INDEX share_events_for_hog ON share_events(hog_id, created_at DESC);

CREATE TABLE share_cards (
  event_id uuid PRIMARY KEY REFERENCES share_events(id) ON DELETE CASCADE,
  png bytea NOT NULL,
  byte_length integer NOT NULL CHECK (byte_length = octet_length(png) AND byte_length > 0),
  width integer NOT NULL CHECK (width = 1200),
  height integer NOT NULL CHECK (height = 630),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE card_account_daily (
  bucket_start date NOT NULL,
  owner_did text NOT NULL REFERENCES accounts(did) ON DELETE CASCADE,
  cards integer NOT NULL CHECK (cards > 0),
  PRIMARY KEY (bucket_start, owner_did)
);

CREATE TABLE card_global_daily (
  bucket_start date PRIMARY KEY,
  cards integer NOT NULL CHECK (cards > 0)
);
