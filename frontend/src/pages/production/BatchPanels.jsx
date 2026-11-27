import { useEffect, useMemo, useState } from 'react';
import { X, AlertCircle, CheckCircle2, XCircle } from 'lucide-react';
import client from '../../api/client';

// Panels used by Production Orders: one for completing a batch, one for the independent output decision.
// They replace the inline row inputs and the browser prompt; the server rules are unchanged (BOM consumption,
// QC, a different authorized user approves the output, a reason is required).

function fmt(n) { return Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 3 }); }

function Panel({ title, subtitle, onClose, children, label }) {
  return (
    <div role="dialog" aria-modal="true" aria-label={label || title}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
      <div className="card" style={{ width: 'min(640px, 96vw)', maxHeight: '92vh', overflowY: 'auto' }}>
        <div className="card__header">
          <div><h3 style={{ margin: 0 }}>{title}</h3>{subtitle && <p className="muted" style={{ margin: '4px 0 0' }}>{subtitle}</p>}</div>
          <button className="btn-icon" onClick={onClose} aria-label="Close"><X size={14} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Summary({ items }) {
  return (
    <dl style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '6px 16px', margin: '0 0 14px' }}>
      {items.filter(Boolean).map(([k, v]) => (
        <div key={k} style={{ display: 'contents' }}><dt className="muted">{k}</dt><dd style={{ margin: 0, fontWeight: 500 }}>{v}</dd></div>
      ))}
    </dl>
  );
}

export function CompleteBatchPanel({ batch, warehouses, onClose, onDone }) {
  const [actual, setActual] = useState('');
  const [wastage, setWastage] = useState('');
  const [wastageNotes, setWastageNotes] = useState('');
  const [varianceNotes, setVarianceNotes] = useState('');
  const [materialsWh, setMaterialsWh] = useState('');
  const [qc, setQc] = useState('');
  const [bom, setBom] = useState({ loading: true, items: [] });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const rawWarehouses = (warehouses || []).filter((w) => w.is_active && w.type === 'raw_material');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!batch.product_id) { setBom({ loading: false, items: [] }); return; }
      try {
        const list = (await client.get('/production/bom')).data.data || [];
        const active = list.find((b) => Number(b.product_id) === Number(batch.product_id) && b.is_active);
        if (!active) { if (!cancelled) setBom({ loading: false, items: [] }); return; }
        const detail = (await client.get(`/production/bom/${active.id}`)).data.data || {};
        if (!cancelled) setBom({ loading: false, name: active.name, items: detail.items || [] });
      } catch (_) { if (!cancelled) setBom({ loading: false, items: [], failed: true }); }
    })();
    return () => { cancelled = true; };
  }, [batch.product_id]);

  const units = (Number(actual) || 0) + (Number(wastage) || 0);
  const planned = Number(batch.planned_qty) || 0;
  const differs = actual !== '' && planned > 0 && Number(actual) !== planned;
  const blockedReason = !batch.product_id
    ? 'This batch has no Output Product. Use Edit to choose one before completing it.'
    : (!bom.loading && !bom.items.length ? 'This product has no active Bill of Materials, so materials cannot be deducted. Create a BOM first (Production → Bill of Materials).' : null);

  const preview = useMemo(() => bom.items.map((i) => ({ ...i, total: Number(i.quantity_per_unit) * units })), [bom.items, units]);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    if (blockedReason) return;
    if (!(Number(actual) >= 0) || actual === '') { setError('Enter the actual quantity produced.'); return; }
    if (Number(wastage) < 0) { setError('Wastage cannot be negative.'); return; }
    if (!materialsWh) { setError('Choose the raw-material warehouse the materials come from.'); return; }
    if (!qc) { setError('Choose the QC result: Passed or Failed.'); return; }
    setBusy(true);
    try {
      await client.put(`/production/batches/${batch.id}/complete`, {
        actual_qty: Number(actual), wastage_qty: Number(wastage) || 0,
        wastage_notes: wastageNotes || undefined, variance_notes: varianceNotes || undefined,
        materials_warehouse_id: Number(materialsWh), qc_status: qc
      });
      onDone(qc === 'passed'
        ? `${batch.batch_number} completed. The output now waits for another Production Manager to approve it into stock.`
        : `${batch.batch_number} completed with QC failed. No finished goods were added to stock.`);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not complete this batch.');
    } finally { setBusy(false); }
  }

  return (
    <Panel title={`Complete ${batch.batch_number}`} subtitle={`${batch.product_name || 'No output product'} · ${batch.machine_name || ''}`} onClose={onClose} label="Complete batch">
      <Summary items={[['Planned', `${fmt(planned)} ${batch.unit || ''}`], ['Finished goods to', batch.destination_warehouse_name || '—']]} />
      {blockedReason && <div className="error-box" role="alert"><AlertCircle size={15} /> {blockedReason}</div>}
      <form onSubmit={submit}>
        {error && <div className="error-box" role="alert"><AlertCircle size={15} /> {error}</div>}
        <div className="form-grid">
          <div className="form-field"><label htmlFor="cb-actual">Actual quantity produced ({batch.unit})</label>
            <input id="cb-actual" type="number" min="0" step="0.001" value={actual} onChange={(e) => setActual(e.target.value)} disabled={!!blockedReason} /></div>
          <div className="form-field"><label htmlFor="cb-wastage">Wastage ({batch.unit})</label>
            <input id="cb-wastage" type="number" min="0" step="0.001" value={wastage} onChange={(e) => setWastage(e.target.value)} disabled={!!blockedReason} /></div>
          <div className="form-field span-2"><label htmlFor="cb-wnotes">Wastage reason</label>
            <input id="cb-wnotes" value={wastageNotes} onChange={(e) => setWastageNotes(e.target.value)} placeholder="e.g. bottles broken at the filler" disabled={!!blockedReason} /></div>
          {differs && <div className="form-field span-2"><label htmlFor="cb-vnotes">Why is the actual different from the plan?</label>
            <input id="cb-vnotes" value={varianceNotes} onChange={(e) => setVarianceNotes(e.target.value)} /></div>}
          <div className="form-field"><label htmlFor="cb-wh">Materials taken from</label>
            <select id="cb-wh" value={materialsWh} onChange={(e) => setMaterialsWh(e.target.value)} disabled={!!blockedReason}>
              <option value="">Choose a raw-material warehouse…</option>
              {rawWarehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select></div>
          <div className="form-field"><label>QC result</label>
            <div style={{ display: 'flex', gap: 16, alignItems: 'center', minHeight: 38 }}>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontWeight: 400 }}><input type="radio" name="qc" value="passed" checked={qc === 'passed'} onChange={() => setQc('passed')} disabled={!!blockedReason} /> Passed</label>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontWeight: 400 }}><input type="radio" name="qc" value="failed" checked={qc === 'failed'} onChange={() => setQc('failed')} disabled={!!blockedReason} /> Failed</label>
            </div></div>
        </div>
        {qc === 'failed' && <p style={{ color: 'var(--danger)', fontSize: 12 }}>QC failed: the batch is completed and materials are deducted, but no finished goods enter stock.</p>}

        {!blockedReason && bom.items.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <h4 style={{ margin: '8px 0' }}>Materials that will be deducted <span className="muted" style={{ fontWeight: 400 }}>(BOM {bom.name} × {fmt(units)} {batch.unit})</span></h4>
            <table className="table" aria-label="Materials to deduct">
              <thead><tr><th>Material</th><th>Per unit</th><th>Total</th></tr></thead>
              <tbody>{preview.map((i) => <tr key={i.raw_material_product_id}><td>{i.raw_material_name}</td><td>{fmt(i.quantity_per_unit)} {i.unit}</td><td><strong>{fmt(i.total)} {i.unit}</strong></td></tr>)}</tbody>
            </table>
          </div>
        )}

        <div className="form-actions">
          <button className="btn" type="submit" disabled={busy || !!blockedReason}>{busy ? 'Completing…' : 'Complete batch'}</button>
          <button className="btn secondary" type="button" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Panel>
  );
}

export function OutputDecisionPanel({ batch, me, onClose, onDone }) {
  const [materials, setMaterials] = useState(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const ownBatch = Number(batch.completed_by || batch.supervisor_id) === Number(me?.id) && me?.role !== 'Admin';

  useEffect(() => {
    let cancelled = false;
    client.get(`/production/batches/${batch.id}/materials`)
      .then((r) => { if (!cancelled) setMaterials(r.data.data || []); })
      .catch(() => { if (!cancelled) setMaterials([]); });
    return () => { cancelled = true; };
  }, [batch.id]);

  async function decide(decision) {
    setError(null);
    if (reason.trim().length < 3) { setError('Write a reason of at least 3 characters.'); return; }
    setBusy(true);
    try {
      await client.post(`/production/batches/${batch.id}/output-decision`, { decision, reason: reason.trim() });
      onDone(decision === 'approve'
        ? `${batch.batch_number} approved: ${fmt(batch.actual_qty)} ${batch.unit} added to ${batch.destination_warehouse_name || 'the finished-goods warehouse'}.`
        : `${batch.batch_number} rejected: no finished goods were added to stock.`);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not record the decision.');
    } finally { setBusy(false); }
  }

  return (
    <Panel title={`Review output · ${batch.batch_number}`} subtitle="Approve to add the output to stock, or reject it." onClose={onClose} label="Review output">
      <Summary items={[
        ['Product', batch.product_name || '—'],
        ['Produced', `${fmt(batch.actual_qty)} ${batch.unit} (planned ${fmt(batch.planned_qty)})`],
        ['Wastage', Number(batch.wastage_qty) > 0 ? `${fmt(batch.wastage_qty)} ${batch.unit}${batch.wastage_notes ? ` — ${batch.wastage_notes}` : ''}` : 'None'],
        batch.variance_notes && ['Variance reason', batch.variance_notes],
        ['QC', 'Passed'],
        ['Goes to', batch.destination_warehouse_name || '—'],
        ['Completed by', batch.completed_by_name || batch.supervisor_name || '—']
      ]} />
      <h4 style={{ margin: '4px 0 8px' }}>Materials used</h4>
      {materials === null ? <p className="muted">Loading…</p> : materials.length === 0 ? <p className="muted">No materials recorded.</p> : (
        <table className="table" aria-label="Materials used">
          <thead><tr><th>Material</th><th>Quantity</th><th>From</th></tr></thead>
          <tbody>{materials.map((m) => <tr key={`${m.product_id}-${m.warehouse_name}`}><td>{m.product_name}</td><td>{fmt(m.quantity_used)} {m.unit}</td><td>{m.warehouse_name || '—'}</td></tr>)}</tbody>
        </table>
      )}
      {ownBatch ? (
        <div className="error-box" role="alert" style={{ marginTop: 12 }}><AlertCircle size={15} /> You completed this batch, so another Production Manager must decide its output.</div>
      ) : (
        <>
          {error && <div className="error-box" role="alert" style={{ marginTop: 12 }}><AlertCircle size={15} /> {error}</div>}
          <div className="form-field" style={{ marginTop: 12 }}><label htmlFor="od-reason">Reason (required)</label>
            <textarea id="od-reason" rows="3" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. counted 700 boxes on the pallet, QC sheet signed" /></div>
          <div className="form-actions">
            <button className="btn" type="button" disabled={busy} onClick={() => decide('approve')}><CheckCircle2 size={15} /> Approve into stock</button>
            <button className="btn secondary" type="button" disabled={busy} onClick={() => decide('reject')}><XCircle size={15} /> Reject output</button>
            <button className="btn secondary" type="button" onClick={onClose}>Cancel</button>
          </div>
        </>
      )}
    </Panel>
  );
}
