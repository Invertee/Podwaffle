-- Explicit media-end completion may be authoritative even when an RSS feed
-- does not provide duration metadata. Do not restore a completed active row
-- after the playback service removes it from the shared queue.

DROP TRIGGER IF EXISTS queue_current_restore_after_delete;

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
      AND (
        episode.played = 1
        OR (
          episode.duration_ms IS NOT NULL
          AND episode.duration_ms > 0
          AND episode.position_ms >= episode.duration_ms
        )
      )
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
