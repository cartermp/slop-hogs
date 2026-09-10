CREATE TABLE operational_status (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  database_size_bytes bigint CHECK (database_size_bytes >= 0),
  database_used_percent bigint CHECK (database_used_percent >= 0),
  warning boolean NOT NULL DEFAULT false,
  registrations_blocked boolean NOT NULL DEFAULT false,
  cards_blocked boolean NOT NULL DEFAULT false,
  read_only boolean NOT NULL DEFAULT false,
  measured_at timestamptz
);
INSERT INTO operational_status(id) VALUES (true);

CREATE TABLE backup_restore_checks (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  challenge uuid NOT NULL,
  fixture_hog_id uuid NOT NULL REFERENCES hog_lives(id),
  fixture_digest text NOT NULL CHECK (length(fixture_digest) = 64),
  prepared_at timestamptz NOT NULL,
  verified_at timestamptz,
  source_database_size_bytes bigint CHECK (source_database_size_bytes >= 0),
  restored_database_size_bytes bigint CHECK (restored_database_size_bytes >= 0)
);

CREATE TABLE restore_verification_probes (
  id uuid PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
