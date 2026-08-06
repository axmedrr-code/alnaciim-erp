const { Pool, types } = require('pg');

// pg's default DATE parser builds a JS Date from local year/month/day, which then
// shifts to the wrong calendar day when serialized to JSON on a non-UTC host.
// Returning the raw 'YYYY-MM-DD' string sidesteps timezone conversion entirely.
types.setTypeParser(types.builtins.DATE, (value) => value);

// Managed Postgres (Railway/Render/Fly's own Postgres, Neon, Supabase, ...)
// requires SSL for external connections; a local/self-hosted Postgres
// usually doesn't offer it at all. Off by default so local dev is unaffected;
// set DATABASE_SSL=true in production.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle Postgres client', err);
});

async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, withTransaction };
