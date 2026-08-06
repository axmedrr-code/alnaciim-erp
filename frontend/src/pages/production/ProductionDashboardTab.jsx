import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { Factory, Droplets, Snowflake, AlertTriangle, Wrench, Gauge } from 'lucide-react';
import { useApi } from '../../components/useApi';
import Table from '../../components/Table';

function shortDate(d) { return new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); }

// The one cross-line view in the Production module — everything else (RO Water,
// Bottled Water, Ice production orders) is scoped to a single line so their batch
// counts, output, and wastage never blend together.
export default function ProductionDashboardTab() {
  const { rows: summary } = useApi('/reports/dashboard-summary');
  const { rows: trend } = useApi('/reports/production-trend?days=14');
  const { rows: machines } = useApi('/production/machines');

  if (!summary || !machines) return <p className="muted">Loading…</p>;

  const productionToday = summary.production_today.reduce((acc, p) => ({ ...acc, [p.production_type]: Number(p.total) }), {});
  const operational = machines.filter((m) => m.status === 'operational').length;
  const down = machines.filter((m) => m.status === 'breakdown' || m.status === 'under_maintenance').length;
  const uptimePct = machines.length ? Math.round((operational / machines.length) * 100) : 0;

  const chartData = (trend || []).map((r) => ({
    day: shortDate(r.day), 'RO Water': Number(r.ro_water), 'Bottling': Number(r.bottling), 'Ice': Number(r.ice)
  }));

  return (
    <div>
      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-card__top"><div className="kpi-card__icon"><Droplets size={18} /></div></div>
          <div className="kpi-card__label">RO Water Today</div>
          <div className="kpi-card__value">{productionToday.RO_WATER || 0} m³</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-card__top"><div className="kpi-card__icon kpi-card__icon--accent"><Factory size={18} /></div></div>
          <div className="kpi-card__label">Bottled Water Today</div>
          <div className="kpi-card__value">{productionToday.BOTTLING || 0} box</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-card__top"><div className="kpi-card__icon kpi-card__icon--success"><Snowflake size={18} /></div></div>
          <div className="kpi-card__label">Ice Today</div>
          <div className="kpi-card__value">{productionToday.ICE || 0} kg</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-card__top"><div className={`kpi-card__icon${uptimePct < 80 ? ' kpi-card__icon--danger' : ' kpi-card__icon--success'}`}><Gauge size={18} /></div></div>
          <div className="kpi-card__label">Machine Uptime</div>
          <div className="kpi-card__value">{uptimePct}%</div>
          <div className="kpi-card__sub">{operational} of {machines.length} operational</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-card__top"><div className={`kpi-card__icon${down > 0 ? ' kpi-card__icon--danger' : ' kpi-card__icon--success'}`}><Wrench size={18} /></div></div>
          <div className="kpi-card__label">Machines Down</div>
          <div className="kpi-card__value" style={{ color: down > 0 ? 'var(--danger)' : undefined }}>{down}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-card__top"><div className={`kpi-card__icon${summary.low_stock_count > 0 ? ' kpi-card__icon--danger' : ' kpi-card__icon--success'}`}><AlertTriangle size={18} /></div></div>
          <div className="kpi-card__label">Low Stock Alerts</div>
          <div className="kpi-card__value">{summary.low_stock_count}</div>
        </div>
      </div>

      <div className="card">
        <h3>Production Output — Last 14 Days</h3>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="day" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} width={50} />
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="RO Water" stackId="a" fill="#0b4a5c" />
            <Bar dataKey="Bottling" stackId="a" fill="#0F5E75" />
            <Bar dataKey="Ice" stackId="a" fill="#14B8A6" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="card">
        <h3>Downtime — Last 7 Days</h3>
        <Table
          columns={[
            { key: 'machine_name', header: 'Machine' },
            { key: 'hours_down', header: 'Hours Down', render: (r) => Number(r.hours_down).toFixed(1) }
          ]}
          rows={summary.downtime_last_7_days}
          emptyText="No downtime recorded in the last 7 days."
        />
      </div>
    </div>
  );
}
