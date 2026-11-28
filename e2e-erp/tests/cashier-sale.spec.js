const { test, expect } = require('@playwright/test');
const { loginOk, fixtures, stockOf } = require('../lib/helpers');

async function openSalesScreen(page) {
  await loginOk(page, 'cashier');
  await page.goto('/sales');
  await expect(page.getByText('CUSTOMER & WAREHOUSE', { exact: false }).first()).toBeVisible();
}
async function pickCustomer(page) {
  await page.getByPlaceholder('Search by HNO, name, or phone…').fill('990001');
  await page.getByRole('button', { name: /E2E Test Customer/ }).click();
  await expect(page.getByText('Selected customer')).toBeVisible();
}
const form = (page) => page.locator('form.form-modern');

test.describe('Cashier: retail cash sale', () => {
  test('the Cashier sees the four sales tabs and no Reports tab', async ({ page }) => {
    await loginOk(page, 'cashier');
    await page.goto('/sales');
    for (const name of ['Sales Screen', 'Sales List', 'Receive Payment', 'Customer Statement']) await expect(page.getByRole('button', { name })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reports' })).toHaveCount(0);
  });

  test('records a cash sale: the invoice is saved and the stock goes down', async ({ page }) => {
    const { FG, bottle } = fixtures();
    const before = await stockOf(bottle, FG);
    await openSalesScreen(page);
    await pickCustomer(page);
    await form(page).locator('select').nth(0).selectOption({ label: 'E2E Finished Goods Store' });
    await form(page).locator('select').nth(1).selectOption({ label: 'E2E Bottled Water 1.5L (pcs)' });
    await form(page).getByPlaceholder('Qty').fill('5');
    await form(page).getByPlaceholder('Unit price').fill('2');
    await form(page).getByRole('button', { name: 'Complete Cash Sale' }).click();
    await expect(page.locator('.success-box')).toContainText(/Cash Invoice .* saved/);
    await expect.poll(() => stockOf(bottle, FG)).toBe(before - 5);
  });

  test('a quantity larger than the stock is refused and nothing is recorded', async ({ page }) => {
    const { FG, bottle } = fixtures();
    const before = await stockOf(bottle, FG);
    await openSalesScreen(page);
    await pickCustomer(page);
    await form(page).locator('select').nth(0).selectOption({ label: 'E2E Finished Goods Store' });
    await form(page).locator('select').nth(1).selectOption({ label: 'E2E Bottled Water 1.5L (pcs)' });
    await form(page).getByPlaceholder('Qty').fill('99999');
    await form(page).getByPlaceholder('Unit price').fill('2');
    await form(page).getByRole('button', { name: 'Complete Cash Sale' }).click();
    await expect(form(page).locator('.error-box')).toBeVisible();
    expect(await stockOf(bottle, FG)).toBe(before);
  });

  test('a negative price is refused and nothing is recorded', async ({ page }) => {
    const { FG, bottle } = fixtures();
    const before = await stockOf(bottle, FG);
    await openSalesScreen(page);
    await pickCustomer(page);
    await form(page).locator('select').nth(0).selectOption({ label: 'E2E Finished Goods Store' });
    await form(page).locator('select').nth(1).selectOption({ label: 'E2E Bottled Water 1.5L (pcs)' });
    await form(page).getByPlaceholder('Qty').fill('1');
    await form(page).getByPlaceholder('Unit price').fill('-5');
    await form(page).getByRole('button', { name: 'Complete Cash Sale' }).click();
    await expect(form(page).locator('.error-box')).toBeVisible();
    expect(await stockOf(bottle, FG)).toBe(before);
  });

  test('a credit sale is recorded as a customer invoice and the stock goes down', async ({ page }) => {
    const { FG, bottle } = fixtures();
    const before = await stockOf(bottle, FG);
    await openSalesScreen(page);
    await pickCustomer(page);
    await form(page).locator('select').nth(0).selectOption({ label: 'E2E Finished Goods Store' });
    await form(page).locator('select').nth(1).selectOption({ label: 'E2E Bottled Water 1.5L (pcs)' });
    await form(page).getByPlaceholder('Qty').fill('2');
    await form(page).getByPlaceholder('Unit price').fill('3');
    await page.getByLabel('Credit Sale').check();
    await form(page).getByRole('button', { name: 'Record Credit Sale' }).click();
    await expect(page.locator('.success-box')).toContainText(/Customer Invoice .* saved/);
    await expect.poll(() => stockOf(bottle, FG)).toBe(before - 2);
  });
});
