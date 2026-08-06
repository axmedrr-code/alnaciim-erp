-- =====================================================================
-- TRUCK STOCK RECONCILIATION
--
-- A truck cannot be loaded again while its previous load still has water
-- remaining in the system, until a warehouse operator (or Admin) reconciles
-- that remaining stock against what's physically in the tank. Every
-- reconciliation — matched or not — is a permanent record: what the system
-- said, what the operator found, the difference, why (if any), and who/when.
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
