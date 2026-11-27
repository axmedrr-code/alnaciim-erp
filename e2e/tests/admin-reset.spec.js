// Admin password reset in a real browser (Settings -> Users): offered only for non-Admin accounts, enforces the policy,
// never shows the password after submit, really changes the password, and is audited without the password.
const crypto = require('crypto');
const { test, expect } = require('@playwright/test');
const { state, signIn, db } = require('../support/helpers');

const fresh = () => `Rv-${crypto.randomBytes(9).toString('hex')}`; // random per run, never printed

async function openUsers(page) {
  await signIn(page, 'admin');
  await page.locator('aside.sidebar nav').getByRole('link', { name: 'Settings' }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole('button', { name: '+ New User' })).toBeVisible();
  await expect(page.getByRole('cell', { name: state().users.reset_target.email, exact: true })).toBeVisible();
}

test('the reset is offered for non-Admin users only, never for my own or another Admin account', async ({ page }) => {
  const s = state();
  await openUsers(page);
  await expect(page.getByRole('button', { name: `Reset password for ${s.users.reset_target.email}` })).toBeVisible();
  await expect(page.getByRole('button', { name: `Reset password for ${s.users.admin.email}` })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Reset password for admin@alnaciim.com' })).toHaveCount(0);
});

test('a weak password is refused by the server and nothing changes', async ({ page }) => {
  const s = state();
  const [before] = await db('select password_hash from users where id=$1', [s.users.reset_target.id]);
  await openUsers(page);
  await page.getByRole('button', { name: `Reset password for ${s.users.reset_target.email}` }).click();
  const dialog = page.getByRole('dialog', { name: 'Reset password' });
  await dialog.getByLabel(/New password/).fill('Password-2026-ok');
  await dialog.getByLabel('Repeat the new password').fill('Password-2026-ok');
  await dialog.getByRole('button', { name: 'Reset password' }).click();
  await expect(dialog.locator('.error-box')).toContainText('too common');
  await expect(dialog.getByLabel(/New password/)).toHaveValue('');
  const [after] = await db('select password_hash from users where id=$1', [s.users.reset_target.id]);
  expect(after.password_hash).toBe(before.password_hash);
});

test('Admin resets a password: the new one works, the old one stops, the page never shows it, the reset is audited', async ({ page, browser }) => {
  const s = state();
  const target = s.users.reset_target;
  const next = fresh();
  const [{ n: auditBefore }] = await db(`select count(*)::int n from audit_logs where entity_type='user_password' and entity_id=$1`, [target.id]);

  await openUsers(page);
  await page.getByRole('button', { name: `Reset password for ${target.email}` }).click();
  const dialog = page.getByRole('dialog', { name: 'Reset password' });
  await dialog.getByLabel(/New password/).fill(next);
  await dialog.getByLabel('Repeat the new password').fill(next);
  await dialog.getByRole('button', { name: 'Reset password' }).click();
  await expect(dialog.getByRole('status')).toContainText('The password was reset');
  expect(await page.content()).not.toContain(next);

  const [audit] = await db(`select user_id, entity_id, created_at, new_value::text t from audit_logs where entity_type='user_password' and entity_id=$1 order by id desc limit 1`, [target.id]);
  const [{ n: auditAfter }] = await db(`select count(*)::int n from audit_logs where entity_type='user_password' and entity_id=$1`, [target.id]);
  expect(auditAfter).toBe(auditBefore + 1);
  expect(Number(audit.user_id)).toBe(s.users.admin.id);
  expect(audit.created_at).toBeTruthy();
  expect(audit.t).not.toContain(next);
  expect(audit.t).not.toContain('$2');

  // The target signs in in a separate browser context: the old password fails, the new one works.
  const ctx = await browser.newContext();
  const other = await ctx.newPage();
  await other.goto('/login');
  await other.getByLabel('Email').fill(target.email);
  await other.getByLabel('Password').fill(s.password);
  await other.getByRole('button', { name: 'Sign in' }).click();
  await expect(other.locator('.login-card .error')).toBeVisible();
  await other.getByLabel('Password').fill(next);
  await other.getByRole('button', { name: 'Sign in' }).click();
  await expect(other.locator('aside.sidebar nav')).toBeVisible();
  await ctx.close();
});
