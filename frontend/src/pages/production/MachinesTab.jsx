import { useState } from 'react';
import { Plus, X, CheckCircle2, AlertCircle, Cog, CheckCircle, Wrench, AlertOctagon, Archive } from 'lucide-react';
import { useApi } from '../../components/useApi';
import Table from '../../components/Table';
import client from '../../api/client';
import { useAuth } from '../../context/AuthContext';

const EMPTY_FORM = { code: '', name: '', type: 'RO_PLANT' };
const STATUS_BADGE = { operational: 'ok', under_maintenance: 'info', breakdown: 'low', retired: 'low' };
const TYPE_LABEL = { RO_PLANT: 'RO Plant', FILLING_LINE: 'Filling Line', ICE_MACHINE: 'Ice Machine', PACKAGING: 'Packaging', GENERATOR: 'Generator', VEHICLE: 'Vehicle' };

export default function MachinesTab() {
  const { user } = useAuth();
  const canEdit = ['Admin', 'Production Manager'].includes(user?.role);
  const { rows, reload } = useApi('/production/machines');
  const [form, setForm] = useState(EMPTY_FORM);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    try {
      await client.post('/production/machines', form);
      setForm(EMPTY_FORM);
      setShowForm(false);
      setSuccess('Machine registered.');
      setTimeout(() => setSuccess(null), 4000);
      reload();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create machine');
    }
  }

  const counts = (rows || []).reduce((acc, m) => ({ ...acc, [m.status]: (acc[m.status] || 0) + 1 }), {});

  return (
    <div>
      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-card__top"><div className="kpi-card__icon kpi-card__icon--success"><CheckCircle size={18} /></div></div>
          <div className="kpi-card__label">Operational</div>
          <div className="kpi-card__value">{counts.operational || 0}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-card__top"><div className="kpi-card__icon kpi-card__icon--warning"><Wrench size={18} /></div></div>
          <div className="kpi-card__label">Under Maintenance</div>
          <div className="kpi-card__value">{counts.under_maintenance || 0}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-card__top"><div className="kpi-card__icon kpi-card__icon--danger"><AlertOctagon size={18} /></div></div>
          <div className="kpi-card__label">Breakdown</div>
          <div className="kpi-card__value" style={{ color: counts.breakdown > 0 ? 'var(--danger)' : undefined }}>{counts.breakdown || 0}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-card__top"><div className="kpi-card__icon"><Archive size={18} /></div></div>
          <div className="kpi-card__label">Retired</div>
          <div className="kpi-card__value">{counts.retired || 0}</div>
        </div>
      </div>

      {success && <div className="success-box"><CheckCircle2 size={15} /> {success}</div>}
      <div className="toolbar">
        {canEdit && <button className="btn" onClick={() => setShowForm((s) => !s)}>{showForm ? <><X size={15} /> Cancel</> : <><Plus size={15} /> New Machine</>}</button>}
      </div>

      {showForm && (
        <form className="form-modern" onSubmit={handleSubmit}>
          <h3 className="form-modern__title">Register Machine</h3>
          {error && <div className="error-box"><AlertCircle size={15} /> {error}</div>}
          <div className="form-grid">
            <div className="form-field"><label>Code</label><input required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></div>
            <div className="form-field"><label>Name</label><input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div className="form-field">
              <label>Type</label>
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                {Object.entries(TYPE_LABEL).map(([val, lbl]) => <option key={val} value={val}>{lbl}</option>)}
              </select>
            </div>
          </div>
          <div className="form-actions">
            <button className="btn" type="submit"><CheckCircle2 size={15} /> Save Machine</button>
            <button type="button" className="secondary" onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </form>
      )}

      <div className="card">
        <Table
          columns={[
            { key: 'code', header: 'Code' },
            { key: 'name', header: 'Name', render: (r) => <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Cog size={13} color="var(--text-muted)" /> {r.name}</span> },
            { key: 'type', header: 'Type', render: (r) => TYPE_LABEL[r.type] || r.type },
            { key: 'status', header: 'Status', render: (r) => <span className={`badge badge--${STATUS_BADGE[r.status]}`}>{r.status.replace('_', ' ')}</span> }
          ]}
          rows={rows}
          emptyText="No machines registered yet."
          searchable searchPlaceholder="Search machines…" sortable
        />
      </div>
    </div>
  );
}
