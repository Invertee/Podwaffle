CREATE TABLE analysis_media (
  id TEXT PRIMARY KEY,
  episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  sha256 TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  source_url TEXT NOT NULL,
  content_type TEXT NOT NULL,
  created_at TEXT NOT NULL,
  accessed_at TEXT NOT NULL,
  UNIQUE(episode_id, sha256)
);
CREATE TABLE analysis_storage_settings (
  id INTEGER PRIMARY KEY CHECK(id=1),
  limit_mb INTEGER NOT NULL CHECK(limit_mb>=0)
);
CREATE TABLE analysis_test_job_owners (
  job_id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE
);
