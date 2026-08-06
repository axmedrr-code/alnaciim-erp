import { useState } from 'react';
import { useApi } from '../../components/useApi';
import Table from '../../components/Table';
import client from '../../api/client';
import { useAuth } from '../../context/AuthContext';

const EMPTY_FORM = { code: '', name: '', type: 'general', location: '' };

export default function WarehousesTab() {
  const { user } = useAuth();
  const canEdit = ['Admin', 'Inventory Manager'].includes(user?.role);
  const { rows, reload } = useApi('/warehouses');
  const [form, setForm] = useState(EMPTY_FORM);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    try {
      await client.post('/warehouses', form);
      setForm(EMPTY_FORM);
      setShowForm(false);
      reload();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create warehouse');
    }
  }

  return (
    <div>
      <div className="toolbar">
        {canEdit && <button className="btn" onClick={() => setShowForm((s) => !s)}>{showForm ? 'Cancel' : '+ New Warehouse'}</button>}
      </div>

      {showForm && (
        <form className="stacked-form card" onSubmit={handleSubmit}>
          {error && <div className="error-box" style={{ gridColumn: '1/-1' }}>{error}</div>}
          <label>Code<input required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></label>
          <label>Name<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label>Type
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              <option value="raw_material">Raw Material</option>
              <option value="finished_goods">Finished Goods</option>
              <option value="spare_parts">Spare Parts</option>
              <option value="general">General</option>
            </select>
          </label>
          <label>Location<input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></label>
          <div><button className="btn" type="submit">Save</button></div>
        </form>
      )}

      <div className="card">
        <Table
          columns={[
            { key: 'code', header: 'Code' },
            { key: 'name', header: 'Name' },
            { key: 'type', header: 'Type' },
            { key: 'location', header: 'Location' },
            { key: 'manager_name', header: 'Manager' }
          ]}
          rows={rows}
        />
      </div>
    </div>
  );
}
