# Browser end-to-end tests (Playwright)

Real Chromium against the real ERP frontend and the real backend, on an isolated test database. No mocked API.
This closes the gap noted in `docs/QA_REVIEW_FINAL_2026-11-26.md` section 6 #1 / section 9 #3 for the Cashier,
Storekeeper and Collector flows.

> **Soo koobid:** Imtixaannadan waxay ku socdaan browser dhab ah (Chromium), frontend-ka ERP iyo backend-ka dhabta ah,
> database tijaabo ah oo go'doonsan. API been-abuur ah (mock) ma jiro.

## Run

```bash
cd backend  && npm ci        # the suite starts the real backend from here
cd ../frontend && npm ci     # and the ERP Vite dev server from here
cd ../e2e   && npm ci && npx playwright install chromium
TEST_DATABASE_URL=postgres://...test... npm test
```

The safety guard is the same as `backend/tests/e2e/harness.js`: `TEST_DATABASE_URL` must be localhost or Neon and the
database name must have a `test` part (or pin the host with `TEST_DATABASE_EXPECT_HOST`). `DATABASE_URL` is never read.
Set `TEST_DATABASE_SSL=true` for Neon. Ports: `E2E_API_PORT` (5590), `E2E_ERP_PORT` (5273). `E2E_SERVER_LOG=1` shows server logs.

## What the run does

1. Starts the backend with a throwaway JWT secret and the ERP dev server (its `/api` proxy points at that backend via `E2E_API_TARGET`).
2. Creates or refreshes `pwui.{admin,cashier,store_fg,store_rm,collector,reset_target}@alnaciim.test` with a **random per-run password**
   (never printed; kept only in `e2e/.state/state.json`, mode 0600, git-ignored). `pwui.admin` only seeds fixtures through the API.
3. Seeds warehouses `TST-PWUI-FG` / `TST-PWUI-RM`, two products, stock (through the API, so the ledger stays signed), a cash
   customer and a debtor with a $20.00 bottled-water credit invoice.
4. Teardown stops the servers, gives every `pwui.*` account a new random hash and deactivates it. Fixture data is kept, not deleted.

## Coverage (25 tests)

| Spec | Checks |
|---|---|
| `access` | wrong password refused; signed-out redirect; for Cashier, Storekeeper, Collector: exact menu, forbidden URLs show the access message, unknown URL shows Page not found, `/login` redirect, logout clears the session |
| `cashier` | only Retail Sales & Billing; Bottled Water / Ice only; no Reports tab; cash sale through the form saved as paid, stock reduced by exactly the sold quantity in the database, listed in Sales List; no sale without a customer |
| `storekeeper` | FG and RM storekeepers each see only their own warehouse (one picker option, only own rows and products) |
| `admin-reset` | Settings → Users: reset offered only for non-Admin accounts (not own, not other Admins); a common password refused with nothing changed; a reset through the dialog never shows the password, is audited (who, whose, when, no password) and the old password stops working while the new one signs in |
| `collector` | no Employee Performance tab; partial then full payment through Receive Payment, balance on screen and Accounts Receivable (1100) in the ledger follow; zero amount refused |

Mutation-checked: Cashier given `/finance`, Storekeeper picker unscoped, Cashier shown every sales group, Cashier shown the
Reports tab, logout keeping the token: each makes the matching tests fail. (Removing only the client-side zero-amount check
does not: the backend refuses it too, which is the outcome the test asserts.)
