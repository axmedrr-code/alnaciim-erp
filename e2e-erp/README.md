# Real-browser end-to-end tests (Playwright)

These tests drive the **real ERP in a real browser** (the Microsoft Edge that is already installed, through Playwright's `msedge`
channel, so no browser is downloaded). They sign in through the actual login form, click through the actual pages and check the
result in the database.

## What runs

`npm test` starts a **local** stack and tears it down again:

| Part | How | Notes |
|---|---|---|
| Backend | `node src/index.js` on `:4000` | throwaway JWT secret, scheduled backups disabled |
| Frontend | `npm run dev` (Vite) on `:5173` | proxies `/api` to the local backend |
| Database | the isolated **test** database | Neon TEST or a local test database |

Nothing here touches production, Railway, Render or Vercel.

## Run it

```powershell
$env:TEST_DATABASE_URL = '<Neon TEST or local test database URL>'
$env:TEST_DATABASE_EXPECT_HOST = '<its host name>'   # pins the target; must equal the URL's host
$env:TEST_DATABASE_SSL = 'true'                      # for Neon
cd e2e-erp
npm install
npm test            # all specs, one after another
npx playwright test tests/auth.spec.js      # one file
npx playwright show-report                  # HTML report (screenshots and traces of failures)
```

`lib/guard.js` refuses to run unless the database host is `localhost` or `*.neon.tech`, is not Railway, and equals
`TEST_DATABASE_EXPECT_HOST`. It never reads `DATABASE_URL`.
Ports 4000 and 5173 must be free (stop any dev servers first).
This suite sits beside the older `e2e/` suite (different users, `e2e.<key>`; different data): both use ports 4000 and 5173, so run them one after the other.

## Test data and passwords

`global-setup.js` creates (or resets) users `e2e.<key>@alnaciim.test` and an isolated department, two warehouses, two products and
a customer, all marked `E2E`. Every user gets a **random password that lives only in the test process' environment**: it is never
printed or written to disk. `global-teardown.js` deactivates the accounts afterwards. The real UAT accounts and departments are
never touched.

## What is covered

| Spec | Flow |
|---|---|
| `auth.spec.js` | login/logout, wrong password and unknown account (same message), deactivated account, `/login` while signed in, **password change ends the other sessions and keeps this one** |
| `access.spec.js` | for 7 roles: the menu equals the policy; every page opens or shows "You do not have access"; unknown URL; the API refuses what the menu hides |
| `storekeeper.spec.js` | Raw-Materials storekeeper sees only the own warehouse; records a movement (stock changes); a finished good into the RM warehouse is refused |
| `cashier-sale.spec.js` | Cashier has no Reports tab; cash sale (invoice saved, stock down); too-large quantity and negative price refused; credit sale |
| `emergency-request.spec.js` | storekeeper raises an **emergency** request (reason and date required) → Department Head approves → Operation Manager approves and signs → storekeeper sees both signatures |

## Limits

Only Edge (Chromium) is used. The suite checks the main flows of five roles; it is not a replacement for the staff UAT in
`docs/UAT_PLAN.md`. Tests leave their E2E data in the test database (each run uses unique request titles).
