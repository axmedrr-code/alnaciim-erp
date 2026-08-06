-- =====================================================================
-- Migration 002 — Bulk water tanker operations, customer tanks, BOM
-- Redesigns the Sales & Distribution module around bulk water delivery
-- (tanker trucks), on top of the existing retail/bottled-water schema.
-- =====================================================================

BEGIN;

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

-- ---------------------------------------------------------------------
-- Link deliveries to a tanker load + the specific customer tank filled,
-- and capture the actual confirmed quantity (bulk water is invoiced on
-- what was actually delivered, not what was ordered).
-- ---------------------------------------------------------------------

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

COMMIT;
