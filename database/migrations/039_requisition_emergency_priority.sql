-- Adds an 'emergency' priority to purchase requisitions (above 'urgent'). Approvals are NOT bypassed: it only flags and sorts first.
ALTER TABLE purchase_requisitions DROP CONSTRAINT IF EXISTS purchase_requisitions_priority_check;
ALTER TABLE purchase_requisitions ADD CONSTRAINT purchase_requisitions_priority_check CHECK (priority IN ('low','normal','high','urgent','emergency'));
