import { useMemo, useRef, useState } from 'react';
import { ClipboardList, Plus, X, Paperclip, Send, Check, RotateCcw, Ban } from 'lucide-react';
import { useApi } from '../../components/useApi';
import client from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import SourcingPanel from './SourcingPanel';

const STATUS_LABEL = {
  draft: 'Draft', submitted: 'Waiting for Department Head', returned_for_revision: 'Returned for revision',
  rejected: 'Rejected', dept_approved: 'Waiting for Operation Manager', approved: 'Approved',
  sourcing: 'Sourcing', po_issued: 'PO issued', fulfilled: 'Fulfilled', closed: 'Closed', cancelled: 'Cancelled'
};
const STATUS_BADGE = {
  draft: 'info', submitted: 'pending', returned_for_revision: 'pending', rejected: 'cancelled', dept_approved: 'pending',
  approved: 'ok', sourcing: 'info', po_issued: 'info', fulfilled: 'ok', closed: 'ok', cancelled: 'cancelled'
};
const STEP_LABEL = { submission: 'Submission', dept_review: 'Department review', ops_approval: 'Operation Manager approval', assignment: 'Assignment', supplier_selection: 'Supplier selection', po_submission: 'PO submission', po_authorization: 'PO authorization' };
const DECISION_LABEL = { submitted: 'Submitted', approved: 'Approved', rejected: 'Rejected', revision_requested: 'Revision requested', assigned: 'Assigned', authorized: 'Authorized', cancelled: 'Cancelled' };
const money = (v) => `$${Number(v || 0).toFixed(2)}`;
const day = (v) => (v ? String(v).slice(0, 10) : '—');
const stamp = (v) => (v ? new Date(v).toLocaleString() : '');
const errText = (e, fallback) => e.response?.data?.error || fallback;

const blankLine = () => ({ item_name: '', description: '', quantity: '', unit: '', estimated_unit_cost: '' });

// ------------------------------------------------------------------ create / edit form
function RequisitionForm({ initial, onSaved, onCancel }) {
  const { rows: products } = useApi('/products');
  const [title, setTitle] = useState(initial?.title || '');
  const [justification, setJustification] = useState(initial?.justification || '');
  const [priority, setPriority] = useState(initial?.priority || 'normal');
  const [requiredDate, setRequiredDate] = useState(initial?.required_date ? String(initial.required_date).slice(0, 10) : '');
  const [lines, setLines] = useState(initial?.lines?.length
    ? initial.lines.map((l) => ({ product_id: l.product_id, item_name: l.item_name, description: l.description || '', quantity: String(l.quantity), unit: l.unit, estimated_unit_cost: String(l.estimated_unit_cost) }))
    : [blankLine()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const total = useMemo(() => lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.estimated_unit_cost) || 0), 0), [lines]);
  const setLine = (i, patch) => setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  function onItemName(i, name) {
    const p = (products || []).find((x) => x.name.toLowerCase() === name.trim().toLowerCase());
    setLine(i, p ? { item_name: name, product_id: p.id, unit: lines[i].unit || p.unit || '', estimated_unit_cost: lines[i].estimated_unit_cost || String(p.unit_cost || '') } : { item_name: name, product_id: null });
  }

  async function save(submit) {
    setBusy(true); setError(null);
    const body = {
      title, justification, priority, required_date: requiredDate || null,
      lines: lines.map((l) => ({ product_id: l.product_id || null, item_name: l.item_name, description: l.description || null, quantity: Number(l.quantity), unit: l.unit, estimated_unit_cost: Number(l.estimated_unit_cost) || 0 }))
    };
    try {
      let id = initial?.id;
      if (id) {
        await client.put(`/procurement/requisitions/${id}`, body);
        if (submit) await client.post(`/procurement/requisitions/${id}/submit`);
      } else {
        const { data } = await client.post('/procurement/requisitions', { ...body, submit });
        id = data.data.id;
      }
      onSaved(id);
    } catch (e) { setError(errText(e, 'Could not save the requisition')); } finally { setBusy(false); }
  }

  return (
    <div className="card">
      <div className="card__header">
        <h3>{initial ? `Edit ${initial.pr_number}` : 'New Purchase Requisition'}</h3>
        <button className="btn secondary" onClick={onCancel}><X size={13} /> Close</button>
      </div>
      {error && <div className="error-box">{error}</div>}
      <div className="form-grid" style={{ marginBottom: 14 }}>
        <div className="form-field" style={{ gridColumn: '1 / -1' }}><label>Title</label><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Replacement pump for line 2" /></div>
        <div className="form-field"><label>Priority</label>
          <select value={priority} onChange={(e) => setPriority(e.target.value)}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select>
        </div>
        <div className="form-field"><label>Required by</label><input type="date" value={requiredDate} onChange={(e) => setRequiredDate(e.target.value)} /></div>
        <div className="form-field" style={{ gridColumn: '1 / -1' }}><label>Justification</label><textarea rows={3} value={justification} onChange={(e) => setJustification(e.target.value)} placeholder="Why is this needed?" /></div>
      </div>
      <h4 style={{ margin: '4px 0 8px' }}>Items</h4>
      <datalist id="pr-products">{(products || []).map((p) => <option key={p.id} value={p.name} />)}</datalist>
      <div style={{ overflowX: 'auto' }}>
        <table className="simple-table" style={{ width: '100%', minWidth: 760 }}>
          <thead><tr><th>#</th><th>Item (pick a stock item or type)</th><th>Description</th><th>Qty</th><th>Unit</th><th>Est. unit cost</th><th>Line total</th><th /></tr></thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td>{i + 1}</td>
                <td><input list="pr-products" value={l.item_name} onChange={(e) => onItemName(i, e.target.value)} /></td>
                <td><input value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} /></td>
                <td><input type="number" min="0" step="any" style={{ width: 90 }} value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} /></td>
                <td><input style={{ width: 80 }} value={l.unit} onChange={(e) => setLine(i, { unit: e.target.value })} /></td>
                <td><input type="number" min="0" step="any" style={{ width: 110 }} value={l.estimated_unit_cost} onChange={(e) => setLine(i, { estimated_unit_cost: e.target.value })} /></td>
                <td>{money((Number(l.quantity) || 0) * (Number(l.estimated_unit_cost) || 0))}</td>
                <td>{lines.length > 1 && <button className="btn secondary" onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))} aria-label="Remove line"><X size={13} /></button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="toolbar" style={{ marginTop: 10 }}>
        <button className="btn secondary" onClick={() => setLines((ls) => [...ls, blankLine()])}><Plus size={13} /> Add item</button>
        <strong style={{ marginLeft: 'auto' }}>Estimated total: {money(total)}</strong>
      </div>
      <div className="toolbar">
        <button className="btn secondary" disabled={busy} onClick={() => save(false)}>Save draft</button>
        <button className="btn" disabled={busy} onClick={() => save(true)}><Send size={13} /> Submit for review</button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ detail + actions
function RequisitionDetail({ id, onBack, onEdit }) {
  const { user } = useAuth();
  const [version, setVersion] = useState(0);
  const { rows: pr, error: loadError } = useApi(`/procurement/requisitions/${id}`, [id, version]);
  const a = pr?.actions || {};
  const { rows: officers } = useApi(a.can_assign ? '/procurement/requisitions/meta/officers' : null, [a.can_assign]);
  const [comments, setComments] = useState('');
  const [assignee, setAssignee] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const fileRef = useRef(null);

  async function act(path, body, okMessage) {
    setBusy(true); setError(null);
    try { await client.post(`/procurement/requisitions/${id}/${path}`, body || {}); setComments(''); setVersion((v) => v + 1); }
    catch (e) { setError(errText(e, okMessage || 'Action failed')); } finally { setBusy(false); }
  }
  async function upload(e) {
    const file = e.target.files?.[0]; if (!file) return;
    const form = new FormData(); form.append('file', file);
    setBusy(true); setError(null);
    try { await client.post(`/procurement/requisitions/${id}/attachments`, form); setVersion((v) => v + 1); }
    catch (err) { setError(errText(err, 'Upload failed')); } finally { setBusy(false); if (fileRef.current) fileRef.current.value = ''; }
  }
  async function download(att) {
    try {
      const res = await client.get(`/procurement/requisitions/${id}/attachments/${att.id}`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data); const link = document.createElement('a');
      link.href = url; link.download = att.file_name; link.click(); URL.revokeObjectURL(url);
    } catch (err) { setError(errText(err, 'Download failed')); }
  }

  if (loadError) return <div className="card"><div className="error-box">{loadError}</div><button className="btn secondary" onClick={onBack}>Back</button></div>;
  if (!pr) return <p className="muted">Loading…</p>;

  return (
    <div className="card">
      <div className="card__header">
        <h3>{pr.pr_number} — {pr.title}</h3>
        <button className="btn secondary" onClick={onBack}><X size={13} /> Back to list</button>
      </div>
      {error && <div className="error-box">{error}</div>}
      <div className="form-grid" style={{ marginBottom: 14 }}>
        <div className="form-field"><label>Status</label><span className={`badge badge--${STATUS_BADGE[pr.status]}`}>{STATUS_LABEL[pr.status]}</span></div>
        <div className="form-field"><label>Department</label><span>{pr.department_name}</span></div>
        <div className="form-field"><label>Requested by</label><span>{pr.requester_name}</span></div>
        <div className="form-field"><label>Priority</label><span style={{ textTransform: 'capitalize' }}>{pr.priority}</span></div>
        <div className="form-field"><label>Required by</label><span>{day(pr.required_date)}</span></div>
        <div className="form-field"><label>Estimated total</label><span>{money(pr.estimated_total)}</span></div>
        <div className="form-field"><label>Procurement Officer</label><span>{pr.assigned_name || '—'}</span></div>
        <div className="form-field"><label>Version</label><span>{pr.version}</span></div>
        <div className="form-field" style={{ gridColumn: '1 / -1' }}><label>Justification</label><span>{pr.justification}</span></div>
      </div>

      <h4 style={{ margin: '4px 0 8px' }}>Items</h4>
      <table className="simple-table" style={{ width: '100%' }}>
        <thead><tr><th>#</th><th>Item</th><th>Description</th><th>Qty</th><th>Unit</th><th>Est. unit cost</th><th>Line total</th></tr></thead>
        <tbody>{pr.lines.map((l) => (
          <tr key={l.id}><td>{l.line_no}</td><td>{l.item_name}{l.product_name ? <span className="muted"> · stock item</span> : ''}</td><td>{l.description || ''}</td>
            <td>{Number(l.quantity)}</td><td>{l.unit}</td><td>{money(l.estimated_unit_cost)}</td><td>{money(l.estimated_total)}</td></tr>))}</tbody>
      </table>

      <h4 style={{ margin: '18px 0 8px' }}>Approval history</h4>
      {pr.approvals.length === 0 ? <p className="muted">No decisions yet.</p> : (
        <table className="simple-table" style={{ width: '100%' }}>
          <thead><tr><th>When</th><th>Step</th><th>Decision</th><th>By</th><th>Comments</th><th>Signature</th></tr></thead>
          <tbody>{pr.approvals.map((x) => (
            <tr key={x.id}><td>{stamp(x.decided_at)}</td><td>{STEP_LABEL[x.step] || x.step}</td><td>{DECISION_LABEL[x.decision] || x.decision}</td>
              <td>{x.actor_name} <span className="muted">({x.actor_role})</span></td><td>{x.comments || ''}</td><td title={x.signature_hash}><code>{x.signature_hash?.slice(0, 12)}…</code></td></tr>))}</tbody>
        </table>
      )}

      {['sourcing', 'po_issued'].includes(pr.status) && <SourcingPanel requisition={pr} onChanged={() => setVersion((x) => x + 1)} />}

      <h4 style={{ margin: '18px 0 8px' }}>Attachments</h4>
      {pr.attachments.length === 0 ? <p className="muted">None.</p> : (
        <ul style={{ margin: 0, paddingLeft: 18 }}>{pr.attachments.map((x) => (
          <li key={x.id}><button className="btn secondary" style={{ padding: '2px 8px' }} onClick={() => download(x)}><Paperclip size={12} /> {x.file_name}</button> <span className="muted">{Math.round(x.file_size / 1024)} KB · {x.uploaded_by_name} · {stamp(x.uploaded_at)}</span></li>))}</ul>
      )}
      {a.can_attach && (
        <div className="toolbar" style={{ marginTop: 8 }}>
          <input ref={fileRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.txt,.docx,.xlsx" onChange={upload} disabled={busy} />
          <span className="muted">PDF, image, TXT, DOCX or XLSX, up to 5 MB</span>
        </div>
      )}

      <div style={{ marginTop: 18 }}>
        {(a.can_review || a.can_approve) && (
          <>
            <div className="form-field"><label>{a.can_review ? 'Department review' : 'Operation Manager approval'} — comments (required to reject or request a revision)</label>
              <textarea rows={2} value={comments} onChange={(e) => setComments(e.target.value)} /></div>
            <div className="toolbar">
              <button className="btn" disabled={busy} onClick={() => act(a.can_review ? 'review' : 'approve', { decision: 'approve', comments })}><Check size={13} /> Approve{a.can_approve ? ' & sign' : ''}</button>
              <button className="btn secondary" disabled={busy} onClick={() => act(a.can_review ? 'review' : 'approve', { decision: 'revision', comments })}><RotateCcw size={13} /> Request revision</button>
              <button className="btn danger" disabled={busy} onClick={() => act(a.can_review ? 'review' : 'approve', { decision: 'reject', comments })}><Ban size={13} /> Reject</button>
            </div>
          </>
        )}
        {a.can_assign && (
          <div className="toolbar">
            <select value={assignee} onChange={(e) => setAssignee(e.target.value)}><option value="">Assign to a Procurement Officer…</option>{(officers || []).map((o) => <option key={o.id} value={o.id}>{o.full_name}</option>)}</select>
            <button className="btn" disabled={busy || !assignee} onClick={() => act('assign', { assigned_to: Number(assignee) })}>Assign for sourcing</button>
          </div>
        )}
        <div className="toolbar">
          {a.can_edit && <button className="btn secondary" onClick={() => onEdit(pr)}>Edit</button>}
          {a.can_submit && <button className="btn" disabled={busy} onClick={() => act('submit')}><Send size={13} /> Submit for review</button>}
          {a.can_cancel && <button className="btn danger" disabled={busy} onClick={() => { if (window.confirm('Cancel this requisition?')) act('cancel', { comments }); }}>Cancel requisition</button>}
        </div>
      </div>
      <p className="muted" style={{ marginTop: 10 }}>Signed in as {user?.fullName} ({user?.role}). You only see requisitions you raised, your department's (if you are its head), or those at a stage your role handles.</p>
    </div>
  );
}

// ------------------------------------------------------------------ page
export default function RequisitionsPage() {
  const [view, setView] = useState({ name: 'list' });
  const [filter, setFilter] = useState('pending');
  const [tick, setTick] = useState(0);
  const query = filter === 'mine' ? '?mine=1' : filter === 'pending' ? '?pending=1' : '';
  const { rows, loading, error } = useApi(`/procurement/requisitions${query}`, [filter, tick, view.name]);

  const back = () => { setTick((t) => t + 1); setView({ name: 'list' }); };
  if (view.name === 'new') return <RequisitionForm onCancel={back} onSaved={(id) => { setTick((t) => t + 1); setView({ name: 'detail', id }); }} />;
  if (view.name === 'edit') return <RequisitionForm initial={view.pr} onCancel={() => setView({ name: 'detail', id: view.pr.id })} onSaved={(id) => { setTick((t) => t + 1); setView({ name: 'detail', id }); }} />;
  if (view.name === 'detail') return <RequisitionDetail id={view.id} onBack={back} onEdit={(pr) => setView({ name: 'edit', pr })} />;

  return (
    <div>
      <div className="page-header">
        <h1><ClipboardList size={22} color="var(--primary)" /> Purchase Requisitions</h1>
        <button className="btn" onClick={() => setView({ name: 'new' })}><Plus size={14} /> New requisition</button>
      </div>
      <div className="toolbar">
        {[['pending', 'Needs my action'], ['mine', 'My requests'], ['all', 'Everything I can see']].map(([k, label]) => (
          <button key={k} className={`btn ${filter === k ? '' : 'secondary'}`} onClick={() => setFilter(k)}>{label}</button>))}
      </div>
      <div className="card">
        {error && <div className="error-box">{error}</div>}
        {loading ? <p className="muted">Loading…</p> : !rows?.length ? <p className="muted">Nothing here yet.</p> : (
          <table className="simple-table" style={{ width: '100%' }}>
            <thead><tr><th>PR</th><th>Title</th><th>Department</th><th>Requested by</th><th>Priority</th><th>Required</th><th>Est. total</th><th>Status</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => setView({ name: 'detail', id: r.id })}>
                <td><strong>{r.pr_number}</strong></td><td>{r.title}</td><td>{r.department_name}</td><td>{r.requester_name}</td>
                <td style={{ textTransform: 'capitalize' }}>{r.priority}</td><td>{day(r.required_date)}</td><td>{money(r.estimated_total)}</td>
                <td><span className={`badge badge--${STATUS_BADGE[r.status]}`}>{STATUS_LABEL[r.status]}</span></td></tr>))}</tbody>
          </table>
        )}
      </div>
    </div>
  );
}
