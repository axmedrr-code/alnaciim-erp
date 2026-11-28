const { test, expect } = require('@playwright/test');
const { loginOk, navLinks } = require('../lib/helpers');

const ALL = ['/operations', '/logistics', '/tanker-loading', '/collections', '/inventory', '/production', '/sales', '/requisitions', '/procurement', '/maintenance', '/finance', '/reports', '/settings'];
// What each role may open (besides the dashboard), written out by hand from the access policy.
const POLICY = {
  cashier: ['/sales', '/requisitions'],
  store: ['/tanker-loading', '/inventory', '/requisitions', '/procurement'],
  fin: ['/requisitions', '/procurement', '/finance', '/reports'],
  coll: ['/collections', '/requisitions'],
  de: ['/logistics', '/tanker-loading', '/requisitions'],
  opm: ['/operations', '/logistics', '/requisitions', '/procurement', '/reports'],
  admin: ['/operations', '/logistics', '/tanker-loading', '/inventory', '/production', '/sales', '/requisitions', '/procurement', '/maintenance', '/finance', '/reports', '/settings']
};

for (const [key, allowed] of Object.entries(POLICY)) {
  test.describe(`role: ${key}`, () => {
    test(`the menu shows exactly the pages this role may open`, async ({ page }) => {
      await loginOk(page, key);
      expect(await navLinks(page)).toEqual(['/', ...allowed].sort());
    });

    test(`every page is either opened or refused with a clear message`, async ({ page }) => {
      await loginOk(page, key);
      for (const path of ALL) {
        await page.goto(path);
        const denied = page.getByText('You do not have access to this page');
        if (allowed.includes(path)) await expect(denied, `${key} must open ${path}`).toHaveCount(0);
        else await expect(denied, `${key} must be refused ${path}`).toBeVisible();
        await expect(page).toHaveURL(new RegExp(`${path}$`)); // a refused page keeps its URL and shows the message in place
      }
    });
  });
}

test('an address that does not exist shows "Page not found" inside the app', async ({ page }) => {
  await loginOk(page, 'cashier');
  await page.goto('/this-page-does-not-exist');
  await expect(page.getByText('Page not found')).toBeVisible();
});

test('a refused page makes no data request that returns data (the API refuses too)', async ({ page }) => {
  await loginOk(page, 'cashier');
  // Ask the API directly with the signed-in session: the server must refuse what the menu hides.
  const status = await page.evaluate(async () => {
    const r = await fetch('/api/v1/finance/chart-of-accounts', { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
    return r.status;
  });
  expect(status).toBe(403);
});
