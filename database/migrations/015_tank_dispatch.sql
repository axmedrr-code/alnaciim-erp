-- =====================================================================
-- TANK-CENTRIC DISPATCH — Bulk Water business runs on customer tanks, not
-- generic sales-order quantities. tank_name is real master data (an
-- optional human-friendly label alongside the existing tank_code), safe
-- to add as a nullable column — falls back to tank_code wherever unset.
-- =====================================================================

ALTER TABLE customer_tanks ADD COLUMN tank_name VARCHAR(100);
