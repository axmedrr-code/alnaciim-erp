// Small helpers shared by the specs: sign in through the real login form, read the sidebar, query the test database.
const { expect } = require('@playwright/test');
const { Pool } = require('pg');
const { readState, testDatabase } = require('./env');

const state = () => readState();

async function signIn(page, key) {
  const s = state();
  await page.goto('/login');
  await page.getByLabel('Email').fill(s.users[key].email);
  await page.getByLabel('Password').fill(s.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('aside.sidebar nav')).toBeVisible();
}

async function sidebarLabels(page) {
  return (await page.locator('aside.sidebar nav a').allInnerTexts()).map((t) => t.trim()).filter(Boolean);
}

let pool;
async function db(sql, params) {
  if (!pool) {
    const { url, ssl } = testDatabase();
    pool = new Pool({ connectionString: url, ssl: ssl ? { rejectUnauthorized: false } : false, max: 1 });
    pool.on('error', () => {});
  }
  return (await pool.query(sql, params)).rows;
}

async function stockOf(productId, warehouseId) {
  return Number((await db('select coalesce(sum(quantity),0) n from stock_levels where product_id=$1 and warehouse_id=$2', [productId, warehouseId]))[0].n);
}

module.exports = { state, signIn, sidebarLabels, db, stockOf };
