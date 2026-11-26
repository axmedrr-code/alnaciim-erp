// Storekeeper scoping in a real browser (PR #22/#28): each storekeeper sees only the assigned warehouse in Stock Levels —
// no "All warehouses" choice, no other warehouse's rows, no other warehouse's products.
const { test, expect } = require('@playwright/test');
const { state, signIn } = require('../support/helpers');

const CASES = [
  { key: 'store_fg', own: 'fg', other: 'rm', ownProduct: 'bottle', otherProduct: 'preform' },
  { key: 'store_rm', own: 'rm', other: 'fg', ownProduct: 'preform', otherProduct: 'bottle' }
];

for (const c of CASES) {
  test(`${c.key} sees only the own warehouse in Stock Levels`, async ({ page }) => {
    const s = state();
    await signIn(page, c.key);
    await page.locator('aside.sidebar nav').getByRole('link', { name: 'Inventory' }).click();
    await page.locator('.tabs').getByRole('button', { name: 'Stock Levels' }).click();

    const picker = page.locator('.toolbar select').first();
    await expect(picker.locator('option')).toHaveCount(1);
    await expect(picker.locator('option')).toHaveText(s.warehouses[c.own].name);

    const table = page.locator('.card table');
    await expect(table.getByRole('row', { name: new RegExp(s.products[c.ownProduct].name) })).toBeVisible();
    await expect(table.getByText(s.products[c.otherProduct].name)).toHaveCount(0);
    await expect(table.getByText(s.warehouses[c.other].name)).toHaveCount(0);
    const warehouseCells = await table.locator('tbody tr td:nth-child(3)').allInnerTexts();
    expect(warehouseCells.length).toBeGreaterThan(0);
    expect(new Set(warehouseCells.map((t) => t.trim()))).toEqual(new Set([s.warehouses[c.own].name]));
  });
}
