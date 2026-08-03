-- SQLite applies the conflict policy of the outer statement to statements run
-- by a trigger. acquireLease uses INSERT ... ON CONFLICT DO UPDATE, which can
-- therefore override INSERT OR IGNORE inside migration 003 and abort when the
-- selected episode is already present in queue_items. Recreate the playback
-- triggers with an explicit WHERE NOT EXISTS guard so no conflicting insert is
-- attempted.

DROP TRIGGER IF EXISTS playback_queue_head_after_insert;
DROP TRIGGER IF EXISTS playback_queue_head_after_episode_update;

CREATE TRIGGER playback_queue_head_after_insert
AFTER INSERT ON playback_state
WHEN NEW.episode_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM queue_items AS queued
    WHERE queued.profile_id = NEW.profile_id
      AND queued.episode_id = NEW.episode_id
      AND queued.sort_index = 0
  )
BEGIN
  INSERT INTO queue_items(
    id, profile_id, episode_id, sort_index, added_at
  )
  SELECT
    lower(hex(randomblob(4))) || '-' ||
    lower(hex(randomblob(2))) || '-4' ||
    substr(lower(hex(randomblob(2))), 2) || '-' ||
    substr('89ab', (random() & 3) + 1, 1) ||
    substr(lower(hex(randomblob(2))), 2) || '-' ||
    lower(hex(randomblob(6))),
    NEW.profile_id,
    NEW.episode_id,
    -1,
    NEW.updated_at
  WHERE NOT EXISTS (
    SELECT 1
    FROM queue_items AS queued
    WHERE queued.profile_id = NEW.profile_id
      AND queued.episode_id = NEW.episode_id
  );

  UPDATE queue_items
  SET sort_index = sort_index + 1
  WHERE profile_id = NEW.profile_id
    AND episode_id <> NEW.episode_id;

  UPDATE queue_items
  SET sort_index = 0
  WHERE profile_id = NEW.profile_id
    AND episode_id = NEW.episode_id;
END;

CREATE TRIGGER playback_queue_head_after_episode_update
AFTER UPDATE OF episode_id ON playback_state
WHEN NEW.episode_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM queue_items AS queued
    WHERE queued.profile_id = NEW.profile_id
      AND queued.episode_id = NEW.episode_id
      AND queued.sort_index = 0
  )
BEGIN
  INSERT INTO queue_items(
    id, profile_id, episode_id, sort_index, added_at
  )
  SELECT
    lower(hex(randomblob(4))) || '-' ||
    lower(hex(randomblob(2))) || '-4' ||
    substr(lower(hex(randomblob(2))), 2) || '-' ||
    substr('89ab', (random() & 3) + 1, 1) ||
    substr(lower(hex(randomblob(2))), 2) || '-' ||
    lower(hex(randomblob(6))),
    NEW.profile_id,
    NEW.episode_id,
    -1,
    NEW.updated_at
  WHERE NOT EXISTS (
    SELECT 1
    FROM queue_items AS queued
    WHERE queued.profile_id = NEW.profile_id
      AND queued.episode_id = NEW.episode_id
  );

  UPDATE queue_items
  SET sort_index = sort_index + 1
  WHERE profile_id = NEW.profile_id
    AND episode_id <> NEW.episode_id;

  UPDATE queue_items
  SET sort_index = 0
  WHERE profile_id = NEW.profile_id
    AND episode_id = NEW.episode_id;
END;
