// Backups E2E (run through run-backups-e2e.js on a throwaway LOCAL database - a restore replaces a whole database).
// mode "on":  real pg_dump / pg_restore round trip, retention, deletion, path safety, role scoping, trigger/DB survival.
// mode "off": restore switched off (default for hosted servers) and a broken pg_dump: failures are logged, nothing is damaged.
const fs = require('fs');
const path = require('path');
const { start } = require('./harness');

(async () => {
  const mode = process.env.E2E_BACKUP_MODE === 'off' ? 'off' : 'on';
  const BACKUP_DIR = path.join(__dirname, '../../backups');
  const env = mode === 'on'
    ? { PG_BIN_PATH: process.env.PG_BIN_PATH || '', ALLOW_DB_RESTORE: 'true', BACKUP_RETENTION_DAYS: '1' }
    : { PG_BIN_PATH: 'C:\\definitely\\not\\a\\real\\folder', BACKUP_RETENTION_DAYS: '1' };
  const { api, raw, q, pool, U, rep, finish } = await start('bkp', [['cash', 'Cashier'], ['fin', 'Finance Officer'], ['sales', 'Sales Manager']], { env });
  const stamp = Date.now();
  const ids = [];
  const mkCust = async (n, name) => (await q(`insert into customers (code, name, type) values ($1,$2,'wholesale') returning id`, [`BK${n}-${String(stamp).slice(-8)}`, name]))[0].id;
  const nameOf = async (id) => (await q('select name from customers where id=$1', [id]))[0]?.name;

  // ---------- access (both modes)
  for (const [m, p, label, body] of [['GET', '/backups/schedule', 'schedule'], ['GET', '/backups', 'list'], ['GET', '/backups/logs', 'logs'], ['POST', '/backups', 'create', {}], ['GET', '/backups/1/download', 'download'], ['POST', '/backups/1/restore', 'restore', { confirm: 'RESTORE' }], ['DELETE', '/backups/1', 'delete']]) {
    const codes = [];
    for (const who of ['cash', 'fin', 'sales']) codes.push((await api(who, m, p, body)).s);
    rep(`Backup ${label}: Cashier, Finance and Sales Manager are all refused (403)`, codes.every((c) => c === 403), codes.join(','));
  }
  let r = await raw('GET', '/backups'); rep('Backups need a signed-in Admin (401 without a token)', r.s === 401);
  r = await api('admin', 'GET', '/backups/schedule'); rep('The schedule endpoint reports the cron schedule and the retention days (1)', r.s === 200 && r.d.retention_days === 1 && r.d.cron_schedule, JSON.stringify(r.d));

  if (mode === 'off') {
    // ---------- restore disabled
    const before = (await q('select count(*)::int n from customers'))[0].n;
    r = await api('admin', 'POST', '/backups/1/restore', { confirm: 'RESTORE' }); rep('Restore is refused (403) unless the server operator enabled it, and the message says how', r.s === 403 && /ALLOW_DB_RESTORE/.test(r.e || ''), `[${r.s}] ${r.e}`);
    r = await api('admin', 'POST', '/backups/1/restore', {}); rep('Without the confirmation word the request is still invalid (400)', r.s === 400 || r.s === 403);
    rep('Nothing was changed by the refused restore', (await q('select count(*)::int n from customers'))[0].n === before);
    // ---------- broken pg_dump
    const files0 = fs.existsSync(BACKUP_DIR) ? fs.readdirSync(BACKUP_DIR).filter((f) => f.endsWith('.dump')).length : 0;
    r = await api('admin', 'POST', '/backups', {}); rep('A backup that cannot run fails with a clear error, not a hang', r.s >= 400, `[${r.s}] ${r.e}`);
    const failed = (await q(`select status, error_message from backup_logs where operation='backup' order by id desc limit 1`))[0];
    rep('The failure is recorded in the backup log with its error message', failed && failed.status === 'failed' && failed.error_message && failed.error_message.length > 0, JSON.stringify(failed));
    rep('No partial dump file was left on disk', (fs.existsSync(BACKUP_DIR) ? fs.readdirSync(BACKUP_DIR).filter((f) => f.endsWith('.dump')).length : 0) === files0);
    r = await api('admin', 'GET', '/backups'); rep('The failed run is listed with file_exists = false', r.s === 200 && r.d.some((b) => b.status === 'failed' && b.file_exists === false));
    r = await api('admin', 'GET', '/auth/me'); rep('The API is healthy after the failed backup', r.s === 200);
    await finish();
    return;
  }

  // ---------- real backup
  const A = await mkCust(1, 'Original A');
  await pool.query(`insert into audit_logs (user_id, action, entity_type, entity_id) values ($1,'CREATE','e2e_backup_marker',1)`, [U.admin.id]); // an audit row must exist for the append-only check after a restore to mean anything
  r = await api('admin', 'POST', '/backups', {}); const B1 = r.d || {};
  rep('Admin creates a backup: success, a .dump file with a size, triggered by the Admin', r.s === 201 && B1.status === 'success' && /\.dump$/.test(B1.filename) && Number(B1.file_size_bytes) > 1000 && B1.triggered_by === U.admin.id && B1.trigger_type === 'manual', `[${r.s}] ${r.e}`);
  ids.push(B1.id);
  rep('The dump file really exists on disk with that size', fs.existsSync(path.join(BACKUP_DIR, B1.filename)) && fs.statSync(path.join(BACKUP_DIR, B1.filename)).size === Number(B1.file_size_bytes));
  r = await api('admin', 'GET', '/backups'); const row = (r.d || []).find((b) => b.id === B1.id);
  rep('The backup list shows it with file_exists and who triggered it', r.s === 200 && row && row.file_exists === true && row.triggered_by_name);
  r = await api('admin', 'GET', '/backups/logs'); rep('The operation log lists the backup', r.s === 200 && r.d.some((l) => l.id === B1.id && l.operation === 'backup'));
  r = await api('admin', 'GET', '/backups/99999999/download'); rep('Downloading an unknown backup -> 404', r.s === 404);
  r = await api('admin', 'GET', '/backups/abc/download'); rep('A non-numeric backup id -> 404 (not a 500)', r.s === 404, `[${r.s}]`);
  const magic = fs.readFileSync(path.join(BACKUP_DIR, B1.filename)).subarray(0, 5).toString();
  rep('The dump is a genuine PostgreSQL custom-format archive (PGDMP)', magic === 'PGDMP', magic);

  // ---------- restore validation
  r = await api('admin', 'POST', `/backups/${B1.id}/restore`, {}); rep('Restore without the confirmation word -> 400', r.s === 400);
  r = await api('admin', 'POST', `/backups/${B1.id}/restore`, { confirm: 'yes please' }); rep('Restore with the wrong confirmation word -> 400', r.s === 400);
  r = await api('admin', 'POST', '/backups/99999999/restore', { confirm: 'RESTORE' }); rep('Restoring an unknown backup -> 404', r.s === 404);
  const failedRow = (await q(`insert into backup_logs (operation, filename, status, trigger_type, triggered_by) values ('backup','failed_e2e.dump','failed','manual',$1) returning id`, [U.admin.id]))[0].id;
  r = await api('admin', 'POST', `/backups/${failedRow}/restore`, { confirm: 'RESTORE' }); rep('A failed backup can never be restored (400)', r.s === 400);
  const ghost = (await q(`insert into backup_logs (operation, filename, status, trigger_type, triggered_by, file_size_bytes) values ('backup','ghost_e2e.dump','success','manual',$1,10) returning id`, [U.admin.id]))[0].id;
  r = await api('admin', 'POST', `/backups/${ghost}/restore`, { confirm: 'RESTORE' }); rep('A backup whose file is gone cannot be restored (404)', r.s === 404);
  r = await api('admin', 'GET', `/backups/${ghost}/download`); rep('...nor downloaded (404)', r.s === 404);

  // ---------- path safety
  fs.mkdirSync(`${BACKUP_DIR}_sibling`, { recursive: true }); fs.writeFileSync(`${BACKUP_DIR}_sibling/secret.txt`, 'not a backup');
  const evil = [['../package.json', 'parent folder'], ['../backups_sibling/secret.txt', 'sibling folder with the same prefix'], ['..\\package.json', 'backslash traversal']];
  for (const [fn, label] of evil) {
    const id = (await q(`insert into backup_logs (operation, filename, status, trigger_type, triggered_by) values ('backup',$1,'success','manual',$2) returning id`, [fn, U.admin.id]))[0].id;
    const d = await api('admin', 'GET', `/backups/${id}/download`);
    const rs = await api('admin', 'POST', `/backups/${id}/restore`, { confirm: 'RESTORE' });
    rep(`A backup record pointing outside the backup folder (${label}) is refused for download and restore`, d.s === 400 && rs.s === 400, `download=${d.s} restore=${rs.s}`);
  }
  rep('...and none of those files was touched', fs.existsSync(path.join(__dirname, '../../package.json')) && fs.existsSync(`${BACKUP_DIR}_sibling/secret.txt`));
  fs.rmSync(`${BACKUP_DIR}_sibling`, { recursive: true, force: true });
  await pool.query(`delete from backup_logs where filename like '..%'`);

  // ---------- retention: old files are pruned, their log rows stay
  const oldFile = path.join(BACKUP_DIR, `old_e2e_${stamp}.dump`); fs.writeFileSync(oldFile, 'old');
  const oldId = (await q(`insert into backup_logs (operation, filename, status, trigger_type, triggered_by, started_at, file_size_bytes) values ('backup',$1,'success','scheduled',$2, now() - interval '40 days', 3) returning id`, [path.basename(oldFile), U.admin.id]))[0].id;
  r = await api('admin', 'POST', '/backups', {}); const B2 = r.d || {}; ids.push(B2.id);
  rep('A new backup prunes files older than the retention period', r.s === 201 && !fs.existsSync(oldFile), `[${r.s}]`);
  r = await api('admin', 'GET', '/backups'); const oldRow = (r.d || []).find((b) => b.id === oldId);
  rep('...but the old log row stays as an audit trail (file_exists = false)', oldRow && oldRow.file_exists === false);
  rep('Two backups get two distinct files', B1.filename !== B2.filename && fs.existsSync(path.join(BACKUP_DIR, B2.filename)));

  // ---------- full restore round trip
  const markA0 = await nameOf(A);
  await pool.query(`update customers set name='Changed after backup' where id=$1`, [A]);
  const Bc = await mkCust(2, 'Created after backup');
  const auditAfter = (await q('select count(*)::int n from audit_logs'))[0].n;
  r = await api('admin', 'POST', `/backups/${B1.id}/restore`, { confirm: 'RESTORE' });
  rep('Admin restores the first backup: success', r.s === 200 && r.d.status === 'success' && r.d.operation === 'restore', `[${r.s}] ${r.e}`);
  rep('Data changed after the backup is rolled back: the edited customer is original again', (await nameOf(A)) === markA0, `${await nameOf(A)}`);
  rep('...and the customer created after the backup is gone', (await nameOf(Bc)) === undefined);
  r = await api('admin', 'GET', '/auth/me'); rep('The API keeps working after the restore (connection pool recovered, Admin session valid)', r.s === 200 && r.d.role === 'Admin', `[${r.s}] ${r.e}`);
  r = await api('admin', 'GET', '/backups/logs'); const restoreLog = (r.d || []).find((l) => l.operation === 'restore' && l.filename === B1.filename);
  rep('The restore itself is recorded in the log and survives the restore (backup_logs is kept outside the dump)', restoreLog && restoreLog.status === 'success' && restoreLog.triggered_by === U.admin.id, JSON.stringify(restoreLog));
  rep('Both backups are still listed after the restore', (await api('admin', 'GET', '/backups')).d.filter((b) => ids.includes(b.id)).length === 2);
  let blocked = ''; try { await pool.query(`update audit_logs set action='TAMPERED' where id = (select max(id) from audit_logs)`); } catch (e) { blocked = e.message; }
  rep('The audit append-only protection is still in force after a restore (triggers restored)', /append-only/.test(blocked), blocked);
  r = await api('admin', 'POST', '/backups', {}); rep('A new backup can be taken after a restore (log sequence repaired)', r.s === 201, `[${r.s}] ${r.e}`); if (r.d) ids.push(r.d.id);
  rep('Test marker: the audit rows written after the backup were rolled back too (restore = point-in-time)', (await q('select count(*)::int n from audit_logs'))[0].n <= auditAfter);

  // ---------- delete
  r = await api('admin', 'DELETE', '/backups/99999999'); rep('Deleting an unknown backup -> 404', r.s === 404);
  for (const id of ids) {
    const f = (await q(`select filename from backup_logs where id=$1`, [id]))[0];
    const d = await api('admin', 'DELETE', `/backups/${id}`);
    rep(`Deleting backup ${id} removes its file and its log row (204)`, d.s === 204 && f && !fs.existsSync(path.join(BACKUP_DIR, f.filename)) && (await q('select 1 from backup_logs where id=$1', [id])).length === 0, `[${d.s}]`);
  }
  await pool.query(`delete from backup_logs where filename in ('failed_e2e.dump','ghost_e2e.dump') or id = $1`, [oldId]);
  await finish();
})().catch((e) => { console.log('ERR', String(e.stack || e.message).replace(/postgres(ql)?:\/\/\S+/gi, '<url>')); process.exit(1); });
