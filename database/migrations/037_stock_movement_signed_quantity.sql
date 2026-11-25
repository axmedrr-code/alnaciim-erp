-- 037: stock_movements.quantity is unsigned, so an ADJUSTMENT row did not say whether it added or removed stock and the ledger
-- could not be reconciled against stock_levels. signed_quantity stores the real effect of every movement from now on.
ALTER TABLE stock_movements ADD COLUMN signed_quantity NUMERIC(14,3);
UPDATE stock_movements SET signed_quantity = quantity WHERE signed_quantity IS NULL AND movement_type IN ('IN','TRANSFER_IN');
UPDATE stock_movements SET signed_quantity = -quantity WHERE signed_quantity IS NULL AND movement_type IN ('OUT','TRANSFER_OUT');
-- Legacy ADJUSTMENT rows (if any) stay NULL: their direction was never recorded.
