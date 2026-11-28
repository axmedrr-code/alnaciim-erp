// Deactivates the E2E accounts after the run so no test login stays usable. (The next run re-activates and re-keys them.)
const path = require('path');
const { assertTestDatabase } = require('./lib/guard');

module.exports = async () => {
  const db = assertTestDatabase();
  const { Pool } = require(path.join(__dirname, '..', 'backend', 'node_modules', 'pg'));
  const pool = new Pool({ connectionString: db.url, ssl: db.ssl ? { rejectUnauthorized: false } : false, max: 1 });
  pool.on('error', () => {});
  try { await pool.query(`update users set is_active = false where email like 'e2e.%@alnaciim.test'`); } finally { await pool.end(); }
};
