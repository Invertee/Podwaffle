-- Progress may be considered "played" for presentation purposes near the end,
-- but queue advancement must only happen after a client reports the actual media
-- duration. These triggers correct automatic completion writes before the API
-- reads the updated episode state. Manual played/unplayed choices are preserved.

CREATE TRIGGER episode_state_require_actual_end_after_insert
AFTER INSERT ON episode_state
WHEN NEW.manual_play_state = 'none'
  AND NEW.played = 1
  AND NEW.duration_ms IS NOT NULL
  AND NEW.duration_ms > 0
  AND NEW.position_ms < NEW.duration_ms
BEGIN
  UPDATE episode_state
  SET played = 0,
      played_at = NULL
  WHERE profile_id = NEW.profile_id
    AND episode_id = NEW.episode_id;
END;

CREATE TRIGGER episode_state_require_actual_end_after_update
AFTER UPDATE OF position_ms, duration_ms, played, manual_play_state ON episode_state
WHEN NEW.manual_play_state = 'none'
  AND NEW.played = 1
  AND NEW.duration_ms IS NOT NULL
  AND NEW.duration_ms > 0
  AND NEW.position_ms < NEW.duration_ms
BEGIN
  UPDATE episode_state
  SET played = 0,
      played_at = NULL
  WHERE profile_id = NEW.profile_id
    AND episode_id = NEW.episode_id;
END;
