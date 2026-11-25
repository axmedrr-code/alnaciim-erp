import { useState } from 'react';
import { useApi } from '../../components/useApi';
import client from '../../api/client';

// Goods receipt note: accepted / damaged / rejected quantities per line. Only accepted units enter stock and become payable.
export default function ReceiveForm({ po, warehouses, onDone }) {
  const { rows: detail } = useApi(`/procurement/purchase-orders/${po.id}`);
  const [warehouseId, setWarehouseId] = useState('');
  const [deliveryNote, setDeliveryNote] = useState('');
  const [entries, setEntries] = useState({});
  const [error, setError] = useState(null);
  const set = (id, patch) => setEntries((e) => ({ ...e, [id]: { ...(e[id] || {}), ...patch } }));

  async function receive() {
    setError(null);
    const items = [];
    for (const it of detail.items || []) {
      const e = entries[it.id] || {};
      for (const cond of ['good', 'damaged', 'rejected']) {
        if (Number(e[cond]) > 0) items.push({ purchase_item_id: it.id, quantity_received: Number(e[cond]), condition: cond, notes: cond === 'good' ? null : e.notes || null });
      }
    }
    if (!items.length || !warehouseId) { setError('Choose a warehouse and enter at least one quantity'); return; }
    try {
      await client.post(`/procurement/purchase-orders/${po.id}/receive`, { items, warehouse_id: Number(warehouseId), delivery_note_no: deliveryNote || null });
      onDone();
    } catch (e) { setError(e.response?.data?.error || 'Receiving failed'); }
  }

  if (!detail) return <span className="muted">Loading…</span>;

  return (
    <div className="card" style={{ marginTop: 8 }}>
      <strong>Goods receipt against {po.po_number}</strong>
      {error && <div className="error-box">{error}</div>}
      <div style={{ margin: '8px 0', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
          <option value="">Receiving warehouse…</option>
          {warehouses?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
        <input placeholder="Supplier delivery note #" value={deliveryNote} onChange={(e) => setDeliveryNote(e.target.value)} />
      </div>
      <table className="simple-table" style={{ width: '100%' }}>
        <thead><tr><th>Item</th><th>Ordered</th><th>Accepted so far</th><th>Accept now</th><th>Damaged</th><th>Rejected</th><th>Damage / rejection note</th></tr></thead>
        <tbody>{detail.items.map((it) => (
          <tr key={it.id}>
            <td>{it.product_name}</td><td>{Number(it.quantity_ordered)}</td><td>{Number(it.quantity_accepted ?? it.quantity_received)}</td>
            {['good', 'damaged', 'rejected'].map((c) => (
              <td key={c}><input type="number" min="0" step="0.001" style={{ width: 80 }} value={entries[it.id]?.[c] || ''} onChange={(e) => set(it.id, { [c]: e.target.value })} /></td>
            ))}
            <td><input value={entries[it.id]?.notes || ''} onChange={(e) => set(it.id, { notes: e.target.value })} /></td>
          </tr>))}</tbody>
      </table>
      <p className="muted">Only accepted units enter stock and are payable to the supplier. Damaged or rejected units are recorded and need a note.</p>
      <button className="btn" onClick={receive}>Confirm goods receipt</button>
    </div>
  );
}
