-- =====================================================================
-- TRUCK MANAGEMENT PERMISSIONS
--
-- Adds the fields role-based truck editing needs: free-text notes a
-- Manager can maintain, and archived_at for a soft "retire this truck"
-- action (never a hard DELETE — trucks accumulate real route_runs,
-- deliveries, and truck_loads history that must never be orphaned).
-- =====================================================================

ALTER TABLE trucks ADD COLUMN notes TEXT;
ALTER TABLE trucks ADD COLUMN archived_at TIMESTAMPTZ;
