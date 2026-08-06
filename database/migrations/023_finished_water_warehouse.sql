-- =====================================================================
-- FINISHED WATER WAREHOUSE — simplified tanker-loading source
--
-- For this version, tanker loading draws from exactly one place: the
-- Finished Water Warehouse (the existing RO Storage Tank warehouse,
-- type='finished_goods' — already the correct place, just renamed to match
-- the simplified workflow's own language). Production and a separate Raw
-- Water Tank are NOT wired into loading yet — deliberately deferred to a
-- future version.
--
-- The warehouses.type CHECK is widened now (schema readiness only) so a
-- future 'raw_water' warehouse type can be added later without another
-- migration to touch this constraint — no such warehouse is created here,
-- and nothing in the app references the new value yet.
-- =====================================================================

UPDATE warehouses SET name = 'Finished Water Warehouse' WHERE code = 'WH-RO-01';

ALTER TABLE warehouses DROP CONSTRAINT warehouses_type_check;
ALTER TABLE warehouses ADD CONSTRAINT warehouses_type_check
  CHECK (type IN ('raw_material', 'finished_goods', 'spare_parts', 'general', 'raw_water'));
