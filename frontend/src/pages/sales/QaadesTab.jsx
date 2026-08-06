import { useState } from 'react';
import { useApi } from '../../components/useApi';
import Table from '../../components/Table';
import client from '../../api/client';
import { useAuth } from '../../context/AuthContext';

const EMPTY_FORM = { qaade_code: '', name: '', area: '', collector_id: '', truck_id: '' };

function QaadePerformance({ qaadeId, onClose }) {
  const { rows } = useApi(`/qaades/${qaadeId}/performance`);
  if (!rows) return <div className="card"><p className="muted">Loading…</p></div>;

  return (
    <div className="card">
      <div className="toolbar" style={{ justifyContent: 'space-between' }}>
        <strong>Performance — {rows.qaade.name} ({rows.qaade.qaade_code})</strong>
        <button className="btn secondary" onClick={onClose}>Close</button>
      </div>
      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-card__label">Total Sales</div>
          <div className="kpi-card__value">${Number(rows.sales.total_sales).toFixed(2)}</div>
          <div className="kpi-card__sub">{rows.sales.order_count} orders</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-card__label">Cash vs Credit</div>
          <div className="kpi-card__value">${Number(rows.sales.cash_sales).toFixed(2)}</div>
          <div className="kpi-card__sub">Credit: ${Number(rows.sales.credit_sales).toFixed(2)}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-card__label">Collections</div>
          <div className="kpi-card__value">${Number(rows.collections.total_collected).toFixed(2)}</div>
          <div className="kpi-card__sub">{rows.collections.payment_count} payments</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-card__label">Outstanding Balance</div>
          <div className="kpi-card__value" style={{ color: rows.outstanding_balance > 0 ? '#dc2626' : undefined }}>
            ${Number(rows.outstanding_balance).toFixed(2)}
          </div>
        </div>
      </div>
      <Table
        columns={[
          { key: 'name', header: 'Customer' },
          { key: 'hno', header: 'HNO', render: (r) => r.hno || '—' },
          { key: 'order_count', header: 'Orders' },
          { key: 'total_sales', header: 'Total Sales', render: (r) => `$${Number(r.total_sales).toFixed(2)}` }
        ]}
        rows={rows.customers}
      />
    </div>
  );
}

export default function QaadesTab() {
  const { user } = useAuth();
  const canEdit = ['Admin', 'Sales Manager'].includes(user?.role);
  const { rows, reload } = useApi('/qaades');
  const { rows: users } = useApi('/users');
  const { rows: trucks } = useApi('/trucks');
  const collectors = users?.filter((u) => u.role_name === 'Driver');
  const [form, setForm] = useState(EMPTY_FORM);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState(null);
  const [viewingId, setViewingId] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    try {
      await client.post('/qaades', { ...form, collector_id: form.collector_id ? Number(form.collector_id) : undefined, truck_id: form.truck_id ? Number(form.truck_id) : undefined });
      setForm(EMPTY_FORM);
      setShowForm(false);
      reload();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create qaade');
    }
  }

  return (
    <div>
      <p className="muted">Qaade = delivery/sales route, collector, and area-based customer grouping — carried over from the legacy route-management workflow.</p>
      <div className="toolbar">
        {canEdit && <button className="btn" onClick={() => setShowForm((s) => !s)}>{showForm ? 'Cancel' : '+ New Qaade'}</button>}
      </div>

      {showForm && (
        <form className="stacked-form card" onSubmit={handleSubmit}>
          {error && <div className="error-box" style={{ gridColumn: '1/-1' }}>{error}</div>}
          <label>Qaade Code<input required value={form.qaade_code} onChange={(e) => setForm({ ...form, qaade_code: e.target.value })} /></label>
          <label>Name<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label>Area<input value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })} /></label>
          <label>Collector
            <select value={form.collector_id} onChange={(e) => setForm({ ...form, collector_id: e.target.value })}>
              <option value="">Select…</option>
              {collectors?.map((c) => <option key={c.id} value={c.id}>{c.full_name}</option>)}
            </select>
          </label>
          <label>Truck
            <select value={form.truck_id} onChange={(e) => setForm({ ...form, truck_id: e.target.value })}>
              <option value="">Select…</option>
              {trucks?.map((t) => <option key={t.id} value={t.id}>{t.plate_number}</option>)}
            </select>
          </label>
          <div><button className="btn" type="submit">Save Qaade</button></div>
        </form>
      )}

      <div className="card table-wrap">
        <table>
          <thead>
            <tr><th>Code</th><th>Name</th><th>Area</th><th>Collector</th><th>Truck</th><th>Customers</th><th>Status</th><th></th></tr>
          </thead>
          <tbody>
            {rows?.map((q) => (
              <tr key={q.id}>
                <td>{q.qaade_code}</td>
                <td>{q.name}</td>
                <td>{q.area || '—'}</td>
                <td>{q.collector_name || '—'}</td>
                <td>{q.plate_number || '—'}</td>
                <td>{q.customer_count}</td>
                <td><span className={`badge badge--${q.status === 'active' ? 'ok' : 'low'}`}>{q.status}</span></td>
                <td><button className="btn secondary" onClick={() => setViewingId(q.id)}>Performance</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows?.length && <p className="muted">No qaades set up yet.</p>}
      </div>

      {viewingId && <QaadePerformance qaadeId={viewingId} onClose={() => setViewingId(null)} />}
    </div>
  );
}
