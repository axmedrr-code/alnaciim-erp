-- =====================================================================
-- BULK CUSTOMER & TANK IMPORT — additive fields needed by the import
-- template. guarantor_name/phone and route are real master data; opening
-- balance is stored as a plain reportable figure only (see backend
-- comment in imports.routes.js for why it is NOT auto-posted to AR).
-- =====================================================================

ALTER TABLE customers ADD COLUMN guarantor_name VARCHAR(150);
ALTER TABLE customers ADD COLUMN guarantor_phone VARCHAR(30);
ALTER TABLE customers ADD COLUMN opening_balance NUMERIC(12,2);
ALTER TABLE customers ADD COLUMN route VARCHAR(80);
