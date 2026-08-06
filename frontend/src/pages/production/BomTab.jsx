import { useState } from 'react';
import { Plus, X, CheckCircle2, AlertCircle, Eye } from 'lucide-react';
import { useApi } from '../../components/useApi';
import Table from '../../components/Table';
import client from '../../api/client';
import { useAuth } from '../../context/AuthContext';

function BomDetail({ bomId, onClose }) {
  const { rows } = useApi(`/production/bom/${bomId}`);
  if (!rows) return <div className="card"><p className="muted">Loading…</p></div>;

  return (
    <div className="card">
      <div className="card__header">
        <h3>{rows.name} — {rows.product_name}</h3>
        <button className="btn secondary" onClick={onClose}><X size={13} /> Close</button>
      </div>
      <Table
        columns={[
          { key: 'raw_material_name', header: 'Raw Material' },
          { key: 'quantity_per_unit', header: 'Qty per Unit', render: (r) => `${Number(r.quantity_per_unit).toLocaleString()} ${r.unit}` }
        ]}
        rows={rows.items}
      />
    </div>
  );
}

export default function BomTab() {
  const { user } = useAuth();
  const canEdit = ['Admin', 'Production Manager'].includes(user?.role);
  const { rows, reload } = useApi('/production/bom');
  const { rows: finishedGoods } = useApi('/products?type=finished_good');
  const { rows: rawMaterials } = useApi('/products?type=raw_material');
  const [productId, setProductId] = useState('');
  const [name, setName] = useState('');
  const [items, setItems] = useState([{ raw_material_product_id: '', quantity_per_unit: '' }]);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [viewingId, setViewingId] = useState(null);

  function updateItem(i, field, value) {
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, [field]: value } : it)));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    try {
      await client.post('/production/bom', {
        product_id: Number(productId),
        name,
        items: items.map((it) => ({ raw_material_product_id: Number(it.raw_material_product_id), quantity_per_unit: Number(it.quantity_per_unit) }))
      });
      setProductId(''); setName(''); setItems([{ raw_material_product_id: '', quantity_per_unit: '' }]);
      setShowForm(false);
      setSuccess('Bill of materials saved.');
      setTimeout(() => setSuccess(null), 4000);
      reload();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create BOM');
    }
  }

  return (
    <div>
      <p className="muted">Defines how much of each raw material one unit of a finished good consumes. Used to auto-calculate consumption when a production batch is completed.</p>
      {success && <div className="success-box"><CheckCircle2 size={15} /> {success}</div>}
      <div className="toolbar">
        {canEdit && <button className="btn" onClick={() => setShowForm((s) => !s)}>{showForm ? <><X size={15} /> Cancel</> : <><Plus size={15} /> New Bill of Materials</>}</button>}
      </div>

      {showForm && (
        <form className="form-modern" onSubmit={handleSubmit}>
          <h3 className="form-modern__title">New Bill of Materials</h3>
          {error && <div className="error-box"><AlertCircle size={15} /> {error}</div>}
          <div className="form-section">
            <div className="form-section__title">Output</div>
            <div className="form-grid">
              <div className="form-field">
                <label>Finished Good</label>
                <select required value={productId} onChange={(e) => setProductId(e.target.value)}>
                  <option value="">Select…</option>
                  {finishedGoods?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div className="form-field">
                <label>BOM Name</label>
                <input required value={name} onChange={(e) => setName(e.target.value)} />
              </div>
            </div>
          </div>
          <div className="form-section">
            <div className="form-section__title">Materials per Unit</div>
            {items.map((it, i) => (
              <div key={i} style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
                <select required value={it.raw_material_product_id} onChange={(e) => updateItem(i, 'raw_material_product_id', e.target.value)} style={{ flex: 2 }}>
                  <option value="">Raw material…</option>
                  {rawMaterials?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <input required type="number" step="0.0001" placeholder="Qty per unit" value={it.quantity_per_unit} onChange={(e) => updateItem(i, 'quantity_per_unit', e.target.value)} style={{ flex: 1 }} />
              </div>
            ))}
            <button type="button" className="secondary" onClick={() => setItems((p) => [...p, { raw_material_product_id: '', quantity_per_unit: '' }])}><Plus size={13} /> Add Material</button>
          </div>
          <div className="form-actions">
            <button className="btn" type="submit"><CheckCircle2 size={15} /> Save BOM</button>
            <button type="button" className="secondary" onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </form>
      )}

      <div className="card">
        <Table
          columns={[
            { key: 'product_name', header: 'Product' },
            { key: 'name', header: 'BOM Name' },
            { key: 'is_active', header: 'Status', render: (r) => <span className={`badge badge--${r.is_active ? 'ok' : 'low'}`}>{r.is_active ? 'Active' : 'Inactive'}</span> },
            { key: 'actions', header: '', sortable: false, render: (b) => <button className="btn secondary" onClick={() => setViewingId(b.id)}><Eye size={13} /> View</button> }
          ]}
          rows={rows}
          emptyText="No bills of materials defined yet."
          searchable searchPlaceholder="Search BOMs…" sortable
        />
      </div>

      {viewingId && <BomDetail bomId={viewingId} onClose={() => setViewingId(null)} />}
    </div>
  );
}
