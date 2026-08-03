-- Playback and queue are one ordered model: a loaded episode is always item 0.
-- Existing databases are backfilled before the triggers begin enforcing the
-- invariant for local, remote and Cast playback updates.

INSERT INTO queue_items(id, profile_id, episode_id, sort_index, added_at)
SELECT
  lower(hex(randomblob(4))) || '-' ||
  lower(hex(randomblob(2))) || '-4' ||
  substr(lower(hex(randomblob(2))), 2) || '-' ||
  substr('89ab', (random() & 3) + 1, 1) ||
  substr(lower(hex(randomblob(2))), 2) || '-' ||
  lower(hex(randomblob(6))),
  playback.profile_id,
  playback.episode_id,
  -1,
  playback.updated_at
FROM playback_state AS playback
WHERE playback.episode_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM queue_items AS queued
    WHERE queued.profile_id = playback.profile_id
      AND queued.episode_id = playback.episode_id
  );

UPDATE queue_items
SET sort_index = sort_index + 1
WHERE profile_id IN (
  SELECT playback.profile_id
  FROM playback_state AS playback
  JOIN queue_items AS current
    ON current.profile_id = playback.profile_id
   AND current.episode_id = playback.episode_id
  WHERE playback.episode_id IS NOT NULL
    AND current.sort_index <> 0
)
  AND episode_id <> (
    SELECT playback.episode_id
    FROM playback_state AS playback
    WHERE playback.profile_id = queue_items.profile_id
  );

UPDATE queue_items
SET sort_index = 0
WHERE episode_id = (
  SELECT playback.episode_id
  FROM playback_state AS playback
  WHERE playback.profile_id = queue_items.profile_id
)
  AND profile_id IN (
    SELECT profile_id
    FROM playback_state
    WHERE episode_id IS NOT NULL
  );

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
  INSERT OR IGNORE INTO queue_items(
    id, profile_id, episode_id, sort_index, added_at
  ) VALUES (
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
  INSERT OR IGNORE INTO queue_items(
    id, profile_id, episode_id, sort_index, added_at
  ) VALUES (
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

-- Reordering is allowed for upcoming episodes, but an active episode remains
-- fixed at the head. SQLite recursive triggers are disabled by default, so the
-- normalising updates below do not recurse.
CREATE TRIGGER queue_current_head_after_reorder
AFTER UPDATE OF sort_index ON queue_items
WHEN EXISTS (
  SELECT 1
  FROM playback_state AS playback
  JOIN queue_items AS current
    ON current.profile_id = playback.profile_id
   AND current.episode_id = playback.episode_id
  WHERE playback.profile_id = NEW.profile_id
    AND current.sort_index <> 0
)
BEGIN
  UPDATE queue_items
  SET sort_index = sort_index + 1
  WHERE profile_id = NEW.profile_id
    AND episode_id <> (
      SELECT episode_id
      FROM playback_state
      WHERE profile_id = NEW.profile_id
    );

  UPDATE queue_items
  SET sort_index = 0
  WHERE profile_id = NEW.profile_id
    AND episode_id = (
      SELECT episode_id
      FROM playback_state
      WHERE profile_id = NEW.profile_id
    );
END;

-- Removing or clearing a queue preserves a currently loaded, incomplete item.
-- Completion updates episode_state first, allowing the normal completion path
-- to delete item zero and advance playback to the next row.
CREATE TRIGGER queue_current_restore_after_delete
AFTER DELETE ON queue_items
WHEN EXISTS (
  SELECT 1
  FROM playback_state AS playback
  WHERE playback.profile_id = OLD.profile_id
    AND playback.episode_id = OLD.episode_id
    AND playback.state <> 'stopped'
)
  AND COALESCE(
    (
      SELECT played
      FROM episode_state
      WHERE profile_id = OLD.profile_id
        AND episode_id = OLD.episode_id
    ),
    0
  ) = 0
BEGIN
  INSERT OR IGNORE INTO queue_items(
    id, profile_id, episode_id, sort_index, added_at
  ) VALUES (
    OLD.id,
    OLD.profile_id,
    OLD.episode_id,
    0,
    OLD.added_at
  );
END;
