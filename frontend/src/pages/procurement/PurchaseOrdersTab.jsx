import { useMemo, useState } from 'react';
import { Eye, X } from 'lucide-react';
import { useApi } from '../../components/useApi';
import Table from '../../components/Table';
import DateFilterBar, { defaultDateRange } from '../../components/DateFilterBar';
import client from '../../api/client';
import { useAuth } from '../../context/AuthContext';

const STATUS_BADGE = { draft: 'pending', sent: 'info', partially_received: 'info', received: 'ok', cancelled: 'low', reversed: 'low' };

// Read-only detail view — same GET /procurement/purchase-orders/:id the Edit form
// and Receive form already use, just rendered without any inputs.
function PoViewModal({ poId, onClose }) {
  const { rows: po } = useApi(`/procurement/purchase-orders/${poId}`);
  if (!po) return <div className="card"><p className="muted">Loading…</p></div>;

  return (
    <div className="card">
      <div className="card__header">
        <h3>{po.po_number} — {po.supplier_name}</h3>
        <button className="btn secondary" onClick={onClose}><X size={13} /> Close</button>
      </div>
      <div className="form-grid" style={{ marginBottom: 18 }}>
        <div className="form-field"><label>Order Date</label><span>{String(po.order_date).slice(0, 10)}</span></div>
        <div className="form-field"><label>Expected Date</label><span>{po.expected_date ? String(po.expected_date).slice(0, 10) : '—'}</span></div>
        <div className="form-field"><label>Status</label><span className={`badge badge--${STATUS_BADGE[po.status]}`}>{po.status}</span></div>
        <div className="form-field"><label>Total</label><span>${Number(po.total_amount).toFixed(2)}</span></div>
      </div>
      <Table
        columns={[
          { key: 'product_name', header: 'Product' },
          { key: 'quantity_ordered', header: 'Ordered' },
          { key: 'quantity_received', header: 'Received' },
          { key: 'unit_cost', header: 'Unit Cost', render: (r) => `$${Number(r.unit_cost).toFixed(2)}` },
          { key: 'subtotal', header: 'Subtotal', render: (r) => `$${Number(r.subtotal).toFixed(2)}` }
        ]}
        rows={po.items}
      />
    </div>
  );
}

// Used both to create a PO and — when `editingPo` is given — to edit one still in
// draft/sent status (PUT instead of POST), since nothing has posted to the ledger yet.
function NewPoForm({ suppliers, products, onCreated, onCancel, editingPo, editingItems }) {
  const isEdit = !!editingPo;
  const [supplierId, setSupplierId] = useState(editingPo ? String(editingPo.supplier_id) : '');
  const [items, setItems] = useState(
    editingItems?.length ? editingItems.map((it) => ({ product_id: String(it.product_id), quantity_ordered: String(it.quantity_ordered), unit_cost: String(it.unit_cost) })) : [{ product_id: '', quantity_ordered: '', unit_cost: '' }]
  );
  const [error, setError] = useState(null);

  function updateItem(i, field, value) {
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, [field]: value } : it)));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    try {
      const payload = {
        supplier_id: Number(supplierId),
        items: items.map((it) => ({ product_id: Number(it.product_id), quantity_ordered: Number(it.quantity_ordered), unit_cost: Number(it.unit_cost) }))
      };
      if (isEdit) await client.put(`/procurement/purchase-orders/${editingPo.id}`, payload);
      else await client.post('/procurement/purchase-orders', payload);
      onCreated();
    } catch (err) {
      setError(err.response?.data?.error || `Failed to ${isEdit ? 'update' : 'create'} purchase order`);
    }
  }

  return (
    <form className="card" onSubmit={handleSubmit} style={{ marginBottom: 16 }}>
      {error && <div className="error-box">{error}</div>}
      <label style={{ display: 'block', marginBottom: 10, fontSize: 12, color: 'var(--text-muted)' }}>
        Supplier
        <select required value={supplierId} onChange={(e) => setSupplierId(e.target.value)} style={{ display: 'block', marginTop: 4 }}>
          <option value="">Select…</option>
          {suppliers?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </label>
      {items.map((it, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <select required value={it.product_id} onChange={(e) => updateItem(i, 'product_id', e.target.value)} style={{ flex: 2 }}>
            <option value="">Product…</option>
            {products?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <input required type="number" step="0.001" placeholder="Qty ordered" value={it.quantity_ordered} onChange={(e) => updateItem(i, 'quantity_ordered', e.target.value)} style={{ flex: 1 }} />
          <input required type="number" step="0.01" placeholder="Unit cost" value={it.unit_cost} onChange={(e) => updateItem(i, 'unit_cost', e.target.value)} style={{ flex: 1 }} />
        </div>
      ))}
      <button type="button" className="btn secondary" onClick={() => setItems((p) => [...p, { product_id: '', quantity_ordered: '', unit_cost: '' }])}>+ Add Line</button>
      {' '}<button type="submit" className="btn">{isEdit ? 'Save Changes' : 'Create PO'}</button>
      {' '}<button type="button" className="btn secondary" onClick={onCancel}>Cancel</button>
    </form>
  );
}

function ReceiveForm({ po, warehouses, onDone }) {
  const { rows: detail } = useApi(`/procurement/purchase-orders/${po.id}`);
  const [warehouseId, setWarehouseId] = useState('');
  const [quantities, setQuantities] = useState({});

  async function receive() {
    const items = (detail.items || [])
      .filter((it) => quantities[it.id])
      .map((it) => ({ purchase_item_id: it.id, quantity_received: Number(quantities[it.id]), condition: 'good' }));
    if (!items.length || !warehouseId) return;
    await client.post(`/procurement/purchase-orders/${po.id}/receive`, { items, warehouse_id: Number(warehouseId) });
    onDone();
  }

  if (!detail) return <span className="muted">Loading…</span>;

  return (
    <div className="card" style={{ marginTop: 8 }}>
      <strong>Receive against {po.po_number}</strong>
      <div style={{ margin: '8px 0' }}>
        <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
          <option value="">Receiving warehouse…</option>
          {warehouses?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
      </div>
      {detail.items.map((it) => (
        <div key={it.id} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
          <span style={{ flex: 2 }}>{it.product_name} (ordered {it.quantity_ordered}, received {it.quantity_received})</span>
          <input type="number" step="0.001" style={{ flex: 1 }} placeholder="Qty received"
            value={quantities[it.id] || ''} onChange={(e) => setQuantities({ ...quantities, [it.id]: e.target.value })} />
        </div>
      ))}
      <button className="btn" onClick={receive}>Confirm Receipt</button>
    </div>
  );
}

export default function PurchaseOrdersTab() {
  const { user } = useAuth();
  const canManage = ['Admin', 'Procurement Officer'].includes(user?.role);
  const canReceive = ['Admin', 'Procurement Officer', 'Storekeeper'].includes(user?.role);
  const [dateRange, setDateRange] = useState(defaultDateRange());
  // No from/to support on the backend for purchase orders — filtered client-side
  // against the full list, same pattern used for Maintenance Logs.
  const { rows: allRows, reload } = useApi('/procurement/purchase-orders');
  const rows = useMemo(
    () => (allRows || []).filter((r) => {
      const day = String(r.order_date).slice(0, 10);
      return day >= dateRange.from && day <= dateRange.to;
    }),
    [allRows, dateRange.from, dateRange.to]
  );
  const { rows: suppliers } = useApi('/suppliers');
  const { rows: products } = useApi('/products?type=raw_material');
  const { rows: warehouses } = useApi('/warehouses');
  const [showForm, setShowForm] = useState(false);
  const [receivingId, setReceivingId] = useState(null);
  const [editing, setEditing] = useState(null);
  const [viewingId, setViewingId] = useState(null);

  async function startEdit(po) {
    const res = await client.get(`/procurement/purchase-orders/${po.id}`);
    setEditing({ po: res.data.data, items: res.data.data.items });
    setShowForm(false);
  }

  async function deletePo(po) {
    if (!window.confirm(`Delete PO ${po.po_number}? This cannot be undone.`)) return;
    await client.delete(`/procurement/purchase-orders/${po.id}`);
    reload();
  }

  async function reversePo(po) {
    const reason = window.prompt(`Reverse ${po.po_number}? This offsets the goods-received entry and reverses the stock. Reason (optional):`);
    if (reason === null) return;
    try {
      await client.post(`/procurement/purchase-orders/${po.id}/reverse`, { reason: reason || undefined });
      reload();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to reverse purchase order');
    }
  }

  return (
    <div>
      <div className="toolbar">
        {canManage && <button className="btn" onClick={() => { setEditing(null); setShowForm((s) => !s); }}>{showForm ? 'Cancel' : '+ New Purchase Order'}</button>}
        <DateFilterBar
          value={dateRange} onChange={setDateRange} title="Purchase Orders"
          columns={[{ key: 'po_number', header: 'PO #' }, { key: 'order_date', header: 'Date' }, { key: 'supplier_name', header: 'Supplier' }, { key: 'total_amount', header: 'Total', render: (r) => `$${Number(r.total_amount).toFixed(2)}` }, { key: 'status', header: 'Status' }]}
          rows={rows}
        />
      </div>

      {showForm && <NewPoForm suppliers={suppliers} products={products} onCreated={() => { setShowForm(false); reload(); }} onCancel={() => setShowForm(false)} />}
      {editing && (
        <NewPoForm
          suppliers={suppliers} products={products}
          editingPo={editing.po} editingItems={editing.items}
          onCreated={() => { setEditing(null); reload(); }}
          onCancel={() => setEditing(null)}
        />
      )}

      <div className="card table-wrap">
        <table>
          <thead><tr><th>PO #</th><th>Date</th><th>Supplier</th><th>Total</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            {rows?.map((po) => (
              <tr key={po.id}>
                <td>{po.po_number}</td>
                <td>{String(po.order_date).slice(0, 10)}</td>
                <td>{po.supplier_name}</td>
                <td>${Number(po.total_amount).toFixed(2)}</td>
                <td><span className={`badge badge--${STATUS_BADGE[po.status]}`}>{po.status}</span></td>
                <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <button className="btn-icon" title="View" onClick={() => setViewingId(po.id)}><Eye size={13} /></button>
                  {canManage && ['draft', 'sent'].includes(po.status) && (
                    <>
                      <button className="btn secondary" onClick={() => startEdit(po)}>Edit</button>
                      <button className="btn secondary" onClick={() => deletePo(po)}>Delete</button>
                    </>
                  )}
                  {canReceive && ['sent', 'partially_received'].includes(po.status) && receivingId !== po.id && (
                    <button className="btn secondary" onClick={() => setReceivingId(po.id)}>Receive</button>
                  )}
                  {receivingId === po.id && <button className="btn secondary" onClick={() => setReceivingId(null)}>Close</button>}
                  {canManage && ['partially_received', 'received'].includes(po.status) && (
                    <button className="btn secondary" onClick={() => reversePo(po)}>Reverse</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows?.length && <p className="muted">No purchase orders yet.</p>}
      </div>

      {receivingId && (
        <ReceiveForm po={allRows.find((p) => p.id === receivingId)} warehouses={warehouses} onDone={() => { setReceivingId(null); reload(); }} />
      )}
      {viewingId && <PoViewModal poId={viewingId} onClose={() => setViewingId(null)} />}
    </div>
  );
}
