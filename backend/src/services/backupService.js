const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const { pool } = require('../config/db');
const { ApiError } = require('../utils/asyncHandler');

const BACKUP_DIR = path.join(__dirname, '../../backups');

function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

function pgBin(name) {
  const dir = process.env.PG_BIN_PATH;
  return dir ? path.join(dir, name) : name;
}

function dbConnectionParts() {
  const url = new URL(process.env.DATABASE_URL);
  return {
    host: url.hostname,
    port: url.port || '5432',
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.slice(1)
  };
}

function timestampForFilename(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

function runExecFile(command, args, env) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { env: { ...process.env, ...env }, maxBuffer: 1024 * 1024 * 64 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr?.trim() || err.message));
      resolve({ stdout, stderr });
    });
  });
}

function dump(outputPath) {
  const { host, port, user, password, database } = dbConnectionParts();
  return runExecFile(
    // backup_logs itself is excluded: restoring a dump replays whatever backup_logs looked
    // like at dump time, which would silently erase every audit entry recorded since —
    // including the restore operation's own "success" row. Keeping the audit trail outside
    // the dump means it survives every restore intact.
    pgBin('pg_dump'),
    ['-h', host, '-p', port, '-U', user, '-F', 'c', '--exclude-table=public.backup_logs', '-f', outputPath, database],
    { PGPASSWORD: password }
  );
}

// Drops other sessions on the target database (via a connection to the
// `postgres` maintenance database) so pg_restore --clean can acquire the
// locks it needs without hanging behind our own connection pool.
async function terminateOtherConnections(database) {
  const maintUrl = new URL(process.env.DATABASE_URL);
  maintUrl.pathname = '/postgres';
  const client = new Client({ connectionString: maintUrl.toString() });
  await client.connect();
  try {
    await client.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [database]
    );
  } finally {
    await client.end();
  }
}

// pg_dump always emits a table's owned sequence even when the table itself is excluded
// (there's no `--exclude-sequence` flag), so backup_logs_id_seq still ends up in the
// archive. Left alone, pg_restore --clean can't DROP/CREATE it because the live
// backup_logs.id column's DEFAULT depends on it. Detaching that default for the
// duration of the restore lets pg_restore do its thing; reattaching it afterward and
// bumping the sequence past the live table's current MAX(id) keeps future inserts safe.
async function withBackupLogsSequenceDetached(database, fn) {
  const url = new URL(process.env.DATABASE_URL);
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  try {
    await client.query('ALTER TABLE backup_logs ALTER COLUMN id DROP DEFAULT');
  } finally {
    await client.end();
  }

  try {
    return await fn();
  } finally {
    const reattach = new Client({ connectionString: url.toString() });
    await reattach.connect();
    try {
      await reattach.query('ALTER TABLE backup_logs ALTER COLUMN id SET DEFAULT nextval(\'backup_logs_id_seq\')');
      await reattach.query(
        `SELECT setval('backup_logs_id_seq', COALESCE((SELECT MAX(id) FROM backup_logs), 1))`
      );
    } finally {
      await reattach.end();
    }
  }
}

async function restore(inputPath) {
  const { host, port, user, password, database } = dbConnectionParts();
  return withBackupLogsSequenceDetached(database, async () => {
    await terminateOtherConnections(database);
    return runExecFile(
      pgBin('pg_restore'),
      ['-h', host, '-p', port, '-U', user, '-d', database, '--clean', '--if-exists', '--no-owner', inputPath],
      { PGPASSWORD: password }
    );
  });
}

function resolveBackupPath(filename) {
  const resolved = path.resolve(BACKUP_DIR, filename);
  if (!resolved.startsWith(path.resolve(BACKUP_DIR))) throw new ApiError(400, 'Invalid backup filename');
  return resolved;
}

async function createBackup({ triggerType, triggeredBy }) {
  ensureBackupDir();
  const filename = `alnaciim_erp_${timestampForFilename()}.dump`;
  const filePath = resolveBackupPath(filename);

  const { rows } = await pool.query(
    `INSERT INTO backup_logs (operation, filename, status, trigger_type, triggered_by)
     VALUES ('backup', $1, 'running', $2, $3) RETURNING *`,
    [filename, triggerType, triggeredBy || null]
  );
  const log = rows[0];

  try {
    await dump(filePath);
    const { size } = fs.statSync(filePath);
    const { rows: updated } = await pool.query(
      `UPDATE backup_logs SET status = 'success', file_size_bytes = $1, completed_at = now() WHERE id = $2 RETURNING *`,
      [size, log.id]
    );
    await pruneOldBackups();
    return updated[0];
  } catch (err) {
    await pool.query(
      `UPDATE backup_logs SET status = 'failed', error_message = $1, completed_at = now() WHERE id = $2`,
      [err.message.slice(0, 2000), log.id]
    );
    throw err;
  }
}

async function restoreBackup({ backupLogId, triggeredBy }) {
  const { rows } = await pool.query(`SELECT * FROM backup_logs WHERE id = $1 AND operation = 'backup'`, [backupLogId]);
  const backup = rows[0];
  if (!backup) throw new ApiError(404, 'Backup not found');
  if (backup.status !== 'success') throw new ApiError(400, 'Only a successful backup can be restored');

  const filePath = resolveBackupPath(backup.filename);
  if (!fs.existsSync(filePath)) throw new ApiError(404, 'Backup file is no longer on disk');

  const { rows: logRows } = await pool.query(
    `INSERT INTO backup_logs (operation, filename, status, trigger_type, triggered_by)
     VALUES ('restore', $1, 'running', 'manual', $2) RETURNING *`,
    [backup.filename, triggeredBy]
  );
  const log = logRows[0];

  try {
    await restore(filePath);
    const { rows: updated } = await pool.query(
      `UPDATE backup_logs SET status = 'success', completed_at = now() WHERE id = $1 RETURNING *`,
      [log.id]
    );
    return updated[0];
  } catch (err) {
    await pool.query(
      `UPDATE backup_logs SET status = 'failed', error_message = $1, completed_at = now() WHERE id = $2`,
      [err.message.slice(0, 2000), log.id]
    );
    throw err;
  }
}

// Deletes backup FILES older than BACKUP_RETENTION_DAYS to bound disk usage.
// Log rows are kept indefinitely as an audit trail (the download endpoint
// simply 404s once the underlying file is gone).
async function pruneOldBackups() {
  const days = Number(process.env.BACKUP_RETENTION_DAYS) || 30;
  const { rows } = await pool.query(
    `SELECT id, filename FROM backup_logs
     WHERE operation = 'backup' AND status = 'success' AND started_at < now() - ($1 || ' days')::interval`,
    [days]
  );
  for (const row of rows) {
    const filePath = resolveBackupPath(row.filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
}

async function listBackups() {
  const { rows } = await pool.query(
    `SELECT bl.*, u.full_name AS triggered_by_name
     FROM backup_logs bl LEFT JOIN users u ON u.id = bl.triggered_by
     WHERE bl.operation = 'backup'
     ORDER BY bl.started_at DESC`
  );
  return rows.map((r) => ({ ...r, file_exists: fs.existsSync(resolveBackupPath(r.filename)) }));
}

async function listLogs() {
  const { rows } = await pool.query(
    `SELECT bl.*, u.full_name AS triggered_by_name
     FROM backup_logs bl LEFT JOIN users u ON u.id = bl.triggered_by
     ORDER BY bl.started_at DESC LIMIT 200`
  );
  return rows;
}

async function deleteBackup(id) {
  const { rows } = await pool.query(`SELECT * FROM backup_logs WHERE id = $1 AND operation = 'backup'`, [id]);
  const backup = rows[0];
  if (!backup) throw new ApiError(404, 'Backup not found');
  const filePath = resolveBackupPath(backup.filename);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  await pool.query('DELETE FROM backup_logs WHERE id = $1', [id]);
}

async function getBackupFile(id) {
  const { rows } = await pool.query(`SELECT * FROM backup_logs WHERE id = $1 AND operation = 'backup'`, [id]);
  const backup = rows[0];
  if (!backup) throw new ApiError(404, 'Backup not found');
  const filePath = resolveBackupPath(backup.filename);
  if (!fs.existsSync(filePath)) throw new ApiError(404, 'Backup file is no longer on disk');
  return { filePath, filename: backup.filename };
}

module.exports = { createBackup, restoreBackup, listBackups, listLogs, deleteBackup, getBackupFile };
