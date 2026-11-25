-- Logistics incident workflow: adds damaged-goods records and a resolution trail.
ALTER TABLE exceptions DROP CONSTRAINT exceptions_type_check;
ALTER TABLE exceptions ADD CONSTRAINT exceptions_type_check
  CHECK (type IN ('shortage','leakage','customer_dispute','wrong_delivery','missing_payment','damaged_goods'));
ALTER TABLE exceptions ADD COLUMN resolution_notes TEXT;
ALTER TABLE exceptions ADD COLUMN investigation_notes TEXT;
CREATE INDEX idx_exceptions_type_created ON exceptions(type, created_at DESC);
