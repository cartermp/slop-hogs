ALTER TABLE farm_achievement_progress
  ADD COLUMN knockouts bigint NOT NULL DEFAULT 0 CHECK (knockouts >= 0);

UPDATE farm_achievement_progress progress
   SET knockouts=player.knockouts
  FROM farm_players player
 WHERE player.owner_did=progress.owner_did;
