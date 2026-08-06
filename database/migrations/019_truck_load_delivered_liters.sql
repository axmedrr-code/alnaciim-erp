-- =====================================================================
-- TRUCK LOAD DELIVERED LITERS
--
-- A truck's Remaining Stock must come from exactly one row: the single
-- ACTIVE load for that truck (status = 'loaded'), never a sum across every
-- load it has ever carried. delivered_liters is tracked directly on that
-- row and incremented by every POS Save against that truck, so Remaining
-- is always just quantity_loaded - delivered_liters — no join, no
-- recomputation from route_stops history.
-- =====================================================================

ALTER TABLE truck_loads ADD COLUMN delivered_liters NUMERIC(12,2) NOT NULL DEFAULT 0;
