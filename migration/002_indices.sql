-- ============================================================
-- AI Waverider — Performance Indices
-- Run after 001_schema.sql
-- psql -U aiwaverider -d aiwaverider -f 002_indices.sql
-- ============================================================

-- Users
CREATE INDEX IF NOT EXISTS idx_users_email     ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role      ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_status    ON users(status);
CREATE INDEX IF NOT EXISTS idx_users_search    ON users(search_field);

-- Agents (matches current query patterns)
CREATE INDEX IF NOT EXISTS idx_agents_category       ON agents(category);
CREATE INDEX IF NOT EXISTS idx_agents_categories     ON agents USING GIN(categories);
CREATE INDEX IF NOT EXISTS idx_agents_tags           ON agents USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_agents_is_featured    ON agents(is_featured) WHERE is_featured = TRUE;
CREATE INDEX IF NOT EXISTS idx_agents_is_free        ON agents(is_free);
CREATE INDEX IF NOT EXISTS idx_agents_price          ON agents(price);
CREATE INDEX IF NOT EXISTS idx_agents_average_rating ON agents(average_rating DESC);
CREATE INDEX IF NOT EXISTS idx_agents_created_at     ON agents(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agents_popularity     ON agents(popularity DESC);
CREATE INDEX IF NOT EXISTS idx_agents_status         ON agents(status);
CREATE INDEX IF NOT EXISTS idx_agents_name_trgm      ON agents USING GIN(name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_agents_title_trgm     ON agents USING GIN(title gin_trgm_ops);

-- Agent Reviews
CREATE INDEX IF NOT EXISTS idx_agent_reviews_agent ON agent_reviews(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_reviews_user  ON agent_reviews(user_id);

-- Orders
CREATE INDEX IF NOT EXISTS idx_orders_user       ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_status     ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created    ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_payment_id ON orders(payment_id);

-- Invoices
CREATE INDEX IF NOT EXISTS idx_invoices_order  ON invoices(order_id);
CREATE INDEX IF NOT EXISTS idx_invoices_number ON invoices(invoice_number);

-- Videos
CREATE INDEX IF NOT EXISTS idx_videos_platform ON videos(platform);
CREATE INDEX IF NOT EXISTS idx_videos_created  ON videos(created_at DESC);

-- Posts
CREATE INDEX IF NOT EXISTS idx_posts_category   ON posts(category);
CREATE INDEX IF NOT EXISTS idx_posts_created    ON posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_created_by ON posts(created_by);

-- Comments
CREATE INDEX IF NOT EXISTS idx_comments_post   ON comments(post_id);
CREATE INDEX IF NOT EXISTS idx_comments_user   ON comments(user_id);
CREATE INDEX IF NOT EXISTS idx_comments_parent ON comments(parent_comment_id);

-- Prompts
CREATE INDEX IF NOT EXISTS idx_prompts_category   ON prompts(category);
CREATE INDEX IF NOT EXISTS idx_prompts_created    ON prompts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_prompts_created_by ON prompts(created_by);
CREATE INDEX IF NOT EXISTS idx_prompts_featured   ON prompts(is_featured) WHERE is_featured = TRUE;
CREATE INDEX IF NOT EXISTS idx_prompts_tags       ON prompts USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_prompts_title_trgm ON prompts USING GIN(title gin_trgm_ops);

-- Wishlists
CREATE INDEX IF NOT EXISTS idx_wishlists_user  ON wishlists(user_id);
CREATE INDEX IF NOT EXISTS idx_wishlists_agent ON wishlists(agent_id);

-- Prices
CREATE INDEX IF NOT EXISTS idx_prices_agent ON prices(agent_id);

-- Template Access
CREATE INDEX IF NOT EXISTS idx_template_access_order   ON template_access(order_id);
CREATE INDEX IF NOT EXISTS idx_template_access_agent   ON template_access(agent_id);
CREATE INDEX IF NOT EXISTS idx_template_access_user    ON template_access(user_id);
CREATE INDEX IF NOT EXISTS idx_template_access_expires ON template_access(expires_at);
