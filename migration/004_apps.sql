-- ============================================================
-- AI Waverider — Apps Table (previously in Firestore)
-- Run: psql -U aiwaverider -d aiwaverider -f 004_apps.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS apps (
  id                  TEXT PRIMARY KEY,
  title               TEXT NOT NULL,
  type                TEXT DEFAULT 'app',                     -- 'app' | 'tool'
  category            TEXT,
  categories          TEXT[] DEFAULT '{}',
  description         TEXT,
  short_description   TEXT,
  version             TEXT DEFAULT '1.0.0',
  -- Pricing
  price               NUMERIC(10,2) DEFAULT 0,
  is_free             BOOLEAN DEFAULT TRUE,
  price_details       JSONB DEFAULT '{}',
  -- URLs & media
  image_url           TEXT,
  image_filename      TEXT,
  icon_url            TEXT,
  icon_filename       TEXT,
  external_url        TEXT,                                    -- for type='tool'
  download_url        TEXT,
  download_filename   TEXT,
  video_url           TEXT,
  screenshots         JSONB DEFAULT '[]',
  -- Arrays
  features            TEXT[] DEFAULT '{}',
  tags                TEXT[] DEFAULT '{}',
  platform_support    TEXT[] DEFAULT '{}',                     -- 'Windows','Mac','Linux','Web'
  system_requirements TEXT,
  resources           JSONB DEFAULT '[]',
  related_apps        JSONB DEFAULT '[]',
  -- Flags
  is_featured         BOOLEAN DEFAULT FALSE,
  is_published        BOOLEAN DEFAULT TRUE,
  -- Engagement
  download_count      INTEGER DEFAULT 0,
  view_count          INTEGER DEFAULT 0,
  likes               TEXT[] DEFAULT '{}',
  rating_average      NUMERIC(3,2) DEFAULT 0,
  rating_count        INTEGER DEFAULT 0,
  -- Creator
  created_by          TEXT REFERENCES users(id) ON DELETE SET NULL,
  -- Timestamps
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE OR REPLACE TRIGGER trg_apps_updated_at
  BEFORE UPDATE ON apps
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Indices
CREATE INDEX IF NOT EXISTS idx_apps_category ON apps (category);
CREATE INDEX IF NOT EXISTS idx_apps_type ON apps (type);
CREATE INDEX IF NOT EXISTS idx_apps_is_featured ON apps (is_featured) WHERE is_featured = TRUE;
CREATE INDEX IF NOT EXISTS idx_apps_is_published ON apps (is_published);
CREATE INDEX IF NOT EXISTS idx_apps_created_at ON apps (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_apps_title_trgm ON apps USING GIN (title gin_trgm_ops);
