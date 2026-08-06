import { useState } from 'react';
import { useApi } from '../../components/useApi';
import client from '../../api/client';
import { useAuth } from '../../context/AuthContext';

const STATUS_BADGE = { scheduled: 'pending', in_transit: 'info', delivered: 'ok', failed: 'low' };

export default function DeliveriesTab() {
  const { user } = useAuth();
  const canUpdate = ['Admin', 'Sales Manager', 'Driver'].includes(user?.role);
  const { rows, reload } = useApi('/sales/deliveries');
  const [confirmingId, setConfirmingId] = useState(null);
  const [qty, setQty] = useState('');
  const [signature, setSignature] = useState('');

  async function confirmDelivery(id) {
    await client.put(`/sales/deliveries/${id}/confirm`, { quantity_delivered: Number(qty), signature_name: signature });
    setConfirmingId(null);
    setQty('');
    setSignature('');
    reload();
  }

  return (
    <div className="card table-wrap">
      <table>
        <thead>
          <tr><th>Order #</th><th>Customer</th><th>Tank</th><th>Truck</th><th>Driver</th><th>Status</th><th>Delivered Qty</th>{canUpdate && <th style={{ minWidth: 260 }}>Actions</th>}</tr>
        </thead>
        <tbody>
          {rows?.map((d) => (
            <tr key={d.id}>
              <td>{d.order_number}</td>
              <td>{d.customer_name}</td>
              <td>{d.tank_code || '—'}</td>
              <td>{d.plate_number}</td>
              <td>{d.driver_name}</td>
              <td><span className={`badge badge--${STATUS_BADGE[d.status]}`}>{d.status}</span></td>
              <td>{d.quantity_delivered ? Number(d.quantity_delivered).toLocaleString() : '—'}</td>
              {canUpdate && (
                <td>
                  {d.status === 'in_transit' && confirmingId !== d.id && (
                    <button className="btn secondary" onClick={() => setConfirmingId(d.id)}>Confirm Delivery</button>
                  )}
                  {confirmingId === d.id && (
                    <span style={{ display: 'flex', gap: 6 }}>
                      <input style={{ width: 90 }} type="number" step="0.01" placeholder="Qty delivered" value={qty} onChange={(e) => setQty(e.target.value)} />
                      <input type="text" style={{ width: 120 }} placeholder="Signature/name" value={signature} onChange={(e) => setSignature(e.target.value)} />
                      <button className="btn" disabled={!qty || !signature} onClick={() => confirmDelivery(d.id)}>Save</button>
                    </span>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {!rows?.length && <p className="muted">No deliveries yet.</p>}
    </div>
  );
}
