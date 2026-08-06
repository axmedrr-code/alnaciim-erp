import { useEffect, useRef, useState } from 'react';
import { useApi } from '../components/useApi';
import client from '../api/client';

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

const PAYMENT_LABEL = { cash: 'Cash', credit: 'Credit', cash_credit: 'Cash + Credit' };

// Read-only info derived from the customer's own last delivered Bulk Water
// sale — never a separate tracked field, so it can never drift out of sync
// with the real sales history.
function lastDeliveryInfo(lastDeliveryDate) {
  if (!lastDeliveryDate) return { label: 'Never Delivered', className: 'pos-delivery--none' };
  // order_date comes back as a plain 'YYYY-MM-DD' string (see backend db
  // config's DATE type parser) — comparing at midnight local avoids a
  // timezone shift nudging "Today" into "Yesterday" or vice versa.
  const [y, m, d] = lastDeliveryDate.split('-').map(Number);
  const last = new Date(y, m - 1, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((today - last) / 86400000);

  const label = days <= 0 ? 'Today' : days === 1 ? 'Yesterday' : `${days} days ago`;
  const className = days <= 3 ? 'pos-delivery--green' : days <= 7 ? 'pos-delivery--yellow' : days <= 14 ? 'pos-delivery--orange' : 'pos-delivery--red';
  return { label, className };
}

// Bulk Water fast POS — one operator, one customer, one transaction, done in
// seconds. HNO is this ERP's one permanent customer identifier (matching the
// predecessor system's account numbering) — the entry point is HNO; every
// other customer field is derived from it, read-only, never searched or
// selected manually.
export default function RoutePlanning() {
  const { rows: trucks } = useApi('/routes/trucks-status');
  const { rows: drivers } = useApi('/routes/drivers-status');

  const [truckId, setTruckId] = useState('');
  // Route Session status — the hard gate on whether a sale is even possible.
  // OPEN for exactly as long as the truck has one active load (Warehouse/Admin
  // Load Tanker opens it; Data Entry/Admin closing it via Complete/Reconcile
  // is what flips this to closed). Re-fetched on truck change, after every
  // Save, and on a light poll so a close made elsewhere (Data Entry's screen)
  // is reflected here without needing a manual refresh.
  const { rows: routeSession, reload: reloadSession } = useApi(
    truckId ? `/routes/route-session?truck_id=${truckId}` : null, [truckId]
  );
  const sessionOpen = routeSession?.status === 'open';
  useEffect(() => {
    if (!truckId) return;
    const id = setInterval(reloadSession, 10000);
    return () => clearInterval(id);
  }, [truckId, reloadSession]);
  // Remaining Stock is THIS truck's own balance — what was physically loaded
  // onto it today minus what it has already sold today — never the shared
  // warehouse total. Switching trucks re-fetches immediately; a save reloads
  // it below so only the selected truck's number ever changes.
  const { rows: truckStock, reload: reloadStock } = useApi(
    truckId ? `/routes/truck-stock?truck_id=${truckId}` : null, [truckId]
  );
  // Today's Driver Summary — scoped to whichever truck is selected, reloaded
  // after every save so it never shows stale totals.
  const { rows: driverSummary, reload: reloadDriverSummary } = useApi(
    truckId ? `/routes/driver-summary?truck_id=${truckId}` : null, [truckId]
  );
  const [replacingDriver, setReplacingDriver] = useState(false);
  const [overrideDriverId, setOverrideDriverId] = useState('');
  const [hnoSearch, setHnoSearch] = useState('');
  const [customer, setCustomer] = useState(null);
  const truck = trucks?.find((t) => t.id === Number(truckId));
  const [fillLiters, setFillLiters] = useState('');
  const [pricePerLiter, setPricePerLiter] = useState('');
  const [discount, setDiscount] = useState('0');
  const [paymentType, setPaymentType] = useState('cash');
  const [cashReceivedInput, setCashReceivedInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [lastSale, setLastSale] = useState(null);
  const [showSuccess, setShowSuccess] = useState(false);
  const [notFoundHno, setNotFoundHno] = useState(null);
  const [looking, setLooking] = useState(false);
  const hnoInputRef = useRef(null);
  const fillLitersRef = useRef(null);
  const discountRef = useRef(null);
  const paymentRef = useRef(null);

  // Lookup by one physical, unique drum number — never a customer list to
  // browse, never fuzzy/contains/startsWith, never by name. The lookup only
  // ever runs on explicit confirmation (Enter, Tab, or a barcode scanner's
  // trailing Enter): typing itself never queries or reacts to anything, so
  // there's no race between a debounced live search and the operator's next
  // keystroke — the request fires once, for the exact value on screen at the
  // moment of confirmation.
  async function confirmHno(e) {
    if (e.key !== 'Enter' && e.key !== 'Tab') return;
    e.preventDefault();
    const hno = hnoSearch.replace(/[,\s]/g, '');
    if (!hno || looking) return;
    setLooking(true);
    setNotFoundHno(null);
    setError(null);
    try {
      const { data } = await client.get(`/customers?hno=${encodeURIComponent(hno)}`);
      if (data.data.length === 1) {
        pickCustomer(data.data[0]);
      } else {
        setNotFoundHno(hno);
      }
    } catch (err) {
      // A failed lookup must never fail silently — log the real backend
      // error and surface it, rather than leaving the operator staring at a
      // form that just did nothing.
      console.error('HNO lookup failed:', err);
      setError(err.response?.data?.error || 'HNO lookup failed — check your connection and try again.');
    } finally {
      setLooking(false);
    }
  }

  const liters = Number(fillLiters) || 0;
  const price = Number(pricePerLiter) || 0;
  const disc = Number(discount) || 0;
  const totalAmount = Math.max(0, liters * price - disc);
  const cashReceived = paymentType === 'cash' ? totalAmount : paymentType === 'credit' ? 0 : Math.min(Number(cashReceivedInput) || 0, totalAmount);
  const outstanding = totalAmount - cashReceived;

  function pickCustomer(c) {
    setCustomer(c);
    // Never show a comma in the HNO field, even if this particular row is a
    // legacy record still stored with one pending cleanup.
    setHnoSearch((c.hno || '').replace(/[,\s]/g, ''));
    setPricePerLiter(String(c.bulk_water_price_per_liter));
    setTimeout(() => fillLitersRef.current?.focus(), 0);
  }

  // Wipes every field back to a blank transaction — HNO, customer info,
  // liters, price, discount, payment method, cash received, and the derived
  // totals all reset. Truck stays selected: the operator keeps working the
  // same truck's deliveries one after another without re-picking it.
  function clearForm() {
    setHnoSearch(''); setCustomer(null); setNotFoundHno(null);
    setFillLiters(''); setPricePerLiter(''); setDiscount('0');
    setPaymentType('cash'); setCashReceivedInput('');
    setError(null);
  }

  // Enter drives the whole sale, field to field: Fill Liters -> Discount ->
  // Payment -> Save. Tab still moves through every field in natural DOM order
  // (including Price/Liter, which Enter deliberately skips since it's
  // already loaded from the HNO lookup) so the keyboard-only flow never
  // breaks accessibility.
  function handleFillLitersKeyDown(e) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    discountRef.current?.focus();
  }
  function handleDiscountKeyDown(e) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    paymentRef.current?.focus();
  }
  function handlePaymentKeyDown(e) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    save();
  }

  async function save() {
    if (busy) return; // ignore double-clicks outright, don't rely on the disabled attribute alone
    setError(null);
    if (!truckId) { setError('Select a truck.'); return; }
    if (!sessionOpen) { setError('No active Route Session. Please ask Warehouse/Admin to load the truck.'); return; }
    if (!customer) { setError('Enter or scan the HNO.'); return; }
    if (!(liters > 0)) { setError('Enter fill liters.'); return; }
    if (price < 0) { setError('Price cannot be negative.'); return; }

    setBusy(true);
    try {
      const { data } = await client.post('/routes/tank-dispatch', {
        truck_id: Number(truckId),
        driver_id: replacingDriver && overrideDriverId ? Number(overrideDriverId) : undefined,
        tank_lines: [{
          customer_id: customer.id, liters, price_per_liter: price,
          discount: disc, cash_received: cashReceived, payment_type: paymentType
        }]
      });
      const order = data.data.orders[0];
      setLastSale({
        order, customerName: customer.name, hno: customer.hno,
        liters, price, discount: disc, totalAmount, cashReceived, outstanding, paymentType
      });
      await reloadStock();
      await reloadDriverSummary();
      await reloadSession();

      // Auto-restart the transaction: clear the form, flash the success
      // banner for ~2s, and put the cursor straight back in HNO — no click
      // required before the next scan.
      clearForm();
      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 2000);
      // Deferred: something later in this render cycle (or a slightly-delayed
      // re-render from the stock/trucks refetch settling) can steal focus back
      // if we grab it synchronously here, so grab it after the DOM has settled.
      setTimeout(() => hnoInputRef.current?.focus(), 0);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save sale');
    } finally {
      setBusy(false);
    }
  }

  function printReceipt() {
    if (!lastSale) return;
    const s = lastSale;
    const win = window.open('', '_blank');
    win.document.write(`
      <title>${s.order.invoice_hno || s.order.order_number}</title>
      <style>body{font-family:sans-serif;padding:24px;font-size:14px;} table{width:100%;border-collapse:collapse;margin-top:12px;} td{padding:5px 0;} td:last-child{text-align:right;font-weight:600;}</style>
      <h2>${s.order.invoice_hno || s.order.order_number}</h2>
      <p>${todayISO()}</p>
      <table>
        <tr><td>HNO</td><td>${s.hno}</td></tr>
        <tr><td>Customer</td><td>${s.customerName}</td></tr>
        <tr><td>Delivered Liters</td><td>${s.liters.toLocaleString()} L</td></tr>
        <tr><td>Price/Liter</td><td>$${s.price.toFixed(3)}</td></tr>
        <tr><td>Discount</td><td>$${s.discount.toFixed(2)}</td></tr>
        <tr><td>Total Amount</td><td>$${s.totalAmount.toFixed(2)}</td></tr>
        <tr><td>Payment Type</td><td>${PAYMENT_LABEL[s.paymentType]}</td></tr>
        <tr><td>Cash Received</td><td>$${s.cashReceived.toFixed(2)}</td></tr>
        <tr><td>Outstanding Credit</td><td>$${s.outstanding.toFixed(2)}</td></tr>
      </table>
    `);
    win.document.close();
    win.print();
  }

  // Customers call the driver directly, not the office — so the driver needs
  // this delivery on their phone the moment it's saved, not a printout.
  function whatsAppDriver() {
    if (!lastSale || !truck) return;
    const digits = (truck.current_driver_phone || '').replace(/[^\d]/g, '');
    if (!digits) { setError('This driver has no phone number on file.'); return; }
    const s = lastSale;
    const message = `Delivery — ${s.order.invoice_hno || s.order.order_number}\nCustomer: ${s.customerName} (HNO ${s.hno})\nLiters: ${s.liters.toLocaleString()} L\nAmount: $${s.totalAmount.toFixed(2)} (${PAYMENT_LABEL[s.paymentType]})`;
    window.open(`https://wa.me/${digits}?text=${encodeURIComponent(message)}`, '_blank');
  }

  return (
    <div className="pos-screen">
      {error && <div className="error">{error}</div>}
      {showSuccess && lastSale && (
        <div className="pos-success pos-success--fade">
          ✓ Sale Saved Successfully — {lastSale.order.invoice_hno || lastSale.order.order_number} — ${lastSale.totalAmount.toFixed(2)}
        </div>
      )}

      <div className="pos-row">
        <label>Truck
          <select value={truckId} onChange={(e) => { setTruckId(e.target.value); setReplacingDriver(false); setOverrideDriverId(''); }}>
            <option value="">Select truck…</option>
            {trucks?.filter((t) => t.computed_status === 'Available' || t.computed_status === 'Loading').map((t) => (
              <option key={t.id} value={t.id}>{t.plate_number} ({t.truck_code})</option>
            ))}
          </select>
        </label>
        {truck && !replacingDriver && (
          <div className="pos-driverline">
            Driver: <strong>{truck.current_driver || 'Unassigned'}</strong>
            {truck.current_driver_phone && <span className="muted"> · {truck.current_driver_phone}</span>}
            <button type="button" className="pos-driverline__link" onClick={() => setReplacingDriver(true)}>Replace</button>
          </div>
        )}
        {truck && replacingDriver && (
          <div className="pos-driverline">
            <select value={overrideDriverId} onChange={(e) => setOverrideDriverId(e.target.value)}>
              <option value="">Replacement driver for today…</option>
              {drivers?.map((d) => <option key={d.id} value={d.id} disabled={!!d.current_route}>{d.full_name}{d.current_route ? ' (busy)' : ''}</option>)}
            </select>
            <button type="button" className="pos-driverline__link" onClick={() => { setReplacingDriver(false); setOverrideDriverId(''); }}>Cancel</button>
          </div>
        )}
      </div>

      {truck && routeSession && (
        sessionOpen ? (
          <div className="pos-session pos-session--open">
            <div className="pos-session__title">🟢 Route Session: OPEN</div>
            <div className="pos-session__grid">
              <span>Truck: <strong>{routeSession.plate_number}</strong></span>
              <span>Driver: <strong>{routeSession.driver_name || '—'}</strong></span>
              <span>Opened By: <strong>{routeSession.opened_by_name}</strong></span>
              <span>Opened Time: <strong>{new Date(routeSession.opened_at).toLocaleString()}</strong></span>
              <span>Loaded Liters: <strong>{Number(routeSession.loaded_liters).toLocaleString()} L</strong></span>
              <span>Delivered Liters: <strong>{Number(routeSession.delivered_liters).toLocaleString()} L</strong></span>
              <span>Remaining Liters: <strong>{Number(routeSession.remaining_liters).toLocaleString()} L</strong></span>
            </div>
          </div>
        ) : (
          <div className="pos-session pos-session--closed">
            <div className="pos-session__title">🔴 No Active Route Session</div>
            <p>No active Route Session.<br />Please ask Warehouse/Admin to load the truck.</p>
          </div>
        )
      )}

      <div className="pos-box">
        <div className="pos-field pos-field--wide" style={{ position: 'relative' }}>
          <label>HNO</label>
          <input
            ref={hnoInputRef}
            placeholder="Scan or type HNO…" value={hnoSearch} autoFocus
            disabled={!sessionOpen}
            onChange={(e) => { setHnoSearch(e.target.value.replace(/,/g, '')); setCustomer(null); setNotFoundHno(null); }}
            onKeyDown={confirmHno}
          />
          {/* No dropdown, no suggestion list, no live search — the lookup only
              ever runs on Enter/Tab. Focus stays put either way. */}
          {notFoundHno && <div className="pos-notfound">HNO {notFoundHno} not found.</div>}
        </div>

        {customer && (
          <div className="pos-tankinfo">
            <span>Name: <strong>{customer.name}</strong></span>
            <span>Customer Phone: <strong>{customer.phone || '—'}</strong></span>
            <span>Guarantor Name: <strong>{customer.guarantor_name || '—'}</strong></span>
            <span>Guarantor Phone: <strong>{customer.guarantor_phone || '—'}</strong></span>
            <span>Status: <strong>{customer.status}</strong></span>
            <span>Outstanding Balance: <strong>${Number(customer.outstanding_balance || 0).toFixed(2)}</strong></span>
          </div>
        )}

        {customer && (() => {
          const { label, className } = lastDeliveryInfo(customer.last_delivery_date);
          return (
            <div className={`pos-delivery ${className}`}>
              Last Water Delivery: <strong>{label}</strong>
            </div>
          );
        })()}
      </div>

      <div className="pos-box">
        <div className="pos-field">
          <label>Fill Liters</label>
          <input
            ref={fillLitersRef}
            type="number" min="0" step="1" value={fillLiters}
            disabled={!sessionOpen}
            onChange={(e) => setFillLiters(e.target.value)}
            onKeyDown={handleFillLitersKeyDown}
          />
        </div>
        <div className="pos-field">
          <label>Price/Liter</label>
          <input type="number" min="0" step="0.001" value={pricePerLiter} onChange={(e) => setPricePerLiter(e.target.value)} />
        </div>
        <div className="pos-field">
          <label>Discount</label>
          <input
            ref={discountRef}
            type="number" min="0" step="0.01" value={discount}
            onChange={(e) => setDiscount(e.target.value)}
            onKeyDown={handleDiscountKeyDown}
          />
        </div>
        <div className="pos-field">
          <label>Payment</label>
          <select
            ref={paymentRef}
            value={paymentType}
            onChange={(e) => setPaymentType(e.target.value)}
            onKeyDown={handlePaymentKeyDown}
          >
            <option value="cash">Cash</option>
            <option value="credit">Credit</option>
            <option value="cash_credit">Cash + Credit</option>
          </select>
        </div>
        {paymentType === 'cash_credit' && (
          <div className="pos-field">
            <label>Cash Received</label>
            <input type="number" min="0" step="0.01" value={cashReceivedInput} onChange={(e) => setCashReceivedInput(e.target.value)} />
          </div>
        )}
      </div>

      {truck && (
        <div className="pos-driversummary">
          <span>Today's Sales: <strong>${Number(driverSummary?.sales_today || 0).toFixed(2)}</strong></span>
          <span>Cash Today: <strong>${Number(driverSummary?.cash_today || 0).toFixed(2)}</strong></span>
          <span>Credit Today: <strong>${Number(driverSummary?.credit_today || 0).toFixed(2)}</strong></span>
          <span>Today's Deliveries: <strong>{driverSummary?.deliveries || 0}</strong></span>
        </div>
      )}

      <div className="pos-box pos-box--totals">
        <div><span>Total Amount</span><strong>${totalAmount.toFixed(2)}</strong></div>
        <div><span>Outstanding Credit</span><strong>${outstanding.toFixed(2)}</strong></div>
        <div><span>Remaining Stock</span><strong>{truckId ? (truckStock ? `${Number(truckStock.liters).toLocaleString()} L` : '…') : '—'}</strong></div>
      </div>

      <div className="pos-actions">
        <button type="button" className="btn-pos btn-pos--primary" disabled={busy || !sessionOpen} onClick={save}>{busy ? 'Saving…' : 'SAVE'}</button>
        <button type="button" className="btn-pos" disabled={!lastSale} onClick={printReceipt}>PRINT</button>
        <button type="button" className="btn-pos" disabled={!lastSale} onClick={whatsAppDriver}>WHATSAPP DRIVER</button>
        <button type="button" className="btn-pos" onClick={clearForm}>NEW SALE</button>
      </div>
    </div>
  );
}
