-- An episode may be considered played near its end, but queue advancement must
-- only happen once reported playback reaches the actual duration. Enforce that
-- invariant in SQLite so Android, web and Cast share the same completion rule,
-- including episodes deliberately marked unplayed.

DROP TRIGGER IF EXISTS queue_current_restore_after_delete;

-- Queue edits still preserve an active item, including one marked played at the
-- presentation threshold. The normal end path is allowed through only when the
-- stored position has reached the stored duration.
CREATE TRIGGER queue_current_restore_after_delete
AFTER DELETE ON queue_items
WHEN EXISTS (
  SELECT 1
  FROM playback_state AS playback
  WHERE playback.profile_id = OLD.profile_id
    AND playback.episode_id = OLD.episode_id
    AND playback.state <> 'stopped'
)
  AND NOT EXISTS (
    SELECT 1
    FROM episode_state AS episode
    WHERE episode.profile_id = OLD.profile_id
      AND episode.episode_id = OLD.episode_id
      AND episode.duration_ms IS NOT NULL
      AND episode.duration_ms > 0
      AND episode.position_ms >= episode.duration_ms
  )
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

CREATE TRIGGER episode_state_advance_queue_after_insert
AFTER INSERT ON episode_state
WHEN NEW.duration_ms IS NOT NULL
  AND NEW.duration_ms > 0
  AND NEW.position_ms >= NEW.duration_ms
BEGIN
  UPDATE queue_items
  SET sort_index = sort_index - 1
  WHERE profile_id = NEW.profile_id
    AND sort_index > COALESCE(
      (
        SELECT sort_index
        FROM queue_items
        WHERE profile_id = NEW.profile_id
          AND episode_id = NEW.episode_id
      ),
      2147483647
    );

  DELETE FROM queue_items
  WHERE profile_id = NEW.profile_id
    AND episode_id = NEW.episode_id;

  UPDATE playback_state
  SET episode_id = (
        SELECT episode_id
        FROM queue_items
        WHERE profile_id = NEW.profile_id
        ORDER BY sort_index
        LIMIT 1
      ),
      position_ms = 0,
      duration_ms = (
        SELECT episode.duration_ms
        FROM queue_items AS queued
        JOIN episodes AS episode ON episode.id = queued.episode_id
        WHERE queued.profile_id = NEW.profile_id
        ORDER BY queued.sort_index
        LIMIT 1
      ),
      state = CASE
        WHEN EXISTS (
          SELECT 1 FROM queue_items WHERE profile_id = NEW.profile_id
        ) THEN state
        ELSE 'stopped'
      END,
      mode = CASE
        WHEN EXISTS (
          SELECT 1 FROM queue_items WHERE profile_id = NEW.profile_id
        ) THEN mode
        ELSE 'local'
      END,
      active_device_id = CASE
        WHEN EXISTS (
          SELECT 1 FROM queue_items WHERE profile_id = NEW.profile_id
        ) THEN active_device_id
        ELSE NULL
      END,
      lease_expires_at = CASE
        WHEN EXISTS (
          SELECT 1 FROM queue_items WHERE profile_id = NEW.profile_id
        ) THEN lease_expires_at
        ELSE NULL
      END,
      cast_owner_device_id = CASE
        WHEN EXISTS (
          SELECT 1 FROM queue_items WHERE profile_id = NEW.profile_id
        ) THEN cast_owner_device_id
        ELSE NULL
      END,
      cast_session_id = CASE
        WHEN EXISTS (
          SELECT 1 FROM queue_items WHERE profile_id = NEW.profile_id
        ) THEN cast_session_id
        ELSE NULL
      END,
      revision = revision + 1,
      updated_at = NEW.updated_at
  WHERE profile_id = NEW.profile_id
    AND episode_id = NEW.episode_id;
END;

CREATE TRIGGER episode_state_advance_queue_after_update
AFTER UPDATE OF position_ms, duration_ms ON episode_state
WHEN NEW.duration_ms IS NOT NULL
  AND NEW.duration_ms > 0
  AND NEW.position_ms >= NEW.duration_ms
BEGIN
  UPDATE queue_items
  SET sort_index = sort_index - 1
  WHERE profile_id = NEW.profile_id
    AND sort_index > COALESCE(
      (
        SELECT sort_index
        FROM queue_items
        WHERE profile_id = NEW.profile_id
          AND episode_id = NEW.episode_id
      ),
      2147483647
    );

  DELETE FROM queue_items
  WHERE profile_id = NEW.profile_id
    AND episode_id = NEW.episode_id;

  UPDATE playback_state
  SET episode_id = (
        SELECT episode_id
        FROM queue_items
        WHERE profile_id = NEW.profile_id
        ORDER BY sort_index
        LIMIT 1
      ),
      position_ms = 0,
      duration_ms = (
        SELECT episode.duration_ms
        FROM queue_items AS queued
        JOIN episodes AS episode ON episode.id = queued.episode_id
        WHERE queued.profile_id = NEW.profile_id
        ORDER BY queued.sort_index
        LIMIT 1
      ),
      state = CASE
        WHEN EXISTS (
          SELECT 1 FROM queue_items WHERE profile_id = NEW.profile_id
        ) THEN state
        ELSE 'stopped'
      END,
      mode = CASE
        WHEN EXISTS (
          SELECT 1 FROM queue_items WHERE profile_id = NEW.profile_id
        ) THEN mode
        ELSE 'local'
      END,
      active_device_id = CASE
        WHEN EXISTS (
          SELECT 1 FROM queue_items WHERE profile_id = NEW.profile_id
        ) THEN active_device_id
        ELSE NULL
      END,
      lease_expires_at = CASE
        WHEN EXISTS (
          SELECT 1 FROM queue_items WHERE profile_id = NEW.profile_id
        ) THEN lease_expires_at
        ELSE NULL
      END,
      cast_owner_device_id = CASE
        WHEN EXISTS (
          SELECT 1 FROM queue_items WHERE profile_id = NEW.profile_id
        ) THEN cast_owner_device_id
        ELSE NULL
      END,
      cast_session_id = CASE
        WHEN EXISTS (
          SELECT 1 FROM queue_items WHERE profile_id = NEW.profile_id
        ) THEN cast_session_id
        ELSE NULL
      END,
      revision = revision + 1,
      updated_at = NEW.updated_at
  WHERE profile_id = NEW.profile_id
    AND episode_id = NEW.episode_id;
END;
