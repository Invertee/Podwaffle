-- Playback and queue are one ordered model: a loaded episode is always item 0.
-- Existing databases are backfilled before the triggers begin enforcing the
-- invariant for local, remote and Cast playback updates.

INSERT INTO queue_items(id, profile_id, episode_id, sort_index, added_at)
SELECT
  lower(hex(randomblob(4))) || '-' ||
  lower(hex(randomblob(2))) || '-4' ||
  substr(lower(hex(randomblob(2))), 2) || '-' ||
  substr('89ab', abs(random()) % 4 + 1, 1) ||
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
SET sort_index = CASE
  WHEN episode_id = (
    SELECT playback.episode_id
    FROM playback_state AS playback
    WHERE playback.profile_id = queue_items.profile_id
  ) THEN 0
  ELSE 1 + (
    SELECT COUNT(*)
    FROM queue_items AS prior
    WHERE prior.profile_id = queue_items.profile_id
      AND prior.episode_id <> (
        SELECT playback.episode_id
        FROM playback_state AS playback
        WHERE playback.profile_id = queue_items.profile_id
      )
      AND (
        prior.sort_index < queue_items.sort_index
        OR (
          prior.sort_index = queue_items.sort_index
          AND prior.id < queue_items.id
        )
      )
  )
END
WHERE profile_id IN (
  SELECT profile_id
  FROM playback_state
  WHERE episode_id IS NOT NULL
);

CREATE TRIGGER playback_queue_head_after_insert
AFTER INSERT ON playback_state
WHEN NEW.episode_id IS NOT NULL
BEGIN
  INSERT OR IGNORE INTO queue_items(
    id, profile_id, episode_id, sort_index, added_at
  ) VALUES (
    lower(hex(randomblob(4))) || '-' ||
    lower(hex(randomblob(2))) || '-4' ||
    substr(lower(hex(randomblob(2))), 2) || '-' ||
    substr('89ab', abs(random()) % 4 + 1, 1) ||
    substr(lower(hex(randomblob(2))), 2) || '-' ||
    lower(hex(randomblob(6))),
    NEW.profile_id,
    NEW.episode_id,
    -1,
    NEW.updated_at
  );

  UPDATE queue_items
  SET sort_index = CASE
    WHEN episode_id = NEW.episode_id THEN 0
    ELSE 1 + (
      SELECT COUNT(*)
      FROM queue_items AS prior
      WHERE prior.profile_id = NEW.profile_id
        AND prior.episode_id <> NEW.episode_id
        AND (
          prior.sort_index < queue_items.sort_index
          OR (
            prior.sort_index = queue_items.sort_index
            AND prior.id < queue_items.id
          )
        )
    )
  END
  WHERE profile_id = NEW.profile_id;
END;

CREATE TRIGGER playback_queue_head_after_episode_update
AFTER UPDATE OF episode_id ON playback_state
WHEN NEW.episode_id IS NOT NULL
BEGIN
  INSERT OR IGNORE INTO queue_items(
    id, profile_id, episode_id, sort_index, added_at
  ) VALUES (
    lower(hex(randomblob(4))) || '-' ||
    lower(hex(randomblob(2))) || '-4' ||
    substr(lower(hex(randomblob(2))), 2) || '-' ||
    substr('89ab', abs(random()) % 4 + 1, 1) ||
    substr(lower(hex(randomblob(2))), 2) || '-' ||
    lower(hex(randomblob(6))),
    NEW.profile_id,
    NEW.episode_id,
    -1,
    NEW.updated_at
  );

  UPDATE queue_items
  SET sort_index = CASE
    WHEN episode_id = NEW.episode_id THEN 0
    ELSE 1 + (
      SELECT COUNT(*)
      FROM queue_items AS prior
      WHERE prior.profile_id = NEW.profile_id
        AND prior.episode_id <> NEW.episode_id
        AND (
          prior.sort_index < queue_items.sort_index
          OR (
            prior.sort_index = queue_items.sort_index
            AND prior.id < queue_items.id
          )
        )
    )
  END
  WHERE profile_id = NEW.profile_id;
END;
