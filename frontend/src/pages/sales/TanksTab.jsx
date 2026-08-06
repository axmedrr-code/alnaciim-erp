import { useState } from 'react';
import { useApi } from '../../components/useApi';
import Table from '../../components/Table';
import client from '../../api/client';
import { useAuth } from '../../context/AuthContext';

const EMPTY_FORM = { tank_code: '', customer_id: '', tank_type: 'tank', capacity_liters: '', barcode: '', location: '', installed_date: '' };
const TYPE_LABEL = { tank: 'Tank', drum: 'Drum', underground_reservoir: 'Underground Reservoir' };

function TankHistory({ tankId, onClose }) {
  const { rows } = useApi(`/tanks/${tankId}/history`);
  if (!rows) return <div className="card"><p className="muted">Loading history…</p></div>;

  return (
    <div className="card">
      <div className="toolbar" style={{ justifyContent: 'space-between' }}>
        <strong>History — {rows.tank.tank_code} ({Number(rows.tank.capacity_liters).toLocaleString()} L)</strong>
        <button className="btn secondary" onClick={onClose}>Close</button>
      </div>
      <Table
        columns={[
          { key: 'event_date', header: 'Date', render: (r) => new Date(r.event_date).toLocaleString() },
          { key: 'event_type', header: 'Event', render: (r) => <span className={`badge badge--${r.event_type === 'refill' ? 'info' : 'pending'}`}>{r.event_type}</span> },
          { key: 'details', header: 'Details', render: (r) => r.event_type === 'refill'
              ? `${Number(r.quantity_delivered ?? 0).toLocaleString()} L delivered by ${r.driver_name} (${r.plate_number}) — ${r.order_number}`
              : r.description || '—' },
          { key: 'cost', header: 'Cost', render: (r) => (r.event_type === 'maintenance' ? `$${Number(r.cost).toFixed(2)}` : '—') }
        ]}
        rows={rows.history}
        emptyText="No refills or maintenance recorded for this tank yet."
      />
    </div>
  );
}

export default function TanksTab() {
  const { user } = useAuth();
  const canEdit = ['Admin', 'Sales Manager'].includes(user?.role);
  const [customerId, setCustomerId] = useState('');
  const { rows, reload } = useApi(`/tanks${customerId ? `?customer_id=${customerId}` : ''}`, [customerId]);
  const { rows: customers } = useApi('/customers');
  const [form, setForm] = useState(EMPTY_FORM);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState(null);
  const [historyTankId, setHistoryTankId] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    try {
      await client.post('/tanks', { ...form, customer_id: Number(form.customer_id), capacity_liters: Number(form.capacity_liters) });
      setForm(EMPTY_FORM);
      setShowForm(false);
      reload();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create tank');
    }
  }

  return (
    <div>
      <div className="toolbar">
        <select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
          <option value="">All customers</option>
          {customers?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        {canEdit && <button className="btn" onClick={() => setShowForm((s) => !s)}>{showForm ? 'Cancel' : '+ New Tank'}</button>}
      </div>

      {showForm && (
        <form className="stacked-form card" onSubmit={handleSubmit}>
          {error && <div className="error-box" style={{ gridColumn: '1/-1' }}>{error}</div>}
          <label>Tank Code<input required value={form.tank_code} onChange={(e) => setForm({ ...form, tank_code: e.target.value })} /></label>
          <label>Customer
            <select required value={form.customer_id} onChange={(e) => setForm({ ...form, customer_id: e.target.value })}>
              <option value="">Select…</option>
              {customers?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label>Type
            <select value={form.tank_type} onChange={(e) => setForm({ ...form, tank_type: e.target.value })}>
              <option value="tank">Tank</option>
              <option value="drum">Drum</option>
              <option value="underground_reservoir">Underground Reservoir</option>
            </select>
          </label>
          <label>Capacity (Liters)<input required type="number" step="1" value={form.capacity_liters} onChange={(e) => setForm({ ...form, capacity_liters: e.target.value })} /></label>
          <label>Barcode / QR<input value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value })} /></label>
          <label>Location<input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></label>
          <label>Installed Date<input type="date" value={form.installed_date} onChange={(e) => setForm({ ...form, installed_date: e.target.value })} /></label>
          <div><button className="btn" type="submit">Save Tank</button></div>
        </form>
      )}

      <div className="card table-wrap">
        <table>
          <thead>
            <tr><th>Tank Code</th><th>Customer</th><th>Type</th><th>Capacity</th><th>Location</th><th>Status</th><th>Barcode</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {rows?.map((t) => (
              <tr key={t.id}>
                <td>{t.tank_code}</td>
                <td>{t.customer_name}</td>
                <td>{TYPE_LABEL[t.tank_type]}</td>
                <td>{Number(t.capacity_liters).toLocaleString()} L</td>
                <td>{t.location || '—'}</td>
                <td><span className={`badge badge--${t.status === 'active' ? 'ok' : 'low'}`}>{t.status}</span></td>
                <td>{t.barcode || '—'}</td>
                <td><button className="btn secondary" onClick={() => setHistoryTankId(t.id)}>History</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows?.length && <p className="muted">No tanks registered yet.</p>}
      </div>

      {historyTankId && <TankHistory tankId={historyTankId} onClose={() => setHistoryTankId(null)} />}
    </div>
  );
}
