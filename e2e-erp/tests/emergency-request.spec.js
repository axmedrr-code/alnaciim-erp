const { test, expect } = require('@playwright/test');
const { loginOk, logout } = require('../lib/helpers');

// One purchase request walked through three people in the real UI: the Raw-Materials storekeeper raises an EMERGENCY request,
// the Department Head reviews it, the Operation Manager approves and signs it, and the storekeeper follows it to the end.
test.describe.configure({ mode: 'serial' });

const title = `E2E emergency: PET preform shortage ${Date.now()}`;
const justification = 'PET preform stock runs out in two days and the bottling line would stop.';

async function newRequisition(page, { priority, text, date }) {
  await page.goto('/requisitions');
  await page.getByRole('button', { name: /New requisition/ }).click();
  const card = page.locator('.card').filter({ hasText: 'New Purchase Requisition' });
  await card.locator('.form-field', { hasText: 'Title' }).locator('input').fill(title);
  await card.locator('.form-field', { hasText: 'Priority' }).locator('select').selectOption(priority);
  if (date) await card.locator('input[type="date"]').fill(date);
  await card.locator('textarea').fill(text);
  const row = card.locator('tbody tr').first();
  await row.locator('input').nth(0).fill('PET Preform 12g');
  await row.locator('input').nth(2).fill('500');
  await row.locator('input').nth(3).fill('pcs');
  await row.locator('input').nth(4).fill('0.2');
  return card;
}
// The title is unique per run (it carries a timestamp), so matching it exactly never picks up a request left by an earlier run.
const exactTitle = () => new RegExp(title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
const openByTitle = async (page, filter) => {
  await page.goto('/requisitions');
  if (filter) await page.getByRole('button', { name: filter }).click();
  await page.getByRole('row', { name: exactTitle() }).click();
};

test('an emergency request needs a real reason and a required-by date', async ({ page }) => {
  await loginOk(page, 'store');
  let card = await newRequisition(page, { priority: 'emergency', text: 'too short', date: '2026-12-15' });
  await card.getByRole('button', { name: /Submit for review/ }).click();
  await expect(card.locator('.error-box')).toContainText(/justification/i);
  card = await newRequisition(page, { priority: 'emergency', text: justification, date: '' });
  await card.getByRole('button', { name: /Submit for review/ }).click();
  await expect(card.locator('.error-box')).toContainText(/required-by date/i);
});

test('the Raw-Materials storekeeper raises the emergency request and it waits for the Department Head', async ({ page }) => {
  await loginOk(page, 'store');
  const card = await newRequisition(page, { priority: 'emergency', text: justification, date: '2026-12-15' });
  await card.getByRole('button', { name: /Submit for review/ }).click();
  await expect(page.getByRole('heading', { name: exactTitle() })).toBeVisible();
  await expect(page.getByText('Waiting for Department Head')).toBeVisible();
  await expect(page.locator('.form-field', { hasText: 'Priority' }).locator('span')).toHaveText('emergency');
});

test('the requester cannot approve his own request', async ({ page }) => {
  await loginOk(page, 'store');
  await openByTitle(page, 'My requests');
  await expect(page.getByRole('button', { name: /Approve/ })).toHaveCount(0);
});

test('the Department Head sees it under "Needs my action", highlighted, and approves it', async ({ page }) => {
  await loginOk(page, 'head');
  await page.goto('/requisitions');
  const row = page.getByRole('row', { name: exactTitle() });
  await expect(row).toBeVisible();
  const priorityCell = row.locator('td').nth(4); // PR, Title, Department, Requested by, Priority
  await expect(priorityCell).toHaveText('emergency');
  await expect(priorityCell).toHaveCSS('color', 'rgb(185, 28, 28)'); // shown in red
  await row.click();
  await page.locator('textarea').fill('Emergency confirmed: the line cannot stop.');
  await page.getByRole('button', { name: /^Approve/ }).click();
  await expect(page.getByText('Waiting for Operation Manager')).toBeVisible();
  await expect(page.locator('h4', { hasText: 'Approval history' }).locator('xpath=following-sibling::table[1]').locator('tbody tr')).toHaveCount(2); // the submission and the department review
});

test('the Operation Manager sees the emergency on the overview and approves and signs it', async ({ page }) => {
  await loginOk(page, 'opm');
  await page.goto('/operations');
  await expect(page.getByText(title).first()).toBeVisible();
  await openByTitle(page);
  await page.locator('textarea').fill('Approved urgently.');
  await page.getByRole('button', { name: /Approve & sign/ }).click();
  await expect(page.locator('.form-field', { hasText: 'Status' }).locator('.badge')).toHaveText('Approved');
});

test('the storekeeper follows it: approved, with both signatures in the approval history', async ({ page }) => {
  await loginOk(page, 'store');
  await openByTitle(page, 'My requests');
  await expect(page.locator('.form-field', { hasText: 'Status' }).locator('.badge')).toHaveText('Approved');
  const history = page.locator('h4', { hasText: 'Approval history' }).locator('xpath=following-sibling::table[1]');
  await expect(history.locator('tbody tr')).toHaveCount(3); // submitted, reviewed, approved
  await expect(history).toContainText('Department Head');
  await expect(history).toContainText('Operation Manager');
  await expect(history.locator('code').first()).toContainText('…'); // signature hash shown
  await logout(page);
});
