-- =====================================================================
-- 026: Procurement Management - Phase 1: roles, requisitions, approvals, audit
-- (see docs/PROCUREMENT_MODULE_PLAN.md). Extends the existing suppliers / purchase_orders /
-- goods_receipts / attachments / departments - nothing is duplicated.
-- Apply once to an existing database with: node backend/src/scripts/apply-migration.js 026_procurement_phase1_requisitions.sql
-- Fresh installs get the same objects from schema.sql (+ the roles from seed.sql).
-- =====================================================================

-- Roles for the approval chain (ids are appended; existing role ids never change).
INSERT INTO roles (name, description)
SELECT 'Department Head', 'Reviews purchase requisitions raised by their department'
WHERE NOT EXISTS (SELECT 1 FROM roles WHERE name = 'Department Head');
INSERT INTO roles (name, description)
SELECT 'Operation Manager', 'Approves requisitions and authorizes purchase orders; procurement oversight'
WHERE NOT EXISTS (SELECT 1 FROM roles WHERE name = 'Operation Manager');

-- Atomic, gap-tolerant reference numbers: PR-2026-00001, QT-..., GRN-..., MIN-..., SINV-..., PV-...
CREATE TABLE procurement_counters (
    prefix      VARCHAR(8) NOT NULL,
    year        INT        NOT NULL,
    next_value  INT        NOT NULL DEFAULT 1 CHECK (next_value >= 1),
    PRIMARY KEY (prefix, year)
);

CREATE TABLE purchase_requisitions (
    id              SERIAL PRIMARY KEY,
    pr_number       VARCHAR(20) UNIQUE NOT NULL,
    department_id   INT NOT NULL REFERENCES departments(id),
    requested_by    INT NOT NULL REFERENCES users(id),
    title           VARCHAR(200) NOT NULL,
    justification   TEXT NOT NULL,
    priority        VARCHAR(10) NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
    required_date   DATE,
    status          VARCHAR(24) NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft','submitted','returned_for_revision','rejected','dept_approved','approved',
                                        'sourcing','po_issued','fulfilled','closed','cancelled')),
    estimated_total NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (estimated_total >= 0),
    assigned_to     INT REFERENCES users(id),                 -- Procurement Officer handling the sourcing
    cost_center_id  INT REFERENCES cost_centers(id),
    version         INT NOT NULL DEFAULT 1,                   -- bumped on every revision after a return
    submitted_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_pr_department ON purchase_requisitions(department_id);
CREATE INDEX idx_pr_requested_by ON purchase_requisitions(requested_by);
CREATE INDEX idx_pr_status ON purchase_requisitions(status);
CREATE INDEX idx_pr_assigned_to ON purchase_requisitions(assigned_to);

CREATE TABLE purchase_requisition_lines (
    id                  SERIAL PRIMARY KEY,
    requisition_id      INT NOT NULL REFERENCES purchase_requisitions(id) ON DELETE CASCADE,
    line_no             INT NOT NULL CHECK (line_no >= 1),
    product_id          INT REFERENCES products(id),          -- NULL for a non-stock item that is described instead
    item_name           VARCHAR(200) NOT NULL,
    description         TEXT,
    quantity            NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
    unit                VARCHAR(20) NOT NULL,
    estimated_unit_cost NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (estimated_unit_cost >= 0),
    UNIQUE (requisition_id, line_no)
);
CREATE INDEX idx_pr_lines_requisition ON purchase_requisition_lines(requisition_id);
CREATE INDEX idx_pr_lines_product ON purchase_requisition_lines(product_id);

-- Every decision on a procurement document: who, in what role, what, when, with a signature hash of the
-- document snapshot that was approved. Append-only (see trigger below).
CREATE TABLE procurement_approvals (
    id             BIGSERIAL PRIMARY KEY,
    entity_type    VARCHAR(24) NOT NULL CHECK (entity_type IN ('requisition','purchase_order','supplier_invoice','supplier_payment')),
    entity_id      INT NOT NULL,
    step           VARCHAR(30) NOT NULL CHECK (step IN ('submission','dept_review','ops_approval','assignment','po_authorization','invoice_approval','payment_approval')),
    decision       VARCHAR(20) NOT NULL CHECK (decision IN ('submitted','approved','rejected','revision_requested','assigned','authorized','cancelled')),
    actor_id       INT NOT NULL REFERENCES users(id),
    actor_role     VARCHAR(60) NOT NULL,
    comments       TEXT,
    decided_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    signature_hash CHAR(64),                                   -- SHA-256 over the approved snapshot + actor + timestamp
    snapshot       JSONB
);
CREATE INDEX idx_proc_approvals_entity ON procurement_approvals(entity_type, entity_id);
CREATE INDEX idx_proc_approvals_actor ON procurement_approvals(actor_id);

CREATE TABLE procurement_audit_logs (
    id          BIGSERIAL PRIMARY KEY,
    entity_type VARCHAR(30) NOT NULL,
    entity_id   INT,
    action      VARCHAR(30) NOT NULL,
    actor_id    INT REFERENCES users(id),
    actor_role  VARCHAR(60),
    old_value   JSONB,
    new_value   JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_proc_audit_entity ON procurement_audit_logs(entity_type, entity_id);
CREATE INDEX idx_proc_audit_created ON procurement_audit_logs(created_at);

-- Approvals and the audit log are evidence: they can be added to but never changed or removed.
CREATE OR REPLACE FUNCTION procurement_block_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_proc_approvals_immutable BEFORE UPDATE OR DELETE ON procurement_approvals
  FOR EACH ROW EXECUTE FUNCTION procurement_block_mutation();
CREATE TRIGGER trg_proc_audit_immutable BEFORE UPDATE OR DELETE ON procurement_audit_logs
  FOR EACH ROW EXECUTE FUNCTION procurement_block_mutation();

-- Attachments are stored in the database (<= 5 MB): the hosting disk is ephemeral. Existing rows keep file_path.
ALTER TABLE attachments ADD COLUMN content BYTEA;
ALTER TABLE attachments ADD CONSTRAINT attachments_size_check CHECK (content IS NULL OR octet_length(content) <= 5242880);
