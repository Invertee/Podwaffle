CREATE TABLE playback_commands (
  command_id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  requested_by_device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  owner_device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (
    action IN ('play', 'pause', 'seek', 'skip-forward', 'skip-backward', 'next', 'previous')
  ),
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'accepted', 'rejected', 'cancelled')
  ),
  result_json TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX playback_commands_owner_pending
  ON playback_commands(profile_id, owner_device_id, status);
