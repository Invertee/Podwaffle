CREATE TABLE subscription_analysis_settings (
  profile_id TEXT NOT NULL,
  podcast_id TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  phrases_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL,
  PRIMARY KEY(profile_id,podcast_id),
  FOREIGN KEY(profile_id,podcast_id) REFERENCES subscriptions(profile_id,podcast_id) ON DELETE CASCADE
);
ALTER TABLE episodes ADD COLUMN chapters_url TEXT;
CREATE TABLE episode_analysis_jobs (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  request_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  stage TEXT NOT NULL DEFAULT 'queued',
  progress INTEGER NOT NULL DEFAULT 0,
  remote_job_id TEXT,
  remote_base_url TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  finished_at TEXT,
  error TEXT,
  result_json TEXT,
  logs_json TEXT NOT NULL DEFAULT '[]',
  transcript_expires_at TEXT
);
CREATE UNIQUE INDEX episode_analysis_active ON episode_analysis_jobs(profile_id,episode_id)
  WHERE status IN ('queued','processing');
CREATE INDEX episode_analysis_poll ON episode_analysis_jobs(status,next_attempt_at);
CREATE INDEX episode_analysis_episode ON episode_analysis_jobs(profile_id,episode_id,created_at);
