-- =====================================================================
-- TRUCK LOAD LIFECYCLE — one active loading per truck, enforced at the
-- database level (never just application code), plus explicit
-- Complete/Cancel actions and a completed_at timestamp.
-- =====================================================================

ALTER TABLE truck_loads ADD COLUMN completed_at TIMESTAMPTZ;

ALTER TABLE truck_loads DROP CONSTRAINT truck_loads_status_check;
ALTER TABLE truck_loads ADD CONSTRAINT truck_loads_status_check
  CHECK (status IN ('loaded', 'in_progress', 'completed', 'cancelled'));

-- A truck may have at most one row with status = 'loaded' at any time —
-- a partial unique index is the actual guarantee; application code (POST
-- /sales/truck-loads) only ever gets the first, friendlier rejection.
CREATE UNIQUE INDEX idx_truck_loads_one_active_per_truck
  ON truck_loads (truck_id) WHERE status = 'loaded';
