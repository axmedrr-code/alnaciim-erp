# Al-Naciim ERP — Final QA review report

**Date:** 2026-11-26 · **Code reviewed:** `main` @ `48c0835` (PR #28 merged) · **Environment:** TEST only (Neon TEST, Render `alnaciim-erp-test-api`, Vercel `alnaciim-erp-test`, POS `alnaciim-pos-test`) · **Production, Railway, Odoo, WMS, NUWACO and GEEDSAN were not touched.**

> **Soo koobid (Somali):** Dib-u-eegista tayada buuxda waa dhammaatay. **1,312 tijaabo E2E + 53 unit: dhammaantood PASS, 0 fashil** (suite kasta mid-mid ayaa loo socodsiiyay Neon TEST). Dib-u-eegistu waxay heshay oo sixday saddex cilad oo badeeco ah (audit-ka dhexe, GRN/issue ee Storekeeper aan xaddidnayn, kala-saarida RM/FG) iyo laba cilad oo tijaabo ah. **TEST waa diyaar UAT-ga dadka dhabta ah. Production MA DIYAAR AH.**

## 1. Verdict

| | Status |
|---|---|
| TEST environment ready for staff UAT | **Yes** |
| Production ready | **No** (blockers in section 7) |
| Automated tests | **1,312 E2E + 53 unit PASS, 0 FAIL** |
| Browser UAT by real staff | **Not started** (cannot be done by the assistant) |
| Frontend / POS automated tests | **None exist** (build only) |

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
| 7 | Run backend, frontend, POS tests | Backend: below. **Frontend/POS: no test suites exist; `vite build` passes for both.** |
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
| 1 | **Frontend and POS have no automated tests** | UI defects are found only by hand (the Cashier case) |
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
| S1 | `react-router` (frontend and POS): open redirect via backslash and SSR-hydration constructor injection (GHSA-wrjc-x8rr-h8h6, GHSA-337j-9hxr-rhxg); fix needs a major version bump | Moderate | **Open** |
| S2 | Tokens are not invalidated when a password is changed or reset | Medium | **Open** |
| S3 | Backups: Render Free has no `pg_dump` and ephemeral disk; no hosted/offsite backup | High for production | **Open** |
| S4 | No formal penetration test or external security assessment | — | **Open** |
| S5 | Backend `npm audit`: 0 vulnerabilities | — | OK |
| S6 | Storekeeper cross-warehouse GRN/issue/read | Medium | **Fixed** |
| S7 | Audit trail incomplete for procurement | Medium | **Fixed**; audit tables are append-only |
| S8 | Database restore is disabled unless `ALLOW_DB_RESTORE=true`; backup path traversal fixed earlier | — | OK |

No password or secret was printed, committed or stored; UAT passwords were put on the clipboard only on request.

## 8. Deployment readiness

**TEST (staff UAT): ready.** Live now: Render `48c0835`, Vercel ERP (current main), POS unchanged. Run `docs/UAT_PLAN.md` with the 21 accounts; log defects in the plan's defect table; fix S1/S2-severity items on separate branches.

**Production: NOT ready.** Blockers:
1. Browser UAT sign-off by staff has not happened.
2. Frontend/POS have no automated tests.
3. Hosted, tested backups and a restore drill (S3).
4. Security assessment and open items S1, S2, S4.
5. The old Railway data is not recovered or reconciled (Phase 0 questionnaire is awaiting the owner).
6. Business decisions on legacy wrong-warehouse stock and on the open gaps in section 6.
7. Integrations (Odoo, WMS, NUWACO, GEEDSAN) are design-only and need owner answers and explicit approval; they must stay separate systems.

## 9. Recommended next steps

1. Staff UAT on TEST (this week), then a daily defect triage.
2. Fix S2 (token invalidation) and S1 (`react-router` upgrade with a smoke test) on separate branches.
3. Add a small automated UI smoke suite for frontend/POS (login, role menus, the Cashier/Storekeeper/Collector flows).
4. Decide the policy for legacy wrong-warehouse stock; then clean it by transfer/adjustment (not deletion).
5. Plan hosted backups and a restore rehearsal before any production talk.
