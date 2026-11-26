// Shared settings and the database safety guard (same rule as backend/tests/e2e/harness.js):
// TEST_DATABASE_URL must point at localhost or Neon AND the database name must have a "test" part (or the host is pinned with
// TEST_DATABASE_EXPECT_HOST). DATABASE_URL is never read; Railway / production hosts are refused.
const path = require('path');
const fs = require('fs');

const ERP_PORT = Number(process.env.E2E_ERP_PORT || 5273);
const API_PORT = Number(process.env.E2E_API_PORT || 5590);
const STATE_DIR = path.join(__dirname, '..', '.state');
const STATE_FILE = path.join(STATE_DIR, 'state.json');
const PREFIX = 'pwui';

function testDatabase() {
  const DB = process.env.TEST_DATABASE_URL;
  if (!DB) throw new Error('refusing: set TEST_DATABASE_URL to an isolated test database');
  const u = new URL(DB);
  const host = u.hostname.toLowerCase();
  const dbName = decodeURIComponent(u.pathname.replace(/^\/+/, '')).toLowerCase();
  const hostOk = host.endsWith('.neon.tech') || host === 'localhost' || host === '127.0.0.1';
  const nameOk = /(^|[-_])test($|[-_])/.test(dbName) || (process.env.TEST_DATABASE_EXPECT_HOST && process.env.TEST_DATABASE_EXPECT_HOST.toLowerCase() === host);
  if (!hostOk || !nameOk || /railway|rlwy/.test(host)) throw new Error('refusing: not an isolated test database');
  return { url: DB, ssl: process.env.TEST_DATABASE_SSL === 'true' };
}

function readState() {
  return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
}

module.exports = { ERP_PORT, API_PORT, STATE_DIR, STATE_FILE, PREFIX, testDatabase, readState };
