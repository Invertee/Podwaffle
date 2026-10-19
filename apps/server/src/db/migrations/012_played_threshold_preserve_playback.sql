-- Marking an episode played at 97% must not truncate its audio. Keep the
-- actual-end advancement triggers, but allow played status before that end.
DROP TRIGGER IF EXISTS episode_state_require_actual_end_after_insert;
DROP TRIGGER IF EXISTS episode_state_require_actual_end_after_update;

-- Older exact-end enforcement left near-finished episodes in In Progress.
-- Honour explicit unplayed choices while repairing automatic played state.
UPDATE episode_state
SET played = 1, played_at = COALESCE(last_played_at, updated_at)
WHERE manual_play_state = 'none' AND played = 0
  AND COALESCE(duration_ms, (SELECT duration_ms FROM episodes WHERE id = episode_id)) > 0
  AND position_ms >= 0.97 * COALESCE(
    duration_ms, (SELECT duration_ms FROM episodes WHERE id = episode_id)
  );

-- Repair played rows left behind by older clients. An active episode can still
-- be playing its final three percent, and a later explicit requeue is valid.
DELETE FROM queue_items
WHERE EXISTS (
  SELECT 1 FROM episode_state AS state
  WHERE state.profile_id = queue_items.profile_id
    AND state.episode_id = queue_items.episode_id
    AND state.played = 1
    AND state.played_at IS NOT NULL
    AND queue_items.added_at <= state.played_at
)
AND NOT EXISTS (
  SELECT 1 FROM playback_state AS playback
  WHERE playback.profile_id = queue_items.profile_id
    AND playback.episode_id = queue_items.episode_id
    AND playback.state <> 'stopped'
);
