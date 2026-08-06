import { useState } from 'react';
import { Plus, Truck as TruckIcon } from 'lucide-react';
import { useApi } from '../../components/useApi';
import client from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import TruckLoadsTab from './TruckLoadsTab';

const EMPTY_FORM = { plate_number: '', model: '', capacity: '', capacity_unit: 'liters', assigned_driver_id: '' };
const STATUS_BADGE = { active: 'ok', maintenance: 'pending', inactive: 'low' };
const MANAGER_ROLES = ['Sales Manager', 'Route Supervisor', 'Supervisor'];

// Tanker fleet management — role-based edit permissions:
//   Admin only:       register a truck, edit Plate Number/Model, archive
//   Admin + Managers: Assigned Driver, Status, Notes
//   everyone else:    read-only
function FleetSection() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'Admin';
  const canEditOperational = isAdmin || MANAGER_ROLES.includes(user?.role);
  const { rows, reload } = useApi('/trucks');
  const { rows: users } = useApi('/users');
  const drivers = users?.filter((u) => u.role_name === 'Driver');
  const [form, setForm] = useState(EMPTY_FORM);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState(null);
  const [editingId, setEditingId] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    try {
      await client.post('/trucks', {
        ...form,
        capacity: form.capacity ? Number(form.capacity) : undefined,
        assigned_driver_id: form.assigned_driver_id ? Number(form.assigned_driver_id) : undefined
      });
      setForm(EMPTY_FORM);
      setShowForm(false);
      reload();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to register truck');
    }
  }

  async function archiveTruck(id) {
    setError(null);
    try {
      await client.post(`/trucks/${id}/archive`);
      reload();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to archive truck');
    }
  }

  return (
    <div>
      <div className="toolbar">
        {isAdmin && <button className="btn" onClick={() => setShowForm((s) => !s)}>{showForm ? 'Cancel' : <><Plus size={15} /> New Truck</>}</button>}
      </div>
      {error && !showForm && !editingId && <div className="error-box">{error}</div>}
      {showForm && (
        <form className="form-modern" onSubmit={handleSubmit}>
          <h3 className="form-modern__title">Register Truck</h3>
          {error && <div className="error-box">{error}</div>}
          <div className="form-grid">
            <div className="form-field"><label>Plate Number</label><input required value={form.plate_number} onChange={(e) => setForm({ ...form, plate_number: e.target.value })} /></div>
            <div className="form-field"><label>Model</label><input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} /></div>
            <div className="form-field">
              <label>Capacity</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input type="number" step="0.01" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} />
                <select value={form.capacity_unit} onChange={(e) => setForm({ ...form, capacity_unit: e.target.value })} style={{ width: 100 }}>
                  <option value="liters">liters</option>
                  <option value="kg">kg</option>
                </select>
              </div>
            </div>
            <div className="form-field">
              <label>Assigned Driver</label>
              <select value={form.assigned_driver_id} onChange={(e) => setForm({ ...form, assigned_driver_id: e.target.value })}>
                <option value="">Unassigned</option>
                {drivers?.map((d) => <option key={d.id} value={d.id}>{d.full_name}</option>)}
              </select>
            </div>
          </div>
          <div className="form-actions">
            <button className="btn" type="submit">Save Truck</button>
            <button type="button" className="secondary" onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </form>
      )}

      {editingId && (
        <EditTruckForm
          truck={rows.find((t) => t.id === editingId)}
          isAdmin={isAdmin}
          drivers={drivers}
          onClose={() => setEditingId(null)}
          onSaved={() => { setEditingId(null); reload(); }}
        />
      )}

      <div className="card">
        <Table_
          rows={rows}
          isAdmin={isAdmin}
          canEditOperational={canEditOperational}
          onEdit={setEditingId}
          onArchive={archiveTruck}
        />
      </div>
    </div>
  );
}

// Only the fields the acting role may actually change are rendered at all —
// Plate Number/Model never even appear in the DOM for a non-Admin, matching
// "hide the option" rather than showing it disabled.
function EditTruckForm({ truck, isAdmin, drivers, onClose, onSaved }) {
  const [plateNumber, setPlateNumber] = useState(truck.plate_number);
  const [model, setModel] = useState(truck.model || '');
  const [reason, setReason] = useState('');
  const [assignedDriverId, setAssignedDriverId] = useState(truck.assigned_driver_id || '');
  const [status, setStatus] = useState(truck.status);
  const [notes, setNotes] = useState(truck.notes || '');
  const [error, setError] = useState(null);

  const plateChanged = isAdmin && plateNumber !== truck.plate_number;

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    if (plateChanged && !reason.trim()) {
      setError('A reason is required when changing the Plate Number');
      return;
    }
    try {
      const body = { assigned_driver_id: assignedDriverId || null, status, notes };
      if (isAdmin) {
        body.plate_number = plateNumber;
        body.model = model;
        if (plateChanged) body.reason = reason;
      }
      await client.put(`/trucks/${truck.id}`, body);
      onSaved();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to update truck');
    }
  }

  return (
    <form className="form-modern" onSubmit={handleSubmit}>
      <h3 className="form-modern__title">Edit Truck — {truck.plate_number}</h3>
      {error && <div className="error-box">{error}</div>}
      <div className="form-grid">
        {isAdmin && (
          <>
            <div className="form-field"><label>Plate Number</label><input required value={plateNumber} onChange={(e) => setPlateNumber(e.target.value)} /></div>
            <div className="form-field"><label>Model</label><input value={model} onChange={(e) => setModel(e.target.value)} /></div>
            {plateChanged && (
              <div className="form-field" style={{ gridColumn: '1/-1' }}>
                <label>Reason for Plate Number change (required)</label>
                <input required value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. re-registered, plate replaced by authority" />
              </div>
            )}
          </>
        )}
        <div className="form-field">
          <label>Assigned Driver</label>
          <select value={assignedDriverId} onChange={(e) => setAssignedDriverId(e.target.value)}>
            <option value="">Unassigned</option>
            {drivers?.map((d) => <option key={d.id} value={d.id}>{d.full_name}</option>)}
          </select>
        </div>
        <div className="form-field">
          <label>Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="active">Active</option>
            <option value="maintenance">Maintenance</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
        <div className="form-field" style={{ gridColumn: '1/-1' }}>
          <label>Notes</label>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>
      <div className="form-actions">
        <button className="btn" type="submit">Save Changes</button>
        <button type="button" className="secondary" onClick={onClose}>Cancel</button>
      </div>
    </form>
  );
}

function Table_({ rows, isAdmin, canEditOperational, onEdit, onArchive }) {
  if (!rows) return <p className="muted">Loading…</p>;
  if (!rows.length) return <p className="muted">No trucks registered yet.</p>;
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>Plate Number</th><th>Model</th><th>Capacity</th><th>Driver</th><th>Status</th><th></th></tr></thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.id}>
              <td>{t.plate_number}</td>
              <td>{t.model || '—'}</td>
              <td>{t.capacity ? `${Number(t.capacity).toLocaleString()} ${t.capacity_unit || ''}` : '—'}</td>
              <td>{t.driver_name || '—'}</td>
              <td><span className={`badge badge--${STATUS_BADGE[t.status] || 'info'}`}>{t.status}</span></td>
              <td style={{ display: 'flex', gap: 6 }}>
                {canEditOperational && <button className="btn secondary" onClick={() => onEdit(t.id)}>Edit</button>}
                {isAdmin && <button className="btn secondary" onClick={() => onArchive(t.id)}>Archive</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Every tank-fill sale the fast POS records is attributed to the driver on
// that route — this reads straight off route_stops/sales_orders, the same
// rows a POS Save writes to, so a new sale shows up here immediately with no
// separate sync step.
function DriverPerformance() {
  const { rows } = useApi('/reports/driver-performance');
  if (!rows) return <p className="muted">Loading…</p>;
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>Driver</th><th>Truck</th><th>Deliveries</th><th>Liters Delivered</th><th>Revenue</th><th>Cash Collected</th></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td>{r.driver_name}</td>
              <td>{r.plate_number}</td>
              <td>{r.deliveries}</td>
              <td>{Number(r.liters_delivered).toLocaleString()} L</td>
              <td>${Number(r.revenue).toFixed(2)}</td>
              <td>${Number(r.cash_collected).toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && <p className="muted">No deliveries recorded in the last 30 days.</p>}
    </div>
  );
}

export default function TankersTab() {
  return (
    <div>
      <h3 className="section-title"><TruckIcon size={16} /> Tanker Fleet</h3>
      <FleetSection />

      <div style={{ marginTop: 28 }}>
        <h3 className="section-title">Tanker Loading</h3>
        <TruckLoadsTab />
      </div>

      <div style={{ marginTop: 28 }}>
        <h3 className="section-title">Driver Performance (Last 30 Days)</h3>
        <div className="card"><DriverPerformance /></div>
      </div>
    </div>
  );
}
