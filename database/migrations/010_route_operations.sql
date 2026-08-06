-- =====================================================================
-- WATER DISTRIBUTION OPERATING SYSTEM — route lifecycle (Rev. 3 blueprint)
--
-- Additive only. Every new table/column is nullable or defaulted so no
-- existing row or query breaks. Reuses trucks/users/qaades/customers/
-- customer_tanks/sales_orders/deliveries/payments/vehicle_expenses
-- exactly as already built — this migration only adds the route-run
-- and route-stop scaffolding plus a handful of small extensions.
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
    -- Daily Closing's four required gates
    cash_reconciled_at     TIMESTAMPTZ,
    water_reconciled_at    TIMESTAMPTZ,
    expenses_confirmed_at  TIMESTAMPTZ,
    approved_by            INT REFERENCES users(id),
    -- Stock-ledger + reconciliation figures, computed at close/reconcile time
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

-- Loading Bay: physical seal recorded at truck-loading time.
ALTER TABLE truck_loads ADD COLUMN seal_number VARCHAR(50);

-- Also links a truck_load to the route_run it's loading for, so Dispatch
-- Center can require "loaded" before allowing dispatch.
ALTER TABLE truck_loads ADD COLUMN route_run_id INT REFERENCES route_runs(id);
CREATE INDEX idx_truck_loads_route_run ON truck_loads(route_run_id);

-- Return Processing: undelivered water measured back at the warehouse.
CREATE TABLE route_returns (
    id               SERIAL PRIMARY KEY,
    route_run_id     INT NOT NULL REFERENCES route_runs(id),
    warehouse_id     INT NOT NULL REFERENCES warehouses(id),
    measured_liters  NUMERIC(12,2) NOT NULL,
    received_by      INT NOT NULL REFERENCES users(id),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_route_returns_run ON route_returns(route_run_id);

-- Exception Management.
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

-- Field-operations audit context — additive on the existing audit trail,
-- not a second mechanism. Populated when the client provides it, never
-- required (an offline save must never be blocked by a missing GPS fix).
ALTER TABLE audit_logs ADD COLUMN device_id VARCHAR(100);
ALTER TABLE audit_logs ADD COLUMN gps_lat NUMERIC(9,6);
ALTER TABLE audit_logs ADD COLUMN gps_lng NUMERIC(9,6);

-- Offline retry safety for the composite delivery-save endpoint.
ALTER TABLE deliveries ADD COLUMN idempotency_key VARCHAR(64) UNIQUE;
ALTER TABLE deliveries ADD COLUMN route_stop_id INT REFERENCES route_stops(id);
CREATE INDEX idx_deliveries_route_stop ON deliveries(route_stop_id);
