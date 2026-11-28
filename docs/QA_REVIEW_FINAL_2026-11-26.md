# Al-Naciim ERP — Final QA review report

**Date:** 2026-11-26 · **Code reviewed:** `main` @ `48c0835` (PR #28 merged) · **Environment:** TEST only (Neon TEST, Render `alnaciim-erp-test-api`, Vercel `alnaciim-erp-test`, POS `alnaciim-pos-test`) · **Production, Railway, Odoo, WMS, NUWACO and GEEDSAN were not touched.**

> **Update (same day, after the review):** security items S1 (`react-router`) and S2 (token invalidation) are **closed** (PR #30, #31, deployed to TEST), and the UI route-guard / not-found / login-redirect gaps found in the browser check are fixed (UI guard PR #32). **Automatic UI tests now exist** for the ERP frontend and the POS (PR #34), and a **real-browser Playwright suite (39 tests, PR #39)** that found and fixed two more defects (PR #38, #40). Sections 1-9 below are updated accordingly; the 1,312 E2E + 53 unit figures are the backend results of the review itself.

> **Soo koobid (Somali):** Dib-u-eegista tayada buuxda waa dhammaatay. **1,312 tijaabo E2E + 53 unit: dhammaantood PASS, 0 fashil** (suite kasta mid-mid ayaa loo socodsiiyay Neon TEST). Dib-u-eegistu waxay heshay oo sixday saddex cilad oo badeeco ah (audit-ka dhexe, GRN/issue ee Storekeeper aan xaddidnayn, kala-saarida RM/FG) iyo laba cilad oo tijaabo ah. **TEST waa diyaar UAT-ga dadka dhabta ah. Production MA DIYAAR AH.**

## 1. Verdict

| | Status |
|---|---|
| TEST environment ready for staff UAT | **Yes** |
| Production ready | **No** (blockers in section 7) |
| Automated tests | **1,312 E2E + 53 unit PASS, 0 FAIL** |
| Browser UAT by real staff | **Not started** (cannot be done by the assistant) |
| Frontend / POS automated tests | **180 PASS** (ERP 174 + POS 6, jsdom with a mocked API; PR #34, later PRs #38, #40 and the production-batch work add to the ERP count) |
| Real-browser E2E (Playwright, Edge) | **39/39 PASS** in `e2e-erp/` (two earlier runs and the final run after the fixes); a second suite lives in `e2e/` (PR #36, see its README) |

## 2. Completed features (as of this review)

All modules of the original mandate are implemented and covered by tests: Procurement (requisition → Department Head → Operation Manager (signed) → assignment → quotations/comparison → PO + authorization → GRN with accepted/damaged/rejected → material issue + department confirmation/dispute → supplier invoice 3-way match → payment approval → voucher), Production (BOM, batches, consumption, wastage, QC, independent output approval, reversals, downtime, machine costing), Inventory and Warehouse (movements, transfers, stock counts with independent approval, signed ledger), Logistics (tanker loading/reconciliation, route operations, incidents), Sales/Billing/Collections/Quotations, Retail POS, Finance (journals, bank/cash, expenses, budgets, fiscal-year close, reports), Maintenance, Users/roles, Audit, Backups, Operation Manager dashboard.

Delivered since the completion report:

| PR | What |
|---|---|
| #21 | Retail **Reports tab hidden from roles without access** (Cashier was stuck on "Loading…"); report errors are now shown |
| #22 | **Storekeeper GRN and material issue limited to the assigned warehouse** (found by the workflow suite) |
| #23/#24 | **UAT role-by-role workflow E2E** (one account per UAT role) + UAT plan B13/B14 corrected |
| #25 | **Procurement events now also written to the central audit log** (root cause of the failing B15) |
| #26 | **Raw-material / finished-goods / spare-part warehouse separation** enforced for every stock inflow |
| #27 | route-operations test isolation (test only) |
| #30 | **Password change or reset ends every earlier session** (`users.password_changed_at`, migration 040; `change-password` returns a fresh token) |
| #31 | **react-router-dom 6.26 → 7.18.7** in the ERP frontend and the POS (`npm audit` 0 vulnerabilities) |
| UI guard PR | **Role guard on every ERP route** (one shared table `utils/routeAccess.js` drives both the menu and the guard), a **Page not found** page, signed-in users are redirected away from `/login`; POS unknown URLs redirect |
| #28 | **RM storekeeper sees only own warehouse** (API + UI) and new **EMERGENCY** request priority (needs justification ≥ 20 chars and a required-by date; does **not** bypass approvals; sorted first for the Operation Manager) |

21 UAT accounts (`uat.<key>@alnaciim.test`) with data are ready on TEST; passwords were issued one by one through the clipboard only.

## 3. Review checklist (the 8 requested checks)

| # | Check | Result |
|---|---|---|
| 1 | Fix the failing B15 audit assertion from the root cause | **Done.** Root cause: procurement wrote only to `procurement_audit_logs`; the Admin Audit Log reads `audit_logs`, so no requisition/PO/issue/invoice/payment event was visible there. `audit()` now writes both in one transaction. B15 asserts the **central** log (requisition, PO, invoice, payment, issue) and the append-only triggers on both tables. The assertion was restored to the central log, not weakened. |
| 2 | Procurement PR → approval → PO → … | **PASS** (74 + 57 + 32 + 25 + workflow suite). The real order is PR → approvals → PO → **GRN → supplier invoice** (the 3-way match needs the GRN first). Includes over-receipt, damaged/rejected, dispute, duplicate invoice, segregation of duties. |
| 3 | Raw-material / finished-goods separation | **Defect found and fixed** (see 5.3). New suite 20/20; 9 of its checks fail without the fix. |
| 4 | Storekeeper permissions and inventory controls | **PASS** after two fixes (5.2 and #28). Writes, counts, transfers, GRN, issue and reads are all limited to the assigned warehouse. |
| 5 | Production consumption, output, wastage, approval | **PASS** (64 + workflow). BOM consumption = BOM × (actual + wastage); finished goods only after independent approval; reject/reverse returns materials; failed QC adds nothing; over-consumption refused. |
| 6 | Audit logs and user permissions | **PASS** after fix #25. 21 accounts × 149 GET routes: 0 server errors, 0 unexpected 401; allowed routes 200, others 403. Audit tables are append-only (trigger-enforced). |
| 7 | Run backend, frontend, POS tests | Backend: below. **Frontend/POS: no test suites existed during the review (build only); they were added right after: ERP 156/156 and POS 6/6, mutation-checked (section 4b).** |
| 8 | End-to-end UAT | **Partial.** API-level UAT (workflow suite, 153 checks) done. **Browser UAT by staff per `docs/UAT_PLAN.md` has not started.** |

## 4. Test results (final code, each suite run alone against Neon TEST)

| Suite | Result | Suite | Result |
|---|---|---|---|
| Unit (`npm run test:unit`) | 53/53 | Billing | 64/64 |
| Procurement phase 1 | 74/74 | Retail POS | 57/57 |
| Procurement phase 2 | 57/57 | Quotations | 44/44 |
| Procurement phase 3 | 32/32 | Machine costing | 33/33 |
| Procurement phase 5 | 25/25 | Users | 69/69 |
| Inventory | 44/44 | Qaade / customers | 68/68 |
| Production | 64/64 | Master data | 122/122 |
| Logistics | 72/72 | Tanks + maintenance | 79/79 |
| Route operations | 99/99 | Warehouse separation | 20/20 |
| Finance | 77/77 | **UAT role workflows** | **153/153** |
| Backups (local throwaway DB) | 42/42 + 17/17 | | |

**Total: 1,312 E2E + 53 unit PASS, 0 FAIL.** (An earlier message said 1,314; the correct sum is 1,312.)

### 4b. Frontend and POS tests (added after the review, PR #34)

Vitest 2 + Testing Library + jsdom, run with `npm test` in `frontend/` and `pos/`. jsdom with a mocked API: they do **not** replace browser end-to-end tests and do not check page contents (pages are stubbed in the routing tests).

| App | Result | Covers |
|---|---|---|
| ERP frontend | **156/156** | role-access table for 16 roles × 14 pages written out independently of the code; the whole `App` for 8 roles × 14 pages (page / access message / not found), signed-out and `/login` redirects, sidebar equals the allowed pages; Cashier has no Reports tab; Storekeeper sees only the own warehouse in Stock Levels; change-password stores the fresh token; API client 401/403 session handling |
| POS | **6/6** | signed-out redirects, signed-in home/import/unknown URL, `/login` redirect, logout |

### 4c. Real-browser end-to-end tests (Playwright, added after section 4b)

`e2e-erp/` (PR #39) drives the real ERP in Edge: sign-in through the login form, the menu and every page for 7 roles, the Raw-Materials storekeeper, cashier cash/credit sales, and an emergency purchase request through the storekeeper, Department Head and Operation Manager. 39 tests, local backend + Vite on Neon TEST, random passwords kept in process memory, a guard that refuses any database that is not localhost or Neon. `e2e/` (PR #36, other work) is a separate suite with its own users (`pwui.*`); both use ports 4000/5173, so run them one after the other.

It found **two real defects** that the jsdom tests could not see, both fixed and deployed to TEST:

| Defect | Effect | Fix |
|---|---|---|
| A request sent while a password change is in flight got 401 and logged the user out although the change returns a fresh token | User thrown to the login page right after changing the password | PR #38: a 401 waits for an in-flight change and a request with an out-of-date token is retried once; a really ended session still goes to `/login` (3 unit tests, 2 fail on the old client) |
| `useApi` let a slower earlier answer overwrite a newer one | Switching "Needs my action" → "My requests" could show "Nothing here yet" although the request existed (any page using the hook) | PR #40: only the newest request writes (3 unit tests, 2 fail on the old hook) |

Final run after both fixes: **39/39 PASS** (3.3 min). Limits: Edge only, 5-7 roles, local stack against TEST; it does not replace the staff UAT in `docs/UAT_PLAN.md`.

Mutation-checked: each protected behavior (Cashier Reports, route guard, Storekeeper scope, fresh token, 401 exception, POS catch-all and login redirect) was broken on purpose and its tests failed; the code was then restored. Both `vite build` pass; `npm audit --omit=dev` is 0 for both.

### Failures met during the review and how each was resolved (none bypassed)

| Failure | Nature | Resolution |
|---|---|---|
| B15: no requisition/PO events in `audit_logs` | **Product defect** | Fixed in the product (#25) |
| B10: storekeeper of another warehouse could receive/issue | **Product defect (S2)** | Fixed (#22) |
| 9 warehouse-separation checks fail without the fix | **Product defect** (also visible in data) | Fixed (#26); suite proves it |
| Unit `stockLedger`: "Unexpected query" | Test fixture did not know the new type lookup | Fixture updated and 3 tests added for the rule; no assertion removed |
| route-operations: 12+ checks failed ("driver already assigned") | **Test isolation:** the suite's persistent drivers kept draft routes dated today; the (correct) double-booking rule rejected them | The suite cancels its own stale draft routes **through the API** before planning (#27). 99/99 on three consecutive runs |

### Disclosures (so nothing is hidden)

- The route-operations suite now changes the status of its **own** leftover `rop.*` draft routes to cancelled (via the API, audited). No other TEST data was reset or deleted.
- Migration 039 (`emergency` priority) was applied to Neon TEST **before** PR #28 was merged (additive CHECK relaxation).
- PR #28 was merged and deployed at your request **before** its full regression had finished; the regression then completed with all suites PASS.
- Assertions changed on purpose: the old note "stock levels readable for all warehouses" in the workflow suite was replaced by scoping assertions once the behavior changed; one retail-credit fixture used a customer limit of 0, which means "no limit", so the fixture (not the assertion) was changed to 50.

## 5. Defects found and fixed in this review

1. **Central audit log was missing all procurement events** — fixed (#25).
2. **Storekeeper could post GRN/issue outside the assigned warehouse** — fixed (#22).
3. **Raw materials, finished goods and spare parts could be stored in the wrong kind of warehouse** (only production was checked; TEST already held finished goods in a raw-material warehouse and raw materials in general warehouses) — fixed (#26). Rule: inflows only; `general` warehouses unrestricted; outflows never blocked so legacy stock can be corrected.
4. **Storekeepers could read every warehouse's stock/movements** — fixed (#28).
5. **UAT plan B13/B14 wrong roles** (Procurement cannot register supplier invoices; Finance registers, Admin approves, Operation Manager approves payment) — corrected.
6. **Cashier saw a Reports tab that returns 403** (endless "Loading…") — fixed (#21).

## 6. Remaining bugs and gaps

| # | Item | Impact |
|---|---|---|
| 1 | **Frontend/POS tests are jsdom with a mocked API** (162 tests, PR #34), not browser end-to-end; page contents and business flows through the UI are still checked by hand (route guards were also verified in a real browser for 5 roles) | A visual or integration UI defect can still slip through (the Cashier case was of this kind before the tests existed) |
| 2 | **Legacy stock in the wrong kind of warehouse remains** (e.g. 2 finished-good rows in a raw-material warehouse, ~20 raw-material rows in general warehouses on TEST) | Needs a business decision; can now be moved out with a transfer/adjustment |
| 3 | Maintenance cost is not posted to the ledger | Cost reports incomplete |
| 4 | Collections dashboards count `pending` invoices | Overstated receivables on dashboards |
| 5 | H3: planned-route dispatch posts non-bulk stock from the first warehouse with negative stock allowed | Possible negative stock |
| 6 | No Sales Representative role (M3) | Sales Manager does everything |
| 7 | Route Supervisor and Driver dispatch live in the POS app, not the ERP | UAT of those roles must use the POS app |
| 8 | Emergency request has no push/e-mail notification | Operation Manager sees it only on the dashboard |

## 7. Security

| # | Issue | Severity | Status |
|---|---|---|---|
| S1 | `react-router` (frontend and POS): open redirect via backslash and SSR-hydration constructor injection (GHSA-wrjc-x8rr-h8h6, GHSA-337j-9hxr-rhxg) | Moderate | **Fixed** (#31, 7.18.7; `npm audit` 0 for both apps) |
| S2 | Tokens were not invalidated when a password is changed or reset | Medium | **Fixed** (#30; users E2E 77/77, 3 of the new checks fail without the fix) |
| S3 | Backups: Render Free has no `pg_dump` and ephemeral disk; no hosted/offsite backup | High for production | **Open** |
| S4 | No formal penetration test or external security assessment | — | **Open** |
| S9 | ERP had no role guard on routes (a role without access could open the page shell; the API already returned 403) and unknown URLs showed a blank page | Low | **Fixed** (UI guard PR) |
| S5 | Backend `npm audit`: 0 vulnerabilities | — | OK |
| S6 | Storekeeper cross-warehouse GRN/issue/read | Medium | **Fixed** |
| S7 | Audit trail incomplete for procurement | Medium | **Fixed**; audit tables are append-only |
| S8 | Database restore is disabled unless `ALLOW_DB_RESTORE=true`; backup path traversal fixed earlier | — | OK |

No password or secret was printed, committed or stored; UAT passwords were put on the clipboard only on request.

## 8. Deployment readiness

**TEST (staff UAT): ready.** Live now: Render `dcd2ee5` (backend unchanged since PR #30), Vercel ERP and POS from `377d34a` (PR #32/#33); PR #34 adds tests only, so nothing was redeployed for it. Run `docs/UAT_PLAN.md` with the 21 accounts; log defects in the plan's defect table; fix S1/S2-severity items on separate branches.

**Production: NOT ready.** Blockers:
1. Browser UAT sign-off by staff has not happened.
2. Browser end-to-end tests of the UI (the existing 162 frontend/POS tests use a mocked API).
3. Hosted, tested backups and a restore drill (S3).
4. Security assessment (S4) and the remaining items in section 6 (S1 and S2 are closed).
5. The old Railway data is not recovered or reconciled (Phase 0 questionnaire is awaiting the owner).
6. Business decisions on legacy wrong-warehouse stock and on the open gaps in section 6.
7. Integrations (Odoo, WMS, NUWACO, GEEDSAN) are design-only and need owner answers and explicit approval; they must stay separate systems.

## 9. Recommended next steps

1. Staff UAT on TEST (this week), then a daily defect triage.
2. ~~Fix S2 and S1~~ **Done** (#30, #31).
3. ~~Add a small automated UI suite~~ **Done** (PR #34). ~~Real-browser end-to-end suite~~ **Done** (PR #39, 39/39; found and fixed two defects, PR #38 and #40). Next: extend it to Collector, Production and Procurement-to-GRN flows and add Firefox/Chrome.
4. Decide the policy for legacy wrong-warehouse stock; then clean it by transfer/adjustment (not deletion).
5. Plan hosted backups and a restore rehearsal before any production talk.
