import { useState } from 'react';
import { useApi } from '../../components/useApi';
import Table from '../../components/Table';
import client from '../../api/client';
import { useAuth } from '../../context/AuthContext';

const EMPTY_FORM = { code: '', name: '', category: 'raw_material', contact_person: '', phone: '' };

export default function SuppliersTab() {
  const { user } = useAuth();
  const canEdit = ['Admin', 'Procurement Officer'].includes(user?.role);
  const { rows, reload } = useApi('/suppliers');
  const [form, setForm] = useState(EMPTY_FORM);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    try {
      await client.post('/suppliers', form);
      setForm(EMPTY_FORM);
      setShowForm(false);
      reload();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create supplier');
    }
  }

  return (
    <div>
      <div className="toolbar">
        {canEdit && <button className="btn" onClick={() => setShowForm((s) => !s)}>{showForm ? 'Cancel' : '+ New Supplier'}</button>}
      </div>

      {showForm && (
        <form className="stacked-form card" onSubmit={handleSubmit}>
          {error && <div className="error-box" style={{ gridColumn: '1/-1' }}>{error}</div>}
          <label>Code<input required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></label>
          <label>Name<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label>Category
            <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              <option value="raw_material">Raw Material</option>
              <option value="packaging">Packaging</option>
              <option value="spare_part">Spare Part</option>
              <option value="chemicals">Chemicals</option>
            </select>
          </label>
          <label>Contact Person<input value={form.contact_person} onChange={(e) => setForm({ ...form, contact_person: e.target.value })} /></label>
          <label>Phone<input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
          <div><button className="btn" type="submit">Save</button></div>
        </form>
      )}

      <div className="card">
        <Table
          columns={[
            { key: 'code', header: 'Code' },
            { key: 'name', header: 'Name' },
            { key: 'category', header: 'Category' },
            { key: 'contact_person', header: 'Contact' },
            { key: 'phone', header: 'Phone' },
            { key: 'rating', header: 'Rating', render: (r) => Number(r.rating).toFixed(1) }
          ]}
          rows={rows}
        />
      </div>
    </div>
  );
}
