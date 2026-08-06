import { useState } from 'react';
import { Plus, X, CheckCircle2, AlertCircle, Pencil, Trash2, Play, PackageCheck, RotateCcw } from 'lucide-react';
import { useApi } from '../../components/useApi';
import Table from '../../components/Table';
import client from '../../api/client';
import { useAuth } from '../../context/AuthContext';

const TYPE_LABEL = { RO_WATER: 'RO Water', BOTTLING: 'Bottling', ICE: 'Ice' };
const STATUS_BADGE = { planned: 'pending', in_progress: 'info', completed: 'ok', cancelled: 'low', reversed: 'low' };
const QC_BADGE = { pending: 'pending', passed: 'ok', failed: 'low' };
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
  const [completingId, setCompletingId] = useState(null);
  const [actualQty, setActualQty] = useState('');
  const [wastageQty, setWastageQty] = useState('');
  const [materialsWarehouseId, setMaterialsWarehouseId] = useState('');
  const [qcStatus, setQcStatus] = useState('');
  const [completeError, setCompleteError] = useState(null);

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

  async function completeBatch(id) {
    setCompleteError(null);
    if (!qcStatus) { setCompleteError('Select a QC Status before completing this batch.'); return; }
    try {
      await client.put(`/production/batches/${id}/complete`, {
        actual_qty: Number(actualQty),
        wastage_qty: Number(wastageQty) || 0,
        materials_warehouse_id: materialsWarehouseId ? Number(materialsWarehouseId) : undefined,
        qc_status: qcStatus
      });
      setCompletingId(null);
      setActualQty('');
      setWastageQty('');
      setMaterialsWarehouseId('');
      setQcStatus('');
      flashSuccess(qcStatus === 'passed' ? 'Batch completed — stock received into the destination warehouse.' : 'Batch completed — QC did not pass, no stock was added.');
      reload();
    } catch (err) {
      setCompleteError(err.response?.data?.error || 'Failed to complete batch');
    }
  }

  return (
    <div>
      {success && <div className="success-box"><CheckCircle2 size={15} /> {success}</div>}
      <div className="toolbar">
        {canManage && <button className="btn" onClick={() => { setForm(emptyForm(productionType)); setEditingId(null); setError(null); setShowForm((s) => !s); }}>
          {showForm ? <><X size={15} /> Cancel</> : <><Plus size={15} /> New Production Order</>}
        </button>}
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
              <label>Output Product{form.production_type === 'RO_WATER' ? '' : ' (optional)'}</label>
              <select required={form.production_type === 'RO_WATER'} value={form.product_id} onChange={(e) => setForm({ ...form, product_id: e.target.value })}>
                <option value="">{form.production_type === 'RO_WATER' ? 'Select…' : '(bulk / none)'}</option>
                {products?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div className="form-field">
              <label>Destination Warehouse{form.production_type === 'RO_WATER' ? '' : ' (optional)'}</label>
              <select required={form.production_type === 'RO_WATER'} value={form.destination_warehouse_id} onChange={(e) => setForm({ ...form, destination_warehouse_id: e.target.value })}>
                <option value="">Select…</option>
                {warehouses?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
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
            { key: 'machine_name', header: 'Machine' },
            { key: 'product_name', header: 'Product', render: (r) => r.product_name || '—' },
            {
              key: 'progress', header: 'Progress', sortable: false, render: (r) => {
                const planned = Number(r.planned_qty) || 0;
                const actual = Number(r.actual_qty) || 0;
                const pct = planned > 0 ? Math.min(100, Math.round((actual / planned) * 100)) : (r.status === 'completed' ? 100 : 0);
                return (
                  <div style={{ minWidth: 140 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)', marginBottom: 3 }}>
                      <span>{actual || 0}/{planned || '—'} {r.unit}</span><span>{pct}%</span>
                    </div>
                    <div style={{ height: 6, borderRadius: 999, background: 'var(--border-light)', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${pct}%`, background: pct >= 100 ? 'var(--success)' : 'var(--primary)', borderRadius: 999 }} />
                    </div>
                  </div>
                );
              }
            },
            { key: 'wastage_qty', header: 'Wastage', render: (r) => Number(r.wastage_qty) > 0 ? Number(r.wastage_qty) : '—' },
            { key: 'status', header: 'Status', render: (r) => <span className={`badge badge--${STATUS_BADGE[r.status]}`}>{r.status.replace('_', ' ')}</span> },
            { key: 'qc_status', header: 'QC Status', render: (r) => r.status === 'completed' || r.status === 'reversed' ? <span className={`badge badge--${QC_BADGE[r.qc_status]}`}>{r.qc_status}</span> : '—' },
            canManage && {
              key: 'actions', header: '', sortable: false, render: (b) => (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {['planned', 'in_progress'].includes(b.status) && (
                    <>
                      <button className="btn-icon" title="Edit" onClick={() => startEdit(b)}><Pencil size={13} /></button>
                      <button className="btn-icon" title="Delete" onClick={() => deleteBatch(b)}><Trash2 size={13} /></button>
                    </>
                  )}
                  {b.status === 'completed' && <button className="btn secondary" onClick={() => reverseBatch(b)}><RotateCcw size={13} /> Reverse</button>}
                  {b.status === 'planned' && <button className="btn secondary" onClick={() => startBatch(b.id)}><Play size={13} /> Start</button>}
                  {b.status === 'in_progress' && completingId !== b.id && (
                    <button className="btn secondary" onClick={() => setCompletingId(b.id)}><PackageCheck size={13} /> Complete</button>
                  )}
                  {completingId === b.id && (
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <input style={{ width: 80 }} type="number" step="0.001" placeholder="Actual qty" value={actualQty} onChange={(e) => setActualQty(e.target.value)} />
                        <input style={{ width: 80 }} type="number" step="0.001" placeholder="Wastage" value={wastageQty} onChange={(e) => setWastageQty(e.target.value)} />
                        <select style={{ width: 130 }} value={materialsWarehouseId} onChange={(e) => setMaterialsWarehouseId(e.target.value)}>
                          <option value="">Materials from…</option>
                          {warehouses?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                        </select>
                        <select style={{ width: 110 }} value={qcStatus} onChange={(e) => setQcStatus(e.target.value)}>
                          <option value="">QC Status…</option>
                          <option value="passed">Passed</option>
                          <option value="failed">Failed</option>
                          <option value="pending">Pending</option>
                        </select>
                        <button className="btn" disabled={!actualQty} onClick={() => completeBatch(b.id)}>Confirm</button>
                      </span>
                      {qcStatus === 'failed' && (
                        <span style={{ fontSize: 11, color: 'var(--danger)' }}>Failed QC — this batch will complete, but no stock will be added.</span>
                      )}
                      {completeError && <span style={{ fontSize: 11, color: 'var(--danger)' }}>{completeError}</span>}
                    </span>
                  )}
                </div>
              )
            }
          ].filter(Boolean)}
          rows={rows}
          emptyText="No production orders yet."
          searchable searchPlaceholder="Search batch #, machine, product…" sortable pageSize={10}
        />
      </div>
    </div>
  );
}
