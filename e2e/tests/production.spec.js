// Production Orders in a real browser: Start -> Complete panel (BOM preview, labelled fields) -> another Production
// Manager reviews the output in a panel (materials used, reason) and approves it into stock. Also: batches that cannot be
// completed say why up front, the browser prompt is gone, and "Needs action" hides test batches and finished work.
const { test, expect } = require('@playwright/test');
const { state, signIn, stockOf, db } = require('../support/helpers');

async function openOrders(page, who) {
  await signIn(page, who);
  await page.locator('aside.sidebar nav').getByRole('link', { name: 'Production' }).click();
  await page.locator('.grouped-nav__group', { hasText: 'Production Orders' }).click();
  await expect(page.getByRole('button', { name: 'Needs action' })).toBeVisible();
}
const row = (page, batchNo) => page.getByRole('row', { name: new RegExp(batchNo) });

test.describe.configure({ mode: 'serial' });

test('Needs action lists my batches and hides automated-test batches', async ({ page }) => {
  const s = state();
  await openOrders(page, 'prod1');
  await expect(row(page, s.batches.main)).toBeVisible();
  await expect(page.getByRole('cell', { name: /^(TST|E2E)-/ })).toHaveCount(0);
});

test('a batch without an output product, or without a BOM, says why it cannot be completed', async ({ page }) => {
  const s = state();
  await openOrders(page, 'prod1');
  for (const [batchNo, why] of [[s.batches.noProduct, 'no Output Product'], [s.batches.noBom, 'no active Bill of Materials']]) {
    await page.getByPlaceholder(/Search batch/).fill(batchNo);
    const r = row(page, batchNo);
    if (await r.getByRole('button', { name: 'Start' }).count()) await r.getByRole('button', { name: 'Start' }).click();
    await r.getByRole('button', { name: 'Complete…' }).click();
    const panel = page.getByRole('dialog', { name: 'Complete batch' });
    await expect(panel.getByRole('alert')).toContainText(why);
    await expect(panel.getByRole('button', { name: 'Complete batch' })).toBeDisabled();
    await panel.getByRole('button', { name: 'Cancel' }).click();
  }
});

test('complete with the panel: BOM preview, materials deducted, output waits for another manager', async ({ page }) => {
  const s = state();
  const rmBefore = await stockOf(s.products.preform.id, s.warehouses.rm.id);
  const fgBefore = await stockOf(s.products.bottle.id, s.warehouses.fg.id);
  let dialogs = 0; page.on('dialog', (d) => { dialogs++; d.dismiss(); });
  await openOrders(page, 'prod1');
  await page.getByPlaceholder(/Search batch/).fill(s.batches.main);
  await row(page, s.batches.main).getByRole('button', { name: 'Start' }).click();
  await row(page, s.batches.main).getByRole('button', { name: 'Complete…' }).click();
  const panel = page.getByRole('dialog', { name: 'Complete batch' });
  await panel.getByLabel(/Actual quantity produced/).fill('18');
  await panel.getByLabel(/^Wastage \(/).fill('2');
  await panel.getByLabel('Wastage reason').fill('two bottles cracked at the filler');
  await expect(panel.getByLabel(/different from the plan/)).toBeVisible(); // 18 vs planned 20
  await panel.getByLabel(/different from the plan/).fill('short of preforms at the end of shift');
  // materials warehouse and QC are required, with a clear message
  await panel.getByRole('button', { name: 'Complete batch' }).click();
  await expect(panel.getByRole('alert')).toContainText('raw-material warehouse');
  await panel.getByLabel('Materials taken from').selectOption({ label: s.warehouses.rm.name });
  await expect(panel.getByRole('table', { name: 'Materials to deduct' })).toContainText('20 pcs'); // 1 per unit x (18 + 2)
  await panel.getByLabel('Passed').check();
  await panel.getByRole('button', { name: 'Complete batch' }).click();
  await expect(page.locator('.success-box')).toContainText('waits for another Production Manager');

  expect(await stockOf(s.products.preform.id, s.warehouses.rm.id)).toBe(rmBefore - 20);
  expect(await stockOf(s.products.bottle.id, s.warehouses.fg.id)).toBe(fgBefore);
  await page.getByRole('button', { name: 'All batches' }).click();
  await page.getByPlaceholder(/Search batch/).fill(s.batches.main);
  await expect(row(page, s.batches.main)).toContainText('Awaiting approval');
  await expect(row(page, s.batches.main)).toContainText('Waiting for another manager');
  expect(dialogs).toBe(0); // no browser prompt anywhere
});

test('another manager reviews the output in a panel and approves it into stock', async ({ page }) => {
  const s = state();
  const fgBefore = await stockOf(s.products.bottle.id, s.warehouses.fg.id);
  let dialogs = 0; page.on('dialog', (d) => { dialogs++; d.dismiss(); });
  await openOrders(page, 'prod2');
  await page.getByPlaceholder(/Search batch/).fill(s.batches.main);
  await row(page, s.batches.main).getByRole('button', { name: 'Review output…' }).click();
  const panel = page.getByRole('dialog', { name: 'Review output' });
  await expect(panel).toContainText('18 pcs');
  await expect(panel).toContainText('two bottles cracked');
  await expect(panel).toContainText('E2E UI prod1'); // completed by
  await expect(panel.getByRole('table', { name: 'Materials used' })).toContainText(s.products.preform.name);
  await panel.getByRole('button', { name: 'Approve into stock' }).click();
  await expect(panel.getByRole('alert')).toContainText('at least 3 characters');
  await panel.getByLabel('Reason (required)').fill('counted 18 on the pallet, QC sheet signed');
  await panel.getByRole('button', { name: 'Approve into stock' }).click();
  await expect(page.locator('.success-box')).toContainText('approved: 18 pcs added');

  expect(await stockOf(s.products.bottle.id, s.warehouses.fg.id)).toBe(fgBefore + 18);
  const [b] = await db('select output_approval_status, output_decision_reason from production_batches where batch_number=$1', [s.batches.main]);
  expect(b.output_approval_status).toBe('approved');
  expect(b.output_decision_reason).toBe('counted 18 on the pallet, QC sheet signed');
  expect(dialogs).toBe(0);
});
