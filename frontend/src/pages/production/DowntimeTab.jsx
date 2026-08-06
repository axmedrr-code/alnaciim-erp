import { useState } from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { AlertOctagon, Clock, CheckCircle2, AlertCircle, X } from 'lucide-react';
import { useApi } from '../../components/useApi';
import Table from '../../components/Table';
import client from '../../api/client';
import { useAuth } from '../../context/AuthContext';

const STATUS_BADGE = { operational: 'ok', under_maintenance: 'info', breakdown: 'low', retired: 'low' };

// There is no backend endpoint to list historical downtime_logs (only "report a new
// one" and "resolve one you already have the id for"), so this view works with what
// IS exposed: current machine status, the 7-day downtime-hours aggregate already used
// on the main dashboard, and a live "Report Breakdown" / "Mark Resolved" action pair
// using the two endpoints that already exist but never had a UI.
export default function DowntimeTab() {
  const { user } = useAuth();
  const canReport = ['Admin', 'Production Manager', 'Technician'].includes(user?.role);
  const { rows: machines, reload } = useApi('/production/machines');
  const { rows: summary } = useApi('/reports/dashboard-summary');
  const [reportingId, setReportingId] = useState(null);
  const [category, setCategory] = useState('breakdown');
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [openDowntime, setOpenDowntime] = useState({}); // machine_id -> downtime_log id reported this session

  function flashSuccess(msg) { setSuccess(msg); setTimeout(() => setSuccess(null), 4000); }

  async function reportBreakdown(machineId) {
    setError(null);
    try {
      const { data } = await client.post(`/production/machines/${machineId}/downtime`, {
        start_time: new Date().toISOString(), category, reason: reason || undefined
      });
      setOpenDowntime((prev) => ({ ...prev, [machineId]: data.data.id }));
      setReportingId(null);
      setCategory('breakdown');
      setReason('');
      flashSuccess('Breakdown reported — machine marked down.');
      reload();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to report breakdown');
    }
  }

  async function resolveDowntime(machineId) {
    const downtimeId = openDowntime[machineId];
    if (!downtimeId) return;
    await client.put(`/production/downtime/${downtimeId}/resolve`, {});
    setOpenDowntime((prev) => { const next = { ...prev }; delete next[machineId]; return next; });
    flashSuccess('Machine marked operational again.');
    reload();
  }

  if (!machines || !summary) return <p className="muted">Loading…</p>;

  const downMachines = machines.filter((m) => m.status === 'breakdown' || m.status === 'under_maintenance');
  const totalHours7d = summary.downtime_last_7_days.reduce((s, r) => s + Number(r.hours_down), 0);

  return (
    <div>
      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-card__top"><div className={`kpi-card__icon${downMachines.length > 0 ? ' kpi-card__icon--danger' : ' kpi-card__icon--success'}`}><AlertOctagon size={18} /></div></div>
          <div className="kpi-card__label">Machines Down Now</div>
          <div className="kpi-card__value" style={{ color: downMachines.length > 0 ? 'var(--danger)' : undefined }}>{downMachines.length}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-card__top"><div className="kpi-card__icon kpi-card__icon--warning"><Clock size={18} /></div></div>
          <div className="kpi-card__label">Downtime Hours (7 days)</div>
          <div className="kpi-card__value">{totalHours7d.toFixed(1)}h</div>
        </div>
      </div>

      {success && <div className="success-box"><CheckCircle2 size={15} /> {success}</div>}
      {error && <div className="error-box"><AlertCircle size={15} /> {error}</div>}

      <div className="chart-grid">
        <div className="card">
          <h3>Downtime Hours by Machine — Last 7 Days</h3>
          {summary.downtime_last_7_days.length ? (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={summary.downtime_last_7_days.map((r) => ({ name: r.machine_name, Hours: Number(r.hours_down) }))} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} width={40} />
                <Tooltip />
                <Bar dataKey="Hours" fill="var(--danger)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <p className="muted">No downtime recorded in the last 7 days.</p>}
        </div>

        <div className="card">
          <h3>Machine Status</h3>
          <Table
            columns={[
              { key: 'code', header: 'Code' },
              { key: 'name', header: 'Machine' },
              { key: 'status', header: 'Status', render: (r) => <span className={`badge badge--${STATUS_BADGE[r.status]}`}>{r.status.replace('_', ' ')}</span> },
              canReport && {
                key: 'actions', header: '', sortable: false, render: (m) => {
                  if (m.status === 'breakdown' && openDowntime[m.id]) {
                    return <button className="btn secondary" onClick={() => resolveDowntime(m.id)}>Mark Resolved</button>;
                  }
                  if (m.status === 'operational') {
                    return reportingId === m.id ? (
                      <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <select value={category} onChange={(e) => setCategory(e.target.value)} style={{ width: 130 }}>
                          <option value="breakdown">Breakdown</option>
                          <option value="scheduled_maintenance">Scheduled Maintenance</option>
                          <option value="power_outage">Power Outage</option>
                          <option value="other">Other</option>
                        </select>
                        <input placeholder="Reason" value={reason} onChange={(e) => setReason(e.target.value)} style={{ width: 120 }} />
                        <button className="btn" onClick={() => reportBreakdown(m.id)}>Save</button>
                        <button className="btn-icon" onClick={() => setReportingId(null)}><X size={13} /></button>
                      </span>
                    ) : (
                      <button className="btn secondary" onClick={() => setReportingId(m.id)}>Report Breakdown</button>
                    );
                  }
                  return null;
                }
              }
            ].filter(Boolean)}
            rows={machines}
            emptyText="No machines registered yet."
          />
        </div>
      </div>
    </div>
  );
}
