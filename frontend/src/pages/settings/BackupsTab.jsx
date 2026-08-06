import { useState } from 'react';
import { useApi } from '../../components/useApi';
import Table from '../../components/Table';
import client from '../../api/client';

const STATUS_BADGE = { success: 'ok', failed: 'low', running: 'info' };

function formatBytes(bytes) {
  if (bytes == null) return '—';
  const n = Number(bytes);
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function cronToEnglish(expr) {
  // Just the common default is spelled out; anything else shows the raw expression.
  if (expr === '0 2 * * *') return 'Every day at 2:00 AM';
  return expr;
}

function RestoreConfirm({ backup, onDone, onCancel }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function doRestore() {
    setBusy(true);
    setError(null);
    try {
      await client.post(`/backups/${backup.id}/restore`, { confirm: 'RESTORE' });
      onDone();
    } catch (err) {
      setError(err.response?.data?.error || 'Restore failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ borderColor: 'var(--danger)' }}>
      <strong style={{ color: 'var(--danger)' }}>⚠ Restore {backup.filename}?</strong>
      <p className="muted">
        This will overwrite <strong>every table</strong> in the live database with the contents of this backup
        (taken {new Date(backup.started_at).toLocaleString()}). Anything created or changed since then will be lost.
        This cannot be undone. Type <strong>RESTORE</strong> to confirm.
      </p>
      {error && <div className="error-box">{error}</div>}
      <div style={{ display: 'flex', gap: 8 }}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Type RESTORE" style={{ width: 160 }} />
        <button className="btn danger" disabled={text !== 'RESTORE' || busy} onClick={doRestore}>
          {busy ? 'Restoring…' : 'Confirm Restore'}
        </button>
        <button className="btn secondary" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </div>
  );
}

export default function BackupsTab() {
  const { rows: backups, reload } = useApi('/backups');
  const { rows: logs, reload: reloadLogs } = useApi('/backups/logs');
  const { rows: schedule } = useApi('/backups/schedule');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);
  const [restoringId, setRestoringId] = useState(null);

  async function runBackupNow() {
    setRunning(true);
    setError(null);
    try {
      await client.post('/backups');
      reload();
      reloadLogs();
    } catch (err) {
      setError(err.response?.data?.error || 'Backup failed');
    } finally {
      setRunning(false);
    }
  }

  async function downloadBackup(id) {
    const res = await client.get(`/backups/${id}/download`, { responseType: 'blob' });
    const url = URL.createObjectURL(res.data);
    const a = document.createElement('a');
    a.href = url;
    a.download = '';
    a.click();
    URL.revokeObjectURL(url);
  }

  async function deleteBackup(id) {
    if (!confirm('Delete this backup file permanently? This cannot be undone.')) return;
    await client.delete(`/backups/${id}`);
    reload();
  }

  return (
    <div>
      {schedule && (
        <div className="card">
          <strong>Automatic daily backup:</strong> {cronToEnglish(schedule.cron_schedule)}
          <span className="muted"> · files older than {schedule.retention_days} days are pruned automatically after each backup</span>
        </div>
      )}

      <div className="toolbar">
        <button className="btn" onClick={runBackupNow} disabled={running}>{running ? 'Backing up…' : 'Run Backup Now'}</button>
      </div>
      {error && <div className="error-box">{error}</div>}

      <div className="card table-wrap">
        <table>
          <thead>
            <tr><th>Date</th><th>Filename</th><th>Size</th><th>Status</th><th>Triggered By</th><th style={{ minWidth: 220 }}>Actions</th></tr>
          </thead>
          <tbody>
            {backups?.map((b) => (
              <tr key={b.id}>
                <td>{new Date(b.started_at).toLocaleString()}</td>
                <td>{b.filename}</td>
                <td>{formatBytes(b.file_size_bytes)}</td>
                <td><span className={`badge badge--${STATUS_BADGE[b.status]}`}>{b.status}</span></td>
                <td>{b.triggered_by_name || (b.trigger_type === 'scheduled' ? 'Scheduled' : '—')}</td>
                <td style={{ display: 'flex', gap: 6 }}>
                  {b.status === 'success' && b.file_exists && (
                    <>
                      <button className="btn secondary" onClick={() => downloadBackup(b.id)}>Download</button>
                      <button className="btn secondary" onClick={() => setRestoringId(b.id)}>Restore</button>
                      <button className="btn secondary" onClick={() => deleteBackup(b.id)}>Delete</button>
                    </>
                  )}
                  {b.status === 'success' && !b.file_exists && <span className="muted">File pruned</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!backups?.length && <p className="muted">No backups yet — click "Run Backup Now" to create one.</p>}
      </div>

      {restoringId && (
        <RestoreConfirm
          backup={backups.find((b) => b.id === restoringId)}
          onCancel={() => setRestoringId(null)}
          onDone={() => { setRestoringId(null); reload(); reloadLogs(); }}
        />
      )}

      <div className="card">
        <h3>Backup & Restore Activity Log</h3>
        <Table
          columns={[
            { key: 'started_at', header: 'Date', render: (r) => new Date(r.started_at).toLocaleString() },
            { key: 'operation', header: 'Operation' },
            { key: 'trigger_type', header: 'Trigger' },
            { key: 'triggered_by_name', header: 'By', render: (r) => r.triggered_by_name || '—' },
            { key: 'status', header: 'Status', render: (r) => <span className={`badge badge--${STATUS_BADGE[r.status]}`}>{r.status}</span> },
            { key: 'error_message', header: 'Error', render: (r) => r.error_message ? <span title={r.error_message}>{r.error_message.slice(0, 60)}…</span> : '—' }
          ]}
          rows={logs}
          emptyText="No backup activity recorded yet."
        />
      </div>
    </div>
  );
}
