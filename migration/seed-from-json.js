/**
 * Seed PostgreSQL from exported Firestore JSON files
 *
 * Usage:
 *   node seed-from-json.js
 *
 * Env vars (or .env file in this directory):
 *   PGHOST     — default: localhost
 *   PGPORT     — default: 5432
 *   PGUSER     — default: aiwaverider
 *   PGPASSWORD — default: aiwaverider
 *   PGDATABASE — default: aiwaverider
 */

require('dotenv').config({ path: __dirname + '/.env' });
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const DATA_DIR = path.resolve(__dirname, 'data');

const pgConfig = {
  host: process.env.PGHOST || 'localhost',
  port: parseInt(process.env.PGPORT || '5432', 10),
  user: process.env.PGUSER || 'sakhr',
  password: process.env.PGPASSWORD || 'sakhr',
  database: process.env.PGDATABASE || 'aiwaverider',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadJSON(filename) {
  const filePath = path.join(DATA_DIR, filename);
  if (!fs.existsSync(filePath)) {
    console.warn(`  [skip] ${filename} not found`);
    return [];
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

/** Convert a value to a TIMESTAMPTZ-safe value (ISO string or null). */
function toTimestamp(val) {
  if (!val) return null;
  // String that looks like raw milliseconds (e.g. "1738156869033")
  if (typeof val === 'string' && /^\d{10,13}$/.test(val)) {
    const n = Number(val);
    const ms = n > 1e12 ? n : n * 1000;
    return new Date(ms).toISOString();
  }
  // Already an ISO string or date string
  if (typeof val === 'string') return val;
  // Raw milliseconds as number (e.g. 1738156869033)
  if (typeof val === 'number') {
    const ms = val > 1e12 ? val : val * 1000;
    return new Date(ms).toISOString();
  }
  // Firestore-style { _seconds, _nanoseconds }
  if (typeof val === 'object' && val._seconds != null) {
    return new Date(val._seconds * 1000).toISOString();
  }
  // Firestore Timestamp exported as { seconds, nanoseconds }
  if (typeof val === 'object' && val.seconds != null) {
    return new Date(val.seconds * 1000).toISOString();
  }
  return null;
}

/** Ensure value is a JSON string (for JSONB columns). */
function toJsonb(val) {
  if (val === undefined || val === null) return null;
  if (typeof val === 'string') {
    // Already serialised
    try { JSON.parse(val); return val; } catch { return JSON.stringify(val); }
  }
  return JSON.stringify(val);
}

/** Ensure value is a PG TEXT[] literal. */
function toTextArray(val) {
  if (!val) return '{}';
  if (Array.isArray(val)) {
    // Escape each element
    const escaped = val.map((v) => {
      const s = String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      return `"${s}"`;
    });
    return `{${escaped.join(',')}}`;
  }
  return '{}';
}

/** Safe numeric conversion. */
function toNum(val, fallback = 0) {
  if (val === null || val === undefined) return fallback;
  const n = Number(val);
  return isNaN(n) ? fallback : n;
}

/** Safe boolean conversion. */
function toBool(val, fallback = false) {
  if (val === null || val === undefined) return fallback;
  if (typeof val === 'boolean') return val;
  if (typeof val === 'string') return val.toLowerCase() === 'true';
  return fallback;
}

// ---------------------------------------------------------------------------
// Seed functions — one per table, in FK-dependency order
// ---------------------------------------------------------------------------

async function seedUsers(client) {
  const docs = loadJSON('users.json');
  if (!docs.length) return 0;

  let count = 0;
  for (const d of docs) {
    try {
      await client.query(
        `INSERT INTO users (
          id, email, username, first_name, last_name, display_name,
          phone_number, photo_url, role, status, search_field,
          email_preferences, onboarding, signup_method, password_hash,
          subscription, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
        ON CONFLICT (id) DO NOTHING`,
        [
          d._id,
          d.email || `${d._id}@unknown.local`,
          d.username || null,
          d.firstName || d.first_name || null,
          d.lastName || d.last_name || null,
          d.displayName || d.display_name || null,
          d.phoneNumber || d.phone_number || null,
          d.photoURL || d.photoUrl || d.photo_url || null,
          d.role || 'authenticated',
          d.status || 'active',
          d.searchField || d.search_field || null,
          toJsonb(d.emailPreferences || d.email_preferences || {}),
          toJsonb(d.onboarding || {}),
          d.signupMethod || d.signup_method || null,
          d.passwordHash || d.password_hash || d.password || null,
          toJsonb(d.subscription || {}),
          toTimestamp(d.createdAt || d.created_at) || new Date().toISOString(),
          toTimestamp(d.updatedAt || d.updated_at) || new Date().toISOString(),
        ]
      );
      count++;
    } catch (err) {
      console.error(`  [users] Failed to insert ${d._id}: ${err.message}`);
    }
  }
  return count;
}

async function seedAgents(client) {
  const docs = loadJSON('agents.json');
  if (!docs.length) return 0;

  let count = 0;
  for (const d of docs) {
    try {
      await client.query(
        `INSERT INTO agents (
          id, name, title, description, category, categories, status,
          business_value, paddle_compliant, version,
          price, is_free, price_details, creator,
          image, image_url, icon, icon_url, json_file, download_url, file_url,
          is_featured, is_verified, is_popular, is_trending, is_subscription,
          features, tags, deliverables,
          likes, like_count, download_count, view_count, popularity, wishlist_count,
          average_rating, review_count, workflow_metadata,
          last_transformed, analyzed_at, created_at, updated_at
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
          $11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
          $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,
          $31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,$42
        ) ON CONFLICT (id) DO NOTHING`,
        [
          d._id,
          d.name || 'Untitled',
          d.title || null,
          d.description || null,
          d.category || null,
          toTextArray(d.categories),
          d.status || 'active',
          d.businessValue || d.business_value || null,
          toBool(d.paddleCompliant || d.paddle_compliant),
          d.version || '1.0.0',
          toNum(d.price),
          toBool(d.isFree ?? d.is_free, true),
          toJsonb(d.priceDetails || d.price_details || {}),
          toJsonb(d.creator || {}),
          toJsonb(d.image),
          d.imageUrl || d.image_url || null,
          toJsonb(d.icon),
          d.iconUrl || d.icon_url || null,
          toJsonb(d.jsonFile || d.json_file),
          d.downloadUrl || d.download_url || null,
          d.fileUrl || d.file_url || null,
          toBool(d.isFeatured || d.is_featured),
          toBool(d.isVerified || d.is_verified),
          toBool(d.isPopular || d.is_popular),
          toBool(d.isTrending || d.is_trending),
          toBool(d.isSubscription || d.is_subscription),
          toTextArray(d.features),
          toTextArray(d.tags),
          toJsonb(d.deliverables || []),
          toTextArray(d.likes),
          toNum(d.likeCount || d.like_count),
          toNum(d.downloadCount || d.download_count),
          toNum(d.viewCount || d.view_count),
          toNum(d.popularity),
          toNum(d.wishlistCount || d.wishlist_count),
          toNum(d.averageRating || d.average_rating),
          toNum(d.reviewCount || d.review_count),
          toJsonb(d.workflowMetadata || d.workflow_metadata),
          toTimestamp(d.lastTransformed || d.last_transformed),
          toTimestamp(d.analyzedAt || d.analyzed_at),
          toTimestamp(d.createdAt || d.created_at) || new Date().toISOString(),
          toTimestamp(d.updatedAt || d.updated_at) || new Date().toISOString(),
        ]
      );
      count++;
    } catch (err) {
      console.error(`  [agents] Failed to insert ${d._id}: ${err.message}`);
    }
  }
  return count;
}

async function seedAgentReviews(client) {
  const docs = loadJSON('agents_reviews.json');
  if (!docs.length) return 0;

  let count = 0;
  for (const d of docs) {
    try {
      await client.query(
        `INSERT INTO agent_reviews (
          id, agent_id, user_id, user_name, rating, content,
          verification_status, created_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        ON CONFLICT (id) DO NOTHING`,
        [
          d._id,
          d._parentId || d.agentId || d.agent_id,
          d.userId || d.user_id,
          d.userName || d.user_name || null,
          toNum(d.rating, 3),
          d.content || d.text || d.review || '',
          d.verificationStatus || d.verification_status || 'unverified',
          toTimestamp(d.createdAt || d.created_at) || new Date().toISOString(),
        ]
      );
      count++;
    } catch (err) {
      console.error(`  [agent_reviews] Failed to insert ${d._id}: ${err.message}`);
    }
  }
  return count;
}

async function seedOrders(client) {
  const docs = loadJSON('orders.json');
  if (!docs.length) return 0;

  let count = 0;
  for (const d of docs) {
    try {
      await client.query(
        `INSERT INTO orders (
          id, user_id, user_email, items, total, currency, status,
          payment_id, payment_method, payment_processor,
          delivery_status, delivery_results, metadata, vat_info,
          invoice_id, invoice_number, template_access_tokens,
          unipay_order_hash_id, merchant_order_id, conversion_info,
          refund_id, refund_amount, refunded_at, refund_reason,
          created_at, updated_at
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
          $11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
          $21,$22,$23,$24,$25,$26
        ) ON CONFLICT (id) DO NOTHING`,
        [
          d._id,
          d.userId || d.user_id || null,
          d.userEmail || d.user_email || null,
          toJsonb(d.items || []),
          toNum(d.total),
          d.currency || 'USD',
          d.status || 'pending',
          d.paymentId || d.payment_id || null,
          d.paymentMethod || d.payment_method || null,
          d.paymentProcessor || d.payment_processor || null,
          d.deliveryStatus || d.delivery_status || 'pending',
          toJsonb(d.deliveryResults || d.delivery_results || []),
          toJsonb(d.metadata || {}),
          toJsonb(d.vatInfo || d.vat_info),
          d.invoiceId || d.invoice_id || null,
          d.invoiceNumber || d.invoice_number || null,
          toTextArray(d.templateAccessTokens || d.template_access_tokens),
          d.unipayOrderHashId || d.unipay_order_hash_id || null,
          d.merchantOrderId || d.merchant_order_id || null,
          toJsonb(d.conversionInfo || d.conversion_info),
          d.refundId || d.refund_id || null,
          d.refundAmount != null ? toNum(d.refundAmount || d.refund_amount) : null,
          toTimestamp(d.refundedAt || d.refunded_at),
          d.refundReason || d.refund_reason || null,
          toTimestamp(d.createdAt || d.created_at) || new Date().toISOString(),
          toTimestamp(d.updatedAt || d.updated_at) || new Date().toISOString(),
        ]
      );
      count++;
    } catch (err) {
      console.error(`  [orders] Failed to insert ${d._id}: ${err.message}`);
    }
  }
  return count;
}

async function seedInvoices(client) {
  const docs = loadJSON('invoices.json');
  if (!docs.length) return 0;

  let count = 0;
  for (const d of docs) {
    try {
      await client.query(
        `INSERT INTO invoices (
          id, invoice_number, status,
          issue_date, due_date, paid_date,
          paid_amount, total_amount, subtotal,
          vat_rate, vat_amount, currency,
          company, customer, line_items, payment,
          order_id, metadata, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
        ON CONFLICT (id) DO NOTHING`,
        [
          d._id,
          d.invoiceNumber || d.invoice_number || null,
          d.status || 'paid',
          toTimestamp(d.issueDate || d.issue_date),
          toTimestamp(d.dueDate || d.due_date),
          toTimestamp(d.paidDate || d.paidAt || d.paid_date),
          d.paidAmount != null ? toNum(d.paidAmount || d.paid_amount) : null,
          d.totalAmount != null ? toNum(d.totalAmount || d.total_amount) : null,
          d.subtotal != null ? toNum(d.subtotal) : null,
          toNum(d.vatRate || d.vat_rate),
          toNum(d.vatAmount || d.vat_amount),
          d.currency || 'USD',
          toJsonb(d.company || {}),
          toJsonb(d.customer || {}),
          toJsonb(d.lineItems || d.line_items || []),
          toJsonb(d.payment || {}),
          d.orderId || d.order_id || (d.order && d.order.id) || null,
          toJsonb(d.metadata || {}),
          toTimestamp(d.createdAt || d.created_at) || new Date().toISOString(),
          toTimestamp(d.updatedAt || d.updated_at) || new Date().toISOString(),
        ]
      );
      count++;
    } catch (err) {
      console.error(`  [invoices] Failed to insert ${d._id}: ${err.message}`);
    }
  }
  return count;
}

async function seedVideos(client) {
  const docs = loadJSON('videos.json');
  if (!docs.length) return 0;

  let count = 0;
  for (const d of docs) {
    try {
      await client.query(
        `INSERT INTO videos (
          id, platform, original_url, embed_url, title,
          author_name, author_user, description, thumbnail_url,
          views, likes, comments_count, shares, engagement_score,
          added_by, added_by_uid, last_fetched, created_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
        ON CONFLICT (id) DO NOTHING`,
        [
          d._id,
          d.platform || 'youtube',
          d.originalUrl || d.original_url || d.url || '',
          d.embedUrl || d.embed_url || null,
          d.title || null,
          d.authorName || d.author_name || null,
          d.authorUser || d.author_user || null,
          d.description || null,
          d.thumbnailUrl || d.thumbnail_url || null,
          toNum(d.views),
          toNum(d.likes),
          toNum(d.commentsCount || d.comments_count),
          toNum(d.shares),
          d.engagementScore != null ? toNum(d.engagementScore || d.engagement_score) : null,
          d.addedBy || d.added_by || null,
          d.addedByUid || d.added_by_uid || null,
          toTimestamp(d.lastFetched || d.last_fetched),
          toTimestamp(d.createdAt || d.created_at) || new Date().toISOString(),
        ]
      );
      count++;
    } catch (err) {
      console.error(`  [videos] Failed to insert ${d._id}: ${err.message}`);
    }
  }
  return count;
}

async function seedPosts(client) {
  const docs = loadJSON('posts.json');
  if (!docs.length) return 0;

  // Load valid user IDs for FK validation
  const { rows: userRows } = await client.query('SELECT id FROM users');
  const validUserIds = new Set(userRows.map(r => r.id));

  let count = 0;
  for (const d of docs) {
    const createdBy = d.createdBy || d.created_by || null;
    try {
      await client.query(
        `INSERT INTO posts (
          id, title, description, category, image_url, image_filename,
          additional_html, graph_html, created_by, created_by_username,
          views, likes, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
        ON CONFLICT (id) DO NOTHING`,
        [
          d._id,
          d.title || 'Untitled',
          d.description || d.content || '',
          d.category || 'general',
          d.imageUrl || d.image_url || null,
          d.imageFilename || d.image_filename || null,
          d.additionalHTML || d.additionalHtml || d.additional_html || null,
          d.graphHTML || d.graphHtml || d.graph_html || null,
          (createdBy && validUserIds.has(createdBy)) ? createdBy : null,
          d.createdByUsername || d.created_by_username || null,
          toNum(d.views),
          toTextArray(d.likes),
          toTimestamp(d.createdAt || d.created_at) || new Date().toISOString(),
          toTimestamp(d.updatedAt || d.updated_at) || new Date().toISOString(),
        ]
      );
      count++;
    } catch (err) {
      console.error(`  [posts] Failed to insert ${d._id}: ${err.message}`);
    }
  }
  return count;
}

async function seedComments(client) {
  const docs = loadJSON('comments.json');
  if (!docs.length) return 0;

  // Load valid FKs
  const { rows: postRows } = await client.query('SELECT id FROM posts');
  const validPostIds = new Set(postRows.map(r => r.id));
  const { rows: userRows } = await client.query('SELECT id FROM users');
  const validUserIds = new Set(userRows.map(r => r.id));

  // Sort so that root comments (no parent) come first
  docs.sort((a, b) => {
    const aHasParent = a.parentCommentId || a.parent_comment_id ? 1 : 0;
    const bHasParent = b.parentCommentId || b.parent_comment_id ? 1 : 0;
    return aHasParent - bHasParent;
  });

  let count = 0;
  for (const d of docs) {
    const postId = d.postId || d.post_id;
    const userId = d.userId || d.user_id;
    if (!validPostIds.has(postId)) { continue; }
    if (!validUserIds.has(userId)) { continue; }
    try {
      await client.query(
        `INSERT INTO comments (
          id, post_id, user_id, username, user_role, text, likes,
          parent_comment_id, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        ON CONFLICT (id) DO NOTHING`,
        [
          d._id,
          postId,
          userId,
          d.username || null,
          d.userRole || d.user_role || null,
          d.text || d.content || '',
          toTextArray(d.likes),
          d.parentCommentId || d.parent_comment_id || null,
          toTimestamp(d.createdAt || d.created_at) || new Date().toISOString(),
          toTimestamp(d.updatedAt || d.updated_at) || new Date().toISOString(),
        ]
      );
      count++;
    } catch (err) {
      console.error(`  [comments] Failed to insert ${d._id}: ${err.message}`);
    }
  }
  return count;
}

async function seedPrompts(client) {
  const docs = loadJSON('prompts.json');
  if (!docs.length) return 0;

  // Load valid user IDs for FK validation
  const { rows: userRows } = await client.query('SELECT id FROM users');
  const validUserIds = new Set(userRows.map(r => r.id));

  let count = 0;
  for (const d of docs) {
    try {
      const createdBy = d.createdBy || d.created_by || null;
      await client.query(
        `INSERT INTO prompts (
          id, title, description, link, image, video_url, input_image,
          keywords, tags, category, additional_html, json_prompt,
          created_by, updated_by, likes, like_count, view_count, download_count,
          is_featured, is_public, type, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
        ON CONFLICT (id) DO NOTHING`,
        [
          d._id,
          d.title || 'Untitled',
          d.description || null,
          d.link || null,
          d.image || null,
          d.videoUrl || d.video_url || null,
          d.inputImage || d.input_image || null,
          toTextArray(d.keywords),
          toTextArray(d.tags),
          d.category || null,
          d.additionalHTML || d.additionalHtml || d.additional_html || null,
          d.jsonPrompt || d.json_prompt || null,
          (createdBy && validUserIds.has(createdBy)) ? createdBy : null,
          d.updatedBy || d.updated_by || null,
          toTextArray(d.likes),
          toNum(d.likeCount || d.like_count),
          toNum(d.viewCount || d.view_count),
          toNum(d.downloadCount || d.download_count),
          toBool(d.isFeatured || d.is_featured),
          toBool(d.isPublic ?? d.is_public, true),
          d.type || 'prompt',
          toTimestamp(d.createdAt || d.created_at) || new Date().toISOString(),
          toTimestamp(d.updatedAt || d.updated_at) || new Date().toISOString(),
        ]
      );
      count++;
    } catch (err) {
      console.error(`  [prompts] Failed to insert ${d._id}: ${err.message}`);
    }
  }
  return count;
}

async function seedWishlists(client) {
  const docs = loadJSON('wishlists.json');
  if (!docs.length) return 0;

  // Load valid FKs
  const { rows: userRows } = await client.query('SELECT id FROM users');
  const validUserIds = new Set(userRows.map(r => r.id));
  const { rows: agentRows } = await client.query('SELECT id FROM agents');
  const validAgentIds = new Set(agentRows.map(r => r.id));

  let count = 0;
  for (const d of docs) {
    const userId = d.userId || d.user_id;
    const agentId = d.agentId || d.agent_id;
    if (!validUserIds.has(userId) || !validAgentIds.has(agentId)) { continue; }
    try {
      await client.query(
        `INSERT INTO wishlists (id, user_id, agent_id, created_at)
        VALUES ($1,$2,$3,$4)
        ON CONFLICT (id) DO NOTHING`,
        [
          d._id,
          userId,
          agentId,
          toTimestamp(d.createdAt || d.created_at) || new Date().toISOString(),
        ]
      );
      count++;
    } catch (err) {
      console.error(`  [wishlists] Failed to insert ${d._id}: ${err.message}`);
    }
  }
  return count;
}

async function seedPrices(client) {
  const docs = loadJSON('prices.json');
  if (!docs.length) return 0;

  // Load valid agent IDs for FK validation
  const { rows: agentRows } = await client.query('SELECT id FROM agents');
  const validAgentIds = new Set(agentRows.map(r => r.id));

  let count = 0;
  for (const d of docs) {
    const agentId = d.agentId || d.agent_id || d._id;
    if (!validAgentIds.has(agentId)) { continue; }
    try {
      await client.query(
        `INSERT INTO prices (
          id, agent_id, base_price, discounted_price, final_price,
          discount_percentage, currency, is_free, is_subscription,
          discount, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        ON CONFLICT (id) DO NOTHING`,
        [
          d._id,
          agentId,
          toNum(d.basePrice || d.base_price),
          toNum(d.discountedPrice || d.discounted_price),
          toNum(d.finalPrice || d.final_price),
          toNum(d.discountPercentage || d.discount_percentage),
          d.currency || 'USD',
          toBool(d.isFree ?? d.is_free, true),
          toBool(d.isSubscription || d.is_subscription),
          toJsonb(d.discount),
          toTimestamp(d.createdAt || d.created_at) || new Date().toISOString(),
          toTimestamp(d.updatedAt || d.updated_at) || new Date().toISOString(),
        ]
      );
      count++;
    } catch (err) {
      console.error(`  [prices] Failed to insert ${d._id}: ${err.message}`);
    }
  }
  return count;
}

async function seedTemplateAccess(client) {
  const docs = loadJSON('templateAccess.json');
  if (!docs.length) return 0;

  let count = 0;
  for (const d of docs) {
    try {
      await client.query(
        `INSERT INTO template_access (
          id, order_id, agent_id, user_id, email,
          used, revoked, revoked_at, revoked_reason,
          invoice_id, unipay_order_hash_id, merchant_order_id,
          expires_at, created_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
        ON CONFLICT (id) DO NOTHING`,
        [
          d._id,
          d.orderId || d.order_id,
          d.agentId || d.agent_id,
          d.userId || d.user_id || null,
          d.email || null,
          toBool(d.used),
          toBool(d.revoked),
          toTimestamp(d.revokedAt || d.revoked_at),
          d.revokedReason || d.revoked_reason || null,
          d.invoiceId || d.invoice_id || null,
          d.unipayOrderHashId || d.unipay_order_hash_id || null,
          d.merchantOrderId || d.merchant_order_id || null,
          toTimestamp(d.expiresAt || d.expires_at) || new Date(Date.now() + 365 * 86400000).toISOString(),
          toTimestamp(d.createdAt || d.created_at) || new Date().toISOString(),
        ]
      );
      count++;
    } catch (err) {
      console.error(`  [template_access] Failed to insert ${d._id}: ${err.message}`);
    }
  }
  return count;
}

async function seedSiteConfig(client) {
  const docs = loadJSON('siteConfig.json');
  if (!docs.length) return 0;

  let count = 0;
  for (const d of docs) {
    try {
      await client.query(
        `INSERT INTO site_config (id, theme, notifications, advertisement, created_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT (id) DO NOTHING`,
        [
          d._id || 'settings',
          toJsonb(d.theme || {}),
          toJsonb(d.notifications || {}),
          toJsonb(d.advertisement || {}),
          toTimestamp(d.createdAt || d.created_at) || new Date().toISOString(),
          toTimestamp(d.updatedAt || d.updated_at) || new Date().toISOString(),
        ]
      );
      count++;
    } catch (err) {
      console.error(`  [site_config] Failed to insert ${d._id}: ${err.message}`);
    }
  }
  return count;
}

async function seedAiTools(client) {
  const docs = loadJSON('ai_tools.json');
  if (!docs.length) return 0;

  let count = 0;
  for (const d of docs) {
    try {
      let keywords = d.keywords || d.keyword || [];
      if (typeof keywords === 'string') keywords = [keywords];
      let tags = d.tags || [];
      if (typeof tags === 'string') tags = [tags];

      await client.query(
        `INSERT INTO ai_tools (
          id, title, description, link, image, keywords, tags, category,
          additional_html, created_by, updated_by, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
        ON CONFLICT (id) DO NOTHING`,
        [
          d._id,
          d.title || 'Untitled Tool',
          d.description || '',
          d.link || null,
          d.image || null,
          keywords,
          tags,
          d.category || null,
          d.additionalHTML || d.additional_html || null,
          d.createdBy || d.created_by || null,
          d.updatedBy || d.updated_by || null,
          toTimestamp(d.createdAt || d.created_at) || new Date().toISOString(),
          toTimestamp(d.updatedAt || d.updated_at) || new Date().toISOString(),
        ]
      );
      count++;
    } catch (err) {
      console.error(`  [ai_tools] Failed to insert ${d._id}: ${err.message}`);
    }
  }
  return count;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

// Insertion order respects FK dependencies
const SEED_STEPS = [
  { name: 'users', fn: seedUsers },
  { name: 'agents', fn: seedAgents },
  { name: 'agent_reviews', fn: seedAgentReviews },
  { name: 'orders', fn: seedOrders },
  { name: 'invoices', fn: seedInvoices },
  { name: 'videos', fn: seedVideos },
  { name: 'posts', fn: seedPosts },
  { name: 'comments', fn: seedComments },
  { name: 'prompts', fn: seedPrompts },
  { name: 'wishlists', fn: seedWishlists },
  { name: 'prices', fn: seedPrices },
  { name: 'template_access', fn: seedTemplateAccess },
  { name: 'site_config', fn: seedSiteConfig },
  { name: 'ai_tools', fn: seedAiTools },
];

async function main() {
  const client = new Client(pgConfig);
  await client.connect();
  console.log(`Connected to PostgreSQL at ${pgConfig.host}:${pgConfig.port}/${pgConfig.database}\n`);

  console.log('=== Seeding PostgreSQL from JSON ===\n');

  // Run each table seed independently (no wrapping transaction)
  // Each INSERT uses ON CONFLICT DO NOTHING, so individual failures are safe
  let totalInserted = 0;
  let totalFailed = 0;

  for (const step of SEED_STEPS) {
    try {
      const count = await step.fn(client);
      console.log(`  ${step.name}: ${count} rows inserted`);
      totalInserted += count;
    } catch (err) {
      console.error(`  ${step.name}: FAILED — ${err.message}`);
      totalFailed++;
    }
  }

  await client.end();
  console.log(`\nSeeding complete. Total inserted: ${totalInserted}. Tables with errors: ${totalFailed}.`);

  console.log('\nDone.');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
