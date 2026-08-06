import { useMemo } from 'react';
import { Factory, PackageCheck, AlertTriangle, Gauge } from 'lucide-react';
import { useApi } from '../../components/useApi';
import BatchesTab from './BatchesTab';

// Shared shell for a single production line's dashboard (RO Water, Bottled Water,
// Ice). Reuses the exact same /production/batches?production_type= filter and
// BatchesTab component that "Production Orders" uses — just scoped to one type, so
// the three lines never blend together the way the old single Batches tab did.
export default function ProductionLineTab({ productionType, label, color = 'var(--primary)' }) {
  const { rows } = useApi(`/production/batches?production_type=${productionType}`);

  const stats = useMemo(() => {
    const list = rows || [];
    const completed = list.filter((b) => b.status === 'completed');
    const totalPlanned = list.reduce((s, b) => s + Number(b.planned_qty || 0), 0);
    const totalActual = completed.reduce((s, b) => s + Number(b.actual_qty || 0), 0);
    const totalWastage = completed.reduce((s, b) => s + Number(b.wastage_qty || 0), 0);
    const wastageRate = totalActual + totalWastage > 0 ? (totalWastage / (totalActual + totalWastage)) * 100 : 0;
    const inProgress = list.filter((b) => b.status === 'in_progress').length;
    return { batchCount: list.length, totalPlanned, totalActual, totalWastage, wastageRate, inProgress };
  }, [rows]);

  if (!rows) return <p className="muted">Loading…</p>;

  const unit = rows[0]?.unit || '';

  return (
    <div>
      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-card__top"><div className="kpi-card__icon"><Factory size={18} /></div></div>
          <div className="kpi-card__label">Total Batches</div>
          <div className="kpi-card__value">{stats.batchCount}</div>
          <div className="kpi-card__sub">{stats.inProgress} in progress</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-card__top"><div className="kpi-card__icon kpi-card__icon--success"><PackageCheck size={18} /></div></div>
          <div className="kpi-card__label">Output ({label})</div>
          <div className="kpi-card__value">{stats.totalActual.toLocaleString()} {unit}</div>
          <div className="kpi-card__sub">{stats.totalPlanned.toLocaleString()} {unit} planned</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-card__top"><div className={`kpi-card__icon${stats.wastageRate > 5 ? ' kpi-card__icon--danger' : ' kpi-card__icon--accent'}`}><AlertTriangle size={18} /></div></div>
          <div className="kpi-card__label">Wastage Rate</div>
          <div className="kpi-card__value" style={{ color: stats.wastageRate > 5 ? 'var(--danger)' : undefined }}>{stats.wastageRate.toFixed(1)}%</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-card__top"><div className="kpi-card__icon kpi-card__icon--warning"><Gauge size={18} /></div></div>
          <div className="kpi-card__label">Fulfillment</div>
          <div className="kpi-card__value">{stats.totalPlanned > 0 ? Math.round((stats.totalActual / stats.totalPlanned) * 100) : 0}%</div>
          <div className="kpi-card__sub">actual vs. planned</div>
        </div>
      </div>

      <BatchesTab productionType={productionType} />
    </div>
  );
}
