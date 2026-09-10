ALTER TABLE accounts
  ADD COLUMN public_id uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN pen_public boolean NOT NULL DEFAULT true,
  ADD COLUMN gifts_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE accounts ADD CONSTRAINT accounts_public_id_unique UNIQUE (public_id);

CREATE TABLE account_blocks (
  owner_did text NOT NULL REFERENCES accounts(did) ON DELETE CASCADE,
  blocked_did text NOT NULL REFERENCES accounts(did) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (owner_did, blocked_did),
  CHECK (owner_did <> blocked_did)
);

CREATE TABLE gift_treats (
  id uuid PRIMARY KEY,
  sender_did text NOT NULL REFERENCES accounts(did) ON DELETE CASCADE,
  recipient_did text NOT NULL REFERENCES accounts(did) ON DELETE CASCADE,
  hog_id uuid NOT NULL REFERENCES hog_lives(id) ON DELETE CASCADE,
  food text NOT NULL CHECK (food IN (
    'ai_image',
    'generated_post',
    'chatbot_screenshot',
    'human_post',
    'shitpost'
  )),
  gift_day date NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
  accepted_request_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  decided_at timestamptz,
  UNIQUE (sender_did, recipient_did, gift_day),
  CHECK (sender_did <> recipient_did),
  CHECK (
    (status = 'pending' AND accepted_request_id IS NULL AND decided_at IS NULL)
    OR (status = 'accepted' AND accepted_request_id IS NOT NULL AND decided_at IS NOT NULL)
    OR (status = 'declined' AND accepted_request_id IS NULL AND decided_at IS NOT NULL)
  )
);
CREATE INDEX pending_gifts_for_recipient
  ON gift_treats(recipient_did, created_at)
  WHERE status = 'pending';

CREATE TABLE gift_sender_daily (
  bucket_start date NOT NULL,
  sender_did text NOT NULL REFERENCES accounts(did) ON DELETE CASCADE,
  gifts integer NOT NULL CHECK (gifts > 0),
  PRIMARY KEY (bucket_start, sender_did)
);

CREATE TABLE gift_recipient_daily (
  bucket_start date NOT NULL,
  recipient_did text NOT NULL REFERENCES accounts(did) ON DELETE CASCADE,
  gifts integer NOT NULL CHECK (gifts > 0),
  PRIMARY KEY (bucket_start, recipient_did)
);
