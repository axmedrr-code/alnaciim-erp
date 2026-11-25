-- =====================================================================
-- 029: Procurement Phase 3 - goods receipt notes (accepted / damaged / rejected) and material issuing with department confirmation
-- Extends goods_receipts / goods_receipt_items / purchase_items (the existing receive flow stays the single receiving path).
-- =====================================================================

ALTER TABLE goods_receipts ADD COLUMN grn_number VARCHAR(20) UNIQUE;
ALTER TABLE goods_receipts ADD COLUMN delivery_note_no VARCHAR(60);

ALTER TABLE goods_receipt_items DROP CONSTRAINT goods_receipt_items_condition_check;
ALTER TABLE goods_receipt_items ADD CONSTRAINT goods_receipt_items_condition_check CHECK (condition IN ('good','damaged','rejected'));
ALTER TABLE goods_receipt_items ADD COLUMN notes TEXT;

-- quantity_received = physically delivered; quantity_accepted = good units that entered stock (drives PO fulfilment and the AP credit).
ALTER TABLE purchase_items ADD COLUMN quantity_accepted NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (quantity_accepted >= 0);
ALTER TABLE purchase_items ADD COLUMN quantity_rejected NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (quantity_rejected >= 0);
UPDATE purchase_items pi SET
  quantity_accepted = COALESCE((SELECT SUM(g.quantity_received) FROM goods_receipt_items g WHERE g.purchase_item_id = pi.id AND g.condition = 'good'), 0),
  quantity_rejected = COALESCE((SELECT SUM(g.quantity_received) FROM goods_receipt_items g WHERE g.purchase_item_id = pi.id AND g.condition <> 'good'), 0);

ALTER TABLE stock_movements DROP CONSTRAINT stock_movements_reference_type_check;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_reference_type_check
  CHECK (reference_type IN ('purchase','production','sales','maintenance','transfer','adjustment','tanker_load','issue'));

-- Materials issued from a warehouse to the requesting department; the department must confirm what it actually got.
CREATE TABLE material_issues (
    id              SERIAL PRIMARY KEY,
    issue_number    VARCHAR(20) UNIQUE NOT NULL,
    requisition_id  INT NOT NULL REFERENCES purchase_requisitions(id),
    department_id   INT NOT NULL REFERENCES departments(id),
    warehouse_id    INT NOT NULL REFERENCES warehouses(id),
    status          VARCHAR(12) NOT NULL DEFAULT 'issued' CHECK (status IN ('issued','confirmed','disputed')),
    issued_by       INT NOT NULL REFERENCES users(id),
    issued_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    confirmed_by    INT REFERENCES users(id),
    confirmed_at    TIMESTAMPTZ,
    confirm_notes   TEXT,
    notes           TEXT
);
CREATE INDEX idx_issue_requisition ON material_issues(requisition_id);

CREATE TABLE material_issue_items (
    id                  SERIAL PRIMARY KEY,
    issue_id            INT NOT NULL REFERENCES material_issues(id) ON DELETE CASCADE,
    requisition_line_id INT NOT NULL REFERENCES purchase_requisition_lines(id),
    product_id          INT NOT NULL REFERENCES products(id),
    quantity            NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
    unit_cost           NUMERIC(12,2) NOT NULL CHECK (unit_cost >= 0)
);
CREATE INDEX idx_issue_items_line ON material_issue_items(requisition_line_id);

ALTER TABLE procurement_approvals DROP CONSTRAINT procurement_approvals_entity_type_check;
ALTER TABLE procurement_approvals ADD CONSTRAINT procurement_approvals_entity_type_check
  CHECK (entity_type IN ('requisition','purchase_order','supplier_invoice','supplier_payment','material_issue'));
ALTER TABLE procurement_approvals DROP CONSTRAINT procurement_approvals_step_check;
ALTER TABLE procurement_approvals ADD CONSTRAINT procurement_approvals_step_check
  CHECK (step IN ('submission','dept_review','ops_approval','assignment','supplier_selection','po_submission','po_authorization','invoice_approval','payment_approval','issue_confirmation'));
ALTER TABLE procurement_approvals DROP CONSTRAINT procurement_approvals_decision_check;
ALTER TABLE procurement_approvals ADD CONSTRAINT procurement_approvals_decision_check
  CHECK (decision IN ('submitted','approved','rejected','revision_requested','assigned','authorized','cancelled','confirmed','disputed'));
