-- Quantify physical water returned to the source warehouse during route close.
ALTER TABLE stock_reconciliations
  ADD COLUMN returned_liters NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (returned_liters >= 0);
