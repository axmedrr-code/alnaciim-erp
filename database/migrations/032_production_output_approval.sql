-- QC-passed production outputs require independent approval before entering stock.
-- Existing rows remain legacy; their historic stock ledger entries are not replayed.
ALTER TABLE production_batches
  ADD COLUMN output_approval_status VARCHAR(20) NOT NULL DEFAULT 'legacy'
    CHECK (output_approval_status IN ('legacy','not_required','pending','approved','rejected')),
  ADD COLUMN output_approved_by INT REFERENCES users(id),
  ADD COLUMN output_approved_at TIMESTAMPTZ,
  ADD COLUMN output_decision_reason TEXT,
  ADD COLUMN completed_by INT REFERENCES users(id),
  ADD COLUMN variance_notes TEXT;

CREATE INDEX idx_production_batches_output_approval
  ON production_batches(output_approval_status, end_time DESC);
