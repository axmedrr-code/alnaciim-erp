-- =====================================================================
-- ROUTE PLANNING — ENTERPRISE DISPATCH SCREEN
--
-- Operator is dropped (drivers record their own deliveries — no separate
-- operator role at planning time). Status gains the full dispatch
-- lifecycle. route_number gives routes a human-readable identifier like
-- every other document in this ERP (order_number, po_number, ...).
-- Tank/warehouse lat-lng are real, nullable GPS fields — distance/ETA are
-- only ever computed when real coordinates exist, never fabricated.
-- =====================================================================

ALTER TABLE route_runs ALTER COLUMN operator_id DROP NOT NULL;

ALTER TABLE route_runs ADD COLUMN route_number VARCHAR(30) UNIQUE;
UPDATE route_runs SET route_number = 'RT-' || EXTRACT(YEAR FROM route_date) || '-' || LPAD(id::text, 6, '0') WHERE route_number IS NULL;
ALTER TABLE route_runs ALTER COLUMN route_number SET NOT NULL;

ALTER TABLE route_runs DROP CONSTRAINT route_runs_status_check;
UPDATE route_runs SET status = 'draft' WHERE status = 'planned';
ALTER TABLE route_runs ALTER COLUMN status SET DEFAULT 'draft';
ALTER TABLE route_runs ADD CONSTRAINT route_runs_status_check
    CHECK (status IN ('draft','ready','dispatched','in_progress','completed','closed','cancelled'));

ALTER TABLE customer_tanks ADD COLUMN latitude NUMERIC(9,6);
ALTER TABLE customer_tanks ADD COLUMN longitude NUMERIC(9,6);
ALTER TABLE warehouses ADD COLUMN latitude NUMERIC(9,6);
ALTER TABLE warehouses ADD COLUMN longitude NUMERIC(9,6);
