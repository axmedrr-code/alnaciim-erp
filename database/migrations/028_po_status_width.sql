-- 028: 'pending_authorization' (21 chars) does not fit the original VARCHAR(20) purchase_orders.status.
ALTER TABLE purchase_orders ALTER COLUMN status TYPE VARCHAR(30);
