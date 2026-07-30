CREATE TABLE profiles (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  timezone TEXT NOT NULL DEFAULT 'UTC',
  settings_json TEXT NOT NULL DEFAULT '{}',
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('web', 'android')),
  token_hash TEXT NOT NULL UNIQUE,
  app_version TEXT,
  runtime_version TEXT,
  capabilities_json TEXT NOT NULL DEFAULT '{}',
  last_seen_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX devices_profile_id_idx ON devices(profile_id);

CREATE TABLE podcasts (
  id TEXT PRIMARY KEY,
  feed_url TEXT NOT NULL UNIQUE,
  apple_collection_id TEXT,
  title TEXT NOT NULL,
  author TEXT,
  description TEXT,
  artwork_url TEXT,
  website_url TEXT,
  etag TEXT,
  last_modified TEXT,
  last_checked_at TEXT,
  last_success_at TEXT,
  next_check_at TEXT,
  failure_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE subscriptions (
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  podcast_id TEXT NOT NULL REFERENCES podcasts(id) ON DELETE CASCADE,
  sort_index INTEGER NOT NULL,
  subscribed_at TEXT NOT NULL,
  auto_download_mode TEXT NOT NULL DEFAULT 'none',
  auto_download_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (profile_id, podcast_id)
);

CREATE TABLE episodes (
  id TEXT PRIMARY KEY,
  podcast_id TEXT NOT NULL REFERENCES podcasts(id) ON DELETE CASCADE,
  guid TEXT,
  enclosure_url TEXT,
  enclosure_type TEXT,
  title TEXT NOT NULL,
  description_html TEXT,
  published_at TEXT,
  first_discovered_at TEXT NOT NULL,
  duration_ms INTEGER,
  artwork_url TEXT,
  episode_url TEXT,
  explicit INTEGER NOT NULL DEFAULT 0,
  removed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX episodes_podcast_guid_idx
  ON episodes(podcast_id, guid) WHERE guid IS NOT NULL;

CREATE TABLE episode_state (
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  position_ms INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER,
  played INTEGER NOT NULL DEFAULT 0,
  played_at TEXT,
  manual_play_state TEXT NOT NULL DEFAULT 'none'
    CHECK (manual_play_state IN ('none', 'played', 'unplayed')),
  last_played_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (profile_id, episode_id)
);

CREATE TABLE queue_items (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  sort_index INTEGER NOT NULL,
  added_at TEXT NOT NULL,
  UNIQUE(profile_id, episode_id)
);

CREATE TABLE playback_state (
  profile_id TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  episode_id TEXT REFERENCES episodes(id) ON DELETE SET NULL,
  position_ms INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER,
  state TEXT NOT NULL DEFAULT 'stopped' CHECK (state IN ('playing', 'paused', 'stopped')),
  mode TEXT NOT NULL DEFAULT 'local' CHECK (mode IN ('local', 'cast')),
  playback_rate REAL NOT NULL DEFAULT 1,
  active_device_id TEXT REFERENCES devices(id) ON DELETE SET NULL,
  lease_expires_at TEXT,
  cast_owner_device_id TEXT REFERENCES devices(id) ON DELETE SET NULL,
  cast_session_id TEXT,
  revision INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE playback_telemetry (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  playback_instance_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('web-local', 'android-local', 'cast')),
  listened_ms INTEGER NOT NULL,
  content_consumed_ms INTEGER NOT NULL,
  recorded_at TEXT NOT NULL,
  UNIQUE(playback_instance_id, sequence)
);

CREATE TABLE movement_events (
  id TEXT PRIMARY KEY,
  command_id TEXT NOT NULL UNIQUE,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('skip-forward', 'skip-backward', 'seek')),
  from_position_ms INTEGER NOT NULL,
  requested_position_ms INTEGER NOT NULL,
  confirmed_position_ms INTEGER NOT NULL,
  skipped_forward_ms INTEGER NOT NULL DEFAULT 0,
  rewound_ms INTEGER NOT NULL DEFAULT 0,
  occurred_at TEXT NOT NULL
);

CREATE TABLE daily_listening_stats (
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  local_date TEXT NOT NULL,
  listened_ms INTEGER NOT NULL DEFAULT 0,
  content_consumed_ms INTEGER NOT NULL DEFAULT 0,
  skipped_forward_ms INTEGER NOT NULL DEFAULT 0,
  rewound_ms INTEGER NOT NULL DEFAULT 0,
  episodes_completed INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (profile_id, local_date)
);

CREATE TABLE history_events (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  position_ms INTEGER NOT NULL DEFAULT 0,
  occurred_at TEXT NOT NULL
);

CREATE TABLE sync_events (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(profile_id, revision)
);
CREATE INDEX sync_events_profile_revision_idx ON sync_events(profile_id, revision);
CREATE INDEX sync_events_created_at_idx ON sync_events(created_at);

CREATE TABLE processed_commands (
  command_id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE push_registrations (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'fcm' CHECK (provider = 'fcm'),
  registration_token TEXT NOT NULL,
  app_version TEXT,
  runtime_version TEXT,
  last_success_at TEXT,
  last_failure_at TEXT,
  last_failure_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
