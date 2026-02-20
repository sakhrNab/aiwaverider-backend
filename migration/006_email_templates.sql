-- 006_email_templates.sql
-- Email templates table for admin-customizable email content

CREATE TABLE IF NOT EXISTS email_templates (
  type        TEXT PRIMARY KEY,
  subject     TEXT NOT NULL,
  content     TEXT NOT NULL DEFAULT '',
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
