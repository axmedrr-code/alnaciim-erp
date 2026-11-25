-- 030: Procurement Phase 5 foundation — supplier invoices and matching.
-- This migration is deliberately not applied automatically. Apply only to a
-- verified TEST database first, then deploy through the approved release path.

CREATE TABLE supplier_invoices (
    id                  SERIAL PRIMARY KEY,
    internal_number     VARCHAR(24) NOT NULL UNIQUE,
    supplier_id         INT NOT NULL REFERENCES suppliers(id),
    purchase_order_id   INT NOT NULL REFERENCES purchase_orders(id),
    supplier_invoice_no VARCHAR(80) NOT NULL,
    invoice_date        DATE NOT NULL,
    due_date            DATE,
    subtotal            NUMERIC(14,2) NOT NULL CHECK (subtotal >= 0),
    total_amount        NUMERIC(14,2) NOT NULL CHECK (total_amount >= 0),
    status              VARCHAR(16) NOT NULL DEFAULT 'registered'
                          CHECK (status IN ('registered','matched','mismatch','approved','partially_paid','paid','voided')),
    match_result        JSONB,
    notes               TEXT,
    void_reason         TEXT,
    registered_by       INT NOT NULL REFERENCES users(id),
    registered_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    matched_by          INT REFERENCES users(id),
    matched_at          TIMESTAMPTZ,
    approved_by         INT REFERENCES users(id),
    approved_at         TIMESTAMPTZ,
    UNIQUE (supplier_id, supplier_invoice_no)
);
CREATE INDEX idx_supplier_invoices_po ON supplier_invoices(purchase_order_id, status);
CREATE INDEX idx_supplier_invoices_supplier ON supplier_invoices(supplier_id, invoice_date DESC);

CREATE TABLE supplier_invoice_lines (
    id                  SERIAL PRIMARY KEY,
    supplier_invoice_id INT NOT NULL REFERENCES supplier_invoices(id) ON DELETE CASCADE,
    purchase_item_id    INT NOT NULL REFERENCES purchase_items(id),
    quantity            NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
    unit_price          NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),
    line_total          NUMERIC(14,2) NOT NULL CHECK (line_total >= 0),
    UNIQUE (supplier_invoice_id, purchase_item_id)
);

-- New payments are linked to approved supplier invoices and carry a unique
-- printable voucher. Existing PO-level payments retain their original state.
ALTER TABLE supplier_payments
    ADD COLUMN supplier_invoice_id INT REFERENCES supplier_invoices(id),
    ADD COLUMN voucher_number VARCHAR(24),
    ADD COLUMN status VARCHAR(12) NOT NULL DEFAULT 'legacy'
        CHECK (status IN ('legacy','pending','approved','rejected','voided')),
    ADD COLUMN approved_by INT REFERENCES users(id),
    ADD COLUMN approved_at TIMESTAMPTZ;
CREATE UNIQUE INDEX uq_supplier_payment_voucher
    ON supplier_payments(voucher_number) WHERE voucher_number IS NOT NULL;
