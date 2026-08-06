import { useState } from 'react';
import { Plus, X, CheckCircle2, AlertCircle, Trash2, Eye } from 'lucide-react';
import { useApi } from '../../components/useApi';
import Table from '../../components/Table';
import client from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { CATEGORY_ID } from './productLines';

const STATUS_BADGE = { pending: 'pending', approved: 'info', dispatched: 'info', delivered: 'ok', cancelled: 'low', reversed: 'low' };
const PAY_BADGE = { unpaid: 'low', partial: 'pending', paid: 'ok' };

// The document-flow spine every ERP sales order follows here: Order -> Approval ->
// Dispatch -> Delivery -> Invoice -> Payment -> Posted (GL). Cancelled/reversed orders
// break out of the normal spine, so they're rendered as a single terminal state instead.
const DOC_FLOW_STAGES = ['pending', 'approved', 'dispatched', 'delivered', 'invoiced', 'paid'];

function DocFlowStepper({ order }) {
  if (['cancelled', 'reversed'].includes(order.status)) {
    return (
      <div className="badge badge--low" style={{ display: 'inline-block', marginBottom: 14 }}>
        {order.status === 'cancelled' ? 'Cancelled — order was never posted' : 'Reversed — offsetting ledger entry posted'}
      </div>
    );
  }
  // "Invoiced" happens the moment the order is approved (the order IS the invoice document,
  // carrying its own invoice_hno) — so it's reached as soon as invoice_hno exists.
  const reached = {
    pending: true,
    approved: ['approved', 'dispatched', 'delivered'].includes(order.status),
    dispatched: ['dispatched', 'delivered'].includes(order.status),
    delivered: order.status === 'delivered',
    invoiced: !!order.invoice_hno,
    paid: order.payment_status === 'paid'
  };
  const labels = { pending: 'Sales Order', approved: 'Approved', dispatched: 'Dispatched', delivered: 'Delivered', invoiced: 'Invoiced', paid: 'Paid' };
  return (
    <div style={{ display: 'flex', alignItems: 'center', marginBottom: 18, flexWrap: 'wrap' }}>
      {DOC_FLOW_STAGES.map((stage, i) => (
        <div key={stage} style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 14,
            fontSize: 12, fontWeight: 600,
            background: reached[stage] ? 'var(--accent, #2563eb)' : 'var(--surface-2, #eee)',
            color: reached[stage] ? '#fff' : 'var(--text-muted)'
          }}>
            {reached[stage] && <CheckCircle2 size={12} />} {labels[stage]}
          </div>
          {i < DOC_FLOW_STAGES.length - 1 && <div style={{ width: 18, height: 2, background: 'var(--surface-2, #ddd)' }} />}
        </div>
      ))}
    </div>
  );
}

function LedgerSection({ orderId }) {
  const { rows: entries } = useApi(`/finance/journal-entries?reference_type=sales_order&reference_id=${orderId}`);
  if (!entries?.length) return <p className="muted" style={{ marginTop: 14 }}>No ledger postings yet — this order hasn't been approved.</p>;
  return (
    <div style={{ marginTop: 18 }}>
      <div className="form-section__title">Ledger Postings</div>
      <Table
        columns={[
          { key: 'entry_number', header: 'Entry #' },
          { key: 'entry_date', header: 'Date', render: (r) => String(r.entry_date).slice(0, 10) },
          { key: 'description', header: 'Description' },
          { key: 'total', header: 'Total', render: (r) => `$${Number(r.total).toFixed(2)}` },
          { key: 'status', header: 'Status', render: (r) => <span className={`badge badge--${r.status === 'posted' ? 'ok' : 'low'}`}>{r.status}</span> }
        ]}
        rows={entries}
      />
    </div>
  );
}

// Read-only detail view — the View action every row action set should have alongside
// Edit/Reverse/Delete. Uses the same GET /sales/orders/:id the Edit form already
// fetches, just rendered without any inputs.
function OrderViewModal({ orderId, onClose }) {
  const { rows: order } = useApi(`/sales/orders/${orderId}`);
  if (!order) return <div className="card"><p className="muted">Loading…</p></div>;

  return (
    <div className="card">
      <div className="card__header">
        <h3>{order.invoice_hno || order.order_number} — {order.customer_name}</h3>
        <button className="btn secondary" onClick={onClose}><X size={13} /> Close</button>
      </div>
      <DocFlowStepper order={order} />
      <div className="form-grid" style={{ marginBottom: 18 }}>
        <div className="form-field"><label>Order Date</label><span>{String(order.order_date).slice(0, 10)}</span></div>
        <div className="form-field"><label>Sale Type</label><span className={`badge badge--${order.sale_type === 'cash' ? 'ok' : 'info'}`}>{order.sale_type}</span></div>
        <div className="form-field"><label>Status</label><span className={`badge badge--${STATUS_BADGE[order.status]}`}>{order.status}</span></div>
        <div className="form-field"><label>Payment</label><span className={`badge badge--${PAY_BADGE[order.payment_status]}`}>{order.payment_status}</span></div>
        <div className="form-field"><label>Amount Paid</label><span>${Number(order.amount_paid).toFixed(2)}</span></div>
        <div className="form-field"><label>Customer Outstanding (all orders)</label><span>${Number(order.customer_outstanding_balance).toFixed(2)}</span></div>
      </div>
      <Table
        columns={[
          { key: 'product_name', header: 'Product' },
          { key: 'quantity', header: 'Qty', render: (r) => `${Number(r.quantity).toLocaleString()} ${r.unit}` },
          { key: 'unit_price', header: 'Unit Price', render: (r) => `$${Number(r.unit_price).toFixed(2)}` },
          { key: 'subtotal', header: 'Subtotal', render: (r) => `$${Number(r.subtotal).toFixed(2)}` }
        ]}
        rows={order.items}
      />
      <div style={{ textAlign: 'right', marginTop: 14, fontSize: 14 }}>
        <span style={{ color: 'var(--text-muted)' }}>Subtotal ${Number(order.subtotal).toFixed(2)}</span>
        {Number(order.delivery_fee) > 0 && <span style={{ marginLeft: 12, color: 'var(--text-muted)' }}>+ Delivery ${Number(order.delivery_fee).toFixed(2)}</span>}
        <strong style={{ marginLeft: 12 }}>Total ${Number(order.total_amount).toFixed(2)}</strong>
      </div>

      {order.payments?.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <div className="form-section__title">Payments</div>
          <Table
            columns={[
              { key: 'payment_date', header: 'Date', render: (r) => String(r.payment_date).slice(0, 10) },
              { key: 'amount', header: 'Amount', render: (r) => `$${Number(r.amount).toFixed(2)}` },
              { key: 'method', header: 'Method' },
              { key: 'reference_number', header: 'Reference', render: (r) => r.reference_number || '—' },
              { key: 'recorded_by_name', header: 'Recorded By' },
              { key: 'voided_at', header: 'Status', render: (r) => r.voided_at ? <span className="badge badge--low">Voided</span> : <span className="badge badge--ok">Active</span> }
            ]}
            rows={order.payments}
          />
        </div>
      )}

      <LedgerSection orderId={order.id} />
    </div>
  );
}

// Used both to create a new order and — when `editingOrder` is given — to edit a
// still-pending credit order in place (PUT instead of POST). Sale type can't be
// changed once created, since cash sales settle/post immediately at creation.
function NewOrderForm({ customers, products, onCreated, onCancel, editingOrder, editingItems }) {
  const isEdit = !!editingOrder;
  const [customerId, setCustomerId] = useState(editingOrder ? String(editingOrder.customer_id) : '');
  const [deliveryFee, setDeliveryFee] = useState(editingOrder ? String(editingOrder.delivery_fee) : '');
  const [saleType, setSaleType] = useState(editingOrder ? editingOrder.sale_type : 'credit');
  const [cashMethod, setCashMethod] = useState('cash');
  const [items, setItems] = useState(
    editingItems?.length ? editingItems.map((it) => ({ product_id: String(it.product_id), quantity: String(it.quantity), unit_price: String(it.unit_price) })) : [{ product_id: '', quantity: '', unit_price: '' }]
  );
  const [error, setError] = useState(null);
  const customer = customers?.find((c) => c.id === Number(customerId));

  function updateItem(i, field, value) {
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, [field]: value } : it)));
  }

  function removeItem(i) {
    setItems((prev) => prev.filter((_, idx) => idx !== i));
  }

  const subtotal = items.reduce((sum, it) => sum + (Number(it.quantity) || 0) * (Number(it.unit_price) || 0), 0);
  const total = subtotal + (Number(deliveryFee) || 0);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    try {
      const payload = {
        customer_id: Number(customerId),
        delivery_fee: Number(deliveryFee) || 0,
        items: items.map((it) => ({ product_id: Number(it.product_id), quantity: Number(it.quantity), unit_price: Number(it.unit_price) }))
      };
      if (isEdit) {
        await client.put(`/sales/orders/${editingOrder.id}`, payload);
      } else {
        await client.post('/sales/orders', {
          ...payload,
          sale_type: saleType,
          cash_payment_method: saleType === 'cash' ? cashMethod : undefined
        });
      }
      onCreated();
    } catch (err) {
      setError(err.response?.data?.error || `Failed to ${isEdit ? 'update' : 'create'} order`);
    }
  }

  return (
    <form className="form-modern" onSubmit={handleSubmit}>
      <h3 className="form-modern__title">{isEdit ? 'Edit Sales Order' : 'New Sales Order'}</h3>
      <p className="form-modern__subtitle">{isEdit ? 'This order is still pending, so it can be freely rewritten.' : 'Create a cash or credit sale for a customer.'}</p>
      {error && <div className="error-box"><AlertCircle size={15} /> {error}</div>}

      <div className="form-section">
        <div className="form-section__title">Customer & Sale Type</div>
        <div className="form-grid">
          <div className="form-field span-2">
            <label>Customer</label>
            <select required disabled={isEdit} value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              <option value="">Select…</option>
              {customers?.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.type}){c.hno ? ` — ${c.hno}` : ''}</option>)}
            </select>
          </div>
          {!isEdit && (
            <>
              <div className="form-field">
                <label>Sale Type</label>
                <div style={{ display: 'flex', gap: 14, alignItems: 'center', height: 38 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontWeight: 400, fontSize: 12.5 }}>
                    <input type="radio" name="sale_type" checked={saleType === 'credit'} onChange={() => setSaleType('credit')} /> Credit
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontWeight: 400, fontSize: 12.5 }}>
                    <input type="radio" name="sale_type" checked={saleType === 'cash'} onChange={() => setSaleType('cash')} /> Cash
                  </label>
                </div>
              </div>
              {saleType === 'cash' && (
                <div className="form-field">
                  <label>Cash Payment Method</label>
                  <select value={cashMethod} onChange={(e) => setCashMethod(e.target.value)}>
                    <option value="cash">Cash</option>
                    <option value="bank_transfer">Bank Transfer</option>
                    <option value="cheque">Cheque</option>
                  </select>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <div className="form-section">
        <div className="form-section__title">Order Items</div>
        {items.map((it, i) => (
          <div key={i} style={{ display: 'flex', gap: 10, marginBottom: 10, alignItems: 'center' }}>
            <select required value={it.product_id} onChange={(e) => updateItem(i, 'product_id', e.target.value)} style={{ flex: 2 }}>
              <option value="">Product…</option>
              {products?.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.unit})</option>)}
            </select>
            <input required type="number" step="0.001" placeholder="Qty" value={it.quantity} onChange={(e) => updateItem(i, 'quantity', e.target.value)} style={{ flex: 1 }} />
            <input required type="number" step="0.0001" placeholder="Unit price" value={it.unit_price} onChange={(e) => updateItem(i, 'unit_price', e.target.value)} style={{ flex: 1 }} />
            {items.length > 1 && (
              <button type="button" className="btn-icon" onClick={() => removeItem(i)}><Trash2 size={14} /></button>
            )}
          </div>
        ))}
        <button type="button" className="secondary" onClick={() => setItems((p) => [...p, { product_id: '', quantity: '', unit_price: '' }])}><Plus size={13} /> Add Line</button>

        {customer?.type === 'tanker' && (
          <div className="form-field" style={{ maxWidth: 220, marginTop: 16 }}>
            <label>Tanker Delivery Fee ($)</label>
            <input type="number" step="0.01" value={deliveryFee} onChange={(e) => setDeliveryFee(e.target.value)} />
          </div>
        )}

        <div style={{ marginTop: 16, textAlign: 'right', fontSize: 14 }}>
          <span style={{ color: 'var(--text-muted)' }}>Subtotal: {`$${subtotal.toFixed(2)}`}</span>
          {Number(deliveryFee) > 0 && <span style={{ color: 'var(--text-muted)', marginLeft: 14 }}>+ Delivery: {`$${Number(deliveryFee).toFixed(2)}`}</span>}
          <strong style={{ marginLeft: 14 }}>Total: {`$${total.toFixed(2)}`}</strong>
        </div>
      </div>

      <div className="form-actions">
        <button type="submit" className="btn"><CheckCircle2 size={15} /> {isEdit ? 'Save Changes' : 'Create Order'}</button>
        <button type="button" className="secondary" onClick={onCancel}><X size={13} /> Cancel</button>
      </div>
    </form>
  );
}

async function openInvoice(orderId) {
  const res = await client.get(`/sales/orders/${orderId}/invoice`, { responseType: 'blob' });
  const url = URL.createObjectURL(res.data);
  window.open(url, '_blank');
}

function shareInvoiceOnWhatsApp(order, customerPhone) {
  const digits = (customerPhone || '').replace(/[^\d]/g, '');
  const message = `Hello ${order.customer_name}, here is your Alnaciim Water invoice ${order.order_number} for $${Number(order.total_amount).toFixed(2)} (${order.payment_status}). Please contact us to receive the PDF or view it at our office portal.`;
  const url = `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
  window.open(url, '_blank');
}

function DispatchForm({ order, trucks, drivers, warehouses, tanks, truckLoads, onDone }) {
  const [truckLoadId, setTruckLoadId] = useState('');
  const [truckId, setTruckId] = useState('');
  const [driverId, setDriverId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [tankId, setTankId] = useState('');
  const [error, setError] = useState(null);

  const customerTanks = tanks?.filter((t) => t.customer_id === order.customer_id);
  const selectedLoad = truckLoads?.find((l) => l.id === Number(truckLoadId));

  async function dispatch() {
    setError(null);
    try {
      await client.post(`/sales/orders/${order.id}/dispatch`, {
        truck_id: Number(truckLoadId ? selectedLoad.truck_id : truckId),
        driver_id: Number(driverId),
        warehouse_id: truckLoadId ? undefined : Number(warehouseId),
        truck_load_id: truckLoadId ? Number(truckLoadId) : undefined,
        customer_tank_id: tankId ? Number(tankId) : undefined
      });
      onDone();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to dispatch');
    }
  }

  const canGo = driverId && (truckLoadId || (truckId && warehouseId));

  return (
    <div style={{ display: 'inline-block' }}>
      {error && <div className="error-box" style={{ marginBottom: 6 }}>{error}</div>}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={truckLoadId} onChange={(e) => { setTruckLoadId(e.target.value); setTruckId(''); setWarehouseId(''); }} style={{ width: 170 }}>
          <option value="">Tanker load (bulk water)…</option>
          {truckLoads?.map((l) => <option key={l.id} value={l.id}>{l.plate_number} — {Number(l.remaining_balance).toLocaleString()} {l.unit} left</option>)}
        </select>
        {customerTanks?.length > 0 && (
          <select value={tankId} onChange={(e) => setTankId(e.target.value)} style={{ width: 130 }}>
            <option value="">Customer tank…</option>
            {customerTanks.map((t) => <option key={t.id} value={t.id}>{t.tank_code}</option>)}
          </select>
        )}
        {!truckLoadId && (
          <>
            <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} style={{ width: 110 }}>
              <option value="">Warehouse</option>
              {warehouses?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
            <select value={truckId} onChange={(e) => setTruckId(e.target.value)} style={{ width: 90 }}>
              <option value="">Truck</option>
              {trucks?.map((t) => <option key={t.id} value={t.id}>{t.plate_number}</option>)}
            </select>
          </>
        )}
        <select value={driverId} onChange={(e) => setDriverId(e.target.value)} style={{ width: 110 }}>
          <option value="">Driver</option>
          {drivers?.map((d) => <option key={d.id} value={d.id}>{d.full_name}</option>)}
        </select>
        <button className="btn" disabled={!canGo} onClick={dispatch}>Go</button>
      </div>
    </div>
  );
}

export default function OrdersTab() {
  const { user } = useAuth();
  const canManage = ['Admin', 'Sales Manager'].includes(user?.role);
  const { rows, reload } = useApi('/sales/orders');
  const { rows: customers } = useApi('/customers');
  // Bottled Water and Ice now have their own invoice-based Sales & Billing
  // screen with no dispatch step — this Orders/Dispatch flow is Route
  // Operations' back office view, so new orders here are Bulk Water only.
  const { rows: products } = useApi(`/products?category_id=${CATEGORY_ID.bulk}`);
  const { rows: trucks } = useApi('/trucks');
  const { rows: warehouses } = useApi('/warehouses');
  const { rows: tanks } = useApi('/tanks');
  const { rows: truckLoads } = useApi('/sales/truck-loads');
  const { rows: users } = useApi('/users');
  const drivers = users?.filter((u) => u.role_name === 'Driver');
  const availableLoads = truckLoads?.filter((l) => Number(l.remaining_balance) > 0);
  const [showForm, setShowForm] = useState(false);
  const [dispatchingId, setDispatchingId] = useState(null);
  const [editing, setEditing] = useState(null); // { order, items } for the order currently being edited
  const [viewingId, setViewingId] = useState(null);
  const [success, setSuccess] = useState(null);

  function flashSuccess(msg) {
    setSuccess(msg);
    setTimeout(() => setSuccess(null), 4000);
  }

  async function startEdit(order) {
    const res = await client.get(`/sales/orders/${order.id}`);
    setEditing({ order: res.data.data, items: res.data.data.items });
    setShowForm(false);
  }

  async function deleteOrder(order) {
    if (!window.confirm(`Delete pending order ${order.order_number}? This cannot be undone.`)) return;
    await client.delete(`/sales/orders/${order.id}`);
    reload();
  }

  async function reverseOrder(order) {
    const reason = window.prompt(`Reverse invoice ${order.invoice_hno || order.order_number}? This posts an offsetting ledger entry. Reason (optional):`);
    if (reason === null) return;
    try {
      await client.post(`/sales/orders/${order.id}/reverse`, { reason: reason || undefined });
      reload();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to reverse order');
    }
  }

  return (
    <div>
      {success && <div className="success-box"><CheckCircle2 size={15} /> {success}</div>}
      <div className="toolbar">
        {canManage && <button className="btn" onClick={() => { setEditing(null); setShowForm((s) => !s); }}>{showForm ? <><X size={15} /> Cancel</> : <><Plus size={15} /> New Order</>}</button>}
      </div>

      {showForm && (
        <NewOrderForm customers={customers} products={products} onCreated={() => { setShowForm(false); flashSuccess('Order created.'); reload(); }} onCancel={() => setShowForm(false)} />
      )}

      {editing && (
        <NewOrderForm
          customers={customers} products={products}
          editingOrder={editing.order} editingItems={editing.items}
          onCreated={() => { setEditing(null); flashSuccess('Order updated.'); reload(); }}
          onCancel={() => setEditing(null)}
        />
      )}

      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Invoice HNO</th><th>Order #</th><th>Customer</th><th>Date</th><th>Sale Type</th><th>Total</th><th>Status</th><th>Payment</th><th>Invoice</th>{canManage && <th style={{ minWidth: 320 }}>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {rows?.map((o) => {
              const customer = customers?.find((c) => c.id === o.customer_id);
              return (
                <tr key={o.id}>
                  <td>{o.invoice_hno || '—'}</td>
                  <td>{o.order_number}</td>
                  <td>{o.customer_name}</td>
                  <td>{String(o.order_date).slice(0, 10)}</td>
                  <td><span className={`badge badge--${o.sale_type === 'cash' ? 'ok' : 'info'}`}>{o.sale_type}</span></td>
                  <td>${Number(o.total_amount).toFixed(2)}</td>
                  <td><span className={`badge badge--${STATUS_BADGE[o.status]}`}>{o.status}</span></td>
                  <td><span className={`badge badge--${PAY_BADGE[o.payment_status]}`}>{o.payment_status}</span></td>
                  <td style={{ display: 'flex', gap: 6 }}>
                    <button className="btn-icon" title="View" onClick={() => setViewingId(o.id)}><Eye size={13} /></button>
                    <button className="btn secondary" onClick={() => openInvoice(o.id)}>PDF</button>
                    <button className="btn secondary" onClick={() => shareInvoiceOnWhatsApp(o, customer?.phone)}>WhatsApp</button>
                  </td>
                  {canManage && (
                    <td>
                      {o.status === 'pending' && (
                        <button className="btn secondary" onClick={async () => { await client.put(`/sales/orders/${o.id}/approve`); reload(); }}>Approve</button>
                      )}
                      {o.status === 'pending' && o.sale_type === 'credit' && (
                        <>
                          <button className="btn secondary" onClick={() => startEdit(o)}>Edit</button>
                          <button className="btn secondary" onClick={() => deleteOrder(o)}>Delete</button>
                        </>
                      )}
                      {['approved', 'dispatched', 'delivered'].includes(o.status) && (
                        <button className="btn secondary" onClick={() => reverseOrder(o)}>Reverse</button>
                      )}
                      {o.status === 'approved' && dispatchingId !== o.id && (
                        <button className="btn secondary" onClick={() => setDispatchingId(o.id)}>Dispatch</button>
                      )}
                      {dispatchingId === o.id && (
                        <DispatchForm order={o} trucks={trucks} drivers={drivers} warehouses={warehouses} tanks={tanks} truckLoads={availableLoads} onDone={() => { setDispatchingId(null); reload(); }} />
                      )}
                      {o.payment_status !== 'paid' && ['dispatched', 'delivered'].includes(o.status) && (
                        <button className="btn secondary" onClick={async () => {
                          const amount = Number(prompt(`Record payment amount for ${o.order_number} (total: $${Number(o.total_amount).toFixed(2)})`));
                          if (amount > 0) { await client.post(`/sales/orders/${o.id}/payments`, { amount, method: 'cash' }); reload(); }
                        }}>Record Payment</button>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
        {!rows?.length && <p className="muted">No sales orders yet.</p>}
      </div>

      {viewingId && <OrderViewModal orderId={viewingId} onClose={() => setViewingId(null)} />}
    </div>
  );
}
