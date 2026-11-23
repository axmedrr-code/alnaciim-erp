import { useState } from 'react';
import { useApi } from '../../components/useApi';
import client from '../../api/client';
import { useAuth } from '../../context/AuthContext';

const money = (v) => `$${Number(v || 0).toFixed(2)}`;
const errText = (e, fallback) => e.response?.data?.error || fallback;
const Q_BADGE = { requested: 'pending', received: 'info', declined: 'cancelled', selected: 'ok', rejected: 'low' };

// Quotation recording form: one unit price per requisition line + delivery, terms, quality.
function RecordForm({ reqId, quotation, lines, onDone, onCancel, setError }) {
  const priceOf = (lid) => quotation.lines?.find((l) => l.requisition_line_id === lid)?.unit_price;
  const [prices, setPrices] = useState(Object.fromEntries(lines.map((l) => [l.id, priceOf(l.id) ?? ''])));
  const [delivery, setDelivery] = useState(quotation.delivery_days ?? '');
  const [terms, setTerms] = useState(quotation.payment_terms_days ?? '');
  const [quality, setQuality] = useState(quotation.quality_rating ?? '');
  const [notes, setNotes] = useState(quotation.notes || '');
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true); setError(null);
    try {
      await client.put(`/procurement/requisitions/${reqId}/quotations/${quotation.id}`, {
        delivery_days: Number(delivery), payment_terms_days: Number(terms), quality_rating: quality ? Number(quality) : null, notes: notes || null,
        lines: lines.filter((l) => prices[l.id] !== '').map((l) => ({ requisition_line_id: l.id, unit_price: Number(prices[l.id]) }))
      });
      onDone();
    } catch (e) { setError(errText(e, 'Could not save the quotation')); } finally { setBusy(false); }
  }
  return (
    <div className="card" style={{ margin: '8px 0' }}>
      <strong>{quotation.quotation_number} — {quotation.supplier_name}</strong>
      <table className="simple-table" style={{ width: '100%', marginTop: 6 }}>
        <thead><tr><th>Item</th><th>Qty</th><th>Supplier unit price</th></tr></thead>
        <tbody>{lines.map((l) => (
          <tr key={l.id}><td>{l.item_name}</td><td>{Number(l.quantity)} {l.unit}</td>
            <td><input type="number" min="0" step="0.01" value={prices[l.id]} onChange={(e) => setPrices({ ...prices, [l.id]: e.target.value })} /></td></tr>))}</tbody>
      </table>
      <div className="form-grid" style={{ marginTop: 8 }}>
        <div className="form-field"><label>Delivery (days)</label><input type="number" min="0" value={delivery} onChange={(e) => setDelivery(e.target.value)} /></div>
        <div className="form-field"><label>Payment terms (days)</label><input type="number" min="0" value={terms} onChange={(e) => setTerms(e.target.value)} /></div>
        <div className="form-field"><label>Quality (1–5)</label><input type="number" min="1" max="5" value={quality} onChange={(e) => setQuality(e.target.value)} /></div>
        <div className="form-field"><label>Notes</label><input value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
      </div>
      <div className="toolbar">
        <button className="btn" disabled={busy || delivery === '' || terms === ''} onClick={save}>Save quotation</button>
        <button className="btn secondary" onClick={onCancel}>Close</button>
      </div>
    </div>
  );
}

export default function SourcingPanel({ requisition, onChanged }) {
  const { user } = useAuth();
  const id = requisition.id;
  const canWork = requisition.status === 'sourcing' && (user?.role === 'Admin' || (user?.role === 'Procurement Officer' && requisition.assigned_to === user?.id));
  const [v, setV] = useState(0);
  const { rows: qdata, error: loadError } = useApi(`/procurement/requisitions/${id}/quotations`, [id, v]);
  const { rows: cmp } = useApi(`/procurement/requisitions/${id}/comparison`, [id, v]);
  const { rows: suppliers } = useApi(canWork ? '/suppliers' : null, [canWork]);
  const { rows: products } = useApi(canWork ? '/products' : null, [canWork]);
  const [picked, setPicked] = useState([]);
  const [recording, setRecording] = useState(null);
  const [justification, setJustification] = useState('');
  const [mapping, setMapping] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  if (loadError) return null; // roles that cannot see sourcing simply do not get the panel
  if (!qdata) return <p className="muted">Loading sourcing…</p>;
  const refresh = () => { setV((x) => x + 1); onChanged && onChanged(); };
  const lines = requisition.lines;

  async function run(fn, ok) {
    setBusy(true); setError(null); setNotice(null);
    try { await fn(); if (ok) setNotice(ok); refresh(); } catch (e) { setError(errText(e, 'Action failed')); } finally { setBusy(false); }
  }
  const asked = new Set(qdata.quotations.map((q) => q.supplier_id));
  const available = (suppliers || []).filter((s) => !asked.has(s.id));
  const unmapped = lines.filter((l) => !l.product_id);
  const selected = qdata.quotations.find((q) => q.status === 'selected');

  return (
    <div style={{ marginTop: 22 }}>
      <h4 style={{ margin: '4px 0 8px' }}>Sourcing &amp; supplier quotations</h4>
      {error && <div className="error-box">{error}</div>}
      {notice && <p style={{ color: 'var(--success, #198754)' }}>{notice}</p>}

      {qdata.quotations.length === 0 ? <p className="muted">No quotations requested yet.</p> : (
        <table className="simple-table" style={{ width: '100%' }}>
          <thead><tr><th>Quotation</th><th>Supplier</th><th>Status</th><th>Total</th><th>Delivery</th><th>Terms</th><th>Quality</th><th></th></tr></thead>
          <tbody>{qdata.quotations.map((q) => (
            <tr key={q.id}>
              <td>{q.quotation_number}</td><td>{q.supplier_name}</td>
              <td><span className={`badge badge--${Q_BADGE[q.status]}`}>{q.status}</span>{q.status === 'received' && !q.is_complete ? <span className="muted"> · incomplete</span> : ''}</td>
              <td>{q.status === 'received' || q.status === 'selected' || q.status === 'rejected' ? money(q.total_amount) : '—'}</td>
              <td>{q.delivery_days ?? '—'}{q.delivery_days != null ? ' d' : ''}</td><td>{q.payment_terms_days ?? '—'}{q.payment_terms_days != null ? ' d' : ''}</td><td>{q.quality_rating ?? '—'}</td>
              <td>{canWork && ['requested', 'received'].includes(q.status) && (
                <>
                  <button className="btn secondary" onClick={() => setRecording(q.id)}>{q.status === 'requested' ? 'Record prices' : 'Edit'}</button>{' '}
                  <button className="btn secondary" disabled={busy} onClick={() => run(() => client.post(`/procurement/requisitions/${id}/quotations/${q.id}/decline`, {}), 'Marked as declined')}>Declined</button>
                </>
              )}</td>
            </tr>))}</tbody>
        </table>
      )}

      {canWork && recording && (
        <RecordForm reqId={id} lines={lines} quotation={qdata.quotations.find((q) => q.id === recording)} setError={setError}
          onDone={() => { setRecording(null); refresh(); }} onCancel={() => setRecording(null)} />
      )}

      {canWork && (
        <div className="toolbar" style={{ marginTop: 8, flexWrap: 'wrap' }}>
          <select multiple size={Math.min(5, Math.max(2, available.length))} value={picked} onChange={(e) => setPicked([...e.target.selectedOptions].map((o) => o.value))}>
            {available.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <button className="btn" disabled={busy || picked.length === 0}
            onClick={() => run(async () => { await client.post(`/procurement/requisitions/${id}/quotations`, { supplier_ids: picked.map(Number) }); setPicked([]); }, 'Quotation requests created')}>
            Request quotations from selected suppliers
          </button>
        </div>
      )}

      {cmp && cmp.quotations.length > 0 && (
        <>
          <h4 style={{ margin: '18px 0 8px' }}>Comparison</h4>
          <table className="simple-table" style={{ width: '100%' }}>
            <thead><tr><th>Supplier</th>{lines.map((l) => <th key={l.id}>{l.item_name}</th>)}<th>Total</th><th>Delivery</th><th>Terms</th><th>Quality</th><th></th></tr></thead>
            <tbody>{cmp.quotations.map((q) => (
              <tr key={q.id} style={q.status === 'selected' ? { background: 'rgba(25,135,84,.10)' } : undefined}>
                <td>{q.supplier_name}{q.status === 'selected' ? ' ✔' : ''}</td>
                {lines.map((l) => <td key={l.id}>{q.prices[l.id] != null ? money(q.prices[l.id]) : '—'}</td>)}
                <td><strong>{q.is_complete ? money(q.total_amount) : 'incomplete'}</strong>{q.is_lowest_total ? <span className="badge badge--ok" style={{ marginLeft: 4 }}>lowest</span> : ''}</td>
                <td>{q.delivery_days ?? '—'}{q.is_fastest ? <span className="badge badge--ok" style={{ marginLeft: 4 }}>fastest</span> : ''}</td>
                <td>{q.payment_terms_days ?? '—'}{q.has_best_payment_terms ? <span className="badge badge--ok" style={{ marginLeft: 4 }}>best</span> : ''}</td>
                <td>{q.quality_rating ?? '—'}{q.has_best_quality ? <span className="badge badge--ok" style={{ marginLeft: 4 }}>best</span> : ''}</td>
                <td>{canWork && q.is_complete && q.status !== 'selected' && (
                  <button className="btn secondary" disabled={busy}
                    onClick={() => run(() => client.post(`/procurement/requisitions/${id}/select-supplier`, { quotation_id: q.id, justification }), 'Supplier selected')}>Select</button>)}</td>
              </tr>))}</tbody>
          </table>
          {canWork && (
            <div className="form-field" style={{ marginTop: 8 }}>
              <label>Justification — required when the choice is not the lowest complete quotation, or when only one quotation exists</label>
              <textarea rows={2} value={justification} onChange={(e) => setJustification(e.target.value)} />
            </div>
          )}
        </>
      )}
      {requisition.selection_justification && <p className="muted">Selection justification: {requisition.selection_justification}</p>}

      {canWork && selected && (
        <>
          <h4 style={{ margin: '18px 0 8px' }}>Raise purchase order</h4>
          {unmapped.length > 0 && (
            <>
              <p className="muted">Link each requisition line to a stock item so receiving can update inventory.</p>
              <table className="simple-table" style={{ width: '100%' }}>
                <tbody>{unmapped.map((l) => (
                  <tr key={l.id}><td>{l.item_name}</td>
                    <td><select value={mapping[l.id] || ''} onChange={(e) => setMapping({ ...mapping, [l.id]: e.target.value })}>
                      <option value="">Choose stock item…</option>{(products || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></td></tr>))}</tbody>
              </table>
              <button className="btn secondary" disabled={busy || unmapped.some((l) => !mapping[l.id])}
                onClick={() => run(() => client.put(`/procurement/requisitions/${id}/line-products`, { mappings: unmapped.map((l) => ({ line_id: l.id, product_id: Number(mapping[l.id]) })) }), 'Items linked')}>Save links</button>
            </>
          )}
          <div className="toolbar" style={{ marginTop: 8 }}>
            <button className="btn" disabled={busy || unmapped.length > 0}
              onClick={() => run(() => client.post(`/procurement/requisitions/${id}/purchase-order`, {}), 'Purchase order raised — waiting for Operation Manager authorization')}>
              Create purchase order ({money(selected.total_amount)})
            </button>
          </div>
        </>
      )}
    </div>
  );
}
