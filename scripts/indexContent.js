#!/usr/bin/env node

/**
 * Manual Qdrant indexing script.
 * Usage: node scripts/indexContent.js
 *
 * Reads all agents, prompts, and posts from PostgreSQL,
 * embeds them with OpenAI, and upserts into Qdrant.
 */

require('dotenv').config();

const { initCollections, indexAll } = require('../services/rag/qdrantService');

(async () => {
  try {
    console.log('Initializing Qdrant collections...');
    await initCollections();

    console.log('Indexing content into Qdrant...');
    const counts = await indexAll();

    console.log('Indexing complete:');
    console.log(`  Agents:  ${counts.agents} documents`);
    console.log(`  Prompts: ${counts.prompts} documents`);
    console.log(`  Posts:   ${counts.posts} documents`);

    process.exit(0);
  } catch (err) {
    console.error('Indexing failed:', err);
    process.exit(1);
  }
})();
