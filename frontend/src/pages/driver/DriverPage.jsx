import { useState } from 'react';
import { useApi } from '../../components/useApi';
import client from '../../api/client';
import { useAuth } from '../../context/AuthContext';

const STATUS_LABEL = { scheduled: 'Scheduled', in_transit: 'On the way', delivered: 'Delivered', failed: 'Failed' };

function ConfirmForm({ delivery, onDone }) {
  const [qty, setQty] = useState('');
  const [signature, setSignature] = useState('');
  const [gps, setGps] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  function captureGps() {
    if (!navigator.geolocation) { setError('GPS not available on this device'); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => setGps({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => setError('Could not get GPS location')
    );
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await client.put(`/sales/deliveries/${delivery.id}/confirm`, {
        quantity_delivered: Number(qty),
        signature_name: signature,
        last_known_lat: gps?.lat,
        last_known_lng: gps?.lng
      });
      onDone();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to confirm delivery');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 10, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
      {error && <div className="error-box">{error}</div>}
      <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
        Quantity delivered
        <input type="number" step="0.01" value={qty} onChange={(e) => setQty(e.target.value)} style={{ width: '100%', marginTop: 4 }} />
      </label>
      <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
        Customer signature (type name)
        <input type="text" value={signature} onChange={(e) => setSignature(e.target.value)} style={{ width: '100%', marginTop: 4 }} />
      </label>
      <button type="button" className="btn secondary" onClick={captureGps} style={{ marginBottom: 8 }}>
        {gps ? `GPS captured (${gps.lat.toFixed(4)}, ${gps.lng.toFixed(4)})` : 'Capture GPS location (optional)'}
      </button>
      <br />
      <button className="btn" disabled={!qty || !signature || busy} onClick={submit} style={{ width: '100%' }}>
        {busy ? 'Saving…' : 'Confirm Delivery'}
      </button>
    </div>
  );
}

function DeliveryCard({ delivery, onChanged }) {
  const [confirming, setConfirming] = useState(false);

  async function start() {
    await client.put(`/sales/deliveries/${delivery.id}/status`, { status: 'in_transit' });
    onChanged();
  }

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <strong style={{ fontSize: 15 }}>{delivery.customer_name}</strong>
          <div className="muted">{delivery.order_number}</div>
        </div>
        <span className={`badge badge--${delivery.status === 'scheduled' ? 'pending' : 'info'}`}>{STATUS_LABEL[delivery.status]}</span>
      </div>
      <div style={{ marginTop: 8, fontSize: 13 }}>
        {delivery.tank_code && <div>Tank: <strong>{delivery.tank_code}</strong> — {delivery.tank_location}</div>}
        <div>Truck: {delivery.plate_number}</div>
        {delivery.delivery_address && <div>Address: {delivery.delivery_address}</div>}
      </div>

      {!confirming && delivery.status === 'scheduled' && (
        <button className="btn" style={{ width: '100%', marginTop: 10 }} onClick={start}>Start Trip</button>
      )}
      {!confirming && delivery.status === 'in_transit' && (
        <button className="btn" style={{ width: '100%', marginTop: 10 }} onClick={() => setConfirming(true)}>Confirm Delivery</button>
      )}
      {confirming && <ConfirmForm delivery={delivery} onDone={() => { setConfirming(false); onChanged(); }} />}
    </div>
  );
}

export default function DriverPage() {
  const { user } = useAuth();
  const { rows, reload } = useApi(`/sales/deliveries?driver_id=${user.id}`);
  const active = rows?.filter((d) => ['scheduled', 'in_transit'].includes(d.status));
  const completedToday = rows?.filter((d) => d.status === 'delivered' && d.confirmed_at && new Date(d.confirmed_at).toDateString() === new Date().toDateString());

  return (
    <div style={{ maxWidth: 480, margin: '0 auto' }}>
      <div className="page-header"><h1>My Deliveries</h1></div>
      <p className="muted">{user?.fullName}</p>

      {!active?.length && <p className="muted">No active deliveries assigned right now.</p>}
      {active?.map((d) => <DeliveryCard key={d.id} delivery={d} onChanged={reload} />)}

      {completedToday?.length > 0 && (
        <>
          <h3 style={{ marginTop: 24 }}>Completed Today</h3>
          {completedToday.map((d) => (
            <div className="card" key={d.id} style={{ marginBottom: 8 }}>
              <strong>{d.customer_name}</strong> — {Number(d.quantity_delivered).toLocaleString()} L
              <div className="muted">{d.order_number} · signed by {d.signature_name}</div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
