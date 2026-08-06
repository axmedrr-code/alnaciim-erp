-- =====================================================================
-- PRODUCTION QC STATUS
--
-- Completes the Production Order -> Start -> Complete -> Finished Water
-- Warehouse receipt workflow: a batch's output only becomes real, loadable
-- stock once QC has actually signed off on it. A 'failed' batch still
-- records what happened (audit trail), but never creates finished-goods
-- stock — so a truck can never load water that failed quality control.
-- =====================================================================

ALTER TABLE production_batches ADD COLUMN qc_status VARCHAR(20) NOT NULL DEFAULT 'pending'
  CHECK (qc_status IN ('pending', 'passed', 'failed'));
