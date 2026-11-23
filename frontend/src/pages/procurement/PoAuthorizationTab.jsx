import { useState } from 'react';
import { Check, RotateCcw, Ban, Send } from 'lucide-react';
import { useApi } from '../../components/useApi';
import client from '../../api/client';
import { useAuth } from '../../context/AuthContext';

const money = (v) => `$${Number(v || 0).toFixed(2)}`;
const day = (v) => (v ? String(v).slice(0, 10) : '—');
const stamp = (v) => (v ? new Date(v).toLocaleString() : '');
const errText = (e, fallback) => e.response?.data?.error || fallback;
const STATUS_BADGE = { pending_authorization: 'pending', authorized: 'ok', sent: 'info', partially_received: 'info', draft: 'pending' };

// Purchase-order flow: Operation Manager authorization queue + outstanding/delayed orders + send to supplier.
export default function PoAuthorizationTab() {
  const { user } = useAuth();
  const isOps = user?.role === 'Operation Manager' || user?.role === 'Admin';
  const isOfficer = user?.role === 'Procurement Officer' || user?.role === 'Admin';
  const [v, setV] = useState(0);
  const { rows: pending } = useApi(isOps ? '/procurement/po-flow/pending' : null, [v, isOps]);
  const { rows: outstanding } = useApi('/procurement/po-flow/outstanding', [v]);
  const [openId, setOpenId] = useState(null);
  const { rows: detail } = useApi(openId ? `/procurement/po-flow/${openId}` : null, [openId, v]);
  const [comments, setComments] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function act(poId, action, body) {
    setBusy(true); setError(null);
    try { await client.post(`/procurement/po-flow/${poId}/${action}`, body || {}); setComments(''); setV((x) => x + 1); }
    catch (e) { setError(errText(e, 'Action failed')); } finally { setBusy(false); }
  }

  return (
    <div>
      {error && <div className="error-box">{error}</div>}
      {isOps && (
        <div className="card">
          <h3>Waiting for your authorization</h3>
          {!pending?.length ? <p className="muted">Nothing is waiting.</p> : (
            <table className="simple-table" style={{ width: '100%' }}>
              <thead><tr><th>PO #</th><th>Requisition</th><th>Department</th><th>Supplier</th><th>Total</th><th>Raised by</th><th></th></tr></thead>
              <tbody>{pending.map((p) => (
                <tr key={p.id}><td>{p.po_number}</td><td>{p.pr_number || 'direct'}</td><td>{p.department_name || '—'}</td><td>{p.supplier_name}</td>
                  <td>{money(p.total_amount)}</td><td>{p.created_by_name}</td>
                  <td><button className="btn secondary" onClick={() => setOpenId(p.id)}>Review</button></td></tr>))}</tbody>
            </table>
          )}
        </div>
      )}

      {openId && detail && (
        <div className="card">
          <div className="card__header"><h3>{detail.po_number} — {detail.supplier_name}</h3><button className="btn secondary" onClick={() => setOpenId(null)}>Close</button></div>
          <div className="form-grid">
            <div className="form-field"><label>Status</label><span className={`badge badge--${STATUS_BADGE[detail.status] || 'info'}`}>{detail.status}</span></div>
            <div className="form-field"><label>Total</label><span>{money(detail.total_amount)}</span></div>
            <div className="form-field"><label>Expected</label><span>{day(detail.expected_date)}</span></div>
            <div className="form-field"><label>Payment terms</label><span>{detail.payment_terms_days != null ? `${detail.payment_terms_days} days` : '—'}</span></div>
            <div className="form-field"><label>Requisition</label><span>{detail.pr_number ? `${detail.pr_number} — ${detail.requisition_title}` : 'Direct PO'}</span></div>
            <div className="form-field"><label>Raised by</label><span>{detail.created_by_name}</span></div>
            {detail.selection_justification && <div className="form-field" style={{ gridColumn: '1 / -1' }}><label>Supplier selection justification</label><span>{detail.selection_justification}</span></div>}
          </div>
          <table className="simple-table" style={{ width: '100%', margin: '10px 0' }}>
            <thead><tr><th>Item</th><th>Qty</th><th>Unit cost</th><th>Subtotal</th></tr></thead>
            <tbody>{detail.items.map((i) => <tr key={i.id}><td>{i.product_name}</td><td>{Number(i.quantity_ordered)}</td><td>{money(i.unit_cost)}</td><td>{money(i.subtotal)}</td></tr>)}</tbody>
          </table>
          {detail.approvals.length > 0 && (
            <table className="simple-table" style={{ width: '100%' }}>
              <thead><tr><th>When</th><th>Step</th><th>Decision</th><th>By</th><th>Comments</th><th>Signature</th></tr></thead>
              <tbody>{detail.approvals.map((a) => (
                <tr key={a.id}><td>{stamp(a.decided_at)}</td><td>{a.step}</td><td>{a.decision}</td><td>{a.actor_name} <span className="muted">({a.actor_role})</span></td><td>{a.comments || ''}</td>
                  <td title={a.signature_hash}><code>{a.signature_hash?.slice(0, 12)}…</code></td></tr>))}</tbody>
            </table>
          )}
          {isOps && detail.status === 'pending_authorization' && (
            <>
              <div className="form-field" style={{ marginTop: 10 }}><label>Comments (required to reject or return)</label><textarea rows={2} value={comments} onChange={(e) => setComments(e.target.value)} /></div>
              <div className="toolbar">
                <button className="btn" disabled={busy} onClick={() => act(detail.id, 'authorize', { decision: 'approve', comments })}><Check size={13} /> Authorize &amp; sign</button>
                <button className="btn secondary" disabled={busy} onClick={() => act(detail.id, 'authorize', { decision: 'revision', comments })}><RotateCcw size={13} /> Return for revision</button>
                <button className="btn danger" disabled={busy} onClick={() => act(detail.id, 'authorize', { decision: 'reject', comments })}><Ban size={13} /> Reject</button>
              </div>
            </>
          )}
          {isOfficer && detail.status === 'draft' && <div className="toolbar"><button className="btn" disabled={busy} onClick={() => act(detail.id, 'resubmit')}>Resubmit for authorization</button></div>}
          {isOfficer && detail.status === 'authorized' && <div className="toolbar"><button className="btn" disabled={busy} onClick={() => act(detail.id, 'send')}><Send size={13} /> Send to supplier</button></div>}
        </div>
      )}

      <div className="card">
        <h3>Outstanding purchase orders</h3>
        {!outstanding?.length ? <p className="muted">No outstanding orders.</p> : (
          <table className="simple-table" style={{ width: '100%' }}>
            <thead><tr><th>PO #</th><th>Supplier</th><th>Status</th><th>Expected</th><th>Received</th><th>Total</th><th></th></tr></thead>
            <tbody>{outstanding.map((o) => (
              <tr key={o.id}><td>{o.po_number}</td><td>{o.supplier_name}</td><td><span className={`badge badge--${STATUS_BADGE[o.status] || 'info'}`}>{o.status}</span></td>
                <td>{day(o.expected_date)}{o.is_delayed ? <span className="badge badge--cancelled" style={{ marginLeft: 6 }}>{o.days_overdue} d late</span> : ''}</td>
                <td>{Number(o.qty_received)} / {Number(o.qty_ordered)}</td><td>{money(o.total_amount)}</td>
                <td><button className="btn secondary" onClick={() => setOpenId(o.id)}>Open</button></td></tr>))}</tbody>
          </table>
        )}
      </div>
    </div>
  );
}
