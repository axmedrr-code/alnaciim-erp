import { useState } from 'react';
import { useApi } from '../components/useApi';
import Table from '../components/Table';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';

const TYPES = [
  ['shortage', 'Shortage'], ['leakage', 'Leakage'], ['customer_dispute', 'Customer Dispute'],
  ['wrong_delivery', 'Wrong Delivery'], ['missing_payment', 'Missing Payment'], ['damaged_goods', 'Damaged Goods']
];
const CREATE = ['Admin', 'Operation Manager', 'Route Supervisor', 'Supervisor', 'Data Entry Operator', 'Driver'];
const RESOLVE = ['Admin', 'Operation Manager', 'Route Supervisor', 'Supervisor'];
const EMPTY = { type: 'damaged_goods', route_run_id: '', route_stop_id: '', truck_id: '', payment_id: '', quantity: '', amount: '', description: '' };

export default function LogisticsExceptionsPage() {
  const { user } = useAuth();
  const [status, setStatus] = useState('open');
  const [type, setType] = useState('');
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState('');
  const routes = useApi('/logistics/routes');
  const stops = useApi(form.route_run_id ? `/logistics/routes/${form.route_run_id}/stops` : null, [form.route_run_id]);
  const data = useApi(`/logistics/exceptions?status=${encodeURIComponent(status)}${type ? `&type=${encodeURIComponent(type)}` : ''}`, [status, type]);

  async function submit(e) {
    e.preventDefault(); setError('');
    const body = { ...form,
      route_run_id: form.route_run_id ? Number(form.route_run_id) : undefined,
      route_stop_id: form.route_stop_id ? Number(form.route_stop_id) : undefined,
      truck_id: form.truck_id ? Number(form.truck_id) : undefined,
      payment_id: form.payment_id ? Number(form.payment_id) : undefined,
      quantity: form.quantity ? Number(form.quantity) : undefined,
      amount: form.amount ? Number(form.amount) : undefined
    };
    try { await client.post('/logistics/exceptions', body); setForm(EMPTY); data.reload(); }
    catch (err) { setError(err.response?.data?.error || 'Could not record this logistics incident.'); }
  }

  async function resolve(row) {
    const resolution_notes = window.prompt('Resolution notes (required):');
    if (resolution_notes === null) return;
    if (resolution_notes.trim().length < 3) { setError('Enter resolution notes of at least 3 characters.'); return; }
    setError('');
    try { await client.post(`/logistics/exceptions/${row.id}/resolve`, { resolution_notes }); data.reload(); }
    catch (err) { setError(err.response?.data?.error || 'Could not resolve this incident.'); }
  }

  async function investigate(row) {
    const investigation_notes = window.prompt('Investigation note (required):');
    if (investigation_notes === null) return;
    if (investigation_notes.trim().length < 3) { setError('Enter an investigation note of at least 3 characters.'); return; }
    setError('');
    try { await client.post(`/logistics/exceptions/${row.id}/investigate`, { investigation_notes }); data.reload(); }
    catch (err) { setError(err.response?.data?.error || 'Could not start incident investigation.'); }
  }

  const columns = [
    { key: 'created_at', header: 'Reported', render: (r) => new Date(r.created_at).toLocaleString() },
    { key: 'type', header: 'Incident', render: (r) => TYPES.find(([k]) => k === r.type)?.[1] || r.type },
    { key: 'route_number', header: 'Route' }, { key: 'plate_number', header: 'Truck' },
    { key: 'sequence_number', header: 'Stop' }, { key: 'description', header: 'Details' },
    { key: 'quantity', header: 'Qty' }, { key: 'status', header: 'Status' }, { key: 'raised_by_name', header: 'Reported By' },
    ...(RESOLVE.includes(user?.role) ? [{ key: 'action', header: 'Action', render: (r) => <span style={{ display: 'flex', gap: 6 }}>
      {r.status === 'open' && <button className="btn secondary small" onClick={() => investigate(r)}>Investigate</button>}
      {r.status !== 'resolved' ? <button className="btn small" onClick={() => resolve(r)}>Resolve</button> : (r.resolved_by_name || 'Resolved')}
    </span> }] : [])
  ];

  return <div>
    <div className="page-header"><div><h1>Logistics Incidents</h1><p className="muted">Shortages, leaks, delivery issues and damaged goods—with an auditable resolution trail.</p></div></div>
    {error && <div className="error-box" role="alert">{error}</div>}
    {CREATE.includes(user?.role) && <form className="form-modern" onSubmit={submit}>
      <h2 className="form-modern__title">Report an Incident</h2>
      <div className="form-grid">
        <div className="form-field"><label>Incident Type</label><select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>{TYPES.map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></div>
        <div className="form-field"><label>Route</label><select value={form.route_run_id} onChange={(e) => setForm({ ...form, route_run_id: e.target.value, route_stop_id: '' })}><option value="">Select route…</option>{routes.rows?.map((r) => <option key={r.id} value={r.id}>{r.route_number} · {r.route_date} · {r.plate_number}</option>)}</select></div>
        <div className="form-field"><label>Route Stop (optional)</label><select disabled={!form.route_run_id} value={form.route_stop_id} onChange={(e) => setForm({ ...form, route_stop_id: e.target.value })}><option value="">Select stop…</option>{stops.rows?.map((s) => <option key={s.id} value={s.id}>Stop {s.sequence_number} · {s.customer_name || s.hno || 'Customer'}</option>)}</select></div>
        <div className="form-field"><label>Quantity{form.type === 'damaged_goods' ? ' (required)' : ''}</label><input type="number" min="0.001" step="0.001" required={form.type === 'damaged_goods'} value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} /></div>
        {form.type === 'missing_payment' && <div className="form-field"><label>Payment ID (optional)</label><input type="number" min="1" value={form.payment_id} onChange={(e) => setForm({ ...form, payment_id: e.target.value })} /></div>}
        <div className="form-field" style={{ gridColumn: '1/-1' }}><label>Description{form.type === 'damaged_goods' ? ' (required)' : ''}</label><textarea required={form.type === 'damaged_goods'} rows="2" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
      </div>
      <div className="form-actions"><button className="btn" type="submit">Record Incident</button></div>
    </form>}
    <div className="toolbar" style={{ marginTop: 18 }}>
      <label>Status <select value={status} onChange={(e) => setStatus(e.target.value)}><option value="open">Open</option><option value="investigating">Investigating</option><option value="resolved">Resolved</option><option value="">All statuses</option></select></label>
      <label>Type <select value={type} onChange={(e) => setType(e.target.value)}><option value="">All incident types</option>{TYPES.map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <button className="btn secondary" onClick={data.reload}>Refresh</button>
    </div>
    <div className="card"><Table columns={columns} rows={data.rows || []} searchable sortable pageSize={20} emptyText="No incidents match these filters." /></div>
  </div>;
}
