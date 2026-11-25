import { useState } from 'react';
import { useApi } from '../../components/useApi';
import Table from '../../components/Table';
import client from '../../api/client';
import { useAuth } from '../../context/AuthContext';

const STORE_ROLES = ['Admin', 'Storekeeper', 'Inventory Manager'];

export default function MaterialIssuesTab() {
  const { user } = useAuth();
  const canIssue = STORE_ROLES.includes(user?.role);
  const canInspectStock = canIssue || user?.role === 'Operation Manager';
  const [version, setVersion] = useState(0);
  const { rows: issues } = useApi('/procurement/issues', [version]);
  const { rows: requisitions } = useApi('/procurement/requisitions', [version]);
  const { rows: warehouses } = useApi(canIssue ? '/warehouses' : null, [canIssue]);
  const [requisitionId, setRequisitionId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [eligible, setEligible] = useState(null);
  const [quantities, setQuantities] = useState({});
  const [notes, setNotes] = useState('');
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function loadRequisition(id) {
    setRequisitionId(id); setEligible(null); setQuantities({}); setError('');
    if (!id || !canInspectStock) return;
    try {
      const res = await client.get('/procurement/issues/issuable/' + id);
      setEligible(res.data.data);
    } catch (e) { setError(e.response?.data?.error || e.message); }
  }

  async function createIssue(e) {
    e.preventDefault(); setError('');
    const lines = (eligible?.lines || []).filter((line) => Number(quantities[line.requisition_line_id]) > 0)
      .map((line) => ({ requisition_line_id: line.requisition_line_id, quantity: Number(quantities[line.requisition_line_id]) }));
    if (!lines.length || !warehouseId) { setError('Select a warehouse and enter at least one quantity to issue.'); return; }
    setBusy(true);
    try {
      await client.post('/procurement/issues', { requisition_id: Number(requisitionId), warehouse_id: Number(warehouseId), notes: notes || null, lines });
      setRequisitionId(''); setWarehouseId(''); setEligible(null); setQuantities({}); setNotes('');
      setVersion((v) => v + 1);
    } catch (e2) { setError(e2.response?.data?.error || e2.message); }
    finally { setBusy(false); }
  }

  async function openIssue(row) {
    setError('');
    try { setDetail((await client.get('/procurement/issues/' + row.id)).data.data); }
    catch (e) { setError(e.response?.data?.error || e.message); }
  }

  async function confirmIssue(decision) {
    let comments = '';
    if (decision === 'dispute') {
      comments = window.prompt('Explain the quantity or condition discrepancy:') || '';
      if (!comments.trim()) return;
    }
    setError(''); setBusy(true);
    try {
      await client.post('/procurement/issues/' + detail.id + '/confirm', { decision, comments: comments || null });
      setDetail((await client.get('/procurement/issues/' + detail.id)).data.data);
      setVersion((v) => v + 1);
    } catch (e) { setError(e.response?.data?.error || e.message); }
    finally { setBusy(false); }
  }

  const eligibleRequisitions = (requisitions || []).filter((r) => ['po_issued', 'fulfilled'].includes(r.status));
  const issueColumns = [
    { key: 'issue_number', header: 'Issue No.' },
    { key: 'pr_number', header: 'Requisition' },
    { key: 'department_name', header: 'Department' },
    { key: 'warehouse_name', header: 'Warehouse' },
    { key: 'issued_by_name', header: 'Issued By' },
    { key: 'issued_at', header: 'Date', render: (r) => new Date(r.issued_at).toLocaleDateString() },
    { key: 'status', header: 'Status' },
    { key: 'open', header: '', render: (r) => <button className="btn secondary" onClick={() => openIssue(r)}>View / Confirm</button> }
  ];

  return <div>
    {error && <div className="alert alert--error" role="alert">{error}</div>}
    {canIssue && <form className="card" onSubmit={createIssue} style={{ marginBottom: 14 }}>
      <h3>Issue Accepted Materials to a Department</h3>
      <div className="form-grid">
        <div className="form-field"><label>Approved Requisition</label>
          <select value={requisitionId} onChange={(e) => loadRequisition(e.target.value)} required>
            <option value="">Select requisition…</option>
            {eligibleRequisitions.map((r) => <option key={r.id} value={r.id}>{r.pr_number} · {r.title} · {r.status}</option>)}
          </select>
        </div>
        <div className="form-field"><label>Warehouse</label>
          <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} required>
            <option value="">Select warehouse…</option>{(warehouses || []).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </div>
      </div>
      {eligible?.lines?.filter((l) => l.product_id && l.available_to_issue > 0).map((line) =>
        <div key={line.requisition_line_id} style={{ display: 'grid', gridTemplateColumns: '2fr repeat(5,1fr)', gap: 8, alignItems: 'center', margin: '8px 0' }}>
          <span>{line.item_name} ({line.unit})</span>
          <span>Requested: {line.requested}</span><span>Accepted: {line.accepted}</span>
          <span>Issued: {line.issued}</span><span>Available: {line.available_to_issue}</span>
          <input aria-label={'Issue quantity ' + line.item_name} type="number" min="0" max={line.available_to_issue} step="0.001"
            value={quantities[line.requisition_line_id] || ''} onChange={(e) => setQuantities((q) => ({ ...q, [line.requisition_line_id]: e.target.value }))} />
        </div>
      )}
      {eligible && <p className="muted">Only accepted stock can be issued. The recipient must confirm or dispute receipt; disputed issues are reversed in stock and the ledger.</p>}
      <div className="form-field"><label>Notes</label><input value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
      <button className="btn" disabled={busy || !eligible}>{busy ? 'Processing…' : 'Issue Materials'}</button>
    </form>}

    <section className="card">
      <h3>Material Issue History & Confirmations</h3>
      <Table columns={issueColumns} rows={issues || []} searchable searchPlaceholder="Search issue, requisition, department…" sortable pageSize={12} emptyText="No material issues found." />
    </section>

    {detail && <div className="modal-backdrop" onClick={() => setDetail(null)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="page-header"><h2>{detail.issue_number} · {detail.department_name}</h2><button className="btn secondary" onClick={() => setDetail(null)}>Close</button></div>
        <p>{detail.pr_number} · {detail.title} · {detail.warehouse_name} · {detail.status}</p>
        <Table columns={[
          { key: 'item_name', header: 'Item' }, { key: 'product_name', header: 'Stock Product' },
          { key: 'quantity', header: 'Issued Qty' }, { key: 'unit', header: 'Unit' }, { key: 'unit_cost', header: 'Unit Cost' }
        ]} rows={detail.items || []} />
        {detail.can_confirm && <div className="toolbar" style={{ marginTop: 12 }}>
          <button className="btn" disabled={busy} onClick={() => confirmIssue('confirm')}>Confirm Receipt</button>
          <button className="btn danger" disabled={busy} onClick={() => confirmIssue('dispute')}>Dispute & Return</button>
        </div>}
        {detail.confirm_notes && <p><strong>Confirmation note:</strong> {detail.confirm_notes}</p>}
      </div>
    </div>}
  </div>;
}
