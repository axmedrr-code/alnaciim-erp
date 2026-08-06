import { useMemo } from 'react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { ShieldCheck, AlertTriangle, TrendingDown, Percent } from 'lucide-react';
import { useApi } from '../../components/useApi';
import Table from '../../components/Table';

const TYPE_LABEL = { RO_WATER: 'RO Water', BOTTLING: 'Bottling', ICE: 'Ice' };
const WASTAGE_FLAG_THRESHOLD = 5; // % — batches above this are surfaced for review

// There's no dedicated QC/inspection table in the schema, so this view is built from
// the one quality signal production batches already capture: wastage_qty recorded at
// completion. That's a legitimate yield/wastage quality view without inventing a
// backend workflow that doesn't exist.
export default function QualityControlTab() {
  const { rows } = useApi('/production/batches');

  const completed = useMemo(() => (rows || []).filter((b) => b.status === 'completed'), [rows]);

  const stats = useMemo(() => {
    const totalActual = completed.reduce((s, b) => s + Number(b.actual_qty || 0), 0);
    const totalWastage = completed.reduce((s, b) => s + Number(b.wastage_qty || 0), 0);
    const gross = totalActual + totalWastage;
    const wastageRate = gross > 0 ? (totalWastage / gross) * 100 : 0;
    const flagged = completed.filter((b) => {
      const g = Number(b.actual_qty || 0) + Number(b.wastage_qty || 0);
      const rate = g > 0 ? (Number(b.wastage_qty || 0) / g) * 100 : 0;
      return rate > WASTAGE_FLAG_THRESHOLD;
    });
    return { totalActual, totalWastage, wastageRate, yieldRate: 100 - wastageRate, flaggedCount: flagged.length };
  }, [completed]);

  const trend = useMemo(() => {
    const byDay = {};
    for (const b of completed) {
      const day = String(b.end_time || b.start_time || '').slice(0, 10);
      if (!day) continue;
      if (!byDay[day]) byDay[day] = { day, actual: 0, wastage: 0 };
      byDay[day].actual += Number(b.actual_qty || 0);
      byDay[day].wastage += Number(b.wastage_qty || 0);
    }
    return Object.values(byDay)
      .sort((a, b) => a.day.localeCompare(b.day))
      .slice(-14)
      .map((d) => ({ day: new Date(d.day).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), 'Wastage Rate %': d.actual + d.wastage > 0 ? Number(((d.wastage / (d.actual + d.wastage)) * 100).toFixed(1)) : 0 }));
  }, [completed]);

  if (!rows) return <p className="muted">Loading…</p>;

  return (
    <div>
      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-card__top"><div className="kpi-card__icon kpi-card__icon--success"><ShieldCheck size={18} /></div></div>
          <div className="kpi-card__label">Overall Yield</div>
          <div className="kpi-card__value">{stats.yieldRate.toFixed(1)}%</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-card__top"><div className={`kpi-card__icon${stats.wastageRate > WASTAGE_FLAG_THRESHOLD ? ' kpi-card__icon--danger' : ' kpi-card__icon--accent'}`}><Percent size={18} /></div></div>
          <div className="kpi-card__label">Wastage Rate</div>
          <div className="kpi-card__value" style={{ color: stats.wastageRate > WASTAGE_FLAG_THRESHOLD ? 'var(--danger)' : undefined }}>{stats.wastageRate.toFixed(1)}%</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-card__top"><div className="kpi-card__icon kpi-card__icon--warning"><TrendingDown size={18} /></div></div>
          <div className="kpi-card__label">Total Wastage Units</div>
          <div className="kpi-card__value">{stats.totalWastage.toLocaleString()}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-card__top"><div className={`kpi-card__icon${stats.flaggedCount > 0 ? ' kpi-card__icon--danger' : ' kpi-card__icon--success'}`}><AlertTriangle size={18} /></div></div>
          <div className="kpi-card__label">Batches Flagged</div>
          <div className="kpi-card__value" style={{ color: stats.flaggedCount > 0 ? 'var(--danger)' : undefined }}>{stats.flaggedCount}</div>
          <div className="kpi-card__sub">wastage rate &gt; {WASTAGE_FLAG_THRESHOLD}%</div>
        </div>
      </div>

      <div className="card">
        <h3>Wastage Rate Trend — Last 14 Production Days</h3>
        {trend.length ? (
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={trend} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="day" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} width={40} unit="%" />
              <Tooltip />
              <Line type="monotone" dataKey="Wastage Rate %" stroke="var(--danger)" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        ) : <p className="muted">No completed batches yet.</p>}
      </div>

      <div className="card">
        <h3>Completed Batches — Yield Detail</h3>
        <Table
          columns={[
            { key: 'batch_number', header: 'Batch #' },
            { key: 'production_type', header: 'Type', render: (r) => TYPE_LABEL[r.production_type] || r.production_type },
            { key: 'product_name', header: 'Product', render: (r) => r.product_name || '—' },
            { key: 'actual_qty', header: 'Output', render: (r) => `${Number(r.actual_qty || 0).toLocaleString()} ${r.unit}` },
            { key: 'wastage_qty', header: 'Wastage', render: (r) => `${Number(r.wastage_qty || 0).toLocaleString()} ${r.unit}` },
            {
              key: 'wastage_rate', header: 'Wastage Rate', render: (r) => {
                const actual = Number(r.actual_qty || 0), wastage = Number(r.wastage_qty || 0);
                const gross = actual + wastage;
                const rate = gross > 0 ? (wastage / gross) * 100 : 0;
                return <span className={`badge badge--${rate > WASTAGE_FLAG_THRESHOLD ? 'low' : 'ok'}`}>{rate.toFixed(1)}%</span>;
              }
            },
            { key: 'wastage_notes', header: 'Notes', render: (r) => r.wastage_notes || '—' }
          ]}
          rows={completed}
          emptyText="No completed batches yet."
          searchable searchPlaceholder="Search batches…" sortable pageSize={10}
        />
      </div>
    </div>
  );
}
