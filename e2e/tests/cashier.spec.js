// UAT F1 in a real browser: the Cashier works only in Retail Sales & Billing (Bottled Water / Ice, never Bulk Water, no
// Reports tab), completes a cash sale through the form, and the sale really lands: invoice saved as paid, stock reduced in
// the database, and the sale listed in Sales List.
const { test, expect } = require('@playwright/test');
const { state, signIn, stockOf, db } = require('../support/helpers');

test.beforeEach(async ({ page }) => {
  await signIn(page, 'cashier');
  await page.locator('aside.sidebar nav').getByRole('link', { name: 'Sales & Distribution' }).click();
  await expect(page.getByRole('heading', { name: 'Sales & Distribution', exact: true })).toBeVisible();
});

test('only Retail Sales & Billing, two retail departments, no Reports tab', async ({ page }) => {
  await expect(page.getByRole('button', { name: 'Retail Sales & Billing' })).toBeVisible();
  for (const other of ['Overview Dashboard', 'RO Water (Bulk)', 'Tankers', 'Customers', 'Bulk Water Orders', 'Deliveries'])
    await expect(page.getByRole('button', { name: other, exact: true }), other).toHaveCount(0);
  const dept = page.locator('.toolbar select').first();
  expect(await dept.locator('option').allInnerTexts()).toEqual(['Bottled Water', 'Ice']);
  const subtabs = (await page.locator('.grouped-nav__subtabs').last().getByRole('button').allInnerTexts()).map((t) => t.trim());
  expect(subtabs).toEqual(['Sales Screen', 'Sales List', 'Receive Payment', 'Customer Statement']);
});

test('a cash sale of bottled water is saved as paid and reduces stock', async ({ page }) => {
  const s = state();
  const before = await stockOf(s.products.bottle.id, s.warehouses.fg.id);

  await page.getByPlaceholder('Search by HNO, name, or phone…').fill(s.customers.cash.hno);
  await page.locator('.quick-search__dropdown').getByRole('button', { name: new RegExp(s.customers.cash.name) }).click();
  await expect(page.getByText('Selected customer')).toBeVisible();

  const form = page.locator('form.form-modern');
  await form.locator('.form-field', { hasText: 'Warehouse' }).locator('select').selectOption({ label: s.warehouses.fg.name });
  await form.locator('select').filter({ has: page.locator('option', { hasText: 'Product…' }) }).selectOption({ label: `${s.products.bottle.name} (pcs)` });
  await form.getByPlaceholder('Qty').fill('3');
  await form.getByPlaceholder('Unit price').fill('1.50');
  await expect(form.getByText('Total: $4.50', { exact: true })).toBeVisible();
  await form.getByRole('button', { name: 'Complete Cash Sale' }).click();

  const ok = page.locator('.success-box');
  await expect(ok).toContainText('Cash Invoice');
  await expect(ok).toContainText('$4.50 (paid)');
  const invoiceNo = (await ok.innerText()).match(/Cash Invoice (\S+) saved/)[1];

  expect(await stockOf(s.products.bottle.id, s.warehouses.fg.id)).toBe(before - 3);
  const [sale] = await db('select payment_status, total_amount from sales_orders where invoice_hno=$1', [invoiceNo]);
  expect(sale.payment_status).toBe('paid');
  expect(Number(sale.total_amount)).toBe(4.5);

  await page.getByRole('button', { name: 'Sales List' }).click();
  await expect(page.locator('table').getByRole('row', { name: new RegExp(invoiceNo) })).toBeVisible();
});

test('the sale form refuses a sale with no customer selected', async ({ page }) => {
  const form = page.locator('form.form-modern');
  const s = state();
  await form.locator('.form-field', { hasText: 'Warehouse' }).locator('select').selectOption({ label: s.warehouses.fg.name });
  const before = await stockOf(s.products.bottle.id, s.warehouses.fg.id);
  await form.getByRole('button', { name: 'Complete Cash Sale' }).click();
  await expect(page.locator('.success-box')).toHaveCount(0);
  expect(await stockOf(s.products.bottle.id, s.warehouses.fg.id)).toBe(before);
});
