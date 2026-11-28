const { test, expect } = require('@playwright/test');
const { login, loginOk, logout, password, email } = require('../lib/helpers');

test.describe('Sign in, sign out and sessions', () => {
  test('a protected URL sends a signed-out visitor to the login form', async ({ page }) => {
    await page.goto('/finance');
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
  });

  test('a wrong password shows an error and keeps the visitor on the login page', async ({ page }) => {
    await login(page, 'cashier', 'definitely-not-the-password');
    await expect(page.locator('.error')).toContainText(/invalid email or password/i);
    await expect(page).toHaveURL(/\/login/);
    expect(await page.evaluate(() => localStorage.getItem('token'))).toBeNull();
  });

  test('an unknown account gets the same message as a wrong password (no account enumeration)', async ({ page }) => {
    await page.goto('/login');
    await page.locator('input[type="email"]').fill('nobody.at.all@alnaciim.test');
    await page.locator('input[type="password"]').fill('whatever-123');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page.locator('.error')).toContainText(/invalid email or password/i);
  });

  test('signing in shows the app; signing out returns to the login form and clears the session', async ({ page }) => {
    await loginOk(page, 'cashier');
    await expect(page.locator('.user-menu__trigger')).toContainText('E2E Cashier');
    await logout(page);
    expect(await page.evaluate(() => localStorage.getItem('token'))).toBeNull();
    await page.goto('/sales');
    await expect(page).toHaveURL(/\/login/);
  });

  test('opening /login while signed in goes back to the dashboard', async ({ page }) => {
    await loginOk(page, 'cashier');
    await page.goto('/login');
    await expect(page).not.toHaveURL(/\/login/);
  });

  test('a deactivated account cannot sign in', async ({ page }) => {
    const { query } = require('../lib/helpers');
    await query(`update users set is_active=false where email=$1`, [email('de')]);
    try {
      await login(page, 'de');
      await expect(page.locator('.error')).toBeVisible();
      await expect(page).toHaveURL(/\/login/);
    } finally { await query(`update users set is_active=true where email=$1`, [email('de')]); }
  });
});

test.describe('Changing the password', () => {
  test('ends the other sessions, keeps this one, and only the new password works afterwards', async ({ browser }) => {
    const ctxA = await browser.newContext(); const ctxB = await browser.newContext();
    const a = await ctxA.newPage(); const b = await ctxB.newPage();
    await loginOk(a, 'pw');
    await loginOk(b, 'pw');
    await new Promise((r) => setTimeout(r, 1300)); // a token is valid from the second after it was issued

    const next = `New-${Date.now()}-Pw`;
    await a.locator('.user-menu__trigger').click();
    await a.getByRole('button', { name: 'Change password' }).click();
    await a.getByLabel('Current password').fill(password('pw'));
    await a.getByLabel(/New password/).fill(next);
    await a.getByLabel('Repeat the new password').fill(next);
    await a.getByRole('dialog').getByRole('button', { name: 'Change password' }).click();
    await expect(a.getByText(/Your password was changed/)).toBeVisible();

    // this session keeps working
    await a.reload();
    await expect(a).not.toHaveURL(/\/login/);
    await expect(a.locator('.user-menu__trigger')).toBeVisible();

    // the other session is rejected on its next request and sent to the login form
    await b.reload();
    await expect(b).toHaveURL(/\/login/);

    // old password refused, new one accepted
    await login(b, 'pw', password('pw'));
    await expect(b.locator('.error')).toContainText(/invalid email or password/i);
    await login(b, 'pw', next);
    await expect(b).not.toHaveURL(/\/login/);
    await ctxA.close(); await ctxB.close();
  });

  test('a wrong current password shows the message and keeps the session', async ({ page }) => {
    await loginOk(page, 'cashier');
    await page.locator('.user-menu__trigger').click();
    await page.getByRole('button', { name: 'Change password' }).click();
    await page.getByLabel('Current password').fill('wrong-current-password');
    await page.getByLabel(/New password/).fill('Another-Pw-12345');
    await page.getByLabel('Repeat the new password').fill('Another-Pw-12345');
    await page.getByRole('dialog').getByRole('button', { name: 'Change password' }).click();
    await expect(page.getByText('The current password is incorrect')).toBeVisible();
    await page.reload();
    await expect(page).not.toHaveURL(/\/login/);
  });
});
