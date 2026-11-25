import { useState } from 'react';
import { useApi } from '../../components/useApi';
import Table from '../../components/Table';
import client from '../../api/client';
import { useAuth } from '../../context/AuthContext';

const EMPTY = { product_id: '', warehouse_id: '', counted_quantity: '', reason: '', notes: '' };

export default function StockCountsTab() {
  const { user } = useAuth();
  const canCount = ['Admin', 'Inventory Manager', 'Storekeeper'].includes(user?.role);
  const canApprove = ['Admin', 'Inventory Manager'].includes(user?.role);
  const { rows, reload } = useApi('/inventory/stock-counts');
  const { rows: products } = useApi('/products');
  const { rows: warehouses } = useApi('/warehouses');
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);

  async function submit(e) {
    e.preventDefault(); setError('');
    try {
      await client.post('/inventory/stock-counts', {
        ...form, product_id: Number(form.product_id), warehouse_id: Number(form.warehouse_id), counted_quantity: Number(form.counted_quantity)
      });
      setForm(EMPTY); reload();
    } catch (err) { setError(err.response?.data?.error || 'Could not submit this count.'); }
  }

  async function decide(row, decision) {
    const reason = window.prompt(decision === 'approve' ? 'Approval note (required):' : 'Reason for rejection (required):');
    if (reason === null) return;
    if (reason.trim().length < 3) { setError('Enter a reason of at least 3 characters.'); return; }
    setBusyId(row.id); setError('');
    try { await client.post(`/inventory/stock-counts/${row.id}/decision`, { decision, reason }); reload(); }
    catch (err) { setError(err.response?.data?.error || 'Could not decide this stock count.'); }
    finally { setBusyId(null); }
  }

  const columns = [
    { key: 'count_number', header: 'Count No.' }, { key: 'created_at', header: 'Date', render: (r) => new Date(r.created_at).toLocaleString() },
    { key: 'product_name', header: 'Product' }, { key: 'warehouse_name', header: 'Warehouse' },
    { key: 'system_quantity', header: 'System Qty' }, { key: 'counted_quantity', header: 'Physical Qty' },
    { key: 'variance', header: 'Variance', render: (r) => <span className={Number(r.variance) === 0 ? 'badge badge--ok' : 'badge badge--low'}>{Number(r.variance) > 0 ? '+' : ''}{r.variance} {r.unit}</span> },
    { key: 'reason', header: 'Reason' }, { key: 'counted_by_name', header: 'Counted By' },
    { key: 'status', header: 'Status', render: (r) => <span className={`badge ${r.status === 'approved' ? 'badge--ok' : r.status === 'pending' ? 'badge--info' : 'badge--low'}`}>{r.status}</span> },
    { key: 'actions', header: 'Action', render: (r) => r.status === 'pending' && canApprove ? <div className="toolbar">
      <button className="btn small" disabled={busyId === r.id} onClick={() => decide(r, 'approve')}>Approve</button>
      <button className="btn secondary small" disabled={busyId === r.id} onClick={() => decide(r, 'reject')}>Reject</button>
    </div> : r.decided_by_name || '—' }
  ];

  return <div>
    <p className="muted">Physical counts are snapshots. Variances affect stock only after a separate authorized approval; a changed system balance requires a fresh count.</p>
    {error && <div className="error-box" role="alert">{error}</div>}
    {canCount && <form className="stacked-form card" onSubmit={submit}>
      <label>Product<select required value={form.product_id} onChange={(e) => setForm({ ...form, product_id: e.target.value })}><option value="">Select…</option>{products?.map((p) => <option key={p.id} value={p.id}>{p.sku} — {p.name}</option>)}</select></label>
      <label>Warehouse<select required value={form.warehouse_id} onChange={(e) => setForm({ ...form, warehouse_id: e.target.value })}><option value="">Select…</option>{warehouses?.filter((w) => w.is_active).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
      <label>Physical Quantity<input type="number" min="0" step="0.001" required value={form.counted_quantity} onChange={(e) => setForm({ ...form, counted_quantity: e.target.value })} /></label>
      <label>Reason<input required minLength={3} maxLength={200} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></label>
      <label>Notes (optional)<input maxLength={2000} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
      <div><button className="btn" type="submit">Submit Count for Approval</button></div>
    </form>}
    <div className="card"><Table columns={columns} rows={rows || []} searchable sortable pageSize={20} emptyText="No stock counts recorded." /></div>
  </div>;
}
