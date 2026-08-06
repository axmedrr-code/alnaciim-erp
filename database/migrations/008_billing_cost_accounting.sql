-- =====================================================================
-- ENTERPRISE BILLING & COST ACCOUNTING
--
-- Adds the missing dimension every SAP B1 / Business Central / Odoo
-- Enterprise install has from day one: a Cost Center on every
-- transaction, plus Projects, Quotations, and per-Vehicle/Machine cost
-- tracking. Additive only — no existing table is dropped or renamed.
--
-- Design decisions (see plan for full rationale):
--   * Invoice stays merged with Sales Order (invoice_hno is already
--     stamped on the order row) — Quotations are the new pre-order step.
--   * cost_center_id/project_id are nullable on journal_lines and every
--     source document that creates journal entries, so the ledger is the
--     dimension's source of truth and the operational document is just
--     where the user picks it.
--   * Vehicle/machine expense categories map onto the EXISTING 5100-5500
--     Chart of Accounts buckets via a lookup table — no new GL accounts.
--   * Driver commission = % of revenue collected (commission_rate on
--     users), the simplest model that needs no new payroll subsystem.
-- =====================================================================

-- ---------------------------------------------------------------------
-- COST CENTERS (departments)
-- ---------------------------------------------------------------------

CREATE TABLE cost_centers (
    id          SERIAL PRIMARY KEY,
    code        VARCHAR(20) UNIQUE NOT NULL,
    name        VARCHAR(100) NOT NULL,
    type        VARCHAR(30) NOT NULL CHECK (type IN
                 ('production','sales','delivery','procurement','maintenance','warehouse','hr','finance','administration')),
    is_active   BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- PROJECTS
-- ---------------------------------------------------------------------

CREATE TABLE projects (
    id             SERIAL PRIMARY KEY,
    code           VARCHAR(20) UNIQUE NOT NULL,
    name           VARCHAR(150) NOT NULL,
    customer_id    INT REFERENCES customers(id),
    cost_center_id INT REFERENCES cost_centers(id),
    start_date     DATE,
    end_date       DATE,
    budget_amount  NUMERIC(14,2) NOT NULL DEFAULT 0,
    status         VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','on_hold','completed','cancelled')),
    notes          TEXT,
    created_by     INT NOT NULL REFERENCES users(id),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_projects_customer ON projects(customer_id);
CREATE INDEX idx_projects_status ON projects(status);

-- ---------------------------------------------------------------------
-- DIMENSION PROPAGATION — journal_lines is the ledger-truth home for
-- both dimensions; source documents carry them so the poster can copy
-- them onto the journal lines it creates.
-- ---------------------------------------------------------------------

ALTER TABLE journal_lines ADD COLUMN cost_center_id INT REFERENCES cost_centers(id);
ALTER TABLE journal_lines ADD COLUMN project_id     INT REFERENCES projects(id);
CREATE INDEX idx_journal_lines_cost_center ON journal_lines(cost_center_id);
CREATE INDEX idx_journal_lines_project ON journal_lines(project_id);

ALTER TABLE sales_orders ADD COLUMN cost_center_id INT REFERENCES cost_centers(id);
ALTER TABLE sales_orders ADD COLUMN project_id     INT REFERENCES projects(id);
CREATE INDEX idx_sales_orders_cost_center ON sales_orders(cost_center_id);
CREATE INDEX idx_sales_orders_project ON sales_orders(project_id);

ALTER TABLE purchase_orders ADD COLUMN cost_center_id INT REFERENCES cost_centers(id);
ALTER TABLE purchase_orders ADD COLUMN project_id     INT REFERENCES projects(id);
CREATE INDEX idx_purchase_orders_cost_center ON purchase_orders(cost_center_id);
CREATE INDEX idx_purchase_orders_project ON purchase_orders(project_id);

ALTER TABLE expenses ADD COLUMN cost_center_id INT REFERENCES cost_centers(id);
ALTER TABLE expenses ADD COLUMN project_id     INT REFERENCES projects(id);
CREATE INDEX idx_expenses_cost_center ON expenses(cost_center_id);
CREATE INDEX idx_expenses_project ON expenses(project_id);

ALTER TABLE maintenance_logs ADD COLUMN cost_center_id INT REFERENCES cost_centers(id);
ALTER TABLE production_batches ADD COLUMN cost_center_id INT REFERENCES cost_centers(id);

-- ---------------------------------------------------------------------
-- QUOTATIONS — new pre-Sales-Order step. Never touches the ledger;
-- converting a quotation creates a real sales_order which posts exactly
-- like any other order.
-- ---------------------------------------------------------------------

CREATE TABLE quotations (
    id             SERIAL PRIMARY KEY,
    quote_number   VARCHAR(30) UNIQUE NOT NULL,
    customer_id    INT NOT NULL REFERENCES customers(id),
    quote_date     DATE NOT NULL DEFAULT CURRENT_DATE,
    valid_until    DATE,
    sales_rep_id   INT REFERENCES users(id),
    status         VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','accepted','rejected','expired','converted')),
    subtotal       NUMERIC(12,2) NOT NULL DEFAULT 0,
    discount       NUMERIC(12,2) NOT NULL DEFAULT 0,
    tax            NUMERIC(12,2) NOT NULL DEFAULT 0,
    total_amount   NUMERIC(12,2) NOT NULL DEFAULT 0,
    cost_center_id INT REFERENCES cost_centers(id),
    project_id     INT REFERENCES projects(id),
    converted_sales_order_id INT REFERENCES sales_orders(id),
    notes          TEXT,
    created_by     INT NOT NULL REFERENCES users(id),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_quotations_customer ON quotations(customer_id);
CREATE INDEX idx_quotations_status ON quotations(status);

CREATE TABLE quotation_items (
    id            SERIAL PRIMARY KEY,
    quotation_id  INT NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
    product_id    INT NOT NULL REFERENCES products(id),
    quantity      NUMERIC(12,3) NOT NULL,
    unit_price    NUMERIC(12,2) NOT NULL,
    discount      NUMERIC(12,2) NOT NULL DEFAULT 0,
    subtotal      NUMERIC(12,2) NOT NULL
);

-- ---------------------------------------------------------------------
-- VEHICLE BILLING — cost tracking per truck. Revenue per vehicle is
-- derived (deliveries -> sales_orders), no new revenue table needed.
-- ---------------------------------------------------------------------

CREATE TABLE vehicle_expenses (
    id              SERIAL PRIMARY KEY,
    truck_id        INT NOT NULL REFERENCES trucks(id),
    category        VARCHAR(20) NOT NULL CHECK (category IN
                     ('fuel','repairs','tires','oil','driver_salary','insurance','parking','license','other')),
    amount          NUMERIC(12,2) NOT NULL,
    expense_date    DATE NOT NULL DEFAULT CURRENT_DATE,
    odometer_km     NUMERIC(10,1),
    description     TEXT,
    cost_center_id  INT REFERENCES cost_centers(id),
    payment_method  VARCHAR(20) NOT NULL DEFAULT 'cash' CHECK (payment_method IN ('cash','bank_transfer','cheque')),
    bank_account_id INT REFERENCES bank_accounts(id),
    recorded_by     INT NOT NULL REFERENCES users(id),
    voided_at       TIMESTAMPTZ,
    voided_by       INT REFERENCES users(id),
    void_reason     TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_vehicle_expenses_truck_date ON vehicle_expenses(truck_id, expense_date);

-- Maps each vehicle_expenses.category onto an existing 5100-5500 expense
-- account — reuses the seeded Chart of Accounts instead of inventing
-- parallel GL accounts.
CREATE TABLE vehicle_expense_category_accounts (
    category       VARCHAR(20) PRIMARY KEY,
    coa_account_id INT NOT NULL REFERENCES chart_of_accounts(id)
);

-- ---------------------------------------------------------------------
-- MACHINE COSTING
-- ---------------------------------------------------------------------

CREATE TABLE machine_costs (
    id              SERIAL PRIMARY KEY,
    machine_id      INT NOT NULL REFERENCES machines(id),
    category        VARCHAR(20) NOT NULL CHECK (category IN ('fuel_power','parts','labor','other')),
    amount          NUMERIC(12,2) NOT NULL,
    cost_date       DATE NOT NULL DEFAULT CURRENT_DATE,
    description     TEXT,
    cost_center_id  INT REFERENCES cost_centers(id),
    payment_method  VARCHAR(20) NOT NULL DEFAULT 'cash' CHECK (payment_method IN ('cash','bank_transfer','cheque')),
    bank_account_id INT REFERENCES bank_accounts(id),
    recorded_by     INT NOT NULL REFERENCES users(id),
    voided_at       TIMESTAMPTZ,
    voided_by       INT REFERENCES users(id),
    void_reason     TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_machine_costs_machine_date ON machine_costs(machine_id, cost_date);

CREATE TABLE machine_cost_category_accounts (
    category       VARCHAR(20) PRIMARY KEY,
    coa_account_id INT NOT NULL REFERENCES chart_of_accounts(id)
);

-- ---------------------------------------------------------------------
-- DRIVER COMMISSION
-- ---------------------------------------------------------------------

ALTER TABLE users ADD COLUMN commission_rate NUMERIC(5,2); -- percent, e.g. 2.50 = 2.5% of collections
