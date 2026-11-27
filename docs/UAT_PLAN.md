# Al-Naciim ERP — User Acceptance Test (UAT) Plan

**Environment:** TEST only — ERP https://alnaciim-erp-test.vercel.app · POS https://alnaciim-pos-test.vercel.app · API on Render · Neon TEST database.
**Never use production data, real customers' money, or real personal data.** Nothing done here can affect Production, Railway, Odoo, WMS, NUWACO or GEEDSAN.

> **Soo koobid (Somali):** Dukumentigan wuxuu leeyahay (1) 21 account oo UAT ah — mid walba role gooni ah, (2) xogta tijaabada, (3) ~60 tijaabo oo role-ka iyo hawlaha ku xiran, (4) liiska waxa role walba **aan laga rabin** inuu sameeyo, iyo (5) xaashida saxiixa. **Password-ka waxaa la bixiyaa oo keliya marka la codsado ("clip uat.<magac>")**; marna lagama qorin docs-ka.

---

## 1. How to run the UAT

1. One tester per account. The Admin issues each tester a password **only on request** (it is copied to the clipboard, never written down or chat-ed). Passwords of UAT accounts are random and unknown until issued; each tester should change theirs from the user menu → *Change password*. A forgotten password is reset by the Admin in *Settings → Users → Reset password* (12+ characters, not a common password, not the e-mail name; not available for Admin accounts, whose passwords are reset with `backend/src/scripts/set-user-password.js`). The accounts are used for this UAT only and are re-issued or disabled afterwards.
2. Work through the scripts in section 5 in order. For each step record **PASS / FAIL / BLOCKED** and, for FAIL/BLOCKED, a defect line (section 8). Take a screenshot for every FAIL.
3. Use **only** the UAT data in section 4 (`UAT-*` codes) and the seeded catalogue. Do not edit or delete other people's records.
4. Severity: **S1** blocks a business process or loses/corrupts money or stock · **S2** wrong result with a workaround · **S3** cosmetic/wording.
5. UAT exit criteria (section 9): all S1 and S2 fixed and re-tested, every role signed off, reconciliation checks (section 7) clean.

> Do **not** run the automated E2E suites during UAT: some of them re-assign department heads and add test rows on the same TEST database.

## 2. UAT accounts

Login e-mail pattern: `uat.<key>@alnaciim.test`. Requisitions are approved by the **head of the requester's department** (department 3 = Delivery, department 5 = Maintenance), then by the Operation Manager.

| Key | Role | Dept / warehouse | Used for |
|---|---|---|---|
| `admin@alnaciim.com` | Admin | — | Supervises the UAT and user administration; can also act in any role's screens |
| `uat.opm` | Operation Manager | Administration | Approves requisitions, authorizes POs, dashboard, incidents |
| `uat.head.delivery` | Department Head | Delivery (3) | Reviews Delivery requisitions, confirms material issues |
| `uat.head.maint` | Department Head | Maintenance (5) | Reviews Maintenance requisitions |
| `uat.staff.delivery` | Data Entry Operator | Delivery (3) | Raises Delivery requisitions; incident reporting; closes tanker route sessions |
| `uat.staff.maint` | Technician | Maintenance (5) | Raises Maintenance requisitions; machine maintenance; downtime |
| `uat.proc1`, `uat.proc2` | Procurement Officer | Procurement (4) | Sourcing, quotations, POs, invoices (two people to test separation of duties) |
| `uat.store.rm` | Storekeeper | WH-RM-01 | Goods receipt of raw materials, issuing, counts |
| `uat.store.fg` | Storekeeper | WH-FG-01 | Finished goods stock and counts |
| `uat.store.ro` | Storekeeper | WH-RO-01 | Tanker loading (*Tanker Loading* menu) |
| `uat.store.sp` | Storekeeper | WH-SP-01 | Spare parts stock |
| `uat.invmgr` | Inventory Manager | Warehouse (6) | Approves stock counts, transfers, products |
| `uat.prod1`, `uat.prod2` | Production Manager | Production (1) | Batches; one completes, the other approves the output |
| `uat.fin` | Finance Officer | Finance (8) | Invoices, payments, journals, reports |
| `uat.sales` | Sales Manager | — | Customers, orders, quotations, qaade, tanks |
| `uat.cashier` | Cashier | — | Retail POS (bottled water, ice) |
| `uat.collector` | Collector | — | Collections (*Collections* menu) |
| `uat.routesup` | Route Supervisor | Delivery (3) | Route planning, dispatch, incidents |
| `uat.driver1`, `uat.driver2` | Driver | Delivery (3) | Own truck `UAT-TRK-1` / `UAT-TRK-2`: deliveries and tank-fill POS |

## 3. Known gaps (status)

| # | Gap | Status |
|---|---|---|
| G1 | Storekeeper had no screen to load a tanker and Data Entry none to reconcile/close a route session. | **Built** — menu **Tanker Loading** (Admin, Storekeeper, Data Entry). Storekeeper sees *Load Tanker*; Data Entry sees *Reconcile Stock*/*Complete* and the session history. Verified in the browser; UAT steps E4 and E7 use it. |
| G2 | Route Supervisor / Driver dispatch happens in the **POS app** (Route Planning, fast tank-fill), not in the ERP menu. | By design for now: test route planning and tank-fill sales in the POS app. |
| G3 | Collector had no menu entry. | **Built** — menu **Collections** (Collector): dashboard, receivables, receive payment, payment history, aging, reports (the Employee Performance tab is for management only). Verified in the browser; UAT step F4 uses it. |
| G4 | No screen to change a password. | **Built** — user menu → **Change password** (current password required; a wrong one shows a message and does **not** sign you out). |
| G5 | Maintenance cost is **not posted to the ledger**; collections/aging dashboards still count unapproved (pending) credit invoices as receivable. | Known and documented; do not report as new defects. |

## 4. Test data (already created)

| Item | Value |
|---|---|
| Customers | `UAT-CUST-1` wholesale, credit 2,000, 30 days · `UAT-CUST-2` credit limit **100** (limit tests) · `UAT-CUST-3` retail · `UAT-CUST-4` tanker with tank `UAT-TANK-1` (1,000 L) |
| Qaade | `UAT-Q1` (collector `uat.collector`, truck `UAT-TRK-1`) with all four customers |
| Trucks | `UAT-TRK-1` (driver 1), `UAT-TRK-2` (driver 2), 5,000 L each |
| Suppliers | `UAT-SUP-1` (preforms and caps), `UAT-SUP-2` (chemicals) |
| Stock (seeded catalogue) | Raw materials in WH-RM-01 (preforms, caps, labels, shrink film, cartons, chlorine), finished goods in WH-FG-01 (bottled water, ice), spare parts in WH-SP-01, bulk water in WH-RO-01 |
| Machines | `MC-FILL-01`, `MC-FILL-02`, `MC-ICE-01`, `MC-RO-01`, … |

The TEST database also contains rows left by automated tests (names starting `E2E`, `TST`, e-mails `*@alnaciim.test` other than `uat.*`). Ignore them; they are not part of the UAT. (Two seeded rows are known data quirks: a −2 balance of `FG-W1500` in WH-RM-01 and 100 L of bulk water in WH-RM-01.)

## 5. Test scripts

Notation: **Who** = account key · **Where** = menu path · **Expect** = result that makes the step PASS. `[ ]` = tick when PASS.

### A. Access and roles
- [ ] **A1** Each account signs in and sees **only** its menu (compare with section 2): Procurement Officer — Requisitions, Procurement; Storekeeper — Tanker Loading, Inventory, Requisitions, Procurement; Data Entry — Logistics Incidents, Tanker Loading, Requisitions; Collector — Collections, Requisitions; Cashier — Sales & Distribution; Technician — Production, Maintenance, Requisitions; Finance — Finance, Procurement, Reports; Driver — the minimal driver shell.
- [ ] **A2** Each account opens a forbidden URL directly (e.g. `/finance` as Cashier, `/settings` as Finance): sent away or shown "not allowed"; no data visible.
- [ ] **A3** Sign out, then press Back: no private page is shown without signing in again.
- [ ] **A4** Five wrong passwords on a **non-UAT test e-mail** do not reveal whether the account exists (same message each time).

### B. Procurement (Department Request → Supplier Payment)
Use department 3 (Delivery): requester `uat.staff.delivery`, head `uat.head.delivery`.
- [ ] **B1** `uat.staff.delivery` — *Requisitions → New*: 2 items (e.g. PET Preform 12g × 1,000; Bottle Cap 28mm × 1,000), justification, priority. Save as draft; edit; **Submit**. *Expect* status "Waiting for Department Head"; PR number `PR-YYYY-nnnnn`.
- [ ] **B2** The requester cannot approve their own request; `uat.staff.maint` (another department) cannot see it.
- [ ] **B3** `uat.head.delivery` — approve (with comment). Try *Request revision* on a second request: requester can edit and resubmit.
- [ ] **B4** `uat.opm` — approve and sign; check the **approval history** shows each step with a signature.
- [ ] **B5** `uat.opm` — assign to `uat.proc1`. *Expect* only `uat.proc1` (not `uat.proc2`) can work on it.
- [ ] **B6** `uat.proc1` — request quotations from `UAT-SUP-1` and `UAT-SUP-2`; record prices (cheaper one for supplier 2). *Expect* comparison highlights the lowest total.
- [ ] **B7** Select the **more expensive** supplier without a justification — *Expect* refused. Add a justification (≥10 characters) — accepted.
- [ ] **B8** Link each line to its stock item and **create the purchase order**. *Expect* status "pending authorization".
- [ ] **B9** `uat.proc1` cannot authorize; `uat.opm` — *Procurement → PO Authorization & Tracking* — return it for revision once, resubmit, then **authorize**; `uat.proc1` — **send** to the supplier.
- [ ] **B10** `uat.store.rm` — *Purchase Orders → Receive*: receive **part** of the order as accepted, one line as **damaged** (with a note) and one as **rejected**. *Expect* GRN number, only accepted units in *Inventory → Stock Levels*, PO "partially received".
- [ ] **B11** Try to receive more than ordered — *Expect* refused. Receive the rest — PO "received", requisition "fulfilled".
- [ ] **B12** `uat.store.rm` — *Material Issues*: issue part of the goods to the Delivery department. `uat.store.rm` cannot confirm it; `uat.staff.delivery` or `uat.head.delivery` **disputes** it with a reason — stock returns to the warehouse; issue again and **confirm**.
- [ ] **B13** `uat.fin` — *Supplier Invoices & Vouchers*: enter the supplier invoice (Procurement Officers **cannot** register invoices; `uat.proc1` trying must be refused). *Expect* 3-way match against PO and accepted receipt; a wrong quantity/price shows a mismatch; a duplicate invoice number is refused.
- [ ] **B14** The invoice's creator cannot approve it, and there is only one Finance account, so **Admin** approves the matched invoice. Then `uat.fin` requests the supplier payment; **`uat.opm` approves the payment** (payments are approved by the Operation Manager, not by Finance); a voucher number is produced and the payment reduces **Accounts Payable** (Finance → Accounts Payable). Finance cannot approve the payment.
- [ ] **B15** Audit: for the PR, PO, GRN and payment, every action shows who and when; the approval history cannot be edited.

### C. Production
- [ ] **C1** `uat.prod1` — *Production → Bill of Materials*: check or create a BOM for a bottled-water product.
- [ ] **C2** *Production Orders → Bottled Water*: create a batch (machine `MC-FILL-01`, planned qty, destination WH-FG-01); **start** it.
- [ ] **C3** **Complete** with actual quantity, wastage and QC **passed**, materials warehouse WH-RM-01. *Expect* raw materials reduced by the BOM × (actual + wastage); variance vs plan shown; finished goods **not yet** in stock.
- [ ] **C4** `uat.prod1` cannot approve their own batch's output; `uat.prod2` — **Approve Output** — finished goods now in WH-FG-01.
- [ ] **C5** Reject the output of a second batch — no finished stock added; **Reverse** it — materials return.
- [ ] **C6** A batch with QC **failed** adds no finished stock.
- [ ] **C7** Try to complete a batch with more materials than the store holds — refused, nothing changed.
- [ ] **C8** `uat.staff.maint` — log a machine **downtime** and resolve it (resolving twice is refused); *Maintenance → Schedules/Logs*: schedule preventive maintenance, log a completed service using a spare part (stock reduces; schedule's next due date moves).
- [ ] **C9** *Production → Reports* and *Capacity Calendar* show the batches just made.

### D. Inventory and warehouse
- [ ] **D1** `uat.store.rm` — *Inventory → Movements*: receive and issue within **own** warehouse; the same in another warehouse is refused.
- [ ] **D2** `uat.invmgr` — *Transfer* stock between two warehouses; more than on hand is refused.
- [ ] **D3** `uat.store.rm` — *Stock Reconciliation*: submit a count that differs from the system. Stock does **not** change yet.
- [ ] **D4** The counter cannot approve it; `uat.invmgr` approves — stock adjusts to the counted figure; a **second** pending count for the same item is refused; a count that went stale (stock moved after counting) cannot be approved.
- [ ] **D5** *Stock Levels* / *Movements* show every step; the **Inventory Report** (Reports) agrees with *Stock Levels*.

### E. Sales, logistics and tankers (bulk water)
- [ ] **E1** `uat.sales` — *Customers*: register a customer; an HNO is issued automatically; the credit limit and status can be edited; a **suspended** customer cannot buy on credit, a **closed** one cannot be invoiced.
- [ ] **E2** *Bulk Water Orders*: create a **credit** invoice for `UAT-CUST-1`, approve it. Try one for `UAT-CUST-2` above 100 — refused (credit limit).
- [ ] **E3** *Quotations*: create → send → accept → **convert**; a rejected/expired quotation cannot be converted.
- [ ] **E4** `uat.store.ro` — menu **Tanker Loading → Load Tanker**: truck `UAT-TRK-1`, 2,000 L from the Finished Water Warehouse. *Expect* warehouse stock reduced by 2,000; the same storekeeper cannot close the session.
- [ ] **E5** (**POS app, G2**) `uat.driver1` signs in to the POS app and records a tank-fill sale for `UAT-CUST-4` / `UAT-TANK-1` (400 L, price per litre, part cash). *Expect* order delivered, truck stock reduced, credit shown as receivable; a driver **cannot** sell from `UAT-TRK-2`.
- [ ] **E6** A sale larger than the tank's capacity or the truck's remaining water is refused with nothing recorded.
- [ ] **E7** `uat.staff.delivery` — **Tanker Loading → Reconcile Stock** on that session: physical equal to system closes it; a mismatch needs a reason; returning water to the warehouse increases WH-RO-01.
- [ ] **E8** `uat.routesup` — plan a route in the POS app with approved orders, dispatch it, close it; the same truck/driver cannot be on two active routes on one day.
- [ ] **E9** *Logistics Incidents*: `uat.driver1` reports a **damaged goods** incident (needs route, quantity, description); `uat.routesup` investigates; `uat.opm` resolves. The reporter cannot investigate/resolve their own incident.

### F. Retail POS and billing
- [ ] **F1** `uat.cashier` — *Sales & Distribution → Retail Sales & Billing*: cash sale of bottled water; the invoice prints; stock reduces; cash is booked.
- [ ] **F2** Credit sale for `UAT-CUST-3`; a negative price, zero quantity or more than the store holds is refused and nothing is recorded.
- [ ] **F3** Cashier collects a payment against **bottled water or ice** only; a bulk-water debt cannot be collected by the Cashier.
- [ ] **F4** `uat.collector` — menu **Collections → Receive Payment** (and `uat.fin` in *Finance → Billing & Collections*): record a collection (oldest invoice first), overpay (excess reported as unapplied), edit the reference, **reverse** a payment (receivable restored).
- [ ] **F5** The customer statement and the *Debtors* report agree with the balance shown for each customer.

### G. Finance
- [ ] **G1f** `uat.fin` — *Journal Entries*: create a draft, edit it, post it; an unbalanced entry is refused; a posted entry cannot be edited, only **reversed**.
- [ ] **G2f** *Cash Receipt / Cash Payment*, *Bank Accounts* (balance = opening + movements), *Expenses* (cost centre required; reversible once).
- [ ] **G3f** *Trial Balance* is balanced; *Profit & Loss*, *Balance Sheet*, *Cash Flow*, *Accounts Receivable/Payable* agree with what you entered.
- [ ] **G4f** *Budget*: set a monthly budget; actual spend appears against it.
- [ ] **G5f** *Year Closing* (use a **future test year** only): closing moves the result to retained earnings; posting into the closed year is then refused.

### H. Operations Manager
- [ ] **H1** `uat.opm` — *Operations Overview* shows: requisitions awaiting approval, POs awaiting authorization, overdue POs, material confirmations pending, invoice mismatches, payments awaiting approval, low stock, production output approvals, open route sessions, open incidents. Each count changes as you complete the scripts above.
- [ ] **H2** From the dashboard open an item and act on it (approve/authorize/resolve) — the dashboard count drops.

### I. Administration and audit
- [ ] **I1** Admin — *Settings → Users*: create a user, assign a role, department and warehouse; change the role (takes effect on the user's next screen); deactivate (the user is signed out at once). An Admin cannot disable or demote their own account.
- [ ] **I2** Admin — *Settings → Audit Log*: review the trail for a requisition, a payment and a stock count: user, time, old and new values present.
- [ ] **I3** *Settings → Backups* lists backups and the schedule. Trying to **restore** returns a clear "disabled on this server" message (by design: `ALLOW_DB_RESTORE` is not set). Do not try to enable it.

> **Automated rehearsal:** `backend/tests/e2e/uat-workflows.e2e.test.js` runs sections B–H and the section-6 checks through the API with one account per UAT role (136 checks). Run it before UAT starts and after every fix; it does not replace the browser UAT.

## 6. Segregation-of-duties and "must not" checks

Every row must be **blocked** with a clear message (and the data must stay unchanged).

| Actor | Tries to… | Expected |
|---|---|---|
| Requester | approve or review their own requisition | refused |
| Another department's staff | open someone else's requisition | not visible |
| Procurement Officer | authorize their own PO; work on another officer's requisition | refused |
| Operation Manager | authorize a PO for a requisition they raised | refused |
| Storekeeper | confirm the issue they made; post stock in another warehouse | refused |
| Stock counter | approve their own count | refused |
| Production Manager | approve the output of the batch they completed | refused |
| Incident reporter | investigate or resolve their own incident | refused |
| Driver | sell from another driver's truck; read dispatch dashboards | refused |
| Cashier | read the chart of accounts, receive bulk-water payments, see unit costs | refused / hidden |
| Finance | change a credit limit, create products or customers | refused |
| Anyone | post into a closed fiscal year; reverse the same entry twice; edit a posted journal | refused |
| Admin | disable/demote own account or the last Admin | refused |

## 7. End-of-UAT reconciliation (Admin + Finance together)

- [ ] **R1** *Trial Balance* is balanced (total debit = total credit) and *Balance Sheet* says balanced.
- [ ] **R2** For each product touched, *Stock Levels* equal the sum of its *Movements* (in/out, adjustments signed).
- [ ] **R3** *Accounts Receivable* per customer equals the customer statement; *Accounts Payable* per supplier equals the unpaid approved invoices.
- [ ] **R4** Truck `UAT-TRK-1`: water loaded − water sold − water returned/lost (reconciliation reasons) = measured remainder.
- [ ] **R5** Every PR / PO / GRN / invoice / payment number used in UAT appears in the audit trail.

## 8. Defect log (copy a row per finding)

| ID | Script step | Role/account | What happened | Expected | Severity | Screenshot | Status |
|---|---|---|---|---|---|---|---|
| UAT-001 | | | | | S1/S2/S3 | | Open |

## 9. Exit criteria and sign-off

- All S1 and S2 defects fixed and re-tested; S3 accepted or scheduled.
- Gap G2 (POS app for dispatch) accepted or addressed; G1, G3 and G4 re-tested.
- Reconciliation R1–R5 clean.

| Role / area | Tester (name) | Date | Result (PASS / PASS with notes / FAIL) | Signature |
|---|---|---|---|---|
| Procurement | | | | |
| Production | | | | |
| Inventory & warehouse | | | | |
| Sales, logistics & POS | | | | |
| Finance & billing | | | | |
| Operations Manager | | | | |
| Administration & audit | | | | |
| **UAT coordinator (Admin)** | | | | |

*Production deployment still requires the separate approvals listed in `docs/ERP_COMPLETION_REPORT.md` section 8.*
