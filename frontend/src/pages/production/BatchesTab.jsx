import { useState } from 'react';
import { Plus, X, CheckCircle2, AlertCircle, Pencil, Trash2, Play, PackageCheck, RotateCcw, ClipboardCheck } from 'lucide-react';
import { useApi } from '../../components/useApi';
import Table from '../../components/Table';
import client from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { CompleteBatchPanel, OutputDecisionPanel } from './BatchPanels';

const TYPE_LABEL = { RO_WATER: 'RO Water', BOTTLING: 'Bottling', ICE: 'Ice' };
// One plain-language state per batch instead of three separate status columns.
export function batchState(b) {
  if (b.status === 'planned') return ['Planned', 'pending'];
  if (b.status === 'in_progress') return ['In progress', 'info'];
  if (b.status === 'reversed') return ['Reversed', 'low'];
  if (b.status === 'cancelled') return ['Cancelled', 'low'];
  if (b.qc_status === 'failed') return ['QC failed, no stock', 'low'];
  if (b.output_approval_status === 'pending') return ['Awaiting approval', 'pending'];
  if (b.output_approval_status === 'approved') return ['In stock', 'ok'];
  if (b.output_approval_status === 'rejected') return ['Output rejected', 'low'];
  return ['Completed', 'ok'];
}
const TEST_BATCH = /^(TST|E2E)-/i;
const DEFAULT_UNIT = { RO_WATER: 'm³', BOTTLING: 'box', ICE: 'kg' };

function emptyForm(productionType) {
  return { batch_number: '', production_type: productionType || 'BOTTLING', machine_id: '', product_id: '', planned_qty: '', unit: DEFAULT_UNIT[productionType] || 'box', shift: 'Morning', destination_warehouse_id: '' };
}

// `productionType`, when given, scopes this entire tab to one production line (RO
// Water / Bottled Water / Ice) — same list endpoint, just with the existing
// ?production_type= filter applied, and the create form's type field locked instead
// of shown as a picker. Omitting the prop (the "Production Orders" section) shows
// every batch across all three lines with the full type picker, exactly as before.
export default function BatchesTab({ productionType }) {
  const { user } = useAuth();
  const canManage = ['Admin', 'Production Manager'].includes(user?.role);
  const { rows, reload } = useApi(productionType ? `/production/batches?production_type=${productionType}` : '/production/batches');
  const { rows: machines } = useApi('/production/machines');
  const { rows: products } = useApi('/products?type=finished_good');
  const { rows: warehouses } = useApi('/warehouses');
  const [form, setForm] = useState(emptyForm(productionType));
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [completing, setCompleting] = useState(null);
  const [deciding, setDeciding] = useState(null);
  const [view, setView] = useState(canManage ? 'mine' : 'all');
  const [hideTest, setHideTest] = useState(true);
  const needsMe = (b) => b.status === 'planned' || b.status === 'in_progress'
    || (b.output_approval_status === 'pending' && (Number(b.completed_by || b.supervisor_id) !== Number(user?.id) || user?.role === 'Admin'));
  const shown = (rows || []).filter((b) => (!hideTest || !TEST_BATCH.test(b.batch_number || '')) && (view === 'all' || needsMe(b)));

  function flashSuccess(msg) { setSuccess(msg); setTimeout(() => setSuccess(null), 4000); }

  async function handleCreate(e) {
    e.preventDefault();
    setError(null);
    try {
      if (editingId) {
        await client.put(`/production/batches/${editingId}`, form);
        flashSuccess('Batch updated.');
      } else {
        await client.post('/production/batches', form);
        flashSuccess('Batch created.');
      }
      setForm(emptyForm(productionType));
      setShowForm(false);
      setEditingId(null);
      reload();
    } catch (err) {
      setError(err.response?.data?.error || `Failed to ${editingId ? 'update' : 'create'} batch`);
    }
  }

  function startEdit(b) {
    setForm({
      batch_number: b.batch_number, production_type: b.production_type, machine_id: String(b.machine_id),
      product_id: b.product_id ? String(b.product_id) : '', planned_qty: String(b.planned_qty), unit: b.unit,
      shift: b.shift || 'Morning', destination_warehouse_id: b.destination_warehouse_id ? String(b.destination_warehouse_id) : ''
    });
    setEditingId(b.id);
    setError(null);
    setShowForm(true);
  }

  async function deleteBatch(b) {
    if (!window.confirm(`Delete batch ${b.batch_number}? This cannot be undone.`)) return;
    await client.delete(`/production/batches/${b.id}`);
    reload();
  }

  async function reverseBatch(b) {
    const reason = window.prompt(`Reverse Adjustment for ${b.batch_number}? This returns consumed materials and removes the output from stock. Reason (optional):`);
    if (reason === null) return;
    try {
      await client.post(`/production/batches/${b.id}/reverse`, { reason: reason || undefined });
      reload();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to reverse batch');
    }
  }

  async function startBatch(id) {
    await client.put(`/production/batches/${id}/start`);
    reload();
  }

  function panelDone(msg) { setCompleting(null); setDeciding(null); flashSuccess(msg); reload(); }

  return (
    <div>
      {success && <div className="success-box"><CheckCircle2 size={15} /> {success}</div>}
      <div className="toolbar">
        {canManage && <button className="btn" onClick={() => { setForm(emptyForm(productionType)); setEditingId(null); setError(null); setShowForm((s) => !s); }}>
          {showForm ? <><X size={15} /> Cancel</> : <><Plus size={15} /> New Production Order</>}
        </button>}
        {canManage && <div role="group" aria-label="Which batches" style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
          <button className={view === 'mine' ? 'btn small' : 'btn secondary small'} aria-pressed={view === 'mine'} onClick={() => setView('mine')}>Needs action</button>
          <button className={view === 'all' ? 'btn small' : 'btn secondary small'} aria-pressed={view === 'all'} onClick={() => setView('all')}>All batches</button>
        </div>}
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12.5, fontWeight: 400 }}>
          <input type="checkbox" checked={hideTest} onChange={(e) => setHideTest(e.target.checked)} /> Hide automated-test batches (TST-, E2E-)
        </label>
      </div>

      {showForm && (
        <form className="form-modern" onSubmit={handleCreate}>
          <h3 className="form-modern__title">{editingId ? 'Edit Production Order' : 'New Production Order'}</h3>
          <p className="form-modern__subtitle">{editingId ? 'Still planned/in-progress, so every field can be rewritten.' : 'Schedule a batch run on a machine.'}</p>
          {error && <div className="error-box"><AlertCircle size={15} /> {error}</div>}
          <div className="form-grid">
            <div className="form-field"><label>Batch Number</label><input required value={form.batch_number} onChange={(e) => setForm({ ...form, batch_number: e.target.value })} /></div>
            {!productionType && (
              <div className="form-field">
                <label>Type</label>
                <select value={form.production_type} onChange={(e) => setForm({ ...form, production_type: e.target.value })}>
                  <option value="RO_WATER">RO Water</option>
                  <option value="BOTTLING">Bottling</option>
                  <option value="ICE">Ice</option>
                </select>
              </div>
            )}
            <div className="form-field">
              <label>Machine</label>
              <select required value={form.machine_id} onChange={(e) => setForm({ ...form, machine_id: e.target.value })}>
                <option value="">Select…</option>
                {machines?.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
            <div className="form-field">
              <label>Output Product</label>
              <select required value={form.product_id} onChange={(e) => setForm({ ...form, product_id: e.target.value })}>
                <option value="">Select…</option>
                {products?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div className="form-field">
              <label>Finished Goods Warehouse</label>
              <select required value={form.destination_warehouse_id} onChange={(e) => setForm({ ...form, destination_warehouse_id: e.target.value })}>
                <option value="">Select…</option>
                {warehouses?.filter((w) => w.is_active && w.type === 'finished_goods').map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
              {form.production_type === 'RO_WATER' && (
                <span className="muted" style={{ fontSize: 11 }}>RO Water production must receipt into the Finished Water Warehouse to be loadable onto a tanker.</span>
              )}
            </div>
            <div className="form-field"><label>Planned Qty</label><input type="number" step="0.001" value={form.planned_qty} onChange={(e) => setForm({ ...form, planned_qty: e.target.value })} /></div>
            <div className="form-field"><label>Unit</label><input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} /></div>
            <div className="form-field">
              <label>Shift</label>
              <select value={form.shift} onChange={(e) => setForm({ ...form, shift: e.target.value })}>
                <option>Morning</option><option>Afternoon</option><option>Night</option>
              </select>
            </div>
          </div>
          <div className="form-actions">
            <button className="btn" type="submit"><CheckCircle2 size={15} /> {editingId ? 'Save Changes' : 'Save Order'}</button>
            <button type="button" className="secondary" onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </form>
      )}

      <div className="card">
        <Table
          columns={[
            { key: 'batch_number', header: 'Batch #' },
            ...(productionType ? [] : [{ key: 'production_type', header: 'Type', render: (r) => TYPE_LABEL[r.production_type] || r.production_type }]),
            { key: 'product_name', header: 'Product', render: (r) => <div><div>{r.product_name || <span style={{ color: 'var(--danger)' }}>No output product</span>}</div><div className="muted" style={{ fontSize: 11.5 }}>{r.machine_name}</div></div> },
            { key: 'actual_qty', header: 'Quantity', render: (r) => <div><div>{r.actual_qty == null ? '—' : Number(r.actual_qty)} / {Number(r.planned_qty) || '—'} {r.unit}</div>{Number(r.wastage_qty) > 0 && <div className="muted" style={{ fontSize: 11.5 }}>wastage {Number(r.wastage_qty)} {r.unit}</div>}</div> },
            { key: 'status', header: 'Status', render: (r) => { const [label, tone] = batchState(r); return <span className={`badge badge--${tone}`}>{label}</span>; } },
            canManage && {
              key: 'actions', header: 'Next step', sortable: false, render: (b) => (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'nowrap', alignItems: 'center' }}>
                  {b.status === 'planned' && <button className="btn small" onClick={() => startBatch(b.id)}><Play size={13} /> Start</button>}
                  {b.status === 'in_progress' && <button className="btn small" onClick={() => setCompleting(b)}><PackageCheck size={13} /> Complete…</button>}
                  {b.output_approval_status === 'pending' && b.status === 'completed' && (
                    Number(b.completed_by || b.supervisor_id) === Number(user?.id) && user?.role !== 'Admin'
                      ? <span className="muted" style={{ fontSize: 12 }}>Waiting for another manager</span>
                      : <button className="btn small" onClick={() => setDeciding(b)}><ClipboardCheck size={13} /> Review output…</button>
                  )}
                  {['planned', 'in_progress'].includes(b.status) && (
                    <>
                      <button className="btn-icon" title="Edit" aria-label={`Edit ${b.batch_number}`} onClick={() => startEdit(b)}><Pencil size={13} /></button>
                      <button className="btn-icon" title="Delete" aria-label={`Delete ${b.batch_number}`} onClick={() => deleteBatch(b)}><Trash2 size={13} /></button>
                    </>
                  )}
                  {b.status === 'completed' && <button className="btn-icon" title="Reverse" aria-label={`Reverse ${b.batch_number}`} onClick={() => reverseBatch(b)}><RotateCcw size={13} /></button>}
                </div>
              )
            }
          ].filter(Boolean)}
          rows={shown}
          emptyText={view === 'mine' ? 'Nothing needs your action. Switch to All batches to see the rest.' : 'No production orders yet.'}
          searchable searchPlaceholder="Search batch #, machine, product…" sortable pageSize={10}
        />
      </div>
      {completing && <CompleteBatchPanel batch={completing} warehouses={warehouses} onClose={() => setCompleting(null)} onDone={panelDone} />}
      {deciding && <OutputDecisionPanel batch={deciding} me={user} onClose={() => setDeciding(null)} onDone={panelDone} />}
    </div>
  );
}
