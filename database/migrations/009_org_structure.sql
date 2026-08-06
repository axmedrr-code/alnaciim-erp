-- =====================================================================
-- ORGANIZATIONAL STRUCTURE: Company / Branch / Department / Attachments
--
-- Additive, non-breaking foundation for enterprise architecture asks
-- (multi-company, branch, department, warehouse hierarchy, document
-- attachments). This is NOT a multi-tenant rewrite: exactly one company
-- and one branch are seeded to match today's actual single-company
-- reality, every existing row is backfilled to those defaults, and no
-- existing table's behavior changes. A multi-company switcher UI is
-- explicitly out of scope for this phase.
-- =====================================================================

CREATE TABLE companies (
    id          SERIAL PRIMARY KEY,
    code        VARCHAR(20) UNIQUE NOT NULL,
    name        VARCHAR(150) NOT NULL,
    is_active   BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE branches (
    id          SERIAL PRIMARY KEY,
    company_id  INT NOT NULL REFERENCES companies(id),
    code        VARCHAR(20) UNIQUE NOT NULL,
    name        VARCHAR(150) NOT NULL,
    is_active   BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_branches_company ON branches(company_id);

CREATE TABLE departments (
    id             SERIAL PRIMARY KEY,
    code           VARCHAR(20) UNIQUE NOT NULL,
    name           VARCHAR(100) NOT NULL,
    cost_center_id INT REFERENCES cost_centers(id),
    branch_id      INT REFERENCES branches(id),
    manager_id     INT REFERENCES users(id),
    is_active      BOOLEAN NOT NULL DEFAULT true,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_departments_cost_center ON departments(cost_center_id);
CREATE INDEX idx_departments_branch ON departments(branch_id);

-- Warehouse hierarchy — self-referencing, nullable, all existing rows
-- stay NULL (top-level), exactly matching today's flat structure.
ALTER TABLE warehouses ADD COLUMN parent_warehouse_id INT REFERENCES warehouses(id);
CREATE INDEX idx_warehouses_parent ON warehouses(parent_warehouse_id);

-- Users gain a formal department/branch link. The existing free-text
-- users.department column is left untouched — nothing that reads it breaks.
ALTER TABLE users ADD COLUMN department_id INT REFERENCES departments(id);
ALTER TABLE users ADD COLUMN branch_id     INT REFERENCES branches(id);

-- Company/Branch dimension propagation — same table list that got
-- cost_center_id/project_id in migration 008.
ALTER TABLE journal_lines    ADD COLUMN company_id INT REFERENCES companies(id);
ALTER TABLE journal_lines    ADD COLUMN branch_id  INT REFERENCES branches(id);
CREATE INDEX idx_journal_lines_company ON journal_lines(company_id);
CREATE INDEX idx_journal_lines_branch  ON journal_lines(branch_id);

ALTER TABLE sales_orders     ADD COLUMN company_id INT REFERENCES companies(id);
ALTER TABLE sales_orders     ADD COLUMN branch_id  INT REFERENCES branches(id);
CREATE INDEX idx_sales_orders_company ON sales_orders(company_id);
CREATE INDEX idx_sales_orders_branch  ON sales_orders(branch_id);

ALTER TABLE purchase_orders  ADD COLUMN company_id INT REFERENCES companies(id);
ALTER TABLE purchase_orders  ADD COLUMN branch_id  INT REFERENCES branches(id);
CREATE INDEX idx_purchase_orders_company ON purchase_orders(company_id);
CREATE INDEX idx_purchase_orders_branch  ON purchase_orders(branch_id);

ALTER TABLE expenses         ADD COLUMN company_id INT REFERENCES companies(id);
ALTER TABLE expenses         ADD COLUMN branch_id  INT REFERENCES branches(id);
CREATE INDEX idx_expenses_company ON expenses(company_id);
CREATE INDEX idx_expenses_branch  ON expenses(branch_id);

-- Generic polymorphic attachments — mirrors the existing audit_logs /
-- stock_movements.reference_type+id polymorphic pattern already used
-- elsewhere in this schema.
CREATE TABLE attachments (
    id          SERIAL PRIMARY KEY,
    entity_type VARCHAR(30) NOT NULL,
    entity_id   INT NOT NULL,
    file_name   VARCHAR(255) NOT NULL,
    file_path   VARCHAR(500) NOT NULL,
    mime_type   VARCHAR(100),
    file_size   BIGINT,
    uploaded_by INT NOT NULL REFERENCES users(id),
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_attachments_entity ON attachments(entity_type, entity_id);

-- ---- Seed: exactly one company + one branch (matches reality today) ----
INSERT INTO companies (code, name) VALUES ('HQ', 'Alnaciim Water Company');
INSERT INTO branches (company_id, code, name) VALUES (1, 'MAIN', 'Main Branch');

-- ---- Seed: one department per existing cost center, under the seeded branch ----
INSERT INTO departments (code, name, cost_center_id, branch_id)
SELECT code, name, id, 1 FROM cost_centers ORDER BY id;

-- ---- Backfill: every existing row gets the seeded company/branch so no
--      existing record is ever missing the dimension. ----
UPDATE journal_lines   SET company_id = 1, branch_id = 1 WHERE company_id IS NULL;
UPDATE sales_orders    SET company_id = 1, branch_id = 1 WHERE company_id IS NULL;
UPDATE purchase_orders SET company_id = 1, branch_id = 1 WHERE company_id IS NULL;
UPDATE expenses        SET company_id = 1, branch_id = 1 WHERE company_id IS NULL;
UPDATE users            SET branch_id = 1 WHERE branch_id IS NULL;
