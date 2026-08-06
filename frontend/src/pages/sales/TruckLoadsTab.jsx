import { useEffect, useState } from 'react';
import { useApi } from '../../components/useApi';
import client from '../../api/client';
import { useAuth } from '../../context/AuthContext';

const STATUS_BADGE = { loaded: 'pending', in_progress: 'info', completed: 'ok', cancelled: 'cancelled' };
const REASON_LABEL = {
  delivered_not_recorded: 'Delivered but not recorded',
  spillage: 'Spillage',
  leakage: 'Leakage',
  returned_to_warehouse: 'Returned to warehouse',
  other: 'Other'
};

// Warehouse/Admin OPEN a Route Session (Load Tanker); Data Entry/Admin CLOSE
// one (Complete/Reconcile). Neither role can do the other's job — a
// Storekeeper who loads a truck cannot also reconcile/close it, and Data
// Entry never touches a loading. Managers get read-only visibility into the
// whole audit trail.
const LOADING_ROLES = ['Admin', 'Storekeeper'];
const CLOSING_ROLES = ['Admin', 'Data Entry Operator'];
const SESSION_VIEWER_ROLES = ['Admin', 'Storekeeper', 'Data Entry Operator', 'Sales Manager', 'Route Supervisor', 'Supervisor'];

export default function TruckLoadsTab() {
  const { user } = useAuth();
  const canLoad = LOADING_ROLES.includes(user?.role);
  const canClose = CLOSING_ROLES.includes(user?.role);
  const canViewHistory = SESSION_VIEWER_ROLES.includes(user?.role);
  const { rows, reload } = useApi('/sales/truck-loads');
  const { rows: trucks } = useApi('/trucks');
  const { rows: products } = useApi('/products?type=finished_good');
  const { rows: warehouses } = useApi('/warehouses');
  const [showOpenModal, setShowOpenModal] = useState(false);
  const [openInfo, setOpenInfo] = useState(null);
  const [error, setError] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [reconcilingId, setReconcilingId] = useState(null);
  const [showHistory, setShowHistory] = useState(false);

  // Complete/Cancel/Reconcile are the only ways an active ('loaded') row ever
  // leaves that status. Complete is refused by the backend while stock is
  // still outstanding — Reconcile is mandatory in that case.
  async function completeLoad(id) {
    setError(null);
    try {
      await client.post(`/sales/truck-loads/${id}/complete`);
      reload();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to complete loading');
    }
  }
  async function cancelLoad(id) {
    setError(null);
    try {
      await client.post(`/sales/truck-loads/${id}/cancel`);
      reload();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to cancel loading');
    }
  }

  return (
    <div>
      <p className="muted">Loading a tanker deducts water directly from the source warehouse's inventory. One load can serve several tank-fill deliveries across a route. A truck with stock still remaining from its previous load must be reconciled before it can be loaded again.</p>
      <div className="toolbar">
        {canLoad && <button className="btn" onClick={() => setShowOpenModal(true)}>+ Load Tanker</button>}
        {canViewHistory && <button className="btn secondary" onClick={() => setShowHistory((s) => !s)}>{showHistory ? 'Hide' : 'View'} Route Session History</button>}
      </div>

      {error && !showOpenModal && !reconcilingId && <div className="error-box">{error}</div>}
      {openInfo && <div className="info-box">{openInfo}</div>}

      {showHistory && <RouteSessionHistory />}

      <div className="card table-wrap">
        <table>
          <thead>
            <tr><th>Truck</th><th>Product</th><th>Loaded</th><th>Delivered</th><th>Remaining</th><th>Route Date</th><th>Status</th><th></th></tr>
          </thead>
          <tbody>
            {rows?.map((l) => {
              // The real, live figures — delivered_liters is the same column
              // the POS's tank-dispatch and the Remaining Stock card both
              // update/read; the legacy quantity_delivered/remaining_balance
              // columns only reflect the older `deliveries` table, which this
              // fast POS flow never writes to.
              const delivered = Number(l.delivered_liters);
              const remaining = Number(l.quantity_loaded) - delivered;
              return (
                <tr key={l.id}>
                  <td>{l.plate_number}</td>
                  <td>{l.product_name}</td>
                  <td>{Number(l.quantity_loaded).toLocaleString()} {l.unit}</td>
                  <td>{delivered.toLocaleString()} {l.unit}</td>
                  <td><strong>{remaining.toLocaleString()} {l.unit}</strong></td>
                  <td>{l.route_date}</td>
                  <td><span className={`badge badge--${STATUS_BADGE[l.status]}`}>{l.status}</span></td>
                  <td style={{ display: 'flex', gap: 6 }}>
                    <button className="btn secondary" onClick={() => setExpandedId(expandedId === l.id ? null : l.id)}>{expandedId === l.id ? 'Hide' : 'View'}</button>
                    {l.status === 'loaded' && canClose && remaining <= 0 && (
                      <button className="btn secondary" onClick={() => completeLoad(l.id)}>Complete</button>
                    )}
                    {l.status === 'loaded' && canClose && remaining > 0 && (
                      <button className="btn secondary" onClick={() => setReconcilingId(l.id)}>Reconcile Stock</button>
                    )}
                    {l.status === 'loaded' && canLoad && (
                      <button className="btn secondary" onClick={() => cancelLoad(l.id)}>Cancel</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!rows?.length && <p className="muted">No tanker loads recorded yet.</p>}
      </div>

      {expandedId && <LoadDeliveries loadId={expandedId} />}

      {reconcilingId && (
        <ReconcileModal
          load={rows.find((l) => l.id === reconcilingId)}
          onClose={() => setReconcilingId(null)}
          onDone={() => { setReconcilingId(null); reload(); }}
        />
      )}

      {showOpenModal && (
        <OpenRouteSessionModal
          user={user}
          trucks={trucks}
          products={products}
          warehouses={warehouses}
          existingLoads={rows}
          onClose={() => setShowOpenModal(false)}
          onOpened={(message) => { setShowOpenModal(false); setOpenInfo(message || null); reload(); }}
        />
      )}
    </div>
  );
}

// "Load Tanker" is always the entry point for opening a Route Session — this
// modal is that entry point. Opened By is the logged-in user, never editable
// (it's who's actually driving this action, not a claim anyone could type
// in); Driver is read straight off the selected truck's own assignment, also
// never a manual pick here. Submitting calls the exact same POST
// /sales/truck-loads that already: creates the truck_load row with
// status='loaded', stamps loaded_by/loaded_at, and is blocked at the database
// level (idx_truck_loads_one_active_per_truck) from ever creating a second
// active row for the same truck — Remaining Stock is then simply
// quantity_loaded - 0 delivered, i.e. exactly the Loaded Liters just entered.
function OpenRouteSessionModal({ user, trucks, products, warehouses, existingLoads, onClose, onOpened }) {
  const [truckId, setTruckId] = useState('');
  const [quantityLoaded, setQuantityLoaded] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  // Whatever the truck's last CLOSED session left physically on it — null
  // while unknown/loading, a number (possibly 0) once fetched for the
  // selected truck. Loaded Liters must never be HTML-required based on this:
  // right after picking a truck this is transiently null while the fetch is
  // still in flight, and a required attribute driven by that would flash
  // true and let the browser's native "Please fill out this field" block a
  // submit that should have been allowed once the real answer (stock > 0)
  // came back. Validation instead happens only in submit() below, once
  // stockLoading is false — so it always sees the resolved answer, never
  // the momentary unknown one.
  const [existingStock, setExistingStock] = useState(null);
  const [stockLoading, setStockLoading] = useState(false);

  const truck = trucks?.find((t) => t.id === Number(truckId));
  // This version's tanker loading has exactly one source and one product —
  // Production and a separate Raw Water Tank aren't wired in yet (future
  // version), so there is nothing to pick here at all, only to confirm.
  const finishedWaterWarehouse = warehouses?.find((w) => w.name === 'Finished Water Warehouse');
  const bulkWaterProduct = products?.find((p) => p.name.includes('Bulk Water'));
  const hasExistingStock = Number(existingStock) > 0;

  useEffect(() => {
    if (!truckId) { setExistingStock(null); setStockLoading(false); return; }
    let cancelled = false;
    setStockLoading(true);
    client.get(`/routes/truck-existing-stock?truck_id=${truckId}`)
      .then(({ data }) => { if (!cancelled) setExistingStock(data.data.liters); })
      .finally(() => { if (!cancelled) setStockLoading(false); });
    return () => { cancelled = true; };
  }, [truckId]);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    if (!finishedWaterWarehouse || !bulkWaterProduct) {
      setError('Finished Water Warehouse / Bulk Water product not found — contact Admin.');
      return;
    }
    const qty = Number(quantityLoaded) || 0;
    if (qty <= 0 && !hasExistingStock) {
      setError('Cannot open Route Session. Load water first or use a truck with existing remaining stock.');
      return;
    }
    setBusy(true);
    try {
      const { data } = await client.post('/sales/truck-loads', {
        truck_id: Number(truckId),
        product_id: bulkWaterProduct.id,
        warehouse_id: finishedWaterWarehouse.id,
        quantity_loaded: qty,
        notes
      });
      onOpened(data.message);
    } catch (err) {
      if (err.response?.status === 409) {
        setError('This truck already has an active Route Session.');
      } else {
        setError(err.response?.data?.error || 'Failed to open Route Session');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.55)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
    }}>
      <form className="stacked-form card" style={{ width: 440 }} onSubmit={submit}>
        <h3 style={{ gridColumn: '1/-1', marginTop: 0 }}>Open Route Session</h3>
        {error && <div className="error-box" style={{ gridColumn: '1/-1' }}>{error}</div>}
        {hasExistingStock && (
          <div className="info-box" style={{ gridColumn: '1/-1' }}>
            Opening Route Session using existing truck stock ({Number(existingStock).toLocaleString()} L). Leave Loaded Liters blank, or enter a new load if the truck was actually refilled.
          </div>
        )}

        <label>Truck
          <select required value={truckId} onChange={(e) => setTruckId(e.target.value)}>
            <option value="">Select…</option>
            {trucks?.filter((t) => !existingLoads?.some((l) => l.truck_id === t.id && l.status === 'loaded')).map((t) => (
              <option key={t.id} value={t.id}>{t.plate_number}</option>
            ))}
          </select>
        </label>
        <label>Driver
          <input value={truck?.driver_name || (truckId ? 'Unassigned' : '')} disabled />
        </label>
        <label>Product
          <input value={bulkWaterProduct?.name || 'Bulk Water (Tanker)'} disabled />
        </label>
        <label>Warehouse
          <input value={finishedWaterWarehouse?.name || 'Finished Water Warehouse'} disabled />
        </label>
        <label>Loaded Liters{hasExistingStock ? ' (optional)' : ''}
          {/* Never HTML-required — see the note on stockLoading above. The
              real gate is the manual check inside submit(), which only ever
              runs once stockLoading is false, so it always has the truck's
              real existing-stock answer rather than a momentary null. */}
          <input
            type="number" step="0.01" min="0"
            placeholder={hasExistingStock ? `Leave blank to use existing ${Number(existingStock).toLocaleString()} L` : ''}
            value={quantityLoaded} onChange={(e) => setQuantityLoaded(e.target.value)}
          />
        </label>
        <label>Opened By
          <input value={user?.fullName || user?.email || ''} disabled />
        </label>
        <label style={{ gridColumn: '1/-1' }}>Notes (optional)<input value={notes} onChange={(e) => setNotes(e.target.value)} /></label>

        <div className="form-actions" style={{ gridColumn: '1/-1' }}>
          <button className="btn" type="submit" disabled={busy || (!!truckId && stockLoading)}>{busy ? 'Opening…' : stockLoading ? 'Checking truck stock…' : 'Open Route Session'}</button>
          <button type="button" className="secondary" onClick={onClose} style={{ marginLeft: 8 }}>Cancel</button>
        </div>
      </form>
    </div>
  );
}

// The mandatory Option 1 / Option 2 choice before a truck can be loaded again.
function ReconcileModal({ load, onClose, onDone }) {
  const previousRemaining = Number(load.quantity_loaded) - Number(load.delivered_liters);
  const [matches, setMatches] = useState(true);
  const [actualRemaining, setActualRemaining] = useState(String(previousRemaining));
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    const actual = matches ? previousRemaining : Number(actualRemaining);
    if (!matches && (reason === '' )) {
      setError('Select a reason for the difference');
      return;
    }
    if (!matches && reason === 'other' && !note.trim()) {
      setError('A note is required when the reason is "Other"');
      return;
    }
    setBusy(true);
    try {
      await client.post(`/sales/truck-loads/${load.id}/reconcile`, {
        actual_remaining: actual,
        reason: matches ? undefined : reason,
        note: matches ? undefined : note
      });
      onDone();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to reconcile stock');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stacked-form card" onSubmit={submit}>
      <strong>Reconcile Stock — {load.plate_number}</strong>
      {error && <div className="error-box" style={{ gridColumn: '1/-1' }}>{error}</div>}
      <div style={{ gridColumn: '1/-1' }}>System Remaining: <strong>{previousRemaining.toLocaleString()} {load.unit}</strong></div>

      <label style={{ gridColumn: '1/-1' }}>
        <input type="radio" checked={matches} onChange={() => setMatches(true)} /> Physical water remaining matches the system ({previousRemaining.toLocaleString()} {load.unit})
      </label>
      <label style={{ gridColumn: '1/-1' }}>
        <input type="radio" checked={!matches} onChange={() => setMatches(false)} /> Physical remaining is different
      </label>

      {!matches && (
        <>
          <label>Actual Remaining<input type="number" step="0.01" min="0" value={actualRemaining} onChange={(e) => setActualRemaining(e.target.value)} /></label>
          <label>Reason
            <select required value={reason} onChange={(e) => setReason(e.target.value)}>
              <option value="">Select…</option>
              {Object.entries(REASON_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label style={{ gridColumn: '1/-1' }}>Note{reason === 'other' ? ' (required)' : ''}<input value={note} onChange={(e) => setNote(e.target.value)} /></label>
        </>
      )}

      <div>
        <button className="btn" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Confirm & Continue'}</button>
        <button type="button" className="secondary" onClick={onClose} style={{ marginLeft: 8 }}>Cancel</button>
      </div>
    </form>
  );
}

// One row per Route Session (each Load Tanker → Close cycle): who opened it,
// who closed it, and the full loaded/delivered/remaining/adjustment picture.
// A session closed by simply selling out completely (no reconciliation ever
// needed) shows blank Closed By/Adjustment fields rather than a fabricated
// value — that's a real, honest distinction from one closed via an explicit
// stock adjustment.
function RouteSessionHistory() {
  const { rows } = useApi('/sales/route-sessions');
  if (!rows) return <p className="muted">Loading…</p>;
  return (
    <div className="card table-wrap">
      <strong>Route Session History</strong>
      <table style={{ marginTop: 8 }}>
        <thead>
          <tr>
            <th>Truck</th><th>Driver</th><th>Opened By</th><th>Closed By</th>
            <th>Loaded</th><th>Delivered</th><th>Remaining</th><th>Adjustment</th><th>Close Date</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.plate_number}</td>
              <td>{r.driver_name || '—'}</td>
              <td>{r.opened_by_name}</td>
              <td>{r.closed_by_name || (r.status === 'completed' ? 'Sold out — no adjustment needed' : '—')}</td>
              <td>{Number(r.loaded_liters).toLocaleString()}</td>
              <td>{Number(r.delivered_liters).toLocaleString()}</td>
              <td>{Number(r.remaining_liters).toLocaleString()}</td>
              <td style={{ color: r.difference != null && Number(r.difference) !== 0 ? 'var(--danger)' : undefined }}>
                {r.difference != null ? `${Number(r.difference).toLocaleString()} (${REASON_LABEL[r.reason] || r.reason})` : '—'}
              </td>
              <td>{r.completed_at ? new Date(r.completed_at).toLocaleString() : <span className={`badge badge--${STATUS_BADGE[r.status]}`}>{r.status}</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && <p className="muted">No route sessions recorded yet.</p>}
    </div>
  );
}

function LoadDeliveries({ loadId }) {
  const { rows } = useApi(`/sales/truck-loads/${loadId}`);
  if (!rows) return null;

  return (
    <div className="card">
      <strong>Delivery stops for this load</strong>
      <table style={{ marginTop: 8 }}>
        <thead><tr><th>Order #</th><th>Customer</th><th>Tank</th><th>Status</th><th>Qty Delivered</th></tr></thead>
        <tbody>
          {rows.deliveries.map((d) => (
            <tr key={d.id}>
              <td>{d.order_number}</td>
              <td>{d.customer_name}</td>
              <td>{d.tank_code || '—'}</td>
              <td>{d.status}</td>
              <td>{d.quantity_delivered ? Number(d.quantity_delivered).toLocaleString() : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.deliveries.length && <p className="muted">No stops dispatched against this load yet.</p>}
    </div>
  );
}
