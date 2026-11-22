# Employee Pilot Testing — Readiness Report (TEST)

**Date:** 2026-11-22 · **Environment:** Render TEST `643f84a` (= GitHub `main`) · Vercel TEST ERP/POS · Neon TEST · **No production, Railway, Odoo, WMS or NUWACO was touched.**

## 1. Deployment and platform checks — PASS
| Check | Result |
|---|---|
| PR #3 merged to `main` | ✅ `643f84a` |
| Render TEST deployed from `main` | ✅ Live (hardened build: helmet, rate limits, DB-backed sessions) |
| `/health`, `/health/db` (Neon TEST) | ✅ |
| Admin login, wrong password, unknown user, CORS | ✅ (see earlier suites) |
| **Client IP detection on Render** | ✅ Verified: header chain is `client, Cloudflare edge, Render internal`. `TRUST_PROXY_HOPS=3` resolves the real client IP (= CF-Connecting-IP); a spoofed `X-Forwarded-For` does not change it. `trust proxy = 1` (the default) would have attributed every user to Render's internal IP. |
| Rate limits | `RATE_LIMIT_LOGIN_IP_MAX=300` (set **after** the IP check), `RATE_LIMIT_API_MAX=20000` (offices share one public IP) |

## 2. Pilot accounts — PASS
16 individual accounts across 14 roles created through the Admin API (audited), each able to log in. They are re-locked (random discarded passwords); a password is issued on request.

## 3. Scenario results (live Render API, real role logins) — 79 of 80 checks passed
| Area | Pass / Fail | Highlights |
|---|---|---|
| Setup / logins | 17 / 0 | 16 accounts log in |
| Cashiers | 7 / 0 | cash + credit sale, invoice numbers, stock −exact quantity, balance +invoice, oversell refused |
| Sales staff | 5 / 0 | customer registered, credit order created + approved, retail sale, statement |
| Warehouse | 6 / 0 | transfer moves stock both ways, receipt +20, over-removal refused |
| Accountants / collector | 8 / 0 | FIFO payments reduce balances exactly (6.00, 4.00), trial balance balanced, negative payment rejected |
| Dispatch (tanker) | 8 / 0 | WH-RO-01 receipt → 500 L load → dispatch 200 L → route + invoice + cash on delivery; over-delivery refused |
| Managers | 5 / 0 | dashboards, stock, low-stock, production batches |
| Permissions (per-role out-of-scope probes) | 10 / 0 | 9–14 forbidden actions per role, all 403 |
| Records | 8 / 1* | totals match lines, stock movement + ledger entry per invoice, attribution to the acting user |
| Reports | 5 / 0 | billing balance = orders − payments, ledger balanced (6535.00 = 6535.00), trial-balance report = ledger, Sales List shows every pilot invoice |

\* The one failed check was a wrong test assumption: tanker-dispatch stock movements are stored against the **route**, not the invoice. The real problem found there is **H2** below.

## 4. Permission sweep — every route × 11 role accounts
239 routes (131 reads, 108 writes) probed as each role. **Writes are well restricted** (Cashier 4, Driver 6, Collector 4, Storekeeper 8, Accountant 32, Production Manager 18, …; 98–112 routes blocked per role). **Reads are not** — see H1.

## 5. Findings — outstanding issues
| ID | Severity | Finding | Recommendation |
|---|---|---|---|
| **H1** | **High (before real staff use it)** | **Every logged-in role can read financial data**: `/reports/*` (21 endpoints incl. trial balance, P&L, balance sheet, cash flow, general ledger, AR/AP) and `/finance/*` reads (chart of accounts, journal entries, bank accounts, budgets, profitability), procurement/supplier data, cost centres. A Cashier or Driver can call them directly. | Gate reads by role (proposed: finance/reports → Admin, Finance Officer, Sales Manager (sales/AR only), Production/Inventory managers (their own reports)); hide the UI menus to match. |
| **H2** | **High (stock accuracy)** | **Bulk Water leaves stock twice**: loading a tanker deducts from WH-RO-01, and the dispatch deducts the same litres again from the *first warehouse* (WH-RM-01, negative allowed). | Dispatch must not post a second OUT for Bulk Water (the truck load already did); decide the single source of truth. |
| M1 | Medium | Admin cannot reset a user's password in the system (no API/UI). On hosted TEST it needs an operator with database access. | Add an Admin "reset password" action (audited) before the pilot grows. |
| M2 | Medium | `audit_logs` has no entry for **payments created** or **stock movements** (they are attributed through `recorded_by` / `performed_by`, so the actor is known, but not in the audit trail). | Add audit rows. |
| M3 | Medium | No low-privilege **Sales Rep** role: sales staff hold *Sales Manager* (41 writes: orders, approve, cancel, reverse, dispatch…). | Create a Sales Rep role. |
| L1 | Low | Any role can post billing follow-up notes and call `suggest-split` (compute only). | Gate them. |
| L2 | Low | Role/deactivation changes can take up to 30 s (`AUTH_CACHE_TTL_MS`); tokens are not revoked on password change. | Accept for pilot. |
| L3 | Low | Render Free sleeps (~50 s first request); backups disabled; no off-site copy of Neon TEST data. | Fine for TEST; plan paid hosting + backups before production. |
| L4 | Info | UI-level role menus and the browser screens were **not** walked through in this run (API level only). | Do a short UI walkthrough with the first testers. |

## 6. Readiness verdict
- **Ready for a controlled pilot on TEST data:** retail sales, invoices, payments, stock transfers/receipts, tanker dispatch, reports and records behave correctly; write permissions are enforced.
- **Before inviting real staff, fix H1** (financial reads visible to all) — or restrict the pilot to staff already allowed to see company financials. **Fix H2** before anyone trusts Bulk Water stock numbers.
- Not ready for production: see L3, M1–M3, backups, Railway data recovery.
