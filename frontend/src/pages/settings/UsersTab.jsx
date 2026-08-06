import { useState } from 'react';
import { useApi } from '../../components/useApi';
import Table from '../../components/Table';
import client from '../../api/client';

export default function UsersTab() {
  const { rows, reload } = useApi('/users');
  const { rows: roles } = useApi('/users/roles');
  const { rows: warehouses } = useApi('/warehouses');
  const [form, setForm] = useState({ employee_code: '', full_name: '', email: '', password: '', role_id: '', department: '' });
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    try {
      await client.post('/users', { ...form, role_id: Number(form.role_id) });
      setForm({ employee_code: '', full_name: '', email: '', password: '', role_id: '', department: '' });
      setShowForm(false);
      reload();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create user');
    }
  }

  return (
    <div>
      <div className="toolbar">
        <button className="btn" onClick={() => setShowForm((s) => !s)}>{showForm ? 'Cancel' : '+ New User'}</button>
      </div>

      {showForm && (
        <form className="stacked-form card" onSubmit={handleSubmit}>
          {error && <div className="error-box" style={{ gridColumn: '1/-1' }}>{error}</div>}
          <label>Employee Code<input required value={form.employee_code} onChange={(e) => setForm({ ...form, employee_code: e.target.value })} /></label>
          <label>Full Name<input required value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></label>
          <label>Email<input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
          <label>Password<input required type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></label>
          <label>Role
            <select required value={form.role_id} onChange={(e) => setForm({ ...form, role_id: e.target.value })}>
              <option value="">Select…</option>
              {roles?.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </label>
          <label>Department<input value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} /></label>
          <div><button className="btn" type="submit">Save User</button></div>
        </form>
      )}

      <div className="card">
        <Table
          columns={[
            { key: 'employee_code', header: 'Code' },
            { key: 'full_name', header: 'Name' },
            { key: 'email', header: 'Email' },
            { key: 'role_name', header: 'Role' },
            { key: 'department', header: 'Department' },
            { key: 'assigned_warehouse_name', header: 'Assigned Warehouse' },
            { key: 'is_active', header: 'Active', render: (r) => (r.is_active ? 'Yes' : 'No') }
          ]}
          rows={rows}
        />
      </div>

      <div className="card">
        <h3>Warehouses ({warehouses?.length ?? '…'})</h3>
        <p className="muted">Manage warehouses from the Inventory → Warehouses tab.</p>
      </div>
    </div>
  );
}
