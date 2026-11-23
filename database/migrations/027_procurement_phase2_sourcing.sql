-- =====================================================================
-- 027: Procurement Management - Phase 2: sourcing, supplier quotations, comparison, PO authorization
-- Extends suppliers / purchase_orders / purchase_items / procurement_approvals (nothing duplicated).
-- Apply once with: node backend/src/scripts/apply-migration.js 027_procurement_phase2_sourcing.sql
-- =====================================================================

ALTER TABLE suppliers ADD COLUMN payment_terms_days INT NOT NULL DEFAULT 30 CHECK (payment_terms_days >= 0);
ALTER TABLE suppliers ADD COLUMN tax_no VARCHAR(40);

-- One request-for-quotation per supplier per requisition.
CREATE TABLE supplier_quotations (
    id                 SERIAL PRIMARY KEY,
    quotation_number   VARCHAR(20) UNIQUE NOT NULL,
    requisition_id     INT NOT NULL REFERENCES purchase_requisitions(id),
    supplier_id        INT NOT NULL REFERENCES suppliers(id),
    status             VARCHAR(12) NOT NULL DEFAULT 'requested'
                         CHECK (status IN ('requested','received','declined','selected','rejected')),
    requested_by       INT NOT NULL REFERENCES users(id),
    requested_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    received_at        TIMESTAMPTZ,
    valid_until        DATE,
    delivery_days      INT CHECK (delivery_days IS NULL OR delivery_days >= 0),
    payment_terms_days INT CHECK (payment_terms_days IS NULL OR payment_terms_days >= 0),
    quality_rating     INT CHECK (quality_rating IS NULL OR quality_rating BETWEEN 1 AND 5),
    is_complete        BOOLEAN NOT NULL DEFAULT false,        -- prices every requisition line
    total_amount       NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
    notes              TEXT,
    UNIQUE (requisition_id, supplier_id)
);
CREATE INDEX idx_sq_requisition ON supplier_quotations(requisition_id);
CREATE INDEX idx_sq_supplier ON supplier_quotations(supplier_id);

CREATE TABLE supplier_quotation_lines (
    id                  SERIAL PRIMARY KEY,
    quotation_id        INT NOT NULL REFERENCES supplier_quotations(id) ON DELETE CASCADE,
    requisition_line_id INT NOT NULL REFERENCES purchase_requisition_lines(id),
    unit_price          NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),
    line_total          NUMERIC(14,2) NOT NULL CHECK (line_total >= 0),
    UNIQUE (quotation_id, requisition_line_id)
);
CREATE INDEX idx_sql_quotation ON supplier_quotation_lines(quotation_id);

-- The chosen supplier and WHY (mandatory unless it is the clear lowest complete quotation among 2+).
ALTER TABLE purchase_requisitions ADD COLUMN selected_quotation_id INT REFERENCES supplier_quotations(id);
ALTER TABLE purchase_requisitions ADD COLUMN selection_justification TEXT;
ALTER TABLE purchase_requisitions ADD COLUMN selected_by INT REFERENCES users(id);
ALTER TABLE purchase_requisitions ADD COLUMN selected_at TIMESTAMPTZ;

-- Purchase orders raised from a requisition carry the link, the quotation and the Operation Manager authorization.
ALTER TABLE purchase_orders ADD COLUMN requisition_id INT REFERENCES purchase_requisitions(id);
ALTER TABLE purchase_orders ADD COLUMN quotation_id INT REFERENCES supplier_quotations(id);
ALTER TABLE purchase_orders ADD COLUMN department_id INT REFERENCES departments(id);
ALTER TABLE purchase_orders ADD COLUMN payment_terms_days INT CHECK (payment_terms_days IS NULL OR payment_terms_days >= 0);
ALTER TABLE purchase_orders ADD COLUMN authorized_by INT REFERENCES users(id);
ALTER TABLE purchase_orders ADD COLUMN authorized_at TIMESTAMPTZ;
CREATE INDEX idx_po_requisition ON purchase_orders(requisition_id);
-- A requisition can only have ONE live purchase order at a time (concurrency-safe).
CREATE UNIQUE INDEX idx_po_one_live_per_requisition ON purchase_orders(requisition_id)
  WHERE requisition_id IS NOT NULL AND status NOT IN ('cancelled','reversed');

ALTER TABLE purchase_items ADD COLUMN requisition_line_id INT REFERENCES purchase_requisition_lines(id);

ALTER TABLE purchase_orders DROP CONSTRAINT purchase_orders_status_check;
ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_status_check
  CHECK (status IN ('draft','pending_authorization','authorized','sent','partially_received','received','invoiced','paid','closed','cancelled','reversed'));

ALTER TABLE procurement_approvals DROP CONSTRAINT procurement_approvals_step_check;
ALTER TABLE procurement_approvals ADD CONSTRAINT procurement_approvals_step_check
  CHECK (step IN ('submission','dept_review','ops_approval','assignment','supplier_selection','po_submission','po_authorization','invoice_approval','payment_approval'));
