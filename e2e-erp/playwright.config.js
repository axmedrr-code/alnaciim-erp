// Real-browser E2E: Playwright drives the installed Microsoft Edge against a LOCAL stack (backend :4000 + Vite :5173)
// that talks to the isolated test database. Nothing here touches production, Railway, Render or Vercel.
const crypto = require('crypto');
const { defineConfig } = require('@playwright/test');
const { assertTestDatabase } = require('./lib/guard');

const db = assertTestDatabase();
const JWT_SECRET = crypto.randomBytes(24).toString('hex'); // throwaway, only the local backend started below knows it

module.exports = defineConfig({
  testDir: './tests',
  globalSetup: './global-setup.js',
  globalTeardown: './global-teardown.js',
  // One shared database and ordered flows: run the files one after another.
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: 'http://localhost:5173',
    channel: 'msedge', // the Microsoft Edge already installed on this machine: no browser is downloaded
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    viewport: { width: 1440, height: 900 }
  },
  webServer: [
    {
      command: 'node src/index.js',
      cwd: '../backend',
      url: 'http://localhost:4000/health',
      reuseExistingServer: false,
      timeout: 90_000,
      env: {
        PORT: '4000', DATABASE_URL: db.url, DATABASE_SSL: db.ssl ? 'true' : '', JWT_SECRET, BACKUP_CRON_SCHEDULE: 'disabled',
        CORS_ORIGIN: '', NODE_ENV: '', AUTH_CACHE_TTL_MS: '0', RATE_LIMIT_API_MAX: '1000000', RATE_LIMIT_LOGIN_MAX: '1000', RATE_LIMIT_LOGIN_IP_MAX: '1000'
      }
    },
    {
      command: 'npm run dev',
      cwd: '../frontend',
      url: 'http://localhost:5173',
      reuseExistingServer: false,
      timeout: 90_000
    }
  ]
});
