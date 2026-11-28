// Safety guard shared by the config and the global setup: the E2E suite creates test users and test data, so it refuses to run
// against anything that is not an isolated test database. It never reads DATABASE_URL (which could point at production).
function assertTestDatabase() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('E2E refused: set TEST_DATABASE_URL (Neon TEST or a local test database) and TEST_DATABASE_EXPECT_HOST.');
  const host = new URL(url).hostname.toLowerCase();
  const isLocal = host === 'localhost' || host === '127.0.0.1';
  const isNeon = host.endsWith('.neon.tech');
  const pinned = (process.env.TEST_DATABASE_EXPECT_HOST || '').toLowerCase();
  if (!(isLocal || isNeon) || /railway|rlwy/.test(host)) throw new Error('E2E refused: the database host is not localhost or Neon.');
  if (pinned !== host) throw new Error('E2E refused: TEST_DATABASE_EXPECT_HOST must equal the database host (it pins the target).');
  return { url, host, ssl: process.env.TEST_DATABASE_SSL === 'true' };
}

module.exports = { assertTestDatabase };
