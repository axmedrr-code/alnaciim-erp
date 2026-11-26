// Stops the servers and makes the run's password useless: every pwui.* account gets a fresh random hash and is deactivated.
// Fixture rows (warehouses TST-PWUI-*, products/customers with the run stamp, the sales and payments) stay, like the other
// TEST suites' data; nothing is deleted.
const crypto = require('crypto');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const { STATE_FILE, PREFIX, testDatabase } = require('./env');

module.exports = async function globalTeardown() {
  let state = null;
  try { state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch (_) {}
  for (const pid of state?.procs || []) { try { process.kill(pid); } catch (_) {} }

  const { url, ssl } = testDatabase();
  const pool = new Pool({ connectionString: url, ssl: ssl ? { rejectUnauthorized: false } : false, max: 1 });
  try {
    const scrambled = await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 10);
    await pool.query(`update users set password_hash=$1, is_active=false, password_changed_at=now() where email like $2`, [scrambled, `${PREFIX}.%@alnaciim.test`]);
  } finally {
    await pool.end();
  }
  try { fs.unlinkSync(STATE_FILE); } catch (_) {}
};
