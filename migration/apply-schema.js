/**
 * Apply schema + indices to PostgreSQL
 * Usage: node apply-schema.js
 */
require('dotenv').config({ path: __dirname + '/.env' });
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const pgConfig = {
  host: process.env.PGHOST || 'localhost',
  port: parseInt(process.env.PGPORT || '5432', 10),
  user: process.env.PGUSER || 'sakhr',
  password: process.env.PGPASSWORD || 'sakhr',
  database: process.env.PGDATABASE || 'aiwaverider',
  ssl: false,
};

async function main() {
  const client = new Client(pgConfig);
  await client.connect();
  console.log(`Connected to ${pgConfig.host}:${pgConfig.port}/${pgConfig.database}\n`);

  const files = ['001_schema.sql', '002_indices.sql'];

  for (const file of files) {
    const filePath = path.join(__dirname, file);
    const sql = fs.readFileSync(filePath, 'utf8');
    console.log(`Applying ${file}...`);
    try {
      await client.query(sql);
      console.log(`  OK\n`);
    } catch (err) {
      console.error(`  ERROR in ${file}: ${err.message}\n`);
      throw err;
    }
  }

  // Verify tables
  const res = await client.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `);
  console.log(`Tables created (${res.rows.length}):`);
  for (const row of res.rows) {
    console.log(`  - ${row.table_name}`);
  }

  await client.end();
  console.log('\nDone.');
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
