CREATE TABLE IF NOT EXISTS streams (
  id UUID PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  stream_key TEXT NOT NULL UNIQUE,
  started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMP WITH TIME ZONE
);

ALTER TABLE streams ADD COLUMN IF NOT EXISTS source TEXT;
ALTER TABLE streams ADD COLUMN IF NOT EXISTS record BOOLEAN NOT NULL DEFAULT TRUE;
CREATE UNIQUE INDEX IF NOT EXISTS one_browser_stream_per_account
  ON streams (user_id) WHERE source = 'browser' AND ended_at IS NULL;

CREATE TABLE IF NOT EXISTS recordings (
  id UUID PRIMARY KEY,
  stream_id UUID NOT NULL UNIQUE REFERENCES streams(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ NOT NULL,
  duration_ms INTEGER NOT NULL CHECK (duration_ms >= 0),
  playback_start TEXT NOT NULL,
  duration_seconds DOUBLE PRECISION NOT NULL,
  path TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS clips (
  id UUID PRIMARY KEY,
  recording_id UUID REFERENCES recordings(id) ON DELETE CASCADE,
  stream_id UUID,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  start_ms INTEGER NOT NULL CHECK (start_ms >= 0),
  duration_ms INTEGER NOT NULL CHECK (duration_ms > 0 AND duration_ms <= 60000),
  path TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
