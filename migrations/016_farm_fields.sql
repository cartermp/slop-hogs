CREATE TABLE farm_fields (
  id uuid PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_joined_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TEMP TABLE farm_field_backfill (
  field_number integer PRIMARY KEY,
  field_id uuid NOT NULL
) ON COMMIT DROP;

INSERT INTO farm_field_backfill(field_number, field_id)
SELECT field_number, gen_random_uuid()
  FROM generate_series(
    0,
    GREATEST(0, CEIL((SELECT count(*) FROM farm_players) / 8.0)::integer - 1)
  ) AS generated(field_number);

INSERT INTO farm_fields(id)
SELECT field_id FROM farm_field_backfill;

ALTER TABLE farm_players
  ADD COLUMN field_id uuid REFERENCES farm_fields(id);

WITH ranked_players AS (
  SELECT owner_did,
         ((row_number() OVER (ORDER BY updated_at DESC, player_id) - 1) / 8)::integer AS field_number
    FROM farm_players
)
UPDATE farm_players player
   SET field_id=backfill.field_id
  FROM ranked_players ranked
  JOIN farm_field_backfill backfill USING (field_number)
 WHERE player.owner_did=ranked.owner_did;

ALTER TABLE farm_players
  ALTER COLUMN field_id SET NOT NULL;

DROP INDEX online_farm_players;
CREATE INDEX online_farm_players ON farm_players(field_id, updated_at DESC);

ALTER TABLE farm_slop
  ADD COLUMN field_id uuid REFERENCES farm_fields(id);

UPDATE farm_slop
   SET field_id=(SELECT field_id FROM farm_field_backfill WHERE field_number=0);

ALTER TABLE farm_slop
  ALTER COLUMN field_id SET NOT NULL;

CREATE INDEX farm_slop_field_expiry ON farm_slop(field_id, expires_at);
