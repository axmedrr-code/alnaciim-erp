// Runs the backup/restore E2E against a THROWAWAY database on the LOCAL PostgreSQL only: it creates a scratch database, applies
// schema.sql + seed.sql, runs backups.e2e.test.js twice (restore enabled / restore disabled + broken pg_dump), then drops the scratch
// database. A restore replaces a whole database, so this test must never be pointed at the shared TEST database (Neon) or production.
//   node tests/e2e/run-backups-e2e.js
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const { Client } = require('pg');

const base = new URL(process.env.DATABASE_URL || '');
if (!['localhost', '127.0.0.1'].includes(base.hostname)) { console.log('refusing: the backup E2E only runs against the local PostgreSQL'); process.exit(1); }
const name = `alnaciim_bk_e2e_test_${Date.now()}`;
const adminUrl = new URL(base); adminUrl.pathname = '/postgres';
const scratch = new URL(base); scratch.pathname = '/' + name;

(async () => {
  const admin = new Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  let failed = false;
  try {
    await admin.query(`CREATE DATABASE ${name}`);
    const c = new Client({ connectionString: scratch.toString() });
    await c.connect();
    try {
      await c.query(fs.readFileSync(path.join(__dirname, '../../../database/schema.sql'), 'utf8'));
      await c.query(fs.readFileSync(path.join(__dirname, '../../../database/seed.sql'), 'utf8'));
    } finally { await c.end(); }
    console.log(`scratch database ${name} ready (local only)`);
    for (const mode of ['on', 'off']) {
      console.log(`\n===== backups E2E, mode: ${mode} =====`);
      const r = spawnSync(process.execPath, ['--no-warnings', path.join(__dirname, 'backups.e2e.test.js')], {
        cwd: path.join(__dirname, '../..'), encoding: 'utf8', timeout: 540000,
        env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, PG_BIN_PATH: process.env.PG_BIN_PATH || '', DATABASE_URL: process.env.DATABASE_URL, TEST_DATABASE_URL: scratch.toString(), E2E_BACKUP_MODE: mode }
      });
      process.stdout.write((r.stdout || '').split('\n').filter((l) => !/^PASS/.test(l)).join('\n') + (r.stderr || ''));
      if (r.status !== 0) failed = true;
    }
  } catch (e) { console.log('ERR', String(e.message).replace(/postgres(ql)?:\/\/\S+/gi, '<url>')); failed = true; }
  finally {
    await admin.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1`, [name]).catch(() => {});
    await admin.query(`DROP DATABASE IF EXISTS ${name}`).catch(() => {});
    await admin.end();
    console.log(`\nscratch database ${name} dropped`);
  }
  process.exit(failed ? 1 : 0);
})();
