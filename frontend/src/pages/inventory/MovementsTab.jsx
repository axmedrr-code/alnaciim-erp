import { useState } from 'react';
import { useApi } from '../../components/useApi';
import Table from '../../components/Table';
import DateFilterBar, { defaultDateRange } from '../../components/DateFilterBar';
import client from '../../api/client';
import { useAuth } from '../../context/AuthContext';

const EMPTY_FORM = { product_id: '', warehouse_id: '', movement_type: 'ADJUSTMENT', quantity: '', notes: '' };

export default function MovementsTab() {
  const { user } = useAuth();
  const canRecord = ['Admin', 'Inventory Manager', 'Storekeeper'].includes(user?.role);
  const [dateRange, setDateRange] = useState(defaultDateRange());
  const { rows, reload } = useApi(`/inventory/movements?from=${dateRange.from}&to=${dateRange.to}`, [dateRange.from, dateRange.to]);
  const { rows: products } = useApi('/products');
  const { rows: warehouses } = useApi('/warehouses');
  const [form, setForm] = useState(EMPTY_FORM);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState(null);
  const columns = [
    { key: 'created_at', header: 'Date', render: (r) => new Date(r.created_at).toLocaleString() },
    { key: 'product_name', header: 'Product' },
    { key: 'warehouse_name', header: 'Warehouse' },
    { key: 'movement_type', header: 'Type', render: (r) => <span className="badge badge--info">{r.movement_type}</span> },
    { key: 'quantity', header: 'Qty' },
    { key: 'reference_type', header: 'Reference' },
    { key: 'performed_by_name', header: 'By' }
  ];

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    try {
      await client.post('/inventory/movements', {
        ...form,
        product_id: Number(form.product_id),
        warehouse_id: Number(form.warehouse_id),
        quantity: Number(form.quantity),
        reference_type: 'adjustment'
      });
      setForm(EMPTY_FORM);
      setShowForm(false);
      reload();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to record movement');
    }
  }

  return (
    <div>
      <div className="toolbar">
        {canRecord && <button className="btn" onClick={() => setShowForm((s) => !s)}>{showForm ? 'Cancel' : '+ Record Movement'}</button>}
        <DateFilterBar value={dateRange} onChange={setDateRange} columns={columns} rows={rows || []} title="Stock Movements" />
      </div>

      {showForm && (
        <form className="stacked-form card" onSubmit={handleSubmit}>
          {error && <div className="error-box" style={{ gridColumn: '1/-1' }}>{error}</div>}
          <label>Product
            <select required value={form.product_id} onChange={(e) => setForm({ ...form, product_id: e.target.value })}>
              <option value="">Select…</option>
              {products?.map((p) => <option key={p.id} value={p.id}>{p.sku} — {p.name}</option>)}
            </select>
          </label>
          <label>Warehouse
            <select required value={form.warehouse_id} onChange={(e) => setForm({ ...form, warehouse_id: e.target.value })}>
              <option value="">Select…</option>
              {warehouses?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </label>
          <label>Type
            <select value={form.movement_type} onChange={(e) => setForm({ ...form, movement_type: e.target.value })}>
              <option value="IN">IN</option>
              <option value="OUT">OUT</option>
              <option value="ADJUSTMENT">ADJUSTMENT</option>
            </select>
          </label>
          <label>Quantity<input type="number" step="0.001" required value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} /></label>
          <label>Notes<input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
          <div><button className="btn" type="submit">Save</button></div>
        </form>
      )}

      <div className="card">
        <Table columns={columns} rows={rows} searchable sortable pageSize={20} />
      </div>
    </div>
  );
}
