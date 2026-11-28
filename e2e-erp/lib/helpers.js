const path = require('path');
const { expect } = require('@playwright/test');
const { assertTestDatabase } = require('./guard');

const email = (key) => `e2e.${key}@alnaciim.test`;
const password = (key) => {
  const v = process.env[`E2E_PW_${key.toUpperCase()}`];
  if (!v) throw new Error(`no password for ${key}: the global setup did not run`);
  return v;
};
const fixtures = () => JSON.parse(process.env.E2E_FIXTURES || '{}');

// Signs in through the real login form.
async function login(page, key, pw = password(key)) {
  await page.goto('/login');
  await page.locator('input[type="email"]').fill(email(key));
  await page.locator('input[type="password"]').fill(pw);
  await page.getByRole('button', { name: /sign in/i }).click();
}
async function loginOk(page, key) {
  await login(page, key);
  await expect(page.locator('aside, .app-shell').first()).toBeVisible();
  await expect(page).not.toHaveURL(/\/login/);
}
async function logout(page) {
  await page.locator('.user-menu__trigger').click();
  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page).toHaveURL(/\/login/);
}
const navLinks = (page) => page.locator('aside nav a').evaluateAll((as) => as.map((a) => a.getAttribute('href')).sort());

// Direct database reads for assertions (read-only helpers; the app itself is always driven through the UI).
async function query(sql, params) {
  const db = assertTestDatabase();
  const { Pool } = require(path.join(__dirname, '..', '..', 'backend', 'node_modules', 'pg'));
  const pool = new Pool({ connectionString: db.url, ssl: db.ssl ? { rejectUnauthorized: false } : false, max: 1 });
  pool.on('error', () => {});
  try { return (await pool.query(sql, params)).rows; } finally { await pool.end(); }
}
const stockOf = async (productId, warehouseId) => Number((await query('select coalesce(sum(quantity),0) n from stock_levels where product_id=$1 and warehouse_id=$2', [productId, warehouseId]))[0].n);

module.exports = { email, password, fixtures, login, loginOk, logout, navLinks, query, stockOf };
