import { useState } from 'react';
import { useApi } from '../../components/useApi';
import Table from '../../components/Table';
import client from '../../api/client';
import { useAuth } from '../../context/AuthContext';

const EMPTY_FORM = { sku: '', name: '', category_id: '', product_type: 'raw_material', unit: 'pcs', unit_cost: '', unit_price: '', reorder_level: '', reorder_qty: '' };

export default function ProductsTab() {
  const { user } = useAuth();
  const canEdit = ['Admin', 'Inventory Manager'].includes(user?.role);
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');
  const { rows, reload } = useApi(`/products?search=${search}&type=${type}`, [search, type]);
  const { rows: categories } = useApi('/categories');
  const [form, setForm] = useState(EMPTY_FORM);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState(null);

  async function handleCreate(e) {
    e.preventDefault();
    setError(null);
    try {
      await client.post('/products', { ...form, category_id: Number(form.category_id) });
      setForm(EMPTY_FORM);
      setShowForm(false);
      reload();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create product');
    }
  }

  return (
    <div>
      <div className="toolbar">
        <input placeholder="Search by name or SKU…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">All types</option>
          <option value="raw_material">Raw Material</option>
          <option value="finished_good">Finished Good</option>
          <option value="spare_part">Spare Part</option>
        </select>
        {canEdit && <button className="btn" onClick={() => setShowForm((s) => !s)}>{showForm ? 'Cancel' : '+ New Product'}</button>}
      </div>

      {showForm && (
        <form className="stacked-form card" onSubmit={handleCreate}>
          {error && <div className="error-box" style={{ gridColumn: '1/-1' }}>{error}</div>}
          <label>SKU<input required value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} /></label>
          <label>Name<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label>Category
            <select required value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })}>
              <option value="">Select…</option>
              {categories?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label>Type
            <select value={form.product_type} onChange={(e) => setForm({ ...form, product_type: e.target.value })}>
              <option value="raw_material">Raw Material</option>
              <option value="finished_good">Finished Good</option>
              <option value="spare_part">Spare Part</option>
            </select>
          </label>
          <label>Unit<input required value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} /></label>
          <label>Unit Cost<input type="number" step="0.01" value={form.unit_cost} onChange={(e) => setForm({ ...form, unit_cost: e.target.value })} /></label>
          <label>Unit Price<input type="number" step="0.01" value={form.unit_price} onChange={(e) => setForm({ ...form, unit_price: e.target.value })} /></label>
          <label>Reorder Level<input type="number" step="0.01" value={form.reorder_level} onChange={(e) => setForm({ ...form, reorder_level: e.target.value })} /></label>
          <label>Reorder Qty<input type="number" step="0.01" value={form.reorder_qty} onChange={(e) => setForm({ ...form, reorder_qty: e.target.value })} /></label>
          <div><button className="btn" type="submit">Save Product</button></div>
        </form>
      )}

      <div className="card">
        <Table
          columns={[
            { key: 'sku', header: 'SKU' },
            { key: 'name', header: 'Name' },
            { key: 'category_name', header: 'Category' },
            { key: 'product_type', header: 'Type' },
            { key: 'unit', header: 'Unit' },
            { key: 'unit_cost', header: 'Cost', render: (r) => `$${Number(r.unit_cost).toFixed(2)}` },
            { key: 'unit_price', header: 'Price', render: (r) => `$${Number(r.unit_price).toFixed(2)}` },
            { key: 'reorder_level', header: 'Reorder Level' }
          ]}
          rows={rows}
        />
      </div>
    </div>
  );
}
