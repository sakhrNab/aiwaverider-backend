/**
 * Test all backend query patterns against the PostgreSQL schema.
 * Does NOT modify backend code — just verifies the schema supports
 * every query the application currently uses.
 *
 * Usage: node test-queries.js
 */

require('dotenv').config({ path: __dirname + '/.env' });
const { Client } = require('pg');

const pgConfig = {
  host: process.env.PGHOST || 'localhost',
  port: parseInt(process.env.PGPORT || '5432', 10),
  user: process.env.PGUSER || 'sakhr',
  password: process.env.PGPASSWORD || 'sakhr',
  database: process.env.PGDATABASE || 'aiwaverider',
};

let passed = 0;
let failed = 0;
const failures = [];

async function test(client, name, sql, params = []) {
  try {
    const res = await client.query(sql, params);
    console.log(`  ✓ ${name}`);
    passed++;
    return res;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failed++;
    failures.push({ name, error: err.message });
    return null;
  }
}

async function main() {
  const client = new Client(pgConfig);
  await client.connect();
  console.log(`Connected to ${pgConfig.database}\n`);

  // ================================================================
  // USERS — authController.js, userController.js, profileController.js
  // ================================================================
  console.log('=== USERS ===');

  // signup: doc(uid).set(...)
  await test(client, 'INSERT user (signup)',
    `INSERT INTO users (id, email, username, first_name, last_name, display_name, phone_number, photo_url,
      role, status, search_field, email_preferences, onboarding, signup_method, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW(),NOW())
     ON CONFLICT (id) DO NOTHING`,
    ['test-uid-1', 'test@example.com', 'testuser', 'Test', 'User', 'Test User', '+1234567890',
     'https://example.com/photo.jpg', 'authenticated', 'active',
     'testuser test@example.com test user',
     JSON.stringify({ weeklyUpdates: false, announcements: true }),
     JSON.stringify({ completed: false, currentStep: 'welcome' }),
     'email']);

  // signup: check username uniqueness
  await test(client, 'Check username uniqueness (WHERE username = $1)',
    `SELECT id FROM users WHERE username = $1`, ['testuser']);

  // signup: check email uniqueness
  await test(client, 'Check email uniqueness (WHERE email = $1)',
    `SELECT id FROM users WHERE email = $1`, ['test@example.com']);

  // createSession / verifyUser: doc(uid).get()
  await test(client, 'Get user by ID (doc lookup)',
    `SELECT * FROM users WHERE id = $1`, ['test-uid-1']);

  // admin: list users with role filter
  await test(client, 'List users by role',
    `SELECT id, email, username, role, status, created_at FROM users WHERE role = $1 ORDER BY created_at DESC LIMIT 20`,
    ['authenticated']);

  // admin: search users by search_field
  await test(client, 'Search users by search_field (ILIKE)',
    `SELECT id, email, username FROM users WHERE search_field ILIKE $1 LIMIT 20`,
    ['%test%']);

  // profileController: update user profile
  await test(client, 'UPDATE user profile',
    `UPDATE users SET first_name=$2, last_name=$3, display_name=$4, phone_number=$5, updated_at=NOW()
     WHERE id = $1`,
    ['test-uid-1', 'Updated', 'Name', 'Updated Name', '+9876543210']);

  // ================================================================
  // AGENTS — agentsController.js
  // ================================================================
  console.log('\n=== AGENTS ===');

  // Insert test agent
  await test(client, 'INSERT agent',
    `INSERT INTO agents (id, name, title, description, category, categories, status,
      business_value, paddle_compliant, version, price, is_free, price_details, creator,
      features, tags, deliverables, is_featured, is_verified, is_popular, is_trending,
      likes, like_count, download_count, view_count, popularity, average_rating, review_count,
      workflow_metadata, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,NOW(),NOW())
     ON CONFLICT (id) DO NOTHING`,
    ['test-agent-1', 'Gmail AI Agent', 'Gmail AI Automation', 'Automates Gmail workflows',
     'Productivity', '{Productivity,AI,Email}', 'active',
     'Saves 5 hours per week', true, '1.0.0',
     29.99, false,
     JSON.stringify({ basePrice: 29.99, discountedPrice: 29.99, currency: 'USD', isFree: false }),
     JSON.stringify({ id: 'test-uid-1', name: 'Test Creator', role: 'admin' }),
     '{email,automation,AI}', '{gmail,productivity}',
     JSON.stringify([{ fileName: 'gmail-agent.json', description: 'Workflow file' }]),
     true, true, false, false,
     '{test-uid-1}', 1, 50, 200, 80,
     4.5, 10,
     JSON.stringify({ integrations: ['Gmail', 'Sheets'], complexity: 'medium' })
    ]);

  // Insert second agent for filter/sort testing
  await test(client, 'INSERT second agent (free)',
    `INSERT INTO agents (id, name, title, description, category, categories, status,
      price, is_free, is_featured, tags, features, popularity, average_rating, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW(),NOW())
     ON CONFLICT (id) DO NOTHING`,
    ['test-agent-2', 'Slack Bot', 'Slack Automation', 'Automates Slack messages',
     'Business', '{Business,Communication}', 'active',
     0, true, false, '{slack,bot}', '{messaging,automation}', 50, 3.8]);

  // refreshAgentsCache: orderBy('createdAt', 'desc')
  await test(client, 'Get all agents ordered by created_at DESC (cache refresh)',
    `SELECT * FROM agents ORDER BY created_at DESC`);

  // getFeaturedAgents: where('isFeatured', '==', true).orderBy('createdAt', 'desc').limit(N)
  await test(client, 'Get featured agents',
    `SELECT * FROM agents WHERE is_featured = TRUE ORDER BY created_at DESC LIMIT $1`, [10]);

  // getAgentById: doc(id).get()
  await test(client, 'Get agent by ID',
    `SELECT * FROM agents WHERE id = $1`, ['test-agent-1']);

  // Category filter (both old and new format)
  await test(client, 'Filter by single category',
    `SELECT * FROM agents WHERE category = $1 OR $1 = ANY(categories) ORDER BY created_at DESC`,
    ['Productivity']);

  // GIN array search on categories
  await test(client, 'Filter by categories array (GIN)',
    `SELECT * FROM agents WHERE categories @> ARRAY[$1]::TEXT[]`, ['AI']);

  // Price range filter
  await test(client, 'Filter by price range',
    `SELECT * FROM agents WHERE price >= $1 AND price <= $2 ORDER BY price ASC`,
    [0, 50]);

  // Tag filter (any match)
  await test(client, 'Filter by tags (ANY overlap)',
    `SELECT * FROM agents WHERE tags && ARRAY[$1,$2]::TEXT[]`,
    ['gmail', 'slack']);

  // Feature filter
  await test(client, 'Filter by features (ANY overlap)',
    `SELECT * FROM agents WHERE features && ARRAY[$1]::TEXT[]`,
    ['automation']);

  // Sort: newest
  await test(client, 'Sort by newest',
    `SELECT * FROM agents ORDER BY created_at DESC LIMIT 20 OFFSET 0`);

  // Sort: top rated
  await test(client, 'Sort by top rated',
    `SELECT * FROM agents ORDER BY average_rating DESC, review_count DESC LIMIT 20`);

  // Sort: most popular
  await test(client, 'Sort by popularity',
    `SELECT * FROM agents ORDER BY popularity DESC, average_rating DESC LIMIT 20`);

  // Sort: price low to high
  await test(client, 'Sort by price ascending',
    `SELECT * FROM agents ORDER BY price ASC LIMIT 20`);

  // Sort: price high to low
  await test(client, 'Sort by price descending',
    `SELECT * FROM agents ORDER BY price DESC LIMIT 20`);

  // Fuzzy text search (pg_trgm)
  await test(client, 'Fuzzy search by name (trigram)',
    `SELECT * FROM agents WHERE name % $1 OR title % $1 ORDER BY similarity(name, $1) DESC LIMIT 20`,
    ['Gmail']);

  // ILIKE text search (simpler alternative)
  await test(client, 'Text search by ILIKE on title/description',
    `SELECT * FROM agents WHERE title ILIKE $1 OR description ILIKE $1 OR name ILIKE $1`,
    ['%gmail%']);

  // Verified filter
  await test(client, 'Filter verified agents',
    `SELECT * FROM agents WHERE is_verified = TRUE`);

  // Complexity filter via JSONB
  await test(client, 'Filter by workflow complexity (JSONB)',
    `SELECT * FROM agents WHERE workflow_metadata->>'complexity' = $1`,
    ['medium']);

  // Count agents
  await test(client, 'Count all agents',
    `SELECT COUNT(*) FROM agents`);

  // Increment download count (atomic)
  await test(client, 'Atomic increment download_count',
    `UPDATE agents SET download_count = download_count + 1 WHERE id = $1 RETURNING download_count`,
    ['test-agent-1']);

  // Toggle like (array operations)
  await test(client, 'Add user to likes array',
    `UPDATE agents SET likes = array_append(likes, $2), like_count = like_count + 1 WHERE id = $1`,
    ['test-agent-1', 'test-uid-2']);

  await test(client, 'Remove user from likes array',
    `UPDATE agents SET likes = array_remove(likes, $2), like_count = GREATEST(like_count - 1, 0) WHERE id = $1`,
    ['test-agent-1', 'test-uid-2']);

  // Check if user liked
  await test(client, 'Check if user liked agent',
    `SELECT $2 = ANY(likes) as liked, array_length(likes, 1) as likes_count FROM agents WHERE id = $1`,
    ['test-agent-1', 'test-uid-1']);

  // Pagination
  await test(client, 'Paginated agents (LIMIT/OFFSET)',
    `SELECT * FROM agents ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
    [20, 0]);

  // Delete agent + cascade
  await test(client, 'DELETE agent (cascade to reviews, wishlists, prices)',
    `DELETE FROM agents WHERE id = $1`, ['test-agent-2']);

  // Re-insert for remaining tests
  await test(client, 'Re-insert second agent',
    `INSERT INTO agents (id, name, title, category, categories, status, price, is_free, created_at, updated_at)
     VALUES ('test-agent-2','Slack Bot','Slack Automation','Business','{Business}','active',0,true,NOW(),NOW())
     ON CONFLICT (id) DO NOTHING`);

  // ================================================================
  // AGENT REVIEWS — agentsController.js (reviews in agent doc)
  // ================================================================
  console.log('\n=== AGENT REVIEWS ===');

  await test(client, 'INSERT agent review',
    `INSERT INTO agent_reviews (id, agent_id, user_id, user_name, rating, content, verification_status, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,NOW()) ON CONFLICT (id) DO NOTHING`,
    ['review-1', 'test-agent-1', 'test-uid-1', 'Test User', 5, 'Great agent!', 'verified_purchase']);

  await test(client, 'Get reviews for agent (sorted by created_at DESC)',
    `SELECT * FROM agent_reviews WHERE agent_id = $1 ORDER BY created_at DESC`,
    ['test-agent-1']);

  await test(client, 'Check duplicate review (UNIQUE user+agent)',
    `SELECT id FROM agent_reviews WHERE agent_id = $1 AND user_id = $2`,
    ['test-agent-1', 'test-uid-1']);

  await test(client, 'Compute average rating from reviews',
    `SELECT AVG(rating)::NUMERIC(3,2) as avg_rating, COUNT(*) as review_count
     FROM agent_reviews WHERE agent_id = $1`,
    ['test-agent-1']);

  await test(client, 'DELETE review by id',
    `DELETE FROM agent_reviews WHERE id = $1 AND (user_id = $2)`,
    ['review-1', 'test-uid-1']);

  // ================================================================
  // ORDERS — orderController.js
  // ================================================================
  console.log('\n=== ORDERS ===');

  await test(client, 'INSERT order',
    `INSERT INTO orders (id, user_id, user_email, items, total, currency, status,
      payment_method, payment_processor, delivery_status, metadata, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW(),NOW()) ON CONFLICT (id) DO NOTHING`,
    ['order-1', 'test-uid-1', 'test@example.com',
     JSON.stringify([{ id: 'test-agent-1', title: 'Gmail AI Agent', price: 29.99, quantity: 1 }]),
     29.99, 'USD', 'completed', 'card', 'unipay', 'completed',
     JSON.stringify({ processor: 'unipay' })]);

  await test(client, 'Get orders by user',
    `SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC`, ['test-uid-1']);

  await test(client, 'Get order by ID',
    `SELECT * FROM orders WHERE id = $1`, ['order-1']);

  await test(client, 'Get orders by status',
    `SELECT * FROM orders WHERE status = $1 ORDER BY created_at DESC`, ['completed']);

  await test(client, 'Get order by payment_id',
    `SELECT * FROM orders WHERE payment_id = $1`, ['pay_123']);

  await test(client, 'UPDATE order status + delivery',
    `UPDATE orders SET status=$2, delivery_status=$3, updated_at=NOW() WHERE id=$1`,
    ['order-1', 'completed', 'completed']);

  await test(client, 'UPDATE order refund',
    `UPDATE orders SET status='refunded', refund_id=$2, refund_amount=$3, refunded_at=NOW(), refund_reason=$4
     WHERE id=$1`,
    ['order-1', 'ref-123', 29.99, 'Customer request']);

  // ================================================================
  // INVOICES — invoiceService.js
  // ================================================================
  console.log('\n=== INVOICES ===');

  await test(client, 'INSERT invoice',
    `INSERT INTO invoices (id, invoice_number, status, issue_date, paid_date, paid_amount, total_amount,
      subtotal, vat_rate, vat_amount, currency, company, customer, line_items, payment, order_id,
      created_at, updated_at)
     VALUES ($1,$2,$3,NOW(),NOW(),$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW(),NOW())
     ON CONFLICT (id) DO NOTHING`,
    ['inv-1', 'INV-202602-000001', 'paid', 29.99, 29.99, 29.99, 0, 0, 'USD',
     JSON.stringify({ name: 'AI Waverider', email: 'billing@aiwaverider.com' }),
     JSON.stringify({ id: 'test-uid-1', name: 'Test User', email: 'test@example.com' }),
     JSON.stringify([{ description: 'Gmail AI Agent', quantity: 1, unitPrice: 29.99, totalPrice: 29.99 }]),
     JSON.stringify({ method: 'card', processor: 'unipay' }),
     'order-1']);

  await test(client, 'Get invoice by order_id',
    `SELECT * FROM invoices WHERE order_id = $1`, ['order-1']);

  await test(client, 'Get invoice by invoice_number',
    `SELECT * FROM invoices WHERE invoice_number = $1`, ['INV-202602-000001']);

  // ================================================================
  // VIDEOS — videoController.js
  // ================================================================
  console.log('\n=== VIDEOS ===');

  await test(client, 'INSERT video',
    `INSERT INTO videos (id, platform, original_url, title, thumbnail_url, views, likes, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,NOW()) ON CONFLICT (id) DO NOTHING`,
    ['vid-1', 'youtube', 'https://youtube.com/watch?v=abc', 'AI Tutorial', 'https://img.youtube.com/vi/abc/0.jpg', 1000, 50]);

  await test(client, 'Get videos by platform',
    `SELECT * FROM videos WHERE platform = $1 ORDER BY created_at DESC`, ['youtube']);

  await test(client, 'Get all videos ordered by created_at',
    `SELECT * FROM videos ORDER BY created_at DESC LIMIT $1`, [20]);

  // ================================================================
  // POSTS — postsController.js
  // ================================================================
  console.log('\n=== POSTS ===');

  await test(client, 'INSERT post',
    `INSERT INTO posts (id, title, description, category, created_by, created_by_username, views, likes, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),NOW()) ON CONFLICT (id) DO NOTHING`,
    ['post-1', 'AI in 2026', 'An overview of AI trends', 'Technology', 'test-uid-1', 'testuser', 100, '{test-uid-1}']);

  await test(client, 'Get posts by category',
    `SELECT * FROM posts WHERE category = $1 ORDER BY created_at DESC`, ['Technology']);

  await test(client, 'Get posts by user',
    `SELECT * FROM posts WHERE created_by = $1 ORDER BY created_at DESC`, ['test-uid-1']);

  await test(client, 'Get all posts paginated',
    `SELECT * FROM posts ORDER BY created_at DESC LIMIT $1 OFFSET $2`, [10, 0]);

  await test(client, 'Toggle post like (add)',
    `UPDATE posts SET likes = array_append(likes, $2) WHERE id = $1 AND NOT ($2 = ANY(likes))`,
    ['post-1', 'test-uid-2']);

  // ================================================================
  // COMMENTS — postsController.js
  // ================================================================
  console.log('\n=== COMMENTS ===');

  await test(client, 'INSERT comment',
    `INSERT INTO comments (id, post_id, user_id, username, user_role, text, likes, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),NOW()) ON CONFLICT (id) DO NOTHING`,
    ['comment-1', 'post-1', 'test-uid-1', 'testuser', 'authenticated', 'Great article!', '{}']);

  await test(client, 'INSERT reply comment (parent)',
    `INSERT INTO comments (id, post_id, user_id, username, text, parent_comment_id, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,NOW(),NOW()) ON CONFLICT (id) DO NOTHING`,
    ['comment-2', 'post-1', 'test-uid-1', 'testuser', 'Thanks!', 'comment-1']);

  await test(client, 'Get comments for post',
    `SELECT * FROM comments WHERE post_id = $1 ORDER BY created_at ASC`, ['post-1']);

  await test(client, 'Get replies for comment',
    `SELECT * FROM comments WHERE parent_comment_id = $1 ORDER BY created_at ASC`, ['comment-1']);

  await test(client, 'DELETE comment (cascades to replies)',
    `DELETE FROM comments WHERE id = $1`, ['comment-1']);

  // ================================================================
  // PROMPTS
  // ================================================================
  console.log('\n=== PROMPTS ===');

  await test(client, 'INSERT prompt',
    `INSERT INTO prompts (id, title, description, category, tags, keywords, is_featured, is_public, type,
      created_by, likes, like_count, view_count, download_count, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW(),NOW()) ON CONFLICT (id) DO NOTHING`,
    ['prompt-1', 'Email Writer', 'Writes professional emails', 'Business',
     '{email,writing}', '{professional,email}', true, true, 'prompt',
     'test-uid-1', '{}', 0, 10, 5]);

  await test(client, 'Get prompts by category',
    `SELECT * FROM prompts WHERE category = $1 ORDER BY created_at DESC`, ['Business']);

  await test(client, 'Get featured prompts',
    `SELECT * FROM prompts WHERE is_featured = TRUE ORDER BY created_at DESC LIMIT $1`, [10]);

  await test(client, 'Search prompts by title (trigram)',
    `SELECT * FROM prompts WHERE title % $1 ORDER BY similarity(title, $1) DESC LIMIT 20`,
    ['email']);

  await test(client, 'Filter prompts by tags (GIN)',
    `SELECT * FROM prompts WHERE tags @> ARRAY[$1]::TEXT[]`, ['email']);

  // ================================================================
  // WISHLISTS — agentsController.js
  // ================================================================
  console.log('\n=== WISHLISTS ===');

  await test(client, 'INSERT wishlist entry',
    `INSERT INTO wishlists (id, user_id, agent_id, created_at)
     VALUES ($1,$2,$3,NOW()) ON CONFLICT (id) DO NOTHING`,
    ['test-uid-1_test-agent-1', 'test-uid-1', 'test-agent-1']);

  await test(client, 'Get wishlists by user (WHERE userId = $1)',
    `SELECT * FROM wishlists WHERE user_id = $1`, ['test-uid-1']);

  await test(client, 'Get wishlist agents with JOIN',
    `SELECT a.* FROM wishlists w JOIN agents a ON w.agent_id = a.id WHERE w.user_id = $1`,
    ['test-uid-1']);

  await test(client, 'Check if agent in wishlist',
    `SELECT id FROM wishlists WHERE user_id = $1 AND agent_id = $2`,
    ['test-uid-1', 'test-agent-1']);

  await test(client, 'DELETE wishlist entry + decrement count',
    `DELETE FROM wishlists WHERE id = $1`, ['test-uid-1_test-agent-1']);

  // Wishlist count on agent
  await test(client, 'Atomic increment wishlist_count',
    `UPDATE agents SET wishlist_count = wishlist_count + 1 WHERE id = $1`,
    ['test-agent-1']);

  await test(client, 'Atomic decrement wishlist_count',
    `UPDATE agents SET wishlist_count = GREATEST(wishlist_count - 1, 0) WHERE id = $1`,
    ['test-agent-1']);

  // ================================================================
  // PRICES — priceController.js
  // ================================================================
  console.log('\n=== PRICES ===');

  await test(client, 'INSERT/UPSERT price',
    `INSERT INTO prices (id, agent_id, base_price, discounted_price, final_price,
      discount_percentage, currency, is_free, is_subscription, discount, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),NOW())
     ON CONFLICT (id) DO UPDATE SET base_price=$3, discounted_price=$4, final_price=$5, updated_at=NOW()`,
    ['test-agent-1', 'test-agent-1', 29.99, 29.99, 29.99, 0, 'USD', false, false, null]);

  await test(client, 'Get price by agent_id',
    `SELECT * FROM prices WHERE agent_id = $1`, ['test-agent-1']);

  await test(client, 'DELETE prices for agent (on agent delete)',
    `DELETE FROM prices WHERE agent_id = $1`, ['test-agent-1']);

  // ================================================================
  // TEMPLATE ACCESS — orderController.js
  // ================================================================
  console.log('\n=== TEMPLATE ACCESS ===');

  await test(client, 'INSERT template_access token',
    `INSERT INTO template_access (id, order_id, agent_id, user_id, email, used, expires_at, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,NOW()) ON CONFLICT (id) DO NOTHING`,
    ['token-1', 'order-1', 'test-agent-1', 'test-uid-1', 'test@example.com', false,
     new Date(Date.now() + 30 * 86400000).toISOString()]);

  await test(client, 'Get template_access by token ID',
    `SELECT * FROM template_access WHERE id = $1`, ['token-1']);

  await test(client, 'Get template_access by order',
    `SELECT * FROM template_access WHERE order_id = $1`, ['order-1']);

  await test(client, 'Validate token (not expired, not used, not revoked)',
    `SELECT * FROM template_access WHERE id = $1 AND used = FALSE AND revoked = FALSE AND expires_at > NOW()`,
    ['token-1']);

  await test(client, 'Mark token as used',
    `UPDATE template_access SET used = TRUE WHERE id = $1`, ['token-1']);

  await test(client, 'Revoke token',
    `UPDATE template_access SET revoked = TRUE, revoked_at = NOW(), revoked_reason = $2 WHERE id = $1`,
    ['token-1', 'Refund processed']);

  // ================================================================
  // SITE CONFIG — siteSettings.js
  // ================================================================
  console.log('\n=== SITE CONFIG ===');

  await test(client, 'INSERT/UPSERT site config',
    `INSERT INTO site_config (id, theme, notifications, advertisement, created_at, updated_at)
     VALUES ('settings', $1, $2, $3, NOW(), NOW())
     ON CONFLICT (id) DO UPDATE SET theme=$1, notifications=$2, advertisement=$3, updated_at=NOW()`,
    [JSON.stringify({ primaryColor: '#4A66A0' }),
     JSON.stringify({ enableEmailNotifications: true }),
     JSON.stringify({ enableAds: false })]);

  await test(client, 'Get site config',
    `SELECT * FROM site_config WHERE id = 'settings'`);

  await test(client, 'Update site config theme',
    `UPDATE site_config SET theme = $1, updated_at = NOW() WHERE id = 'settings'`,
    [JSON.stringify({ primaryColor: '#FF0000', secondaryColor: '#00FF00' })]);

  // ================================================================
  // CROSS-TABLE QUERIES (JOINs the backend will need)
  // ================================================================
  console.log('\n=== CROSS-TABLE QUERIES ===');

  await test(client, 'User orders with agent details (JOIN)',
    `SELECT o.id, o.total, o.status, o.created_at,
            (SELECT jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'title', a.title))
             FROM agents a WHERE a.id = ANY(
               SELECT item->>'id' FROM jsonb_array_elements(o.items) item
             )) as agent_details
     FROM orders o WHERE o.user_id = $1 ORDER BY o.created_at DESC`,
    ['test-uid-1']);

  await test(client, 'Agent with reviews aggregated',
    `SELECT a.*,
            COALESCE(r.avg_rating, 0) as computed_avg_rating,
            COALESCE(r.review_count, 0) as computed_review_count
     FROM agents a
     LEFT JOIN (
       SELECT agent_id, AVG(rating)::NUMERIC(3,2) as avg_rating, COUNT(*) as review_count
       FROM agent_reviews GROUP BY agent_id
     ) r ON r.agent_id = a.id
     WHERE a.id = $1`,
    ['test-agent-1']);

  await test(client, 'User entitlements (orders + purchases check)',
    `SELECT u.role,
            EXISTS(SELECT 1 FROM orders o WHERE o.user_id = u.id AND o.status = 'completed') as has_purchases
     FROM users u WHERE u.id = $1`,
    ['test-uid-1']);

  // ================================================================
  // CLEANUP — remove test data
  // ================================================================
  console.log('\n=== CLEANUP ===');

  await test(client, 'Delete test data',
    `DELETE FROM template_access WHERE id LIKE 'token-%';
     DELETE FROM invoices WHERE id LIKE 'inv-%';
     DELETE FROM orders WHERE id LIKE 'order-%';
     DELETE FROM wishlists WHERE id LIKE 'test-%';
     DELETE FROM agent_reviews WHERE id LIKE 'review-%';
     DELETE FROM comments WHERE id LIKE 'comment-%';
     DELETE FROM posts WHERE id LIKE 'post-%';
     DELETE FROM prompts WHERE id LIKE 'prompt-%';
     DELETE FROM prices WHERE id LIKE 'test-%';
     DELETE FROM videos WHERE id LIKE 'vid-%';
     DELETE FROM agents WHERE id LIKE 'test-%';
     DELETE FROM users WHERE id LIKE 'test-%';
     DELETE FROM site_config WHERE id = 'settings';`);

  // ================================================================
  // SUMMARY
  // ================================================================
  console.log('\n' + '='.repeat(50));
  console.log(`RESULTS: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);

  if (failures.length > 0) {
    console.log('\nFAILURES:');
    failures.forEach(f => console.log(`  ✗ ${f.name}: ${f.error}`));
  }

  console.log('='.repeat(50));

  await client.end();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
