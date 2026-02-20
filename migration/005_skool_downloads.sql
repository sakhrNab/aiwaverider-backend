-- ============================================================
-- AI Waverider — Skool Downloads Table (email capture for free downloads)
-- Run: psql -U aiwaverider -d aiwaverider -f 005_skool_downloads.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS skool_downloads (
  id                  TEXT PRIMARY KEY,
  app_id              TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  email               TEXT NOT NULL,
  download_count      INTEGER DEFAULT 1,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  last_downloaded_at  TIMESTAMPTZ,
  UNIQUE(app_id, email)
);

-- Indices
CREATE INDEX IF NOT EXISTS idx_skool_downloads_app_id ON skool_downloads (app_id);
CREATE INDEX IF NOT EXISTS idx_skool_downloads_email ON skool_downloads (email);
CREATE INDEX IF NOT EXISTS idx_skool_downloads_created_at ON skool_downloads (created_at DESC);
