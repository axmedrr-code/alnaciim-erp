-- =====================================================================
-- Migration 003 — Backup & restore audit log
--
-- backup_logs is deliberately excluded from every pg_dump (see
-- backupService.js) so the audit trail — including a restore
-- operation's own "success" row — survives the restore that would
-- otherwise roll it back to whatever it looked like at backup time.
-- triggered_by is therefore a plain column, NOT a foreign key: a live
-- FK to users(id) would make pg_restore's `--clean` unable to drop and
-- recreate the users table, since backup_logs (outside the dump) would
-- still be referencing it.
-- =====================================================================

BEGIN;

CREATE TABLE backup_logs (
    id              SERIAL PRIMARY KEY,
    operation       VARCHAR(20) NOT NULL CHECK (operation IN ('backup', 'restore')),
    filename        VARCHAR(255),
    file_size_bytes BIGINT,
    status          VARCHAR(20) NOT NULL CHECK (status IN ('running', 'success', 'failed')),
    trigger_type    VARCHAR(20) NOT NULL CHECK (trigger_type IN ('scheduled', 'manual')),
    triggered_by    INT, -- intentionally not a FK — see note above
    started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at    TIMESTAMPTZ,
    error_message   TEXT
);

CREATE INDEX idx_backup_logs_started_at ON backup_logs(started_at DESC);
CREATE INDEX idx_backup_logs_operation_status ON backup_logs(operation, status);

COMMIT;
