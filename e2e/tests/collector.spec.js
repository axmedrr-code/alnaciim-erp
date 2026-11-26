// UAT F4 in a real browser: the Collector opens Collections -> Receive Payment, finds the debtor by HNO, records a partial
// payment and then the rest; the outstanding balance on screen and in the database follow each payment. The management-only
// Employee Performance tab is not offered.
const { test, expect } = require('@playwright/test');
const { state, signIn, db } = require('../support/helpers');

async function outstanding(customerId) {
  // Accounts Receivable (1100) on the posted ledger for this customer: the books, not the screen.
  const [r] = await db(`select coalesce(sum(jl.debit - jl.credit),0) n from journal_lines jl
    join journal_entries je on je.id = jl.journal_entry_id and je.status = 'posted'
    join chart_of_accounts a on a.id = jl.account_id and a.code = '1100'
    where jl.customer_id = $1`, [customerId]);
  return Number(r.n);
}

test.beforeEach(async ({ page }) => {
  await signIn(page, 'collector');
  await page.locator('aside.sidebar nav').getByRole('link', { name: 'Collections' }).click();
  await expect(page.getByRole('heading', { name: 'Collections', exact: true })).toBeVisible();
});

test('the Collections tabs exclude Employee Performance', async ({ page }) => {
  const tabs = (await page.locator('.grouped-nav__subtabs').getByRole('button').allInnerTexts()).map((t) => t.trim());
  expect(tabs).toEqual(['Dashboard', 'Customer Receivables', 'Receive Payment', 'Payment History', 'Aging Report', 'Reports']);
});

test('receive a partial payment, then settle the rest', async ({ page }) => {
  const s = state();
  const start = await outstanding(s.customers.debtor.id);
  expect(start).toBe(s.creditInvoice.total); // $20.00 credit invoice from the setup

  await page.locator('.grouped-nav__subtabs').getByRole('button', { name: 'Receive Payment' }).click();
  await page.getByPlaceholder('Search by HNO, phone, or name…').fill(s.customers.debtor.hno);
  await page.getByRole('button', { name: 'Search' }).click();
  await page.getByRole('row', { name: new RegExp(s.customers.debtor.hno) }).getByRole('button', { name: 'Select' }).click();

  const card = page.locator('.card', { has: page.getByRole('heading', { name: new RegExp(s.customers.debtor.name) }) });
  const balance = card.locator('.kpi-card', { hasText: 'Outstanding Balance' }).locator('.kpi-card__value');
  await expect(balance).toHaveText('$20.00');

  const amount = card.locator('.form-field', { hasText: 'Amount' }).locator('input');
  await amount.fill('5');
  await card.locator('.form-field', { hasText: 'Reference Number' }).locator('input').fill(`PWUI-${s.stamp}-1`);
  await card.getByRole('button', { name: 'Save Payment' }).click();
  await expect(page.locator('.success-box')).toContainText('Payment saved');
  await expect(balance).toHaveText('$15.00');
  expect(await outstanding(s.customers.debtor.id)).toBe(15);

  await amount.fill('15');
  await card.getByRole('button', { name: 'Save Payment' }).click();
  await expect(balance).toHaveText('$0.00');
  expect(await outstanding(s.customers.debtor.id)).toBe(0);
});

test('a zero amount is refused and nothing is recorded', async ({ page }) => {
  const s = state();
  const before = await outstanding(s.customers.debtor.id);
  await page.locator('.grouped-nav__subtabs').getByRole('button', { name: 'Receive Payment' }).click();
  await page.getByPlaceholder('Search by HNO, phone, or name…').fill(s.customers.debtor.hno);
  await page.getByRole('button', { name: 'Search' }).click();
  await page.getByRole('row', { name: new RegExp(s.customers.debtor.hno) }).getByRole('button', { name: 'Select' }).click();
  const card = page.locator('.card', { has: page.getByRole('heading', { name: new RegExp(s.customers.debtor.name) }) });
  await card.locator('.form-field', { hasText: 'Amount' }).locator('input').fill('0');
  await card.getByRole('button', { name: 'Save Payment' }).click();
  await expect(card.locator('.error-box')).toContainText('greater than zero');
  expect(await outstanding(s.customers.debtor.id)).toBe(before);
});
