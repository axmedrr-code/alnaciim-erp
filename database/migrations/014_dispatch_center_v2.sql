-- =====================================================================
-- ENTERPRISE BULK WATER DISPATCH CENTER — v2 redesign
--
-- Additive only. truck_code is real master data (an internal asset code,
-- distinct from the vehicle's plate number) and is safe to backfill
-- deterministically. fuel_percent has no telemetry source yet in this
-- system, so it stays nullable and always null until a real fuel-sensor
-- or manual-reading flow exists — never fabricated.
-- =====================================================================

ALTER TABLE trucks ADD COLUMN truck_code VARCHAR(20) UNIQUE;
UPDATE trucks SET truck_code = 'TRK-' || LPAD(id::text, 3, '0') WHERE truck_code IS NULL;
ALTER TABLE trucks ALTER COLUMN truck_code SET NOT NULL;

ALTER TABLE trucks ADD COLUMN fuel_percent NUMERIC(5,2);
