import { useMemo, useState } from 'react';
import { useApi } from '../../components/useApi';
import Table from '../../components/Table';
import DateFilterBar, { defaultDateRange } from '../../components/DateFilterBar';
import client from '../../api/client';
import { useAuth } from '../../context/AuthContext';

function SchedulesTab() {
  const { rows } = useApi('/maintenance/schedules');
  return (
    <div className="card">
      <Table
        columns={[
          { key: 'machine_name', header: 'Machine' },
          { key: 'maintenance_type', header: 'Type' },
          { key: 'frequency_days', header: 'Frequency (days)' },
          { key: 'last_done_date', header: 'Last Done', render: (r) => String(r.last_done_date).slice(0, 10) },
          { key: 'next_due_date', header: 'Next Due', render: (r) => {
              const due = new Date(r.next_due_date) <= new Date();
              return <span className={due ? 'badge badge--low' : 'badge badge--ok'}>{String(r.next_due_date).slice(0, 10)}</span>;
            } },
          { key: 'assigned_to_name', header: 'Assigned To' }
        ]}
        rows={rows}
      />
    </div>
  );
}

function LogsTab() {
  const { user } = useAuth();
  const canLog = ['Admin', 'Production Manager', 'Technician'].includes(user?.role);
  const [dateRange, setDateRange] = useState(defaultDateRange());
  // No from/to support on the backend for maintenance logs — filtered client-side
  // against the full list instead, using the same DateFilterBar every other module uses.
  const { rows: allRows, reload } = useApi('/maintenance/logs');
  const rows = useMemo(
    () => (allRows || []).filter((r) => {
      const day = String(r.log_date).slice(0, 10);
      return day >= dateRange.from && day <= dateRange.to;
    }),
    [allRows, dateRange.from, dateRange.to]
  );
  const { rows: machines } = useApi('/production/machines');
  const [form, setForm] = useState({ machine_id: '', type: 'preventive', description: '', cost: '' });
  const [showForm, setShowForm] = useState(false);
  const columns = [
    { key: 'log_date', header: 'Date', render: (r) => String(r.log_date).slice(0, 10) },
    { key: 'machine_name', header: 'Machine' },
    { key: 'type', header: 'Type' },
    { key: 'description', header: 'Description' },
    { key: 'cost', header: 'Cost', render: (r) => `$${Number(r.cost).toFixed(2)}` },
    { key: 'performed_by_name', header: 'By' }
  ];

  async function handleSubmit(e) {
    e.preventDefault();
    await client.post('/maintenance/logs', { ...form, machine_id: Number(form.machine_id), cost: Number(form.cost) || 0, parts_used: [] });
    setForm({ machine_id: '', type: 'preventive', description: '', cost: '' });
    setShowForm(false);
    reload();
  }

  return (
    <div>
      <div className="toolbar">
        {canLog && <button className="btn" onClick={() => setShowForm((s) => !s)}>{showForm ? 'Cancel' : '+ New Log'}</button>}
        <DateFilterBar value={dateRange} onChange={setDateRange} columns={columns} rows={rows} title="Maintenance Logs" />
      </div>
      {showForm && (
        <form className="stacked-form card" onSubmit={handleSubmit}>
          <label>Machine
            <select required value={form.machine_id} onChange={(e) => setForm({ ...form, machine_id: e.target.value })}>
              <option value="">Select…</option>
              {machines?.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </label>
          <label>Type
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              <option value="preventive">Preventive</option>
              <option value="corrective">Corrective</option>
              <option value="breakdown_repair">Breakdown Repair</option>
            </select>
          </label>
          <label>Description<input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
          <label>Cost<input type="number" step="0.01" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} /></label>
          <div><button className="btn" type="submit">Save</button></div>
        </form>
      )}
      <div className="card">
        <Table columns={columns} rows={rows} searchable sortable />
      </div>
    </div>
  );
}

const TABS = [
  { key: 'schedules', label: 'Schedules', Component: SchedulesTab },
  { key: 'logs', label: 'Logs', Component: LogsTab }
];

export default function MaintenancePage() {
  const [tab, setTab] = useState('schedules');
  const Active = TABS.find((t) => t.key === tab).Component;

  return (
    <div>
      <div className="page-header"><h1>Maintenance</h1></div>
      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.key} className={tab === t.key ? 'active' : ''} onClick={() => setTab(t.key)}>{t.label}</button>
        ))}
      </div>
      <Active />
    </div>
  );
}
