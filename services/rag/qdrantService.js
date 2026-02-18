let QdrantClient;
try {
  QdrantClient = require('@qdrant/js-client-rest').QdrantClient;
} catch (e) {
  // Qdrant client not installed — RAG features will be unavailable
}
const OpenAI = require('openai');
const { pool } = require('../../config/database');
const logger = require('../../utils/logger');

const QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:6333';
const EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';
const VECTOR_SIZE = 1536;

let qdrant;
let openai;

function getQdrantClient() {
  if (!QdrantClient) {
    throw new Error('Qdrant client not installed. Install @qdrant/js-client-rest to use RAG features.');
  }
  if (!qdrant) {
    qdrant = new QdrantClient({ url: QDRANT_URL });
  }
  return qdrant;
}

function getOpenAI() {
  if (!openai) {
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openai;
}

async function embed(text) {
  const response = await getOpenAI().embeddings.create({
    model: EMBEDDING_MODEL,
    input: text,
  });
  return response.data[0].embedding;
}

/**
 * Batch-embed an array of texts. OpenAI supports up to 2048 inputs per call.
 * Returns an array of embedding vectors in the same order as inputs.
 */
async function embedBatch(texts, batchSize = 500) {
  const allEmbeddings = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    console.log(`  Embedding batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(texts.length / batchSize)} (${batch.length} texts)...`);
    const response = await getOpenAI().embeddings.create({
      model: EMBEDDING_MODEL,
      input: batch,
    });
    // OpenAI returns embeddings sorted by index
    const sorted = response.data.sort((a, b) => a.index - b.index);
    allEmbeddings.push(...sorted.map((d) => d.embedding));
  }
  return allEmbeddings;
}

// --- Collection management ---

async function initCollections() {
  const client = getQdrantClient();
  const collections = ['agents', 'prompts', 'posts', 'apps'];

  for (const name of collections) {
    try {
      await client.getCollection(name);
      logger.info(`Qdrant collection "${name}" already exists`);
    } catch (err) {
      if (err.status === 404 || (err.message && err.message.includes('Not found'))) {
        await client.createCollection(name, {
          vectors: { size: VECTOR_SIZE, distance: 'Cosine' },
        });
        logger.info(`Qdrant collection "${name}" created`);
      } else {
        logger.error(`Error checking Qdrant collection "${name}": ${err.message || err.cause || JSON.stringify(err)}`);
      }
    }
  }
}

// --- Indexing ---

async function indexAgents() {
  const { rows } = await pool.query(
    `SELECT id, name, title, description, category, categories, features, tags, price, is_free, status
     FROM agents WHERE status = 'active' OR status IS NULL`
  );

  if (rows.length === 0) return 0;
  console.log(`  Found ${rows.length} agents to index...`);

  // Build text for each row (sanitized for safe JSON)
  const texts = rows.map((row) => {
    const tags = Array.isArray(row.tags) ? row.tags.join(', ') : '';
    const features = Array.isArray(row.features) ? row.features.join(', ') : '';
    return sanitize(`[agent] ${row.name || row.title}: ${(row.description || '').slice(0, 500)}. Category: ${row.category || ''}. Tags: ${tags}. Features: ${features}`);
  });

  // Batch embed all at once
  const vectors = await embedBatch(texts);

  // Build points and upsert in batches of 1000
  const UPSERT_BATCH = 100;
  for (let i = 0; i < rows.length; i += UPSERT_BATCH) {
    const batchRows = rows.slice(i, i + UPSERT_BATCH);
    const points = batchRows.map((row, idx) => ({
      id: toPointId(row.id),
      vector: vectors[i + idx],
      payload: {
        id: String(row.id),
        type: 'agent',
        name: sanitize(row.name || row.title || ''),
        description: sanitize((row.description || '').slice(0, 200)),
        category: sanitize(row.category || ''),
        price: row.price != null ? parseFloat(row.price) : 0,
        is_free: row.is_free || false,
        url_path: `/agents/${row.id}`,
      },
    }));
    try {
      await getQdrantClient().upsert('agents', { points });
      console.log(`  Upserted agents ${i + 1}-${i + batchRows.length}`);
    } catch (err) {
      console.error(`  Failed batch ${i + 1}-${i + batchRows.length}: ${err.message}`);
      // Try one-by-one to find the offending record
      for (const pt of points) {
        try {
          await getQdrantClient().upsert('agents', { points: [pt] });
        } catch (e2) {
          console.error(`    Bad record: ${pt.payload.id} — ${e2.message}`);
        }
      }
    }
  }

  return rows.length;
}

async function indexPrompts() {
  const { rows } = await pool.query(
    `SELECT id, title, description, category, tags, keywords
     FROM prompts WHERE (type = 'prompt' OR type IS NULL)`
  );

  if (rows.length === 0) return 0;
  console.log(`  Found ${rows.length} prompts to index...`);

  const texts = rows.map((row) => {
    const tags = Array.isArray(row.tags) ? row.tags.join(', ') : '';
    const keywords = Array.isArray(row.keywords) ? row.keywords.join(', ') : '';
    return `[prompt] ${row.title}: ${(row.description || '').slice(0, 500)}. Category: ${row.category || ''}. Tags: ${tags}. Keywords: ${keywords}`;
  });

  const vectors = await embedBatch(texts);
  const points = rows.map((row, idx) => ({
    id: toPointId(row.id),
    vector: vectors[idx],
    payload: {
      id: row.id,
      type: 'prompt',
      name: sanitize(row.title),
      description: sanitize((row.description || '').slice(0, 200)),
      category: sanitize(row.category || ''),
      url_path: `/prompts/${row.id}`,
    },
  }));

  await getQdrantClient().upsert('prompts', { points });
  return points.length;
}

async function indexPosts() {
  const { rows } = await pool.query(
    `SELECT id, title, description, category FROM posts`
  );

  if (rows.length === 0) return 0;
  console.log(`  Found ${rows.length} posts to index...`);

  const texts = rows.map((row) => {
    return `[post] ${row.title}: ${(row.description || '').slice(0, 500)}. Category: ${row.category || ''}`;
  });

  const vectors = await embedBatch(texts);
  const points = rows.map((row, idx) => ({
    id: toPointId(row.id),
    vector: vectors[idx],
    payload: {
      id: row.id,
      type: 'post',
      name: sanitize(row.title),
      description: sanitize((row.description || '').slice(0, 200)),
      category: sanitize(row.category || ''),
      url_path: `/posts/${row.id}`,
    },
  }));

  await getQdrantClient().upsert('posts', { points });
  return points.length;
}

async function indexApps() {
  const { rows } = await pool.query(
    `SELECT id, title, type, description, category, categories, features, tags, price, is_free, platform_support
     FROM apps WHERE is_published = TRUE`
  );

  if (rows.length === 0) return 0;
  console.log(`  Found ${rows.length} apps to index...`);

  const texts = rows.map((row) => {
    const tags = Array.isArray(row.tags) ? row.tags.join(', ') : '';
    const features = Array.isArray(row.features) ? row.features.join(', ') : '';
    const platforms = Array.isArray(row.platform_support) ? row.platform_support.join(', ') : '';
    return sanitize(`[app] ${row.title}: ${(row.description || '').slice(0, 500)}. Type: ${row.type || 'app'}. Category: ${row.category || ''}. Tags: ${tags}. Features: ${features}. Platforms: ${platforms}`);
  });

  const vectors = await embedBatch(texts);

  const UPSERT_BATCH = 100;
  for (let i = 0; i < rows.length; i += UPSERT_BATCH) {
    const batchRows = rows.slice(i, i + UPSERT_BATCH);
    const points = batchRows.map((row, idx) => ({
      id: toPointId(row.id),
      vector: vectors[i + idx],
      payload: {
        id: String(row.id),
        type: 'app',
        name: sanitize(row.title || ''),
        description: sanitize((row.description || '').slice(0, 200)),
        category: sanitize(row.category || ''),
        price: row.price != null ? parseFloat(row.price) : 0,
        is_free: row.is_free || false,
        url_path: `/apps/${row.id}`,
      },
    }));
    try {
      await getQdrantClient().upsert('apps', { points });
      console.log(`  Upserted apps ${i + 1}-${i + batchRows.length}`);
    } catch (err) {
      console.error(`  Failed batch ${i + 1}-${i + batchRows.length}: ${err.message}`);
      for (const pt of points) {
        try {
          await getQdrantClient().upsert('apps', { points: [pt] });
        } catch (e2) {
          console.error(`    Bad record: ${pt.payload.id} — ${e2.message}`);
        }
      }
    }
  }

  return rows.length;
}

async function indexAll() {
  const agentCount = await indexAgents();
  const promptCount = await indexPrompts();
  const postCount = await indexPosts();
  const appCount = await indexApps();
  return { agents: agentCount, prompts: promptCount, posts: postCount, apps: appCount };
}

// --- Search ---

const SCORE_THRESHOLD = 0.35; // Minimum similarity score to include a result

async function searchRelevant(query, limit = 5) {
  let vector;
  try {
    vector = await embed(query);
  } catch (err) {
    logger.warn(`Embedding failed for search query, returning empty: ${err.message}`);
    return [];
  }

  const client = getQdrantClient();
  const collections = ['agents', 'prompts', 'posts', 'apps'];

  // Search all collections in parallel (4x faster)
  const results = await Promise.allSettled(
    collections.map((collection) =>
      client.search(collection, {
        vector,
        limit: Math.ceil(limit / collections.length) + 1, // ~2 per collection, not `limit` each
        with_payload: true,
        score_threshold: SCORE_THRESHOLD,
      })
    )
  );

  const allResults = [];
  results.forEach((result, i) => {
    if (result.status === 'fulfilled') {
      allResults.push(...result.value);
    } else {
      logger.warn(`Qdrant search failed for "${collections[i]}": ${result.reason?.message}`);
    }
  });

  // Sort by score descending and take top `limit`
  allResults.sort((a, b) => b.score - a.score);
  return allResults.slice(0, limit).map((r) => ({
    score: r.score,
    ...r.payload,
  }));
}

// --- Helpers ---

/**
 * Sanitize a string for safe JSON serialization to Qdrant.
 * Removes null bytes, lone surrogates, and other problematic characters.
 */
function sanitize(str) {
  if (!str) return '';
  // Remove null bytes and all control chars except \n and \t
  let clean = str.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, ' ');
  // Remove lone surrogates that break JSON
  clean = clean.replace(/[\uD800-\uDFFF]/g, '');
  // Remove backslash followed by invalid escape sequences that could break JSON parsers
  clean = clean.replace(/\\(?!["\\/bfnrtu])/g, '\\\\');
  return clean;
}

/**
 * Convert a string ID to an unsigned integer for Qdrant point IDs.
 * Uses FNV-1a hash to minimize collisions.
 */
function toPointId(str) {
  // FNV-1a 32-bit hash
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  // Ensure non-zero (Qdrant requires positive IDs)
  return hash || 1;
}

// --- Single-document indexing (for auto-index on create/update) ---

async function indexSingleAgent(agent) {
  try {
    const tags = Array.isArray(agent.tags) ? agent.tags.join(', ') : '';
    const features = Array.isArray(agent.features) ? agent.features.join(', ') : '';
    const text = sanitize(`[agent] ${agent.name || agent.title}: ${(agent.description || '').slice(0, 500)}. Category: ${agent.category || ''}. Tags: ${tags}. Features: ${features}`);
    const vector = await embed(text);

    await getQdrantClient().upsert('agents', {
      points: [{
        id: toPointId(agent.id),
        vector,
        payload: {
          id: String(agent.id),
          type: 'agent',
          name: sanitize(agent.name || agent.title || ''),
          description: sanitize((agent.description || '').slice(0, 200)),
          category: sanitize(agent.category || ''),
          price: agent.price != null ? parseFloat(agent.price) : 0,
          is_free: agent.isFree || agent.is_free || false,
          url_path: `/agents/${agent.id}`,
        },
      }],
    });
    logger.info(`Qdrant: indexed agent "${agent.id}"`);
  } catch (err) {
    logger.warn(`Qdrant: failed to index agent "${agent.id}": ${err.message}`);
  }
}

async function indexSinglePrompt(prompt) {
  try {
    const tags = Array.isArray(prompt.tags) ? prompt.tags.join(', ') : '';
    const keywords = Array.isArray(prompt.keywords) ? prompt.keywords.join(', ') : '';
    const text = sanitize(`[prompt] ${prompt.title}: ${(prompt.description || '').slice(0, 500)}. Category: ${prompt.category || ''}. Tags: ${tags}. Keywords: ${keywords}`);
    const vector = await embed(text);

    await getQdrantClient().upsert('prompts', {
      points: [{
        id: toPointId(prompt.id),
        vector,
        payload: {
          id: String(prompt.id),
          type: 'prompt',
          name: sanitize(prompt.title || ''),
          description: sanitize((prompt.description || '').slice(0, 200)),
          category: sanitize(prompt.category || ''),
          url_path: `/prompts/${prompt.id}`,
        },
      }],
    });
    logger.info(`Qdrant: indexed prompt "${prompt.id}"`);
  } catch (err) {
    logger.warn(`Qdrant: failed to index prompt "${prompt.id}": ${err.message}`);
  }
}

async function indexSingleApp(app) {
  try {
    const tags = Array.isArray(app.tags) ? app.tags.join(', ') : '';
    const features = Array.isArray(app.features) ? app.features.join(', ') : '';
    const platforms = Array.isArray(app.platform_support) ? app.platform_support.join(', ') : '';
    const text = sanitize(`[app] ${app.title}: ${(app.description || '').slice(0, 500)}. Type: ${app.type || 'app'}. Category: ${app.category || ''}. Tags: ${tags}. Features: ${features}. Platforms: ${platforms}`);
    const vector = await embed(text);

    await getQdrantClient().upsert('apps', {
      points: [{
        id: toPointId(app.id),
        vector,
        payload: {
          id: String(app.id),
          type: 'app',
          name: sanitize(app.title || ''),
          description: sanitize((app.description || '').slice(0, 200)),
          category: sanitize(app.category || ''),
          price: app.price != null ? parseFloat(app.price) : 0,
          is_free: app.is_free || false,
          url_path: `/apps/${app.id}`,
        },
      }],
    });
    logger.info(`Qdrant: indexed app "${app.id}"`);
  } catch (err) {
    logger.warn(`Qdrant: failed to index app "${app.id}": ${err.message}`);
  }
}

async function indexSinglePost(post) {
  try {
    const text = sanitize(`[post] ${post.title}: ${(post.description || '').slice(0, 500)}. Category: ${post.category || ''}`);
    const vector = await embed(text);

    await getQdrantClient().upsert('posts', {
      points: [{
        id: toPointId(post.id),
        vector,
        payload: {
          id: String(post.id),
          type: 'post',
          name: sanitize(post.title || ''),
          description: sanitize((post.description || '').slice(0, 200)),
          category: sanitize(post.category || ''),
          url_path: `/posts/${post.id}`,
        },
      }],
    });
    logger.info(`Qdrant: indexed post "${post.id}"`);
  } catch (err) {
    logger.warn(`Qdrant: failed to index post "${post.id}": ${err.message}`);
  }
}

async function removeFromIndex(collection, id) {
  try {
    await getQdrantClient().delete(collection, {
      points: [toPointId(id)],
    });
    logger.info(`Qdrant: removed "${id}" from ${collection}`);
  } catch (err) {
    logger.warn(`Qdrant: failed to remove "${id}" from ${collection}: ${err.message}`);
  }
}

module.exports = {
  initCollections,
  indexAgents,
  indexPrompts,
  indexPosts,
  indexApps,
  indexAll,
  searchRelevant,
  indexSingleAgent,
  indexSinglePrompt,
  indexSinglePost,
  indexSingleApp,
  removeFromIndex,
};
