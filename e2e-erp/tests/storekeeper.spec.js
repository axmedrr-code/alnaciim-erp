const { test, expect } = require('@playwright/test');
const { loginOk, fixtures, stockOf } = require('../lib/helpers');

test.describe('Storekeeper of the Raw Materials store', () => {
  test('Stock Levels shows only the own warehouse and its stock', async ({ page }) => {
    await loginOk(page, 'store');
    await page.goto('/inventory');
    await page.getByRole('button', { name: 'Stock Levels' }).click();
    const select = page.locator('select').first();
    await expect(select.locator('option')).toHaveCount(1); // no "All warehouses", no other warehouse
    await expect(select.locator('option').first()).toHaveText('E2E Raw Materials Store');
    await expect(page.getByText('E2E PET Preform')).toBeVisible();
    await expect(page.getByText('E2E Bottled Water 1.5L')).toHaveCount(0);
  });

  test('the Finished Goods storekeeper sees the finished stock and not the raw materials', async ({ page }) => {
    await loginOk(page, 'store2');
    await page.goto('/inventory');
    await page.getByRole('button', { name: 'Stock Levels' }).click();
    await expect(page.getByText('E2E Bottled Water 1.5L')).toBeVisible();
    await expect(page.getByText('E2E PET Preform')).toHaveCount(0);
  });

  test('records a stock movement in the own warehouse and the stock changes', async ({ page }) => {
    const { RM, preform } = fixtures();
    const before = await stockOf(preform, RM);
    await loginOk(page, 'store');
    await page.goto('/inventory');
    await page.getByRole('button', { name: 'Movements' }).click();
    await page.getByRole('button', { name: '+ Record Movement' }).click();
    const form = page.locator('form.stacked-form');
    await form.locator('select').nth(0).selectOption({ label: 'E2E-PREFORM — E2E PET Preform' });
    await expect(form.locator('select').nth(1).locator('option')).toHaveCount(2); // "Select…" and the own warehouse only
    await expect(form.locator('select').nth(1)).toHaveValue(String(RM)); // pre-filled with the own warehouse
    await form.locator('input[type="number"]').fill('25');
    await form.getByRole('button', { name: 'Save' }).click();
    await expect(form).toHaveCount(0);
    await expect.poll(() => stockOf(preform, RM)).toBe(before + 25);
  });

  test('putting a finished good into the raw-material warehouse is refused with a clear message', async ({ page }) => {
    const { RM, bottle } = fixtures();
    const before = await stockOf(bottle, RM);
    await loginOk(page, 'store');
    await page.goto('/inventory');
    await page.getByRole('button', { name: 'Movements' }).click();
    await page.getByRole('button', { name: '+ Record Movement' }).click();
    const form = page.locator('form.stacked-form');
    await form.locator('select').nth(0).selectOption({ label: 'E2E-BOTTLE — E2E Bottled Water 1.5L' });
    await form.locator('input[type="number"]').fill('5');
    await form.getByRole('button', { name: 'Save' }).click();
    await expect(form.locator('.error-box')).toContainText(/cannot be stored in a raw material warehouse/i);
    expect(await stockOf(bottle, RM)).toBe(before);
  });
});
