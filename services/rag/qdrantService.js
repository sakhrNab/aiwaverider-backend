const { QdrantClient } = require('@qdrant/js-client-rest');
const OpenAI = require('openai');
const { pool } = require('../../config/database');
const logger = require('../../utils/logger');

const QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:6333';
const EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';
const VECTOR_SIZE = 1536;

let qdrant;
let openai;

function getQdrantClient() {
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

// --- Collection management ---

async function initCollections() {
  const client = getQdrantClient();
  const collections = ['agents', 'prompts', 'posts'];

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
        logger.error(`Error checking Qdrant collection "${name}":`, err.message);
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

  const points = [];
  for (const row of rows) {
    const tags = Array.isArray(row.tags) ? row.tags.join(', ') : '';
    const features = Array.isArray(row.features) ? row.features.join(', ') : '';
    const text = `[agent] ${row.name || row.title}: ${(row.description || '').slice(0, 500)}. Category: ${row.category || ''}. Tags: ${tags}. Features: ${features}`;

    const vector = await embed(text);
    points.push({
      id: hashId(row.id),
      vector,
      payload: {
        id: row.id,
        type: 'agent',
        name: row.name || row.title,
        description: (row.description || '').slice(0, 200),
        category: row.category || '',
        price: row.price != null ? parseFloat(row.price) : 0,
        is_free: row.is_free || false,
        url_path: `/agents/${row.id}`,
      },
    });
  }

  await getQdrantClient().upsert('agents', { points });
  return points.length;
}

async function indexPrompts() {
  const { rows } = await pool.query(
    `SELECT id, title, description, category, tags, keywords
     FROM prompts WHERE (type = 'prompt' OR type IS NULL)`
  );

  if (rows.length === 0) return 0;

  const points = [];
  for (const row of rows) {
    const tags = Array.isArray(row.tags) ? row.tags.join(', ') : '';
    const keywords = Array.isArray(row.keywords) ? row.keywords.join(', ') : '';
    const text = `[prompt] ${row.title}: ${(row.description || '').slice(0, 500)}. Category: ${row.category || ''}. Tags: ${tags}. Keywords: ${keywords}`;

    const vector = await embed(text);
    points.push({
      id: hashId(row.id),
      vector,
      payload: {
        id: row.id,
        type: 'prompt',
        name: row.title,
        description: (row.description || '').slice(0, 200),
        category: row.category || '',
        url_path: `/prompts/${row.id}`,
      },
    });
  }

  await getQdrantClient().upsert('prompts', { points });
  return points.length;
}

async function indexPosts() {
  const { rows } = await pool.query(
    `SELECT id, title, description, category FROM posts`
  );

  if (rows.length === 0) return 0;

  const points = [];
  for (const row of rows) {
    const text = `[post] ${row.title}: ${(row.description || '').slice(0, 500)}. Category: ${row.category || ''}`;

    const vector = await embed(text);
    points.push({
      id: hashId(row.id),
      vector,
      payload: {
        id: row.id,
        type: 'post',
        name: row.title,
        description: (row.description || '').slice(0, 200),
        category: row.category || '',
        url_path: `/posts/${row.id}`,
      },
    });
  }

  await getQdrantClient().upsert('posts', { points });
  return points.length;
}

async function indexAll() {
  const agentCount = await indexAgents();
  const promptCount = await indexPrompts();
  const postCount = await indexPosts();
  return { agents: agentCount, prompts: promptCount, posts: postCount };
}

// --- Search ---

async function searchRelevant(query, limit = 5) {
  const vector = await embed(query);
  const client = getQdrantClient();

  const collections = ['agents', 'prompts', 'posts'];
  const allResults = [];

  for (const collection of collections) {
    try {
      const results = await client.search(collection, {
        vector,
        limit,
        with_payload: true,
      });
      allResults.push(...results);
    } catch (err) {
      logger.warn(`Qdrant search failed for "${collection}": ${err.message}`);
    }
  }

  // Sort by score descending and take top `limit`
  allResults.sort((a, b) => b.score - a.score);
  return allResults.slice(0, limit).map((r) => ({
    score: r.score,
    ...r.payload,
  }));
}

// --- Helpers ---

/**
 * Convert a string ID (e.g. UUID) to a positive integer for Qdrant point IDs.
 * Uses a simple hash that fits within a 64-bit unsigned integer range.
 */
function hashId(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  // Ensure positive by using unsigned right shift and adding offset
  return (hash >>> 0) + 1;
}

module.exports = {
  initCollections,
  indexAgents,
  indexPrompts,
  indexPosts,
  indexAll,
  searchRelevant,
};
