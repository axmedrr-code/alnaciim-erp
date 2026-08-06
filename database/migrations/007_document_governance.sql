-- =====================================================================
-- DOCUMENT GOVERNANCE: draft-edit / posted-lock / reverse-not-delete
--
-- Policy: while a document is still a draft (nothing has touched the
-- ledger or physical stock yet), it can be freely edited or hard-deleted.
-- Once it is posted (has affected the General Ledger and/or inventory),
-- it becomes immutable — the only way to correct it is a Reverse
-- operation that posts a brand-new offsetting counter-entry and flags
-- the original as reversed, so the full history is always preserved.
-- =====================================================================

-- ---- Sales Order / Invoice ----
ALTER TABLE sales_orders DROP CONSTRAINT sales_orders_status_check;
ALTER TABLE sales_orders ADD CONSTRAINT sales_orders_status_check
    CHECK (status IN ('pending','approved','dispatched','delivered','cancelled','reversed'));

-- ---- Payment (AR) ----
ALTER TABLE payments
    ADD COLUMN voided_at    TIMESTAMPTZ,
    ADD COLUMN voided_by    INT REFERENCES users(id),
    ADD COLUMN void_reason  TEXT;

-- ---- Expense ----
ALTER TABLE expenses
    ADD COLUMN voided_at    TIMESTAMPTZ,
    ADD COLUMN voided_by    INT REFERENCES users(id),
    ADD COLUMN void_reason  TEXT;

-- ---- Purchase Order ----
ALTER TABLE purchase_orders DROP CONSTRAINT purchase_orders_status_check;
ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_status_check
    CHECK (status IN ('draft','sent','partially_received','received','cancelled','reversed'));

-- ---- Supplier Payment (AP) ----
ALTER TABLE supplier_payments
    ADD COLUMN voided_at    TIMESTAMPTZ,
    ADD COLUMN voided_by    INT REFERENCES users(id),
    ADD COLUMN void_reason  TEXT;

-- ---- Production Batch ----
ALTER TABLE production_batches DROP CONSTRAINT production_batches_status_check;
ALTER TABLE production_batches ADD CONSTRAINT production_batches_status_check
    CHECK (status IN ('planned','in_progress','completed','cancelled','reversed'));
ALTER TABLE production_batches ADD COLUMN reversed_at TIMESTAMPTZ;

-- ---- Journal Entry ----
-- Widen status to allow real drafts (saved but not yet affecting any balance),
-- and let a reversal entry point back at what it reverses so the GL can show
-- "Reversed by JE-000123" without ever mutating the original posted lines.
ALTER TABLE journal_entries DROP CONSTRAINT journal_entries_status_check;
ALTER TABLE journal_entries ADD CONSTRAINT journal_entries_status_check
    CHECK (status IN ('draft','posted','void'));
ALTER TABLE journal_entries
    ADD COLUMN reverses_entry_id INT REFERENCES journal_entries(id),
    ADD COLUMN is_reversal       BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX idx_journal_entries_reverses ON journal_entries(reverses_entry_id);
