-- =====================================================================
-- Alnaciim Water Company — Inventory & Manufacturing ERP
-- PostgreSQL schema (matches docs/DESIGN.md section 2)
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- USERS & ROLES
-- ---------------------------------------------------------------------

CREATE TABLE roles (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(50) UNIQUE NOT NULL,
    description TEXT
);

CREATE TABLE warehouses (
    id          SERIAL PRIMARY KEY,
    code        VARCHAR(20) UNIQUE NOT NULL,
    name        VARCHAR(100) NOT NULL,
    type        VARCHAR(30) NOT NULL CHECK (type IN ('raw_material','finished_goods','spare_parts','general')),
    location    VARCHAR(200),
    manager_id  INT,
    is_active   BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
    id                     SERIAL PRIMARY KEY,
    employee_code          VARCHAR(20) UNIQUE NOT NULL,
    full_name              VARCHAR(120) NOT NULL,
    email                  VARCHAR(120) UNIQUE NOT NULL,
    password_hash          VARCHAR(255) NOT NULL,
    role_id                INT NOT NULL REFERENCES roles(id),
    department             VARCHAR(50),
    phone                  VARCHAR(30),
    assigned_warehouse_id  INT REFERENCES warehouses(id),
    is_active              BOOLEAN NOT NULL DEFAULT true,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE warehouses ADD CONSTRAINT fk_warehouses_manager
    FOREIGN KEY (manager_id) REFERENCES users(id);

-- ---------------------------------------------------------------------
-- PRODUCTS & CATEGORIES
-- ---------------------------------------------------------------------

CREATE TABLE categories (
    id           SERIAL PRIMARY KEY,
    name         VARCHAR(100) NOT NULL,
    parent_id    INT REFERENCES categories(id),
    product_type VARCHAR(20) NOT NULL CHECK (product_type IN ('raw_material','finished_good','spare_part'))
);

CREATE TABLE products (
    id             SERIAL PRIMARY KEY,
    sku            VARCHAR(30) UNIQUE NOT NULL,
    barcode        VARCHAR(50) UNIQUE,
    name           VARCHAR(150) NOT NULL,
    category_id    INT NOT NULL REFERENCES categories(id),
    product_type   VARCHAR(20) NOT NULL CHECK (product_type IN ('raw_material','finished_good','spare_part')),
    unit           VARCHAR(20) NOT NULL,
    unit_cost      NUMERIC(12,2) NOT NULL DEFAULT 0,
    unit_price     NUMERIC(12,2) NOT NULL DEFAULT 0,
    reorder_level  NUMERIC(12,2) NOT NULL DEFAULT 0,
    reorder_qty    NUMERIC(12,2) NOT NULL DEFAULT 0,
    is_active      BOOLEAN NOT NULL DEFAULT true,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_products_category ON products(category_id);
CREATE INDEX idx_products_type ON products(product_type);

-- ---------------------------------------------------------------------
-- INVENTORY: STOCK LEVELS & MOVEMENTS
-- ---------------------------------------------------------------------

CREATE TABLE stock_levels (
    id           SERIAL PRIMARY KEY,
    product_id   INT NOT NULL REFERENCES products(id),
    warehouse_id INT NOT NULL REFERENCES warehouses(id),
    quantity     NUMERIC(14,3) NOT NULL DEFAULT 0,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (product_id, warehouse_id)
);

CREATE TABLE stock_movements (
    id                    BIGSERIAL PRIMARY KEY,
    product_id            INT NOT NULL REFERENCES products(id),
    warehouse_id          INT NOT NULL REFERENCES warehouses(id),
    movement_type         VARCHAR(20) NOT NULL CHECK (movement_type IN ('IN','OUT','TRANSFER_IN','TRANSFER_OUT','ADJUSTMENT')),
    quantity              NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
    reference_type        VARCHAR(30) CHECK (reference_type IN ('purchase','production','sales','maintenance','transfer','adjustment')),
    reference_id          INT,
    related_warehouse_id  INT REFERENCES warehouses(id),
    performed_by          INT NOT NULL REFERENCES users(id),
    notes                 TEXT,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_stock_movements_product ON stock_movements(product_id);
CREATE INDEX idx_stock_movements_warehouse ON stock_movements(warehouse_id);
CREATE INDEX idx_stock_movements_reference ON stock_movements(reference_type, reference_id);
CREATE INDEX idx_stock_movements_created_at ON stock_movements(created_at);

-- ---------------------------------------------------------------------
-- PRODUCTION
-- ---------------------------------------------------------------------

CREATE TABLE machines (
    id             SERIAL PRIMARY KEY,
    code           VARCHAR(30) UNIQUE NOT NULL,
    name           VARCHAR(100) NOT NULL,
    type           VARCHAR(30) NOT NULL CHECK (type IN ('RO_PLANT','FILLING_LINE','ICE_MACHINE','PACKAGING','GENERATOR','VEHICLE')),
    warehouse_id   INT REFERENCES warehouses(id),
    purchase_date  DATE,
    status         VARCHAR(20) NOT NULL DEFAULT 'operational' CHECK (status IN ('operational','under_maintenance','breakdown','retired')),
    specifications JSONB
);

CREATE TABLE production_batches (
    id                      SERIAL PRIMARY KEY,
    batch_number            VARCHAR(30) UNIQUE NOT NULL,
    production_type         VARCHAR(20) NOT NULL CHECK (production_type IN ('RO_WATER','BOTTLING','ICE')),
    product_id              INT REFERENCES products(id),
    machine_id              INT NOT NULL REFERENCES machines(id),
    planned_qty             NUMERIC(14,3) NOT NULL DEFAULT 0,
    actual_qty              NUMERIC(14,3),
    unit                    VARCHAR(20) NOT NULL,
    shift                   VARCHAR(10) CHECK (shift IN ('Morning','Afternoon','Night')),
    start_time              TIMESTAMPTZ,
    end_time                TIMESTAMPTZ,
    supervisor_id           INT NOT NULL REFERENCES users(id),
    status                  VARCHAR(20) NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','in_progress','completed','cancelled')),
    destination_warehouse_id INT REFERENCES warehouses(id),
    notes                   TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_production_batches_date ON production_batches(start_time);
CREATE INDEX idx_production_batches_status ON production_batches(status);

CREATE TABLE production_batch_materials (
    id             SERIAL PRIMARY KEY,
    batch_id       INT NOT NULL REFERENCES production_batches(id) ON DELETE CASCADE,
    product_id     INT NOT NULL REFERENCES products(id),
    quantity_used  NUMERIC(14,3) NOT NULL,
    warehouse_id   INT NOT NULL REFERENCES warehouses(id)
);

CREATE TABLE machine_usage_logs (
    id               SERIAL PRIMARY KEY,
    machine_id       INT NOT NULL REFERENCES machines(id),
    log_date         DATE NOT NULL,
    shift            VARCHAR(10),
    hours_used       NUMERIC(5,2) NOT NULL DEFAULT 0,
    output_quantity  NUMERIC(14,3),
    output_unit      VARCHAR(20),
    operator_id      INT NOT NULL REFERENCES users(id),
    notes            TEXT
);

CREATE INDEX idx_machine_usage_logs_machine_date ON machine_usage_logs(machine_id, log_date);

CREATE TABLE downtime_logs (
    id           SERIAL PRIMARY KEY,
    machine_id   INT NOT NULL REFERENCES machines(id),
    start_time   TIMESTAMPTZ NOT NULL,
    end_time     TIMESTAMPTZ,
    category     VARCHAR(30) NOT NULL CHECK (category IN ('breakdown','scheduled_maintenance','power_outage','other')),
    reason       TEXT,
    reported_by  INT NOT NULL REFERENCES users(id),
    resolved_by  INT REFERENCES users(id)
);

CREATE INDEX idx_downtime_logs_machine ON downtime_logs(machine_id);

-- ---------------------------------------------------------------------
-- MAINTENANCE
-- ---------------------------------------------------------------------

CREATE TABLE maintenance_schedules (
    id               SERIAL PRIMARY KEY,
    machine_id       INT NOT NULL REFERENCES machines(id),
    maintenance_type VARCHAR(20) NOT NULL CHECK (maintenance_type IN ('preventive','corrective')),
    frequency_days   INT,
    last_done_date   DATE,
    next_due_date    DATE,
    assigned_to      INT REFERENCES users(id),
    description      TEXT
);

CREATE INDEX idx_maintenance_schedules_due ON maintenance_schedules(next_due_date);

CREATE TABLE maintenance_logs (
    id            SERIAL PRIMARY KEY,
    machine_id    INT NOT NULL REFERENCES machines(id),
    schedule_id   INT REFERENCES maintenance_schedules(id),
    downtime_id   INT REFERENCES downtime_logs(id),
    type          VARCHAR(20) NOT NULL CHECK (type IN ('preventive','corrective','breakdown_repair')),
    performed_by  INT NOT NULL REFERENCES users(id),
    log_date      DATE NOT NULL DEFAULT CURRENT_DATE,
    description   TEXT,
    cost          NUMERIC(12,2) DEFAULT 0,
    status        VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed'))
);

CREATE TABLE maintenance_parts_used (
    id                  SERIAL PRIMARY KEY,
    maintenance_log_id  INT NOT NULL REFERENCES maintenance_logs(id) ON DELETE CASCADE,
    product_id          INT NOT NULL REFERENCES products(id),
    quantity            NUMERIC(12,3) NOT NULL,
    warehouse_id        INT NOT NULL REFERENCES warehouses(id)
);

-- ---------------------------------------------------------------------
-- SALES & DISTRIBUTION
-- ---------------------------------------------------------------------

CREATE TABLE customers (
    id                 SERIAL PRIMARY KEY,
    code               VARCHAR(20) UNIQUE NOT NULL,
    name               VARCHAR(150) NOT NULL,
    type               VARCHAR(20) NOT NULL CHECK (type IN ('retail','wholesale','distributor','tanker')),
    phone              VARCHAR(30),
    email              VARCHAR(120),
    address            VARCHAR(200),
    city               VARCHAR(80),
    credit_limit       NUMERIC(12,2) NOT NULL DEFAULT 0,
    payment_terms_days INT NOT NULL DEFAULT 0,
    sales_rep_id       INT REFERENCES users(id),
    is_active          BOOLEAN NOT NULL DEFAULT true,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE price_lists (
    id               SERIAL PRIMARY KEY,
    product_id       INT NOT NULL REFERENCES products(id),
    customer_type    VARCHAR(20) NOT NULL CHECK (customer_type IN ('retail','wholesale','distributor','tanker')),
    unit_price       NUMERIC(12,2) NOT NULL,
    effective_from   DATE NOT NULL DEFAULT CURRENT_DATE,
    effective_to     DATE
);

CREATE INDEX idx_price_lists_product_type ON price_lists(product_id, customer_type);

CREATE TABLE sales_orders (
    id             SERIAL PRIMARY KEY,
    order_number   VARCHAR(30) UNIQUE NOT NULL,
    customer_id    INT NOT NULL REFERENCES customers(id),
    order_date     DATE NOT NULL DEFAULT CURRENT_DATE,
    delivery_date  DATE,
    sales_rep_id   INT REFERENCES users(id),
    status         VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','dispatched','delivered','cancelled')),
    payment_status VARCHAR(20) NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid','partial','paid')),
    subtotal       NUMERIC(12,2) NOT NULL DEFAULT 0,
    discount       NUMERIC(12,2) NOT NULL DEFAULT 0,
    tax            NUMERIC(12,2) NOT NULL DEFAULT 0,
    total_amount   NUMERIC(12,2) NOT NULL DEFAULT 0,
    notes          TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sales_orders_customer ON sales_orders(customer_id);
CREATE INDEX idx_sales_orders_status ON sales_orders(status);
CREATE INDEX idx_sales_orders_date ON sales_orders(order_date);

CREATE TABLE sales_order_items (
    id              SERIAL PRIMARY KEY,
    sales_order_id  INT NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
    product_id      INT NOT NULL REFERENCES products(id),
    quantity        NUMERIC(12,3) NOT NULL,
    unit_price      NUMERIC(12,2) NOT NULL,
    discount        NUMERIC(12,2) NOT NULL DEFAULT 0,
    subtotal        NUMERIC(12,2) NOT NULL
);

CREATE TABLE trucks (
    id                  SERIAL PRIMARY KEY,
    plate_number        VARCHAR(20) UNIQUE NOT NULL,
    model               VARCHAR(60),
    capacity            NUMERIC(10,2),
    capacity_unit       VARCHAR(20),
    status              VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','maintenance','inactive')),
    assigned_driver_id  INT REFERENCES users(id)
);

CREATE TABLE deliveries (
    id               SERIAL PRIMARY KEY,
    sales_order_id   INT NOT NULL REFERENCES sales_orders(id),
    truck_id         INT NOT NULL REFERENCES trucks(id),
    driver_id        INT NOT NULL REFERENCES users(id),
    dispatch_time    TIMESTAMPTZ,
    delivery_time    TIMESTAMPTZ,
    status           VARCHAR(20) NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','in_transit','delivered','failed')),
    delivery_address TEXT,
    last_known_lat   NUMERIC(9,6),
    last_known_lng   NUMERIC(9,6),
    pod_reference    VARCHAR(100)
);

CREATE INDEX idx_deliveries_status ON deliveries(status);

CREATE TABLE payments (
    id                SERIAL PRIMARY KEY,
    sales_order_id    INT NOT NULL REFERENCES sales_orders(id),
    amount            NUMERIC(12,2) NOT NULL,
    payment_date      DATE NOT NULL DEFAULT CURRENT_DATE,
    method            VARCHAR(20) NOT NULL CHECK (method IN ('cash','bank_transfer','cheque','credit')),
    reference_number  VARCHAR(60),
    recorded_by       INT NOT NULL REFERENCES users(id)
);

-- ---------------------------------------------------------------------
-- PROCUREMENT
-- ---------------------------------------------------------------------

CREATE TABLE suppliers (
    id              SERIAL PRIMARY KEY,
    code            VARCHAR(20) UNIQUE NOT NULL,
    name            VARCHAR(150) NOT NULL,
    category        VARCHAR(30) CHECK (category IN ('raw_material','packaging','spare_part','chemicals')),
    contact_person  VARCHAR(120),
    phone           VARCHAR(30),
    email           VARCHAR(120),
    address         VARCHAR(200),
    rating          NUMERIC(3,2) NOT NULL DEFAULT 0,
    is_active       BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE purchase_orders (
    id             SERIAL PRIMARY KEY,
    po_number      VARCHAR(30) UNIQUE NOT NULL,
    supplier_id    INT NOT NULL REFERENCES suppliers(id),
    order_date     DATE NOT NULL DEFAULT CURRENT_DATE,
    expected_date  DATE,
    status         VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','partially_received','received','cancelled')),
    total_amount   NUMERIC(12,2) NOT NULL DEFAULT 0,
    created_by     INT NOT NULL REFERENCES users(id),
    notes          TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_purchase_orders_supplier ON purchase_orders(supplier_id);
CREATE INDEX idx_purchase_orders_status ON purchase_orders(status);

CREATE TABLE purchase_items (
    id                  SERIAL PRIMARY KEY,
    purchase_order_id   INT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
    product_id          INT NOT NULL REFERENCES products(id),
    quantity_ordered    NUMERIC(14,3) NOT NULL,
    quantity_received   NUMERIC(14,3) NOT NULL DEFAULT 0,
    unit_cost           NUMERIC(12,2) NOT NULL,
    subtotal            NUMERIC(12,2) NOT NULL
);

CREATE TABLE goods_receipts (
    id                  SERIAL PRIMARY KEY,
    purchase_order_id   INT NOT NULL REFERENCES purchase_orders(id),
    received_date       DATE NOT NULL DEFAULT CURRENT_DATE,
    received_by         INT NOT NULL REFERENCES users(id),
    warehouse_id        INT NOT NULL REFERENCES warehouses(id),
    notes               TEXT
);

CREATE TABLE goods_receipt_items (
    id                  SERIAL PRIMARY KEY,
    goods_receipt_id    INT NOT NULL REFERENCES goods_receipts(id) ON DELETE CASCADE,
    purchase_item_id    INT NOT NULL REFERENCES purchase_items(id),
    quantity_received   NUMERIC(14,3) NOT NULL,
    condition           VARCHAR(20) NOT NULL DEFAULT 'good' CHECK (condition IN ('good','damaged'))
);

CREATE TABLE supplier_performance (
    id                 SERIAL PRIMARY KEY,
    supplier_id        INT NOT NULL REFERENCES suppliers(id),
    purchase_order_id  INT NOT NULL REFERENCES purchase_orders(id),
    on_time_delivery   BOOLEAN NOT NULL,
    quality_rating     INT NOT NULL CHECK (quality_rating BETWEEN 1 AND 5),
    notes              TEXT,
    evaluated_by       INT NOT NULL REFERENCES users(id),
    evaluated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- FINANCE (LIGHT)
-- ---------------------------------------------------------------------

CREATE TABLE expense_categories (
    id    SERIAL PRIMARY KEY,
    name  VARCHAR(100) NOT NULL,
    type  VARCHAR(30) NOT NULL CHECK (type IN ('production','logistics','admin','maintenance','utilities'))
);

CREATE TABLE expenses (
    id                       SERIAL PRIMARY KEY,
    category_id              INT NOT NULL REFERENCES expense_categories(id),
    amount                   NUMERIC(12,2) NOT NULL,
    expense_date             DATE NOT NULL DEFAULT CURRENT_DATE,
    description              TEXT,
    related_reference_type   VARCHAR(30),
    related_reference_id     INT,
    recorded_by              INT NOT NULL REFERENCES users(id)
);

CREATE INDEX idx_expenses_date ON expenses(expense_date);
CREATE INDEX idx_expenses_category ON expenses(category_id);

-- ---------------------------------------------------------------------
-- BONUS / FUTURE
-- ---------------------------------------------------------------------

CREATE TABLE iot_sensor_readings (
    id            BIGSERIAL PRIMARY KEY,
    machine_id    INT NOT NULL REFERENCES machines(id),
    reading_type  VARCHAR(30) NOT NULL,
    value         NUMERIC(12,4) NOT NULL,
    unit          VARCHAR(20),
    recorded_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_iot_readings_machine_time ON iot_sensor_readings(machine_id, recorded_at);

CREATE TABLE audit_logs (
    id           BIGSERIAL PRIMARY KEY,
    user_id      INT REFERENCES users(id),
    action       VARCHAR(20) NOT NULL CHECK (action IN ('CREATE','UPDATE','DELETE')),
    entity_type  VARCHAR(50) NOT NULL,
    entity_id    INT,
    old_value    JSONB,
    new_value    JSONB,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =====================================================================
-- BULK WATER TANKER OPERATIONS (see migrations/002_bulk_water_operations.sql)
-- =====================================================================

-- ---------------------------------------------------------------------
-- CUSTOMER TANK MANAGEMENT
-- ---------------------------------------------------------------------

CREATE TABLE customer_tanks (
    id              SERIAL PRIMARY KEY,
    tank_code       VARCHAR(30) UNIQUE NOT NULL,
    customer_id     INT NOT NULL REFERENCES customers(id),
    tank_type       VARCHAR(30) NOT NULL CHECK (tank_type IN ('tank','drum','underground_reservoir')),
    capacity_liters NUMERIC(10,2) NOT NULL,
    barcode         VARCHAR(50) UNIQUE,
    location        VARCHAR(200),
    installed_date  DATE,
    status          VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_customer_tanks_customer ON customer_tanks(customer_id);

CREATE TABLE tank_maintenance_logs (
    id            SERIAL PRIMARY KEY,
    tank_id       INT NOT NULL REFERENCES customer_tanks(id) ON DELETE CASCADE,
    log_date      DATE NOT NULL DEFAULT CURRENT_DATE,
    description   TEXT,
    performed_by  INT REFERENCES users(id),
    cost          NUMERIC(12,2) NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_tank_maintenance_tank ON tank_maintenance_logs(tank_id);

-- ---------------------------------------------------------------------
-- TANKER LOADING — bulk water leaves the RO storage warehouse onto a
-- truck before any delivery happens. One load can serve multiple stops.
-- ---------------------------------------------------------------------

CREATE TABLE truck_loads (
    id               SERIAL PRIMARY KEY,
    truck_id         INT NOT NULL REFERENCES trucks(id),
    product_id       INT NOT NULL REFERENCES products(id),
    warehouse_id     INT NOT NULL REFERENCES warehouses(id),
    quantity_loaded  NUMERIC(12,2) NOT NULL CHECK (quantity_loaded > 0),
    loaded_by        INT NOT NULL REFERENCES users(id),
    loaded_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    route_date       DATE NOT NULL DEFAULT CURRENT_DATE,
    status           VARCHAR(20) NOT NULL DEFAULT 'loaded' CHECK (status IN ('loaded','in_progress','completed')),
    notes            TEXT
);

CREATE INDEX idx_truck_loads_truck_date ON truck_loads(truck_id, route_date);

-- Link deliveries to a tanker load + the specific customer tank filled,
-- and capture the actual confirmed quantity (bulk water is invoiced on
-- what was actually delivered, not what was ordered).
ALTER TABLE deliveries
    ADD COLUMN truck_load_id      INT REFERENCES truck_loads(id),
    ADD COLUMN customer_tank_id   INT REFERENCES customer_tanks(id),
    ADD COLUMN quantity_delivered NUMERIC(12,2),
    ADD COLUMN signature_name     VARCHAR(120),
    ADD COLUMN confirmed_at       TIMESTAMPTZ;

CREATE INDEX idx_deliveries_truck_load ON deliveries(truck_load_id);
CREATE INDEX idx_deliveries_tank ON deliveries(customer_tank_id);

ALTER TABLE sales_orders
    ADD COLUMN delivery_fee NUMERIC(12,2) NOT NULL DEFAULT 0;

-- Widen stock_movements.reference_type so tanker loading can post its own
-- ledger entries distinct from a finished sale or a production run.
ALTER TABLE stock_movements DROP CONSTRAINT stock_movements_reference_type_check;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_reference_type_check
    CHECK (reference_type IN ('purchase','production','sales','maintenance','transfer','adjustment','tanker_load'));

-- ---------------------------------------------------------------------
-- BILL OF MATERIALS — defines how much of each raw material one unit of
-- a finished good consumes, so batch completion can auto-calculate
-- consumption instead of requiring manual entry every time.
-- ---------------------------------------------------------------------

CREATE TABLE bill_of_materials (
    id          SERIAL PRIMARY KEY,
    product_id  INT NOT NULL UNIQUE REFERENCES products(id),
    name        VARCHAR(150) NOT NULL,
    is_active   BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE bom_items (
    id                       SERIAL PRIMARY KEY,
    bom_id                   INT NOT NULL REFERENCES bill_of_materials(id) ON DELETE CASCADE,
    raw_material_product_id  INT NOT NULL REFERENCES products(id),
    quantity_per_unit        NUMERIC(12,4) NOT NULL CHECK (quantity_per_unit > 0)
);

CREATE INDEX idx_bom_items_bom ON bom_items(bom_id);

-- ---------------------------------------------------------------------
-- PRODUCTION WASTAGE — rejected/spoiled units during a batch, tracked
-- separately from actual_qty (good output).
-- ---------------------------------------------------------------------

ALTER TABLE production_batches
    ADD COLUMN wastage_qty   NUMERIC(14,3) NOT NULL DEFAULT 0,
    ADD COLUMN wastage_notes TEXT;

-- =====================================================================
-- BACKUP & RESTORE AUDIT LOG (see migrations/003_backup_system.sql)
--
-- Deliberately excluded from every pg_dump (see backupService.js) so the
-- audit trail survives a restore instead of being rolled back along with
-- it. triggered_by is a plain column, NOT a FK to users(id) — a live FK
-- from a table outside the dump would block pg_restore --clean from
-- dropping/recreating the users table.
-- =====================================================================

CREATE TABLE backup_logs (
    id              SERIAL PRIMARY KEY,
    operation       VARCHAR(20) NOT NULL CHECK (operation IN ('backup', 'restore')),
    filename        VARCHAR(255),
    file_size_bytes BIGINT,
    status          VARCHAR(20) NOT NULL CHECK (status IN ('running', 'success', 'failed')),
    trigger_type    VARCHAR(20) NOT NULL CHECK (trigger_type IN ('scheduled', 'manual')),
    triggered_by    INT,
    started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at    TIMESTAMPTZ,
    error_message   TEXT
);

CREATE INDEX idx_backup_logs_started_at ON backup_logs(started_at DESC);
CREATE INDEX idx_backup_logs_operation_status ON backup_logs(operation, status);

-- =====================================================================
-- HNO NUMBERING + QAADE SYSTEM (see migrations/004_hno_qaade_legacy_system.sql)
--
-- Preserves business concepts from the predecessor desktop customer
-- management system: HNO-based customer/invoice/transaction numbering
-- and Qaade-based route/collector/area distribution.
-- =====================================================================

CREATE TABLE hno_sequences (
    id            SERIAL PRIMARY KEY,
    sequence_type VARCHAR(30) UNIQUE NOT NULL CHECK (sequence_type IN ('customer', 'invoice', 'transaction', 'qaade')),
    prefix        VARCHAR(20) NOT NULL,
    next_value    BIGINT NOT NULL DEFAULT 1,
    padding       INT NOT NULL DEFAULT 5
);

INSERT INTO hno_sequences (sequence_type, prefix, next_value, padding) VALUES
 ('customer', 'HNO-C-', 1, 5),
 ('invoice', 'HNO-INV-', 1, 5),
 ('transaction', 'HNO-TXN-', 1, 5),
 ('qaade', 'Q-', 1, 3);

CREATE TABLE qaades (
    id           SERIAL PRIMARY KEY,
    qaade_code   VARCHAR(20) UNIQUE NOT NULL,
    name         VARCHAR(100) NOT NULL,
    area         VARCHAR(150),
    collector_id INT REFERENCES users(id),
    truck_id     INT REFERENCES trucks(id),
    status       VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    notes        TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_qaades_collector ON qaades(collector_id);

ALTER TABLE customers
    ADD COLUMN hno      VARCHAR(30) UNIQUE,
    ADD COLUMN qaade_id INT REFERENCES qaades(id),
    ADD COLUMN status   VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'suspended', 'closed'));

CREATE INDEX idx_customers_qaade ON customers(qaade_id);
CREATE INDEX idx_customers_hno ON customers(hno);

ALTER TABLE sales_orders
    ADD COLUMN invoice_hno VARCHAR(30) UNIQUE,
    ADD COLUMN qaade_id    INT REFERENCES qaades(id),
    ADD COLUMN sale_type   VARCHAR(20) NOT NULL DEFAULT 'credit' CHECK (sale_type IN ('cash', 'credit'));

CREATE INDEX idx_sales_orders_qaade ON sales_orders(qaade_id);
CREATE INDEX idx_sales_orders_invoice_hno ON sales_orders(invoice_hno);
CREATE INDEX idx_sales_orders_sale_type ON sales_orders(sale_type);

ALTER TABLE payments
    ADD COLUMN transaction_hno VARCHAR(30) UNIQUE;

-- =====================================================================
-- FULL DOUBLE-ENTRY ACCOUNTING SYSTEM (see migrations/005_accounting_system.sql)
--
-- Replaces the "Finance (light)" expenses-only tracking with a real
-- Chart of Accounts + Journal Entries ledger. Every money-moving event
-- elsewhere in the ERP (cash/credit sale, payment received, goods
-- received, supplier payment, expense) posts a balanced journal entry
-- in the SAME transaction as the business event, so books never drift
-- out of sync with operations.
-- =====================================================================

CREATE TABLE chart_of_accounts (
    id             SERIAL PRIMARY KEY,
    code           VARCHAR(20) UNIQUE NOT NULL,
    name           VARCHAR(150) NOT NULL,
    account_type   VARCHAR(20) NOT NULL CHECK (account_type IN ('asset','liability','equity','revenue','expense')),
    parent_id      INT REFERENCES chart_of_accounts(id),
    is_system      BOOLEAN NOT NULL DEFAULT false,
    is_active      BOOLEAN NOT NULL DEFAULT true,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_coa_type ON chart_of_accounts(account_type);

CREATE TABLE fiscal_years (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(50) UNIQUE NOT NULL,
    start_date  DATE NOT NULL,
    end_date    DATE NOT NULL,
    status      VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
    closed_by   INT REFERENCES users(id),
    closed_at   TIMESTAMPTZ
);

CREATE TABLE bank_accounts (
    id               SERIAL PRIMARY KEY,
    name             VARCHAR(100) NOT NULL,
    bank_name        VARCHAR(100),
    account_number   VARCHAR(60),
    coa_account_id   INT NOT NULL UNIQUE REFERENCES chart_of_accounts(id),
    opening_balance  NUMERIC(14,2) NOT NULL DEFAULT 0,
    is_active        BOOLEAN NOT NULL DEFAULT true,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE je_sequences (
    id          SERIAL PRIMARY KEY,
    next_value  BIGINT NOT NULL DEFAULT 1
);
INSERT INTO je_sequences (next_value) VALUES (1);

CREATE TABLE journal_entries (
    id              SERIAL PRIMARY KEY,
    entry_number    VARCHAR(30) UNIQUE NOT NULL,
    entry_date      DATE NOT NULL DEFAULT CURRENT_DATE,
    description     TEXT,
    source          VARCHAR(20) NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','system')),
    reference_type  VARCHAR(30),
    reference_id    INT,
    status          VARCHAR(20) NOT NULL DEFAULT 'posted' CHECK (status IN ('posted','void')),
    created_by      INT NOT NULL REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_journal_entries_date ON journal_entries(entry_date);
CREATE INDEX idx_journal_entries_reference ON journal_entries(reference_type, reference_id);

CREATE TABLE journal_lines (
    id                 BIGSERIAL PRIMARY KEY,
    journal_entry_id   INT NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
    account_id         INT NOT NULL REFERENCES chart_of_accounts(id),
    debit              NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
    credit             NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
    description        TEXT,
    customer_id        INT REFERENCES customers(id),
    supplier_id        INT REFERENCES suppliers(id),
    CHECK ((debit = 0 AND credit > 0) OR (debit > 0 AND credit = 0))
);

CREATE INDEX idx_journal_lines_entry ON journal_lines(journal_entry_id);
CREATE INDEX idx_journal_lines_account ON journal_lines(account_id);
CREATE INDEX idx_journal_lines_customer ON journal_lines(customer_id);
CREATE INDEX idx_journal_lines_supplier ON journal_lines(supplier_id);

CREATE TABLE budgets (
    id             SERIAL PRIMARY KEY,
    account_id     INT NOT NULL REFERENCES chart_of_accounts(id),
    fiscal_year_id INT NOT NULL REFERENCES fiscal_years(id),
    period_month   INT NOT NULL CHECK (period_month BETWEEN 1 AND 12),
    budgeted_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
    UNIQUE (account_id, fiscal_year_id, period_month)
);

CREATE TABLE supplier_payments (
    id                SERIAL PRIMARY KEY,
    purchase_order_id INT NOT NULL REFERENCES purchase_orders(id),
    amount            NUMERIC(12,2) NOT NULL,
    payment_date      DATE NOT NULL DEFAULT CURRENT_DATE,
    method            VARCHAR(20) NOT NULL CHECK (method IN ('cash','bank_transfer','cheque')),
    bank_account_id   INT REFERENCES bank_accounts(id),
    reference_number  VARCHAR(60),
    recorded_by       INT NOT NULL REFERENCES users(id),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_supplier_payments_po ON supplier_payments(purchase_order_id);

ALTER TABLE payments ADD COLUMN bank_account_id INT REFERENCES bank_accounts(id);
ALTER TABLE expenses ADD COLUMN payment_method VARCHAR(20) NOT NULL DEFAULT 'cash' CHECK (payment_method IN ('cash','bank_transfer','cheque'));
ALTER TABLE expenses ADD COLUMN bank_account_id INT REFERENCES bank_accounts(id);
ALTER TABLE expense_categories ADD COLUMN coa_account_id INT REFERENCES chart_of_accounts(id);

-- =====================================================================
-- DOCUMENT GOVERNANCE (see migrations/007_document_governance.sql)
--
-- Draft documents (nothing posted to the ledger/stock yet) are freely
-- editable/deletable. Once posted, they are immutable — corrections go
-- through a Reverse operation that posts an offsetting counter-entry
-- and flags the original, preserving full history.
-- =====================================================================

ALTER TABLE sales_orders DROP CONSTRAINT sales_orders_status_check;
ALTER TABLE sales_orders ADD CONSTRAINT sales_orders_status_check
    CHECK (status IN ('pending','approved','dispatched','delivered','cancelled','reversed'));

ALTER TABLE payments
    ADD COLUMN voided_at    TIMESTAMPTZ,
    ADD COLUMN voided_by    INT REFERENCES users(id),
    ADD COLUMN void_reason  TEXT;

ALTER TABLE expenses
    ADD COLUMN voided_at    TIMESTAMPTZ,
    ADD COLUMN voided_by    INT REFERENCES users(id),
    ADD COLUMN void_reason  TEXT;

ALTER TABLE purchase_orders DROP CONSTRAINT purchase_orders_status_check;
ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_status_check
    CHECK (status IN ('draft','sent','partially_received','received','cancelled','reversed'));

ALTER TABLE supplier_payments
    ADD COLUMN voided_at    TIMESTAMPTZ,
    ADD COLUMN voided_by    INT REFERENCES users(id),
    ADD COLUMN void_reason  TEXT;

ALTER TABLE production_batches DROP CONSTRAINT production_batches_status_check;
ALTER TABLE production_batches ADD CONSTRAINT production_batches_status_check
    CHECK (status IN ('planned','in_progress','completed','cancelled','reversed'));
ALTER TABLE production_batches ADD COLUMN reversed_at TIMESTAMPTZ;

ALTER TABLE journal_entries DROP CONSTRAINT journal_entries_status_check;
ALTER TABLE journal_entries ADD CONSTRAINT journal_entries_status_check
    CHECK (status IN ('draft','posted','void'));
ALTER TABLE journal_entries
    ADD COLUMN reverses_entry_id INT REFERENCES journal_entries(id),
    ADD COLUMN is_reversal       BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX idx_journal_entries_reverses ON journal_entries(reverses_entry_id);

-- =====================================================================
-- ENTERPRISE BILLING & COST ACCOUNTING (see migrations/008_billing_cost_accounting.sql)
--
-- Cost Center dimension on every transaction, Projects, Quotations (the
-- new pre-Sales-Order step — invoices stay merged with sales_orders as
-- today), and per-Vehicle/Machine cost tracking. Additive only.
-- =====================================================================

CREATE TABLE cost_centers (
    id          SERIAL PRIMARY KEY,
    code        VARCHAR(20) UNIQUE NOT NULL,
    name        VARCHAR(100) NOT NULL,
    type        VARCHAR(30) NOT NULL CHECK (type IN
                 ('production','sales','delivery','procurement','maintenance','warehouse','hr','finance','administration')),
    is_active   BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

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

CREATE TABLE vehicle_expense_category_accounts (
    category       VARCHAR(20) PRIMARY KEY,
    coa_account_id INT NOT NULL REFERENCES chart_of_accounts(id)
);

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

ALTER TABLE users ADD COLUMN commission_rate NUMERIC(5,2);

-- =====================================================================
-- ORGANIZATIONAL STRUCTURE (see migrations/009_org_structure.sql)
--
-- Additive, non-breaking foundation for Company/Branch/Department/
-- warehouse-hierarchy/document-attachments. Exactly one company and one
-- branch are seeded (see seed.sql) to match today's single-company
-- reality — this is not a multi-tenant rewrite.
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

ALTER TABLE warehouses ADD COLUMN parent_warehouse_id INT REFERENCES warehouses(id);
CREATE INDEX idx_warehouses_parent ON warehouses(parent_warehouse_id);

ALTER TABLE users ADD COLUMN department_id INT REFERENCES departments(id);
ALTER TABLE users ADD COLUMN branch_id     INT REFERENCES branches(id);

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

-- =====================================================================
-- WATER DISTRIBUTION OPERATING SYSTEM — route lifecycle
-- (see migrations/010_route_operations.sql)
-- =====================================================================

CREATE TABLE route_runs (
    id                     SERIAL PRIMARY KEY,
    qaade_id               INT REFERENCES qaades(id),
    route_date             DATE NOT NULL DEFAULT CURRENT_DATE,
    truck_id               INT NOT NULL REFERENCES trucks(id),
    driver_id              INT NOT NULL REFERENCES users(id),
    salesman_id            INT REFERENCES users(id),
    operator_id            INT NOT NULL REFERENCES users(id),
    status                 VARCHAR(20) NOT NULL DEFAULT 'planned'
                              CHECK (status IN ('planned','dispatched','in_progress','closed','cancelled')),
    dispatched_at          TIMESTAMPTZ,
    closed_at              TIMESTAMPTZ,
    cash_reconciled_at     TIMESTAMPTZ,
    water_reconciled_at    TIMESTAMPTZ,
    expenses_confirmed_at  TIMESTAMPTZ,
    approved_by            INT REFERENCES users(id),
    expected_cash          NUMERIC(12,2),
    expected_water         NUMERIC(12,2),
    returned_water         NUMERIC(12,2),
    lost_water             NUMERIC(12,2),
    created_by             INT NOT NULL REFERENCES users(id),
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_route_runs_date ON route_runs(route_date);
CREATE INDEX idx_route_runs_truck ON route_runs(truck_id, route_date);
CREATE INDEX idx_route_runs_driver ON route_runs(driver_id, route_date);
CREATE INDEX idx_route_runs_operator ON route_runs(operator_id, route_date);
CREATE INDEX idx_route_runs_status ON route_runs(status);

CREATE TABLE route_stops (
    id               SERIAL PRIMARY KEY,
    route_run_id     INT NOT NULL REFERENCES route_runs(id) ON DELETE CASCADE,
    customer_id      INT NOT NULL REFERENCES customers(id),
    customer_tank_id INT REFERENCES customer_tanks(id),
    sequence_number  INT NOT NULL,
    status           VARCHAR(20) NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','delivered','skipped')),
    skip_reason      TEXT,
    is_ad_hoc        BOOLEAN NOT NULL DEFAULT false,
    sales_order_id   INT REFERENCES sales_orders(id),
    delivered_at     TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_route_stops_run ON route_stops(route_run_id, sequence_number);
CREATE INDEX idx_route_stops_status ON route_stops(route_run_id, status);

ALTER TABLE truck_loads ADD COLUMN seal_number VARCHAR(50);
ALTER TABLE truck_loads ADD COLUMN route_run_id INT REFERENCES route_runs(id);
CREATE INDEX idx_truck_loads_route_run ON truck_loads(route_run_id);

CREATE TABLE route_returns (
    id               SERIAL PRIMARY KEY,
    route_run_id     INT NOT NULL REFERENCES route_runs(id),
    warehouse_id     INT NOT NULL REFERENCES warehouses(id),
    measured_liters  NUMERIC(12,2) NOT NULL,
    received_by      INT NOT NULL REFERENCES users(id),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_route_returns_run ON route_returns(route_run_id);

CREATE TABLE exceptions (
    id             SERIAL PRIMARY KEY,
    type           VARCHAR(20) NOT NULL
                      CHECK (type IN ('shortage','leakage','customer_dispute','wrong_delivery','missing_payment')),
    route_run_id   INT REFERENCES route_runs(id),
    route_stop_id  INT REFERENCES route_stops(id),
    truck_id       INT REFERENCES trucks(id),
    payment_id     INT REFERENCES payments(id),
    description    TEXT,
    quantity       NUMERIC(12,2),
    amount         NUMERIC(12,2),
    status         VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open','investigating','resolved')),
    raised_by      INT NOT NULL REFERENCES users(id),
    resolved_by    INT REFERENCES users(id),
    resolved_at    TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_exceptions_route_run ON exceptions(route_run_id);
CREATE INDEX idx_exceptions_status ON exceptions(status);

ALTER TABLE audit_logs ADD COLUMN device_id VARCHAR(100);
ALTER TABLE audit_logs ADD COLUMN gps_lat NUMERIC(9,6);
ALTER TABLE audit_logs ADD COLUMN gps_lng NUMERIC(9,6);

ALTER TABLE deliveries ADD COLUMN idempotency_key VARCHAR(64) UNIQUE;
ALTER TABLE deliveries ADD COLUMN route_stop_id INT REFERENCES route_stops(id);
CREATE INDEX idx_deliveries_route_stop ON deliveries(route_stop_id);

-- =====================================================================
-- BULK WATER ORDER-DRIVEN ROUTING (see migrations/011_bulk_water_order_routing.sql)
-- =====================================================================

ALTER TABLE sales_orders ADD COLUMN customer_tank_id INT REFERENCES customer_tanks(id);
ALTER TABLE sales_orders ADD COLUMN priority VARCHAR(10) NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low','normal','high','urgent'));
CREATE INDEX idx_sales_orders_tank ON sales_orders(customer_tank_id);

-- =====================================================================
-- ROUTE PLANNING — ENTERPRISE DISPATCH SCREEN (see migrations/012_route_planning_enterprise.sql)
-- =====================================================================

ALTER TABLE route_runs ALTER COLUMN operator_id DROP NOT NULL;

ALTER TABLE route_runs ADD COLUMN route_number VARCHAR(30) UNIQUE NOT NULL DEFAULT '';

ALTER TABLE route_runs DROP CONSTRAINT route_runs_status_check;
ALTER TABLE route_runs ALTER COLUMN status SET DEFAULT 'draft';
ALTER TABLE route_runs ADD CONSTRAINT route_runs_status_check
    CHECK (status IN ('draft','ready','dispatched','in_progress','completed','closed','cancelled'));

ALTER TABLE customer_tanks ADD COLUMN latitude NUMERIC(9,6);
ALTER TABLE customer_tanks ADD COLUMN longitude NUMERIC(9,6);
ALTER TABLE warehouses ADD COLUMN latitude NUMERIC(9,6);
ALTER TABLE warehouses ADD COLUMN longitude NUMERIC(9,6);

-- =====================================================================
-- BULK WATER DISPATCH CENTER (see migrations/013_dispatch_center.sql)
-- =====================================================================

ALTER TABLE users ADD COLUMN license_number VARCHAR(50);
ALTER TABLE customer_tanks ADD COLUMN last_known_level_liters NUMERIC(10,2);
ALTER TABLE customer_tanks ADD COLUMN level_recorded_at TIMESTAMPTZ;
ALTER TABLE route_stops ADD COLUMN delivered_liters NUMERIC(10,2);
ALTER TABLE route_stops ADD COLUMN signature_name VARCHAR(120);
ALTER TABLE route_stops ADD COLUMN photo_url VARCHAR(500);
ALTER TABLE route_stops ADD COLUMN gps_lat NUMERIC(9,6);
ALTER TABLE route_stops ADD COLUMN gps_lng NUMERIC(9,6);

-- =====================================================================
-- ENTERPRISE BULK WATER DISPATCH CENTER v2 (see migrations/014_dispatch_center_v2.sql)
-- =====================================================================

ALTER TABLE trucks ADD COLUMN truck_code VARCHAR(20) UNIQUE;
UPDATE trucks SET truck_code = 'TRK-' || LPAD(id::text, 3, '0') WHERE truck_code IS NULL;
ALTER TABLE trucks ALTER COLUMN truck_code SET NOT NULL;
ALTER TABLE trucks ADD COLUMN fuel_percent NUMERIC(5,2);

-- =====================================================================
-- TANK-CENTRIC DISPATCH (see migrations/015_tank_dispatch.sql)
-- =====================================================================

ALTER TABLE customer_tanks ADD COLUMN tank_name VARCHAR(100);

-- =====================================================================
-- SIMPLIFIED DISPATCH + DELIVERY SETTLEMENT (see migrations/016_delivery_settlement.sql)
-- =====================================================================

ALTER TABLE route_runs ALTER COLUMN driver_id DROP NOT NULL;
ALTER TABLE route_runs ADD COLUMN started_at TIMESTAMPTZ;

ALTER TABLE route_stops ADD COLUMN discount NUMERIC(12,2);
ALTER TABLE route_stops ADD COLUMN discount_reason VARCHAR(200);
ALTER TABLE route_stops ADD COLUMN cash_received NUMERIC(12,2);
ALTER TABLE route_stops ADD COLUMN payment_type VARCHAR(20) CHECK (payment_type IN ('cash','credit','cash_credit'));
ALTER TABLE route_stops ADD COLUMN settlement_notes TEXT;

-- =====================================================================
-- BULK CUSTOMER & TANK IMPORT (see migrations/017_bulk_import.sql)
-- =====================================================================

ALTER TABLE customers ADD COLUMN guarantor_name VARCHAR(150);
ALTER TABLE customers ADD COLUMN guarantor_phone VARCHAR(30);
ALTER TABLE customers ADD COLUMN opening_balance NUMERIC(12,2);
ALTER TABLE customers ADD COLUMN route VARCHAR(80);

-- =====================================================================
-- HNO COMMA CLEANUP (see migrations/018_hno_comma_cleanup.sql)
-- =====================================================================

UPDATE customers
SET hno = regexp_replace(hno, '[,\s]', '', 'g')
WHERE hno ~ '^[0-9,\s]+$'
  AND hno <> regexp_replace(hno, '[,\s]', '', 'g');

-- =====================================================================
-- TRUCK LOAD DELIVERED LITERS (see migrations/019_truck_load_delivered_liters.sql)
-- =====================================================================

ALTER TABLE truck_loads ADD COLUMN delivered_liters NUMERIC(12,2) NOT NULL DEFAULT 0;

-- =====================================================================
-- TRUCK LOAD LIFECYCLE (see migrations/020_truck_load_lifecycle.sql)
-- =====================================================================

ALTER TABLE truck_loads ADD COLUMN completed_at TIMESTAMPTZ;

ALTER TABLE truck_loads DROP CONSTRAINT truck_loads_status_check;
ALTER TABLE truck_loads ADD CONSTRAINT truck_loads_status_check
  CHECK (status IN ('loaded', 'in_progress', 'completed', 'cancelled'));

CREATE UNIQUE INDEX idx_truck_loads_one_active_per_truck
  ON truck_loads (truck_id) WHERE status = 'loaded';

-- =====================================================================
-- TRUCK MANAGEMENT PERMISSIONS (see migrations/021_truck_management_permissions.sql)
-- =====================================================================

ALTER TABLE trucks ADD COLUMN notes TEXT;
ALTER TABLE trucks ADD COLUMN archived_at TIMESTAMPTZ;

-- =====================================================================
-- TRUCK STOCK RECONCILIATION (see migrations/022_truck_stock_reconciliation.sql)
-- =====================================================================

CREATE TABLE stock_reconciliations (
    id                 SERIAL PRIMARY KEY,
    truck_id           INT NOT NULL REFERENCES trucks(id),
    truck_load_id      INT NOT NULL REFERENCES truck_loads(id),
    previous_remaining NUMERIC(12,2) NOT NULL,
    actual_remaining   NUMERIC(12,2) NOT NULL,
    difference         NUMERIC(12,2) NOT NULL,
    reason             VARCHAR(30) CHECK (reason IN (
                          'delivered_not_recorded', 'spillage', 'leakage', 'returned_to_warehouse', 'other'
                       )),
    note               TEXT,
    warehouse_user_id  INT NOT NULL REFERENCES users(id),
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_stock_reconciliations_truck ON stock_reconciliations(truck_id, created_at);

-- =====================================================================
-- FINISHED WATER WAREHOUSE (see migrations/023_finished_water_warehouse.sql)
-- =====================================================================

UPDATE warehouses SET name = 'Finished Water Warehouse' WHERE code = 'WH-RO-01';

ALTER TABLE warehouses DROP CONSTRAINT warehouses_type_check;
ALTER TABLE warehouses ADD CONSTRAINT warehouses_type_check
  CHECK (type IN ('raw_material', 'finished_goods', 'spare_parts', 'general', 'raw_water'));

-- =====================================================================
-- PRODUCTION QC STATUS (see migrations/024_production_qc_status.sql)
-- =====================================================================

ALTER TABLE production_batches ADD COLUMN qc_status VARCHAR(20) NOT NULL DEFAULT 'pending'
  CHECK (qc_status IN ('pending', 'passed', 'failed'));

-- =====================================================================
-- BILLING & COLLECTIONS (see migrations/025_billing_collections.sql)
-- =====================================================================

INSERT INTO roles (name, description)
SELECT 'Collector', 'Records payments against assigned customer accounts'
WHERE NOT EXISTS (SELECT 1 FROM roles WHERE name = 'Collector');

ALTER TABLE customers ADD COLUMN collector_id INT REFERENCES users(id);

ALTER TABLE payments ADD COLUMN notes TEXT;

ALTER TABLE payments DROP CONSTRAINT payments_method_check;
ALTER TABLE payments ADD CONSTRAINT payments_method_check
  CHECK (method IN ('cash', 'bank_transfer', 'mobile_money', 'cheque', 'credit'));

CREATE TABLE follow_ups (
    id                  SERIAL PRIMARY KEY,
    customer_id         INT NOT NULL REFERENCES customers(id),
    action_type         VARCHAR(20) NOT NULL CHECK (action_type IN
                           ('call', 'sms', 'whatsapp', 'visit', 'promise_to_pay', 'reminder')),
    notes               TEXT,
    promise_amount      NUMERIC(12,2),
    promise_date        DATE,
    next_followup_date  DATE,
    completed_at        TIMESTAMPTZ,
    created_by          INT NOT NULL REFERENCES users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_follow_ups_customer ON follow_ups(customer_id, created_at);
CREATE INDEX idx_follow_ups_next ON follow_ups(next_followup_date) WHERE next_followup_date IS NOT NULL;

COMMIT;
