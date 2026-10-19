CREATE TABLE queue_activity (
  profile_id TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  last_activity_at TEXT NOT NULL,
  expired_at TEXT,
  expired_episode_id TEXT
);

INSERT INTO queue_activity(profile_id, last_activity_at)
SELECT queued.profile_id, MAX(MAX(queued.added_at), COALESCE(playback.updated_at, ''))
FROM queue_items AS queued
LEFT JOIN playback_state AS playback ON playback.profile_id = queued.profile_id
GROUP BY queued.profile_id;

CREATE TRIGGER queue_activity_after_insert
AFTER INSERT ON queue_items
BEGIN
  INSERT INTO queue_activity(profile_id, last_activity_at)
  VALUES (NEW.profile_id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  ON CONFLICT(profile_id) DO UPDATE SET last_activity_at = MAX(queue_activity.last_activity_at, excluded.last_activity_at), expired_at = NULL;
END;

CREATE TRIGGER queue_activity_after_delete
AFTER DELETE ON queue_items
BEGIN
  INSERT INTO queue_activity(profile_id, last_activity_at)
  VALUES (OLD.profile_id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  ON CONFLICT(profile_id) DO UPDATE SET last_activity_at = MAX(queue_activity.last_activity_at, excluded.last_activity_at);
END;

CREATE TRIGGER queue_activity_after_reorder
AFTER UPDATE OF sort_index ON queue_items
WHEN NEW.sort_index <> OLD.sort_index
BEGIN
  INSERT INTO queue_activity(profile_id, last_activity_at)
  VALUES (NEW.profile_id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  ON CONFLICT(profile_id) DO UPDATE SET last_activity_at = MAX(queue_activity.last_activity_at, excluded.last_activity_at), expired_at = NULL;
END;

CREATE TRIGGER queue_activity_after_playback_insert
AFTER INSERT ON playback_state
WHEN NEW.episode_id IS NOT NULL
BEGIN
  INSERT INTO queue_activity(profile_id, last_activity_at)
  VALUES (NEW.profile_id, NEW.updated_at)
  ON CONFLICT(profile_id) DO UPDATE SET last_activity_at = MAX(queue_activity.last_activity_at, excluded.last_activity_at), expired_at = NULL;
END;

CREATE TRIGGER queue_activity_after_playback_update
AFTER UPDATE ON playback_state
WHEN NEW.episode_id IS NOT NULL AND (
  NEW.state = 'playing' OR NEW.episode_id IS NOT OLD.episode_id
  OR NEW.state <> OLD.state OR NEW.position_ms <> OLD.position_ms
  OR NEW.playback_rate <> OLD.playback_rate
)
BEGIN
  INSERT INTO queue_activity(profile_id, last_activity_at)
  VALUES (NEW.profile_id, NEW.updated_at)
  ON CONFLICT(profile_id) DO UPDATE SET last_activity_at = MAX(queue_activity.last_activity_at, excluded.last_activity_at), expired_at = NULL;
END;

CREATE TRIGGER queue_activity_after_progress_update
AFTER UPDATE OF position_ms ON episode_state
WHEN NEW.position_ms <> OLD.position_ms AND EXISTS (
  SELECT 1 FROM queue_items WHERE profile_id = NEW.profile_id AND episode_id = NEW.episode_id
)
BEGIN
  INSERT INTO queue_activity(profile_id, last_activity_at)
  VALUES (NEW.profile_id, NEW.updated_at)
  ON CONFLICT(profile_id) DO UPDATE SET last_activity_at = MAX(queue_activity.last_activity_at, excluded.last_activity_at), expired_at = NULL;
END;
