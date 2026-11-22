# Procurement Management Module — Implementation Plan (TEST only)

Status: **plan for approval** · Branch: `feature/procurement-module` · Scope: Alnaciim ERP only (no Odoo/WMS/Railway/production).

## 1. What already exists (inspected, not assumed)
| Area | Existing (kept and extended — no duplicate systems) |
|---|---|
| Suppliers | `suppliers` (code, name, category, contact, rating, is_active), `/suppliers`, `supplier_performance` |
| Purchase orders | `purchase_orders` (draft/sent/partially_received/received/cancelled) + `purchase_items`; `/procurement/purchase-orders` CRUD, `reverse` |
| Receiving | `goods_receipts` + `goods_receipt_items` (condition good/damaged); `POST …/receive` already posts **stock IN for good units only** and **Dr Inventory (1200/1210/1220) / Cr Accounts Payable (2000)** |
| Payments | `supplier_payments` (per PO; cash/bank/cheque), journal Dr AP / Cr Cash-Bank, reversal |
| Inventory | `stock_levels`, `stock_movements`, `utils/stockLedger.postStockMovement` (the only way stock changes) |
| Accounting | `services/accountingService` (`postJournalEntry`, `getAccountByCode`, reversal), chart of accounts, bank accounts |
| Org | `departments` (manager_id = head), `users.department_id`, `cost_centers`, `attachments` (generic, file_path) |
| Audit | `audit_logs` + `services/auditService.logAudit` |
| RBAC | JWT + DB-backed role check; `requireRole`, `PERM` read groups; 14 roles (no Department Head / Operation Manager yet) |
| UI | ERP `/procurement` page (Purchase Orders, Suppliers tabs) |

Gaps vs the brief: no requisitions, approvals/signatures, quotations/comparison, GRN numbering with rejected+damaged split, material issuing, supplier invoices / 3-way match / vouchers / duplicate-payment guard, manager dashboard.

## 2. Roles (new rows in `roles`; existing roles reused)
`Department Head`, `Operation Manager` (new). Existing: Procurement Officer, Storekeeper, Finance Officer, Admin, plus any employee as requester. Department head of a department = `departments.manager_id` (a user with role Department Head).

## 3. Workflow and states
`Requisition`: draft → submitted → dept_review (DH) → {returned_for_revision | rejected | dept_approved} → ops_review (OM) → {returned | rejected | approved} → sourcing → po_issued → (fulfilled | closed | cancelled)
`Quotation round`: requested → received → compared → selected (justification required)
`Purchase order`: draft → pending_authorization → authorized (OM, digital signature) → sent → partially_received → received → invoiced → paid → closed (existing statuses kept; new ones added)
`GRN`: one per delivery; lines: ordered, received, accepted, rejected, damaged
`Material issue`: issued (storekeeper) → confirmed (department representative)
`Supplier invoice`: registered → matched | mismatch → approved (Finance) → partially_paid → paid
Every transition writes a `procurement_approvals` row (actor, role, decision, comment, timestamp, signature hash) and a `procurement_audit_logs` row.

## 4. Data model (migration `026_procurement_management.sql`, mirrored into `schema.sql`)
New tables (all with FKs, CHECKs, indexes, `created_at/by`): `purchase_requisitions`, `purchase_requisition_lines`, `procurement_approvals`, `supplier_quotations`, `supplier_quotation_lines`, `material_issues`, `material_issue_lines`, `supplier_invoices`, `supplier_invoice_lines`, `procurement_audit_logs`.
Extended (not duplicated): `purchase_orders` (+requisition_id, department_id, selected_quotation_id, status values, authorized_by/at, signature_hash), `purchase_items` (+requisition_line_id), `goods_receipts` (+grn_number UNIQUE, delivery_note_no), `goods_receipt_items` (+accepted/rejected/damaged qty, receive checks), `supplier_payments` (+supplier_invoice_id, voucher_number UNIQUE, status/approval), `suppliers` (+payment_terms_days, tax_no), `attachments` (+content BYTEA — files must survive Render's ephemeral disk; 5 MB cap).
Reference numbers via the existing `hno_sequences` pattern: PR-YYYY-NNNNN, QT-…, PO (existing), GRN-…, MIN-…, SINV-… (internal), PV-… (payment voucher).
Integrity: unique `(supplier_id, invoice_number)` (duplicate invoice), unique `(supplier_invoice_id, payment ref)`, CHECK accepted+rejected+damaged = received, CHECK payments ≤ approved invoice total (enforced in transaction with row locks), issue lines ≤ accepted-received (remaining tracked).

## 5. Permissions (enforced in the API, mirrored in the UI)
| Action | Allowed |
|---|---|
| Create/edit own requisition, attach files | any employee (own department); Department Head for the department |
| See requisitions | requester (own), their Department Head (own department), Operation Manager, Procurement Officer (assigned/approved), Finance (read), Admin |
| Dept review | Department Head of **that** department (not own request) |
| Ops approve/reject/return + signature | Operation Manager (not the requester) |
| Sourcing, quotations, PO draft | Procurement Officer (assigned) |
| PO authorization | Operation Manager; **Procurement Officer cannot authorize/approve own purchases** |
| Receive goods (GRN), issue materials | Storekeeper |
| Confirm receipt of issued material | department representative (requester/dept staff) |
| Register/match invoice | Finance Officer (cannot change received quantities) |
| Authorize/make payment | Finance Officer (+Operation Manager approval above a threshold, configurable); **Storekeeper cannot** |
Separation of duties checks: requester ≠ approver, PO creator ≠ authorizer, receiver ≠ payer. All checked server-side; negative tests for each.

## 6. Accounting integration (no double posting)
GRN accepted units → stock IN (existing ledger) and Dr Inventory / Cr AP (2000) at PO price — the existing receive logic becomes the GRN service (legacy `POST …/receive` is routed to it, so one code path). Invoice registration **posts nothing** unless a price variance is approved (then a variance entry). Payment: Dr AP / Cr Cash-Bank (existing). Voucher number printed on payment. Supplier balance = AP credits − payments.

## 7. API surface (new router `/procurement/…`, each with `requireRole` + ownership checks + zod validation)
`/requisitions` (CRUD, submit, review, approve, reject, return, assign) · `/requisitions/:id/quotations` (request, record, compare, select) · `/purchase-orders` (from selected quotation, authorize) · `/goods-receipts` · `/material-issues` (+confirm) · `/supplier-invoices` (+match, approve) · `/supplier-payments` (+voucher) · `/procurement/dashboard` · `/procurement/audit`.

## 8. Phases (each phase: migration → API → UI → automated tests → PR)
1. Foundation + Requisitions + Approvals (roles, tables, PR numbering, DH review, OM approval + signature, visibility rules, attachments)
2. Sourcing: quotations, comparison, selection justification, PO generation, PO authorization
3. Goods receiving (GRN, accepted/rejected/damaged, partial deliveries, inventory + ledger)
4. Material issuing + department confirmation + remaining quantities
5. Supplier invoices, three-way match, payments, vouchers, duplicate guard, supplier balances
6. Operation Manager dashboard, audit viewer, reports/H1 permission groups, end-to-end UAT scenarios

## 9. Test plan (module is "complete" only when all pass)
Workflow end-to-end (PR→…→payment→closure); every state transition + illegal transitions; RBAC matrix per role incl. separation-of-duties negatives; department privacy; inventory (accepted-only, partial, damaged/rejected, ledger = stock); finance (3-way match tolerance, duplicate invoice, over-payment, voucher uniqueness, AP balance, trial balance still balanced); audit trail completeness; concurrency (double approve, double pay) via row locks; regression of the existing procurement/PO/payment/inventory/pilot suites; frontend + POS build.

## 10. Decisions needed (recommended defaults marked ★)
1. **Roles:** add `Department Head` and `Operation Manager` ★ (vs reusing Sales/Production Manager).
2. **Legacy PO flow:** route old `receive`/`payments` endpoints through the new GRN/invoice services so there is one path ★.
3. **Digital signature:** server-side signature record (user, role, timestamp, SHA-256 of the document snapshot, shown on the PO/PR) ★ — not a hand-drawn image.
4. **Attachments:** stored in the database (≤5 MB) ★ because Render's disk is ephemeral.
5. **Payment threshold** requiring Operation Manager approval: configurable, default 500 ★.
