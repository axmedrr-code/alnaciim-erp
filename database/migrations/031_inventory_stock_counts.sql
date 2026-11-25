-- Controlled stock reconciliation. Counts are recorded first; only a separate
-- authorized approver may post the variance to the inventory ledger.
CREATE TABLE IF NOT EXISTS inventory_stock_counts (
  id                SERIAL PRIMARY KEY,
  count_number      VARCHAR(30) UNIQUE,
  product_id        INT NOT NULL REFERENCES products(id),
  warehouse_id      INT NOT NULL REFERENCES warehouses(id),
  system_quantity   NUMERIC(14,3) NOT NULL CHECK (system_quantity >= 0),
  counted_quantity  NUMERIC(14,3) NOT NULL CHECK (counted_quantity >= 0),
  variance          NUMERIC(14,3) NOT NULL,
  reason            VARCHAR(200) NOT NULL,
  notes             TEXT,
  status            VARCHAR(20) NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','approved','rejected')),
  counted_by        INT NOT NULL REFERENCES users(id),
  decided_by        INT REFERENCES users(id),
  decision_reason   TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at        TIMESTAMPTZ,
  CHECK (variance = counted_quantity - system_quantity)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_stock_counts_one_pending
  ON inventory_stock_counts(product_id, warehouse_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_inventory_stock_counts_created
  ON inventory_stock_counts(created_at DESC);
