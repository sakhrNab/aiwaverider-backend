/**
 * PostgreSQL Connection Pool
 *
 * Replaces Firestore `db` as the primary data access layer.
 * All controllers/services import `pool` from this module.
 */
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.PGHOST || 'localhost',
  port: parseInt(process.env.PGPORT || '5432', 10),
  user: process.env.PGUSER || 'sakhr',
  password: process.env.PGPASSWORD || 'sakhr',
  database: process.env.PGDATABASE || 'aiwaverider',
  // Pool settings
  max: parseInt(process.env.PG_POOL_MAX || '20', 10),
  idleTimeoutMillis: parseInt(process.env.PG_IDLE_TIMEOUT || '30000', 10),
  connectionTimeoutMillis: parseInt(process.env.PG_CONNECT_TIMEOUT || '5000', 10),
});

// Log pool errors
pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL pool error:', err);
});

// Test connection on startup
pool.query('SELECT NOW()')
  .then(() => console.log('PostgreSQL connected successfully'))
  .catch((err) => console.error('PostgreSQL connection failed:', err.message));

module.exports = { pool };
