// Real-browser E2E for the ERP frontend. global-setup.js starts the real backend (throwaway JWT secret) and the ERP Vite dev
// server against an isolated test database, creates pwui.* test accounts with a random per-run password and seeds fixtures.
// See e2e/README.md.
const { defineConfig, devices } = require('@playwright/test');
const { ERP_PORT } = require('./support/env');

module.exports = defineConfig({
  testDir: './tests',
  globalSetup: require.resolve('./support/global-setup'),
  globalTeardown: require.resolve('./support/global-teardown'),
  fullyParallel: false,
  workers: 1, // the specs share one database and read/write the same fixtures
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: `http://localhost:${ERP_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off'
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }]
});
