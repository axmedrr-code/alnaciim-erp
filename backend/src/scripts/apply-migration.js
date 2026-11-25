// Applies ONE migration file from database/migrations/ to the database in DATABASE_URL, once, in a transaction.
//
//   node src/scripts/apply-migration.js <file.sql> [--yes] [--expect-host=<db host>]
//
// Safeguards (same as set-user-password.js): shows the target database (never credentials); interactive runs must type
// the database name; non-interactive runs need --yes; --expect-host pins the target. Applied files are recorded in
// schema_migrations, so running the same file twice is a no-op. Nothing is ever dropped by this script itself.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { pool } = require('../config/db');
const { assertInitializedSchema, stripStandaloneTransactionCommands } = require('../services/schemaMigrationPlan');

const MIGRATION_LOCK_A = 841027;
const MIGRATION_LOCK_B = 34;

function parseArgs(argv) {
  let yes = false, expectHost = null; const positional = [];
  for (const a of argv) {
    if (a === '--yes' || a === '-y') yes = true;
    else if (a.startsWith('--expect-host=')) expectHost = a.slice('--expect-host='.length).trim().toLowerCase();
    else if (a.startsWith('--')) throw new Error(`Unknown option ${a}`);
    else positional.push(a);
  }
  return { file: positional[0], yes, expectHost };
}
const ask = (q) => new Promise((resolve) => { const rl = readline.createInterface({ input: process.stdin, output: process.stdout }); rl.question(q, (a) => { rl.close(); resolve(a.trim()); }); });

(async () => {
  const { file, yes, expectHost } = parseArgs(process.argv.slice(2));
  if (!file || !/^[\w.-]+\.sql$/.test(file)) throw new Error('Usage: node src/scripts/apply-migration.js <file.sql> [--yes] [--expect-host=<host>]');
  const full = path.join(__dirname, '../../../database/migrations', file);
  if (!fs.existsSync(full)) throw new Error(`No such migration: ${file}`);
  const u = new URL(process.env.DATABASE_URL);
  const target = { host: u.hostname.toLowerCase(), db: decodeURIComponent(u.pathname.replace(/^\//, '')) };
  if (expectHost && expectHost !== target.host) throw new Error(`Refusing: database host is "${target.host}" but --expect-host was "${expectHost}"`);
  console.log(`Target database : ${target.db} @ ${target.host}`);
  console.log(`Migration       : ${file}`);
  if (!yes) {
    if (!process.stdin.isTTY) throw new Error('Non-interactive run: pass --yes to confirm (optionally with --expect-host=<host>)');
    if ((await ask(`Type the database name (${target.db}) to confirm: `)) !== target.db) throw new Error('Confirmation did not match - nothing changed');
  }
  const client = await pool.connect();
  let locked = false;
  try {
    await client.query('SELECT pg_advisory_lock($1,$2)', [MIGRATION_LOCK_A, MIGRATION_LOCK_B]);
    locked = true;
    const { rows: relations } = await client.query(
      "SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','S','v','m','f') AND c.relname <> 'schema_migrations'"
    );
    assertInitializedSchema(relations);
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
    const columns = await client.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='schema_migrations'");
    if (!columns.rows.some((row) => row.column_name === 'name'))
      throw new Error('schema_migrations has an unsupported format; refusing to alter or reinterpret its history');
    const done = await client.query('SELECT 1 FROM schema_migrations WHERE name = $1', [file]);
    if (done.rowCount) { console.log('Already applied - nothing to do.'); return; }
    await client.query('BEGIN');
    const sql = stripStandaloneTransactionCommands(fs.readFileSync(full, 'utf8'));
    await client.query(sql);
    await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
    await client.query('COMMIT');
    console.log('Applied successfully.');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    if (locked) await client.query('SELECT pg_advisory_unlock($1,$2)', [MIGRATION_LOCK_A, MIGRATION_LOCK_B]).catch(() => {});
    client.release();
  }
})()
  .catch((err) => { console.error(String(err.message).replace(/postgres(ql)?:\/\/\S+/gi, '<url>')); process.exitCode = 1; })
  .finally(() => pool.end());
