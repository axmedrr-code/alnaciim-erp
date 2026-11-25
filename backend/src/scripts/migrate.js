// Fresh-database bootstrap only. Existing databases must use the guarded
// apply-migration.js command with an explicitly reviewed migration file.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('../config/db');
const { discoverMigrations, assertEmptyBootstrapTarget, stripStandaloneTransactionCommands } = require('../services/schemaMigrationPlan');

const ROOT = path.join(__dirname, '../../../database');
const LOCK_KEY_A = 841027;
const LOCK_KEY_B = 34;

async function main() {
  if (!process.argv.includes('--bootstrap-empty'))
    throw new Error('This is a fresh-database bootstrap only. For a truly empty database, pass --bootstrap-empty. For an existing database, use apply-migration.js with an explicitly reviewed file.');

  const migrations = discoverMigrations(fs.readdirSync(path.join(ROOT, 'migrations')));
  if (!migrations.length) throw new Error('No numbered SQL migrations were found');
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1,$2)', [LOCK_KEY_A, LOCK_KEY_B]);
    const { rows: relations } = await client.query(
      "SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','S','v','m','f') AND c.relname <> 'schema_migrations'"
    );
    const tracker = (await client.query("SELECT to_regclass('public.schema_migrations') AS table_name")).rows[0].table_name;
    let appliedCount = 0, trackerHasName = false;
    if (tracker) {
      const existing = await client.query('SELECT COUNT(*)::int AS count FROM schema_migrations');
      appliedCount = existing.rows[0].count;
      const columns = await client.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='schema_migrations'");
      trackerHasName = columns.rows.some((row) => row.column_name === 'name');
    }
    assertEmptyBootstrapTarget({ relations, trackingExists: Boolean(tracker), appliedCount, trackerHasName });

    const schemaSql = stripStandaloneTransactionCommands(fs.readFileSync(path.join(ROOT, 'schema.sql'), 'utf8'), { all: true });
    await client.query('BEGIN');
    try {
      await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
      await client.query(schemaSql);
      for (const migration of migrations)
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [migration.name]);
      await client.query('COMMIT');
      console.log(`Bootstrapped an empty database from the repository schema; recorded ${migrations.length} migration files.`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error('Fresh-database bootstrap rolled back. Check the database error in the server log.');
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1,$2)', [LOCK_KEY_A, LOCK_KEY_B]).catch(() => {});
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Database bootstrap failed:', err.message);
  process.exitCode = 1;
});
