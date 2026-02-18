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

-- ============================================================
-- Seed: Sakhr's 6 production apps
-- ============================================================
INSERT INTO apps (id, title, type, category, categories, description, short_description, version, price, is_free, features, tags, platform_support, is_featured, is_published, created_by) VALUES
('app-ai-wavecut', 'AI WaveCut', 'app', 'Video Editing', '{"Video Editing","AI","Productivity"}',
 'AI-powered video editor that uses intelligent scene detection, auto-captioning, and smart trimming to turn raw footage into polished content in minutes. Built with Claude Code and Cursor in under 12 hours.',
 'AI-powered video editor with smart scene detection and auto-captioning.',
 '1.0.0', 0, TRUE,
 '{"AI scene detection","Auto-captioning","Smart trimming","Batch export","Timeline editing","Multi-format support"}',
 '{"video","editor","AI","captions","content creation","vibe coding"}',
 '{"Windows","Mac","Linux","Web"}', TRUE, TRUE, NULL),

('app-flowstate', 'FlowState', 'app', 'Productivity', '{"Productivity","AI","Focus"}',
 'AI-driven productivity app that combines Pomodoro timing, focus music, task prioritization, and distraction blocking into one seamless flow state experience. Built with Claude Code in under 8 hours.',
 'AI productivity app combining focus timing, task management, and distraction blocking.',
 '1.0.0', 0, TRUE,
 '{"Pomodoro timer","AI task prioritization","Focus music","Distraction blocking","Daily analytics","Session history"}',
 '{"productivity","focus","pomodoro","AI","time management","vibe coding"}',
 '{"Windows","Mac","Linux","Web"}', TRUE, TRUE, NULL),

('app-srt-translator-pro', 'SRT Translator Pro', 'app', 'Translation', '{"Translation","AI","Subtitles"}',
 'Professional subtitle translator supporting 50+ languages with context-aware AI translation. Preserves timing, handles idioms, and exports in SRT/VTT/ASS formats. Built in under 6 hours.',
 'AI subtitle translator for 50+ languages with context-aware translation.',
 '1.0.0', 0, TRUE,
 '{"50+ languages","Context-aware translation","SRT/VTT/ASS export","Batch processing","Timing preservation","Idiom handling"}',
 '{"subtitles","translation","SRT","localization","AI","vibe coding"}',
 '{"Windows","Mac","Linux","Web"}', TRUE, TRUE, NULL),

('app-ai-job-writer', 'AI Job Writer', 'app', 'Career', '{"Career","AI","Resume"}',
 'AI resume and cover letter generator that analyzes job descriptions, matches your experience, and produces ATS-optimized applications. Includes interview prep questions. Built in under 4 hours.',
 'AI-powered resume and cover letter generator with ATS optimization.',
 '1.0.0', 0, TRUE,
 '{"Job description analysis","ATS optimization","Cover letter generation","Interview prep","Multiple templates","Keyword matching"}',
 '{"resume","cover letter","job","career","ATS","AI","vibe coding"}',
 '{"Web"}', TRUE, TRUE, NULL),

('app-outbound-ai', 'Outbound AI', 'app', 'Sales', '{"Sales","AI","Outreach"}',
 'AI cold outreach platform that researches prospects, personalizes messages at scale, and manages multi-channel follow-up sequences across email and LinkedIn. Built with N8N + Claude Code.',
 'AI cold outreach tool with prospect research and multi-channel follow-ups.',
 '1.0.0', 0, TRUE,
 '{"Prospect research","Personalized messaging","Multi-channel outreach","Follow-up sequences","LinkedIn integration","Analytics dashboard"}',
 '{"sales","outreach","cold email","LinkedIn","AI","automation","vibe coding"}',
 '{"Web"}', TRUE, TRUE, NULL),

('app-email-ai', 'Email AI', 'app', 'Automation', '{"Automation","AI","Email"}',
 'Intelligent email automation system that categorizes, prioritizes, drafts replies, and manages follow-ups using AI. Integrates with Gmail and Outlook. Built with N8N workflows.',
 'AI email automation for categorization, smart replies, and follow-up management.',
 '1.0.0', 0, TRUE,
 '{"Email categorization","AI draft replies","Smart follow-ups","Gmail integration","Outlook integration","Priority inbox"}',
 '{"email","automation","AI","Gmail","Outlook","productivity","vibe coding"}',
 '{"Web"}', TRUE, TRUE, NULL)
ON CONFLICT (id) DO NOTHING;
