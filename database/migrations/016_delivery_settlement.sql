-- =====================================================================
-- SIMPLIFIED DISPATCH + DELIVERY SETTLEMENT
--
-- Driver is no longer required at route-planning time — a route can be
-- built and dispatched (truck loaded, inventory reduced, revenue posted)
-- with no driver at all; a driver is only assigned when delivery actually
-- starts (POST /routes/:id/start). Settlement columns on route_stops
-- capture what really happened at the doorstep: actual liters delivered,
-- any discount given, and how it was paid — all real, driver-entered
-- data, never fabricated.
-- =====================================================================

ALTER TABLE route_runs ALTER COLUMN driver_id DROP NOT NULL;
ALTER TABLE route_runs ADD COLUMN started_at TIMESTAMPTZ;

ALTER TABLE route_stops ADD COLUMN discount NUMERIC(12,2);
ALTER TABLE route_stops ADD COLUMN discount_reason VARCHAR(200);
ALTER TABLE route_stops ADD COLUMN cash_received NUMERIC(12,2);
ALTER TABLE route_stops ADD COLUMN payment_type VARCHAR(20) CHECK (payment_type IN ('cash','credit','cash_credit'));
ALTER TABLE route_stops ADD COLUMN settlement_notes TEXT;
