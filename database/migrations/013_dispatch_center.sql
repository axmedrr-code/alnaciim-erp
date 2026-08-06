-- =====================================================================
-- BULK WATER DISPATCH CENTER — Water Distribution ERP redesign
--
-- Additive only. Several fields the redesign calls for have no real data
-- source in this system yet (tank level readings, driver license/working
-- hours, delivery signature/photo/GPS capture) — those columns are added
-- here as honest nullable hooks, always null until a real capture flow
-- exists, never fabricated with fake values.
-- =====================================================================

ALTER TABLE users ADD COLUMN license_number VARCHAR(50);

-- Real (currently always-null) tank level hook — populated only once a
-- real reading/IoT flow exists. Never estimated or fabricated.
ALTER TABLE customer_tanks ADD COLUMN last_known_level_liters NUMERIC(10,2);
ALTER TABLE customer_tanks ADD COLUMN level_recorded_at TIMESTAMPTZ;

-- Per-stop delivery capture — populated by the Driver/Operator Run module
-- (not yet built). Route Details can display these columns honestly today
-- (always "—") without inventing fake delivery evidence.
ALTER TABLE route_stops ADD COLUMN delivered_liters NUMERIC(10,2);
ALTER TABLE route_stops ADD COLUMN signature_name VARCHAR(120);
ALTER TABLE route_stops ADD COLUMN photo_url VARCHAR(500);
ALTER TABLE route_stops ADD COLUMN gps_lat NUMERIC(9,6);
ALTER TABLE route_stops ADD COLUMN gps_lng NUMERIC(9,6);
