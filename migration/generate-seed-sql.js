/**
 * Generate 003_seed.sql from local PostgreSQL database.
 *
 * Usage:  node migration/generate-seed-sql.js
 *
 * Produces INSERT statements for every row in every table,
 * ordered so that foreign-key dependencies are satisfied.
 * Uses column type metadata to correctly serialize TEXT[] vs JSONB.
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  host: process.env.PGHOST || 'localhost',
  port: parseInt(process.env.PGPORT || '5432', 10),
  user: process.env.PGUSER || 'sakhr',
  password: process.env.PGPASSWORD || 'sakhr',
  database: process.env.PGDATABASE || 'aiwaverider',
});

// Tables in dependency order (parents before children)
const TABLES = [
  'site_config',
  'users',
  'agents',
  'agent_reviews',
  'orders',
  'invoices',
  'videos',
  'posts',
  'comments',
  'prompts',
  'wishlists',
  'prices',
  'template_access',
  'ai_tools',
];

/**
 * Get column types for a table from information_schema
 */
async function getColumnTypes(table) {
  const { rows } = await pool.query(`
    SELECT column_name, data_type, udt_name
    FROM information_schema.columns
    WHERE table_name = $1
    ORDER BY ordinal_position
  `, [table]);
  const types = {};
  for (const row of rows) {
    // udt_name gives us the underlying type: 'jsonb', '_text' (text[]), 'text', 'int4', etc.
    types[row.column_name] = row.udt_name;
  }
  return types;
}

function escapeString(str) {
  return str.replace(/'/g, "''");
}

function escapeSQL(val, udtType) {
  if (val === null || val === undefined) return 'NULL';

  // JSONB columns
  if (udtType === 'jsonb') {
    if (typeof val === 'string') {
      return `'${escapeString(val)}'::jsonb`;
    }
    return `'${escapeString(JSON.stringify(val))}'::jsonb`;
  }

  // TEXT[] or other array types (udt_name starts with _)
  if (udtType && udtType.startsWith('_')) {
    if (!Array.isArray(val) || val.length === 0) return "'{}'";
    const inner = val.map(v =>
      `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
    ).join(',');
    return `'{${inner}}'`;
  }

  // Boolean
  if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';

  // Number
  if (typeof val === 'number') return String(val);

  // Date
  if (val instanceof Date) return `'${val.toISOString()}'`;

  // Timestamps stored as strings
  if (udtType === 'timestamptz' || udtType === 'timestamp') {
    return `'${escapeString(String(val))}'`;
  }

  // Regular string/text/numeric
  return `'${escapeString(String(val))}'`;
}

async function main() {
  const outPath = path.resolve(__dirname, '003_seed.sql');
  const lines = [];

  lines.push('-- Auto-generated seed data from local PostgreSQL');
  lines.push(`-- Generated: ${new Date().toISOString()}`);
  lines.push('-- Run after 001_schema.sql and 002_indices.sql');
  lines.push('');
  lines.push('BEGIN;');
  lines.push('');

  let totalRows = 0;

  for (const table of TABLES) {
    try {
      const columnTypes = await getColumnTypes(table);
      const { rows } = await pool.query(`SELECT * FROM ${table}`);

      if (rows.length === 0) {
        lines.push(`-- ${table}: 0 rows (skipped)`);
        lines.push('');
        continue;
      }

      const columns = Object.keys(rows[0]);
      lines.push(`-- ${table}: ${rows.length} rows`);

      for (const row of rows) {
        const values = columns.map(col =>
          escapeSQL(row[col], columnTypes[col])
        );
        lines.push(
          `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${values.join(', ')}) ON CONFLICT DO NOTHING;`
        );
      }

      lines.push('');
      totalRows += rows.length;
      console.log(`  ${table}: ${rows.length} rows`);
    } catch (err) {
      console.warn(`  ${table}: skipped (${err.message})`);
      lines.push(`-- ${table}: skipped (${err.message})`);
      lines.push('');
    }
  }

  lines.push('COMMIT;');
  lines.push('');

  fs.writeFileSync(outPath, lines.join('\n'), 'utf8');
  console.log(`\nWrote ${totalRows} total rows to ${outPath}`);

  await pool.end();
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
