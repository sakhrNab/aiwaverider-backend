-- ============================================================
-- AI Waverider — PostgreSQL Schema (Firestore Migration)
-- Run: psql -U aiwaverider -d aiwaverider -f 001_schema.sql
-- ============================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS pg_trgm;   -- fuzzy text search (GIN trigram indices)

-- ============================================================
-- Helper: auto-update updated_at on row modification
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- users
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
  id              TEXT PRIMARY KEY,                        -- Firebase UID
  email           TEXT UNIQUE NOT NULL,
  username        TEXT UNIQUE,
  first_name      TEXT,
  last_name       TEXT,
  display_name    TEXT,
  phone_number    TEXT,
  photo_url       TEXT,
  role            TEXT DEFAULT 'authenticated',            -- 'authenticated' | 'admin'
  status          TEXT DEFAULT 'active',
  search_field    TEXT,
  email_preferences JSONB DEFAULT '{}',
  onboarding      JSONB DEFAULT '{}',
  signup_method   TEXT,
  password_hash   TEXT,                                    -- only for email signups
  subscription    JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE OR REPLACE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- agents
-- ============================================================
CREATE TABLE IF NOT EXISTS agents (
  id                  TEXT PRIMARY KEY,                    -- Firestore doc ID
  name                TEXT NOT NULL,
  title               TEXT,
  description         TEXT,
  category            TEXT,
  categories          TEXT[] DEFAULT '{}',
  status              TEXT DEFAULT 'active',
  business_value      TEXT,
  paddle_compliant    BOOLEAN DEFAULT FALSE,
  version             TEXT DEFAULT '1.0.0',
  -- Pricing (denormalized for query performance)
  price               NUMERIC(10,2) DEFAULT 0,
  is_free             BOOLEAN DEFAULT TRUE,
  price_details       JSONB DEFAULT '{}',
  -- Creator info
  creator             JSONB DEFAULT '{}',
  -- File metadata
  image               JSONB,
  image_url           TEXT,
  icon                JSONB,
  icon_url            TEXT,
  json_file           JSONB,
  download_url        TEXT,
  file_url            TEXT,
  -- Flags
  is_featured         BOOLEAN DEFAULT FALSE,
  is_verified         BOOLEAN DEFAULT FALSE,
  is_popular          BOOLEAN DEFAULT FALSE,
  is_trending         BOOLEAN DEFAULT FALSE,
  is_subscription     BOOLEAN DEFAULT FALSE,
  -- Arrays
  features            TEXT[] DEFAULT '{}',
  tags                TEXT[] DEFAULT '{}',
  deliverables        JSONB DEFAULT '[]',
  -- Engagement
  likes               TEXT[] DEFAULT '{}',                 -- user IDs
  like_count          INTEGER DEFAULT 0,
  download_count      INTEGER DEFAULT 0,
  view_count          INTEGER DEFAULT 0,
  popularity          INTEGER DEFAULT 0,
  wishlist_count      INTEGER DEFAULT 0,
  -- Ratings (denormalized for sort performance)
  average_rating      NUMERIC(3,2) DEFAULT 0,
  review_count        INTEGER DEFAULT 0,
  -- Workflow
  workflow_metadata   JSONB,
  -- Timestamps
  last_transformed    TIMESTAMPTZ,
  analyzed_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE OR REPLACE TRIGGER trg_agents_updated_at
  BEFORE UPDATE ON agents
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- agent_reviews  (was subcollection agents/{id}/reviews)
-- ============================================================
CREATE TABLE IF NOT EXISTS agent_reviews (
  id                    TEXT PRIMARY KEY,
  agent_id              TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  user_id               TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_name             TEXT,
  rating                INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  content               TEXT NOT NULL,
  verification_status   TEXT DEFAULT 'unverified',
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(agent_id, user_id)
);

-- ============================================================
-- orders
-- ============================================================
CREATE TABLE IF NOT EXISTS orders (
  id                      TEXT PRIMARY KEY,
  user_id                 TEXT REFERENCES users(id) ON DELETE SET NULL,
  user_email              TEXT,
  items                   JSONB NOT NULL DEFAULT '[]',
  total                   NUMERIC(10,2) NOT NULL DEFAULT 0,
  currency                TEXT DEFAULT 'USD',
  status                  TEXT DEFAULT 'pending',
  payment_id              TEXT,
  payment_method          TEXT,
  payment_processor       TEXT,
  delivery_status         TEXT DEFAULT 'pending',
  delivery_results        JSONB DEFAULT '[]',
  metadata                JSONB DEFAULT '{}',
  vat_info                JSONB,
  invoice_id              TEXT,
  invoice_number          TEXT,
  template_access_tokens  TEXT[] DEFAULT '{}',
  unipay_order_hash_id    TEXT,
  merchant_order_id       TEXT,
  conversion_info         JSONB,
  refund_id               TEXT,
  refund_amount           NUMERIC(10,2),
  refunded_at             TIMESTAMPTZ,
  refund_reason           TEXT,
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE OR REPLACE TRIGGER trg_orders_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- invoices
-- ============================================================
CREATE TABLE IF NOT EXISTS invoices (
  id              TEXT PRIMARY KEY,
  invoice_number  TEXT UNIQUE,
  status          TEXT DEFAULT 'paid',
  issue_date      TIMESTAMPTZ,
  due_date        TIMESTAMPTZ,
  paid_date       TIMESTAMPTZ,
  paid_amount     NUMERIC(10,2),
  total_amount    NUMERIC(10,2),
  subtotal        NUMERIC(10,2),
  vat_rate        NUMERIC(5,2) DEFAULT 0,
  vat_amount      NUMERIC(10,2) DEFAULT 0,
  currency        TEXT DEFAULT 'USD',
  company         JSONB DEFAULT '{}',
  customer        JSONB DEFAULT '{}',
  line_items      JSONB DEFAULT '[]',
  payment         JSONB DEFAULT '{}',
  order_id        TEXT REFERENCES orders(id) ON DELETE SET NULL,
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE OR REPLACE TRIGGER trg_invoices_updated_at
  BEFORE UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- videos
-- ============================================================
CREATE TABLE IF NOT EXISTS videos (
  id                TEXT PRIMARY KEY,
  platform          TEXT NOT NULL,                         -- 'youtube' | 'tiktok' | 'instagram'
  original_url      TEXT NOT NULL,
  embed_url         TEXT,
  title             TEXT,
  author_name       TEXT,
  author_user       TEXT,
  description       TEXT,
  thumbnail_url     TEXT,
  views             INTEGER DEFAULT 0,
  likes             INTEGER DEFAULT 0,
  comments_count    INTEGER DEFAULT 0,
  shares            INTEGER DEFAULT 0,
  engagement_score  NUMERIC(10,2),
  added_by          TEXT,                                  -- email
  added_by_uid      TEXT REFERENCES users(id) ON DELETE SET NULL,
  last_fetched      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- posts
-- ============================================================
CREATE TABLE IF NOT EXISTS posts (
  id                  TEXT PRIMARY KEY,
  title               TEXT NOT NULL,
  description         TEXT NOT NULL,
  category            TEXT NOT NULL,
  image_url           TEXT,
  image_filename      TEXT,
  additional_html     TEXT,
  graph_html          TEXT,
  created_by          TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_by_username TEXT,
  views               INTEGER DEFAULT 0,
  likes               TEXT[] DEFAULT '{}',
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE OR REPLACE TRIGGER trg_posts_updated_at
  BEFORE UPDATE ON posts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- comments
-- ============================================================
CREATE TABLE IF NOT EXISTS comments (
  id                  TEXT PRIMARY KEY,
  post_id             TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id             TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  username            TEXT,
  user_role           TEXT,
  text                TEXT NOT NULL,
  likes               TEXT[] DEFAULT '{}',
  parent_comment_id   TEXT REFERENCES comments(id) ON DELETE CASCADE,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE OR REPLACE TRIGGER trg_comments_updated_at
  BEFORE UPDATE ON comments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- prompts
-- ============================================================
CREATE TABLE IF NOT EXISTS prompts (
  id                TEXT PRIMARY KEY,
  title             TEXT NOT NULL,
  description       TEXT,
  link              TEXT,
  image             TEXT,                                  -- URL string
  video_url         TEXT,
  input_image       TEXT,
  keywords          TEXT[] DEFAULT '{}',
  tags              TEXT[] DEFAULT '{}',
  category          TEXT,
  additional_html   TEXT,
  json_prompt       TEXT,                                  -- JSON string for generated prompt
  created_by        TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_by        TEXT,
  likes             TEXT[] DEFAULT '{}',
  like_count        INTEGER DEFAULT 0,
  view_count        INTEGER DEFAULT 0,
  download_count    INTEGER DEFAULT 0,
  is_featured       BOOLEAN DEFAULT FALSE,
  is_public         BOOLEAN DEFAULT TRUE,
  type              TEXT DEFAULT 'prompt',
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE OR REPLACE TRIGGER trg_prompts_updated_at
  BEFORE UPDATE ON prompts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- wishlists
-- ============================================================
CREATE TABLE IF NOT EXISTS wishlists (
  id          TEXT PRIMARY KEY,                            -- format: {userId}_{agentId}
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agent_id    TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, agent_id)
);

-- ============================================================
-- prices
-- ============================================================
CREATE TABLE IF NOT EXISTS prices (
  id                  TEXT PRIMARY KEY,                    -- same as agent_id
  agent_id            TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  base_price          NUMERIC(10,2) DEFAULT 0,
  discounted_price    NUMERIC(10,2) DEFAULT 0,
  final_price         NUMERIC(10,2) DEFAULT 0,
  discount_percentage NUMERIC(5,2) DEFAULT 0,
  currency            TEXT DEFAULT 'USD',
  is_free             BOOLEAN DEFAULT TRUE,
  is_subscription     BOOLEAN DEFAULT FALSE,
  discount            JSONB,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE OR REPLACE TRIGGER trg_prices_updated_at
  BEFORE UPDATE ON prices
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- template_access
-- ============================================================
CREATE TABLE IF NOT EXISTS template_access (
  id                    TEXT PRIMARY KEY,                  -- UUID token
  order_id              TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  agent_id              TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  user_id               TEXT REFERENCES users(id) ON DELETE SET NULL,
  email                 TEXT,
  used                  BOOLEAN DEFAULT FALSE,
  revoked               BOOLEAN DEFAULT FALSE,
  revoked_at            TIMESTAMPTZ,
  revoked_reason        TEXT,
  invoice_id            TEXT,
  unipay_order_hash_id  TEXT,
  merchant_order_id     TEXT,
  expires_at            TIMESTAMPTZ NOT NULL,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- site_config
-- ============================================================
CREATE TABLE IF NOT EXISTS site_config (
  id              TEXT PRIMARY KEY DEFAULT 'settings',
  theme           JSONB DEFAULT '{}',
  notifications   JSONB DEFAULT '{}',
  advertisement   JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE OR REPLACE TRIGGER trg_site_config_updated_at
  BEFORE UPDATE ON site_config
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
