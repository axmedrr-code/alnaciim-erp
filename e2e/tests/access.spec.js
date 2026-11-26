// UAT A1/A2 in a real browser: each role signs in through the login form, sees exactly its menu, is stopped at forbidden
// and unknown URLs, and signing out really ends the session. Expected menus are written out here, independently of
// frontend/src/utils/routeAccess.js, so a change there that widens a role's access fails this suite.
const { test, expect } = require('@playwright/test');
const { state, signIn, sidebarLabels } = require('../support/helpers');

const ROLES = [
  { key: 'cashier', menu: ['Dashboard', 'Sales & Distribution', 'Requisitions'], forbidden: ['/finance', '/inventory', '/collections', '/settings', '/reports'] },
  { key: 'store_fg', menu: ['Dashboard', 'Tanker Loading', 'Inventory', 'Requisitions', 'Procurement'], forbidden: ['/sales', '/finance', '/collections', '/settings', '/reports'] },
  { key: 'collector', menu: ['Dashboard', 'Collections', 'Requisitions'], forbidden: ['/sales', '/inventory', '/finance', '/settings', '/reports'] }
];

test('a wrong password is refused on the login form', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill(state().users.cashier.email);
  await page.getByLabel('Password').fill('definitely-not-the-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('.login-card .error')).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});

test('signed out, every page sends you to the login form', async ({ page }) => {
  for (const p of ['/', '/sales', '/inventory', '/collections']) {
    await page.goto(p);
    await expect(page).toHaveURL(/\/login$/);
  }
});

for (const role of ROLES) {
  test.describe(role.key, () => {
    test.beforeEach(async ({ page }) => { await signIn(page, role.key); });

    test('sees exactly its own menu', async ({ page }) => {
      expect(await sidebarLabels(page)).toEqual(role.menu);
    });

    test('forbidden URLs show the access message and no page content', async ({ page }) => {
      for (const p of role.forbidden) {
        await page.goto(p);
        await expect(page.getByRole('alert').getByText('You do not have access to this page'), p).toBeVisible();
        await expect(page.locator('.page-header'), p).toHaveCount(0);
      }
    });

    test('an unknown URL shows Page not found; /login sends a signed-in user home', async ({ page }) => {
      await page.goto('/no-such-page-' + Date.now());
      await expect(page.getByText('Page not found')).toBeVisible();
      await page.goto('/login');
      await expect(page).toHaveURL(/\/$/);
    });

    test('logging out ends the session', async ({ page }) => {
      await page.locator('.user-menu__trigger').click();
      await page.getByRole('button', { name: 'Log out' }).click();
      await expect(page).toHaveURL(/\/login$/);
      await page.goto(role.menu.includes('Inventory') ? '/inventory' : role.menu.includes('Collections') ? '/collections' : '/sales');
      await expect(page).toHaveURL(/\/login$/);
      expect(await page.evaluate(() => localStorage.getItem('token'))).toBeNull();
    });
  });
}
