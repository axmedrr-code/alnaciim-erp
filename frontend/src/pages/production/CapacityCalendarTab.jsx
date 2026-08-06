import { useMemo, useState } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend
} from 'recharts';
import {
  Droplets, Package, Snowflake, ChevronLeft, ChevronRight, X, Gauge
} from 'lucide-react';
import { useApi } from '../../components/useApi';
import Table from '../../components/Table';

// ---------------------------------------------------------------------
// Departments — one calendar at a time, switched by this selector (the
// same pattern Billing & Collections already uses for its department
// scope), rather than three calendars stacked on the page at once. Each
// carries its own machine types (for downtime/active-machine scoping) and
// the unit label the user asked to see for that line.
// ---------------------------------------------------------------------
const DEPARTMENTS = [
  { key: 'RO_WATER', label: 'RO Water', icon: Droplets, unitLabel: 'm³', color: '#0b4a5c' },
  { key: 'BOTTLING', label: 'Bottled Water', icon: Package, unitLabel: 'Boxes/Bottles', color: '#0F5E75' },
  { key: 'ICE', label: 'Ice Factory', icon: Snowflake, unitLabel: 'Kg/Tons', color: '#14B8A6' }
];

function money(v) { return `$${Number(v || 0).toFixed(2)}`; }
function num(v) { return Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 1 }); }
function toISODate(d) { return d.toISOString().slice(0, 10); }
function formatTime(t) { return t ? new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : '—'; }

// Green <70%, Yellow 70–90%, Red >90% — exactly the thresholds requested.
function utilizationColor(pct) {
  if (pct > 90) return { bg: 'var(--bg-danger, #fee2e2)', text: 'var(--danger, #b91c1c)' };
  if (pct >= 70) return { bg: '#fef3c7', text: '#92400e' };
  return { bg: 'var(--bg-success, #dcfce7)', text: 'var(--success, #15803d)' };
}

const STATUS_BADGE = { planned: 'pending', in_progress: 'info', completed: 'ok', cancelled: 'low', reversed: 'low' };
const QC_BADGE = { pending: 'pending', passed: 'ok', failed: 'low' };

function DayModal({ department, date, onClose }) {
  const { rows } = useApi(`/production/capacity-calendar/day?production_type=${department.key}&date=${date}`, [department.key, date]);

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', paddingTop: '4vh', zIndex: 1000 }}>
      <div className="card" style={{ width: 820, maxWidth: '95%', maxHeight: '90vh', overflowY: 'auto' }}>
        <div className="card__header">
          <h3>{department.label} — {new Date(date + 'T00:00:00').toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}</h3>
          <button className="btn-icon" onClick={onClose}><X size={16} /></button>
        </div>
        {!rows ? <p className="muted">Loading…</p> : (
          <Table
            columns={[
              { key: 'batch_number', header: 'Batch #' },
              { key: 'product_name', header: 'Product', render: (r) => r.product_name || '—' },
              { key: 'planned_qty', header: 'Planned Qty', render: (r) => `${num(r.planned_qty)} ${r.unit}` },
              { key: 'actual_qty', header: 'Produced Qty', render: (r) => r.actual_qty != null ? `${num(r.actual_qty)} ${r.unit}` : '—' },
              { key: 'machine_name', header: 'Machine' },
              { key: 'operator_name', header: 'Operator' },
              { key: 'start_time', header: 'Start Time', render: (r) => formatTime(r.start_time) },
              { key: 'end_time', header: 'Finish Time', render: (r) => formatTime(r.end_time) },
              { key: 'status', header: 'Status', render: (r) => <span className={`badge badge--${STATUS_BADGE[r.status]}`}>{r.status.replace('_', ' ')}</span> },
              { key: 'wastage_qty', header: 'Waste', render: (r) => Number(r.wastage_qty) > 0 ? `${num(r.wastage_qty)} ${r.unit}` : '—' },
              { key: 'estimated_cost', header: 'Est. Production Cost', render: (r) => r.estimated_cost != null ? money(r.estimated_cost) : '—' },
              { key: 'qc_status', header: 'Quality Result', render: (r) => <span className={`badge badge--${QC_BADGE[r.qc_status]}`}>{r.qc_status}</span> }
            ]}
            rows={rows.orders}
            emptyText="No production orders on this day."
          />
        )}
      </div>
    </div>
  );
}

export default function CapacityCalendarTab() {
  const [deptKey, setDeptKey] = useState(DEPARTMENTS[0].key);
  const department = DEPARTMENTS.find((d) => d.key === deptKey);
  const [monthDate, setMonthDate] = useState(() => { const d = new Date(); d.setDate(1); return d; });
  const [selectedDay, setSelectedDay] = useState(null);

  const monthStart = monthDate;
  const monthEnd = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0);
  const from = toISODate(monthStart);
  const to = toISODate(monthEnd);
  const today = toISODate(new Date());

  const { rows: data } = useApi(`/production/capacity-calendar?production_type=${deptKey}&from=${from}&to=${to}`, [deptKey, from, to]);

  const dayMap = useMemo(() => {
    const map = {};
    for (const d of data?.days || []) map[String(d.date)] = d;
    return map;
  }, [data]);

  const calendarCells = useMemo(() => {
    const firstWeekday = monthStart.getDay();
    const daysInMonth = monthEnd.getDate();
    const cells = Array(firstWeekday).fill(null);
    for (let day = 1; day <= daysInMonth; day++) {
      const dateObj = new Date(monthDate.getFullYear(), monthDate.getMonth(), day);
      cells.push(toISODate(dateObj));
    }
    return cells;
  }, [monthDate]);

  function changeMonth(delta) {
    setMonthDate((d) => new Date(d.getFullYear(), d.getMonth() + delta, 1));
  }

  const trendData = (data?.days || []).map((d) => ({
    label: String(d.date).slice(8, 10), Planned: d.planned_qty, Actual: d.actual_qty
  }));
  const downtimeData = (data?.downtime_by_category || []).map((r) => ({
    name: r.category.replace('_', ' '), Hours: Number(r.hours.toFixed(1))
  }));
  const wasteData = (data?.waste_by_product || []).map((r) => ({ name: r.product_name, Waste: r.wastage_qty }));
  const PIE_COLORS = ['#0F5E75', '#14B8A6', '#f59e0b', '#dc2626'];

  return (
    <div>
      <div className="toolbar">
        {DEPARTMENTS.map((d) => {
          const Icon = d.icon;
          return (
            <button key={d.key} className={d.key === deptKey ? 'btn' : 'secondary'} onClick={() => setDeptKey(d.key)}>
              <Icon size={14} /> {d.label}
            </button>
          );
        })}
      </div>

      {!data ? <p className="muted">Loading…</p> : (
        <>
          <div className="kpi-grid">
            <div className="kpi-card"><div className="kpi-card__label">Planned Capacity</div><div className="kpi-card__value">{num(data.summary.planned_capacity)} <span style={{ fontSize: 13 }}>{department.unitLabel}</span></div></div>
            <div className="kpi-card"><div className="kpi-card__label">Actual Production</div><div className="kpi-card__value">{num(data.summary.actual_production)} <span style={{ fontSize: 13 }}>{department.unitLabel}</span></div></div>
            <div className="kpi-card"><div className="kpi-card__label">Capacity Utilization</div><div className="kpi-card__value">{data.summary.utilization_pct.toFixed(1)}%</div></div>
            <div className="kpi-card"><div className="kpi-card__label">Production Efficiency</div><div className="kpi-card__value">{data.summary.efficiency_pct.toFixed(1)}%</div></div>
            <div className="kpi-card"><div className="kpi-card__label">Waste %</div><div className="kpi-card__value" style={{ color: data.summary.waste_pct > 5 ? 'var(--danger)' : undefined }}>{data.summary.waste_pct.toFixed(1)}%</div></div>
            <div className="kpi-card"><div className="kpi-card__label">Machine Downtime</div><div className="kpi-card__value">{data.summary.machine_downtime_hours.toFixed(1)}h</div></div>
            <div className="kpi-card"><div className="kpi-card__label">Active Machines</div><div className="kpi-card__value">{data.summary.active_machines}</div></div>
            <div className="kpi-card"><div className="kpi-card__label">Completed Orders</div><div className="kpi-card__value">{data.summary.completed_orders}</div></div>
          </div>

          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <button className="btn-icon" onClick={() => changeMonth(-1)}><ChevronLeft size={16} /></button>
              <h3 style={{ margin: 0 }}><Gauge size={16} style={{ verticalAlign: -3 }} /> {department.label} Capacity — {monthDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</h3>
              <button className="btn-icon" onClick={() => changeMonth(1)}><ChevronRight size={16} /></button>
            </div>

            <div style={{ display: 'flex', gap: 14, marginBottom: 12, fontSize: 12, color: 'var(--text-muted)', flexWrap: 'wrap' }}>
              <span><span style={{ display: 'inline-block', width: 10, height: 10, background: 'var(--bg-success, #dcfce7)', border: '1px solid var(--success)', marginRight: 5, verticalAlign: -1 }} /> 0–69% utilization</span>
              <span><span style={{ display: 'inline-block', width: 10, height: 10, background: '#fef3c7', border: '1px solid #92400e', marginRight: 5, verticalAlign: -1 }} /> 70–90%</span>
              <span><span style={{ display: 'inline-block', width: 10, height: 10, background: 'var(--bg-danger, #fee2e2)', border: '1px solid var(--danger)', marginRight: 5, verticalAlign: -1 }} /> Over 90%</span>
              <span><span style={{ display: 'inline-block', width: 10, height: 10, border: '2px solid #2563eb', marginRight: 5, verticalAlign: -1 }} /> Today</span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6 }}>
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((w) => (
                <div key={w} style={{ textAlign: 'center', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', padding: '4px 0' }}>{w}</div>
              ))}
              {calendarCells.map((iso, i) => {
                if (!iso) return <div key={`empty-${i}`} />;
                const day = dayMap[iso];
                const isToday = iso === today;
                const util = day?.utilization_pct || 0;
                const colors = day ? utilizationColor(util) : { bg: 'var(--surface)', text: 'var(--text-muted)' };
                const dayNum = Number(iso.slice(8, 10));
                return (
                  <button
                    key={iso}
                    onClick={() => day && setSelectedDay(iso)}
                    disabled={!day}
                    style={{
                      textAlign: 'left', padding: 8, minHeight: 84, borderRadius: 6, cursor: day ? 'pointer' : 'default',
                      background: colors.bg, border: isToday ? '2px solid #2563eb' : '1px solid var(--border-light)',
                      display: 'flex', flexDirection: 'column', gap: 2
                    }}
                  >
                    <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)' }}>{dayNum}</span>
                    {day ? (
                      <>
                        <span style={{ fontSize: 15, fontWeight: 700, color: colors.text }}>{util.toFixed(1)}%</span>
                        <span style={{ fontSize: 10, color: colors.text }}>{num(day.actual_qty)}/{num(day.planned_qty)} {department.unitLabel}</span>
                        <span style={{ fontSize: 10, color: colors.text }}>{day.order_count} orders · {day.running_count} running · {day.completed_count} done</span>
                      </>
                    ) : <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>No orders</span>}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="chart-grid">
            <div className="card">
              <h3>Machine Utilization</h3>
              {data.machine_utilization.length ? (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={data.machine_utilization.map((m) => ({ name: m.machine_name, 'Utilization %': Number(m.utilization_pct.toFixed(1)) }))} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-15} textAnchor="end" height={50} />
                    <YAxis tick={{ fontSize: 11 }} width={45} />
                    <Tooltip />
                    <Bar dataKey="Utilization %" fill={department.color} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : <p className="muted">No machines assigned to this department.</p>}
            </div>

            <div className="card">
              <h3>Production Trend</h3>
              {trendData.length ? (
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={trendData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} width={45} />
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Line type="monotone" dataKey="Planned" stroke="#94a3b8" strokeDasharray="4 3" />
                    <Line type="monotone" dataKey="Actual" stroke={department.color} strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              ) : <p className="muted">No production recorded this month.</p>}
            </div>

            <div className="card">
              <h3>Downtime Analysis</h3>
              {downtimeData.length ? (
                <ResponsiveContainer width="100%" height={240}>
                  <PieChart>
                    <Pie data={downtimeData} dataKey="Hours" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
                      {downtimeData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v) => `${v}h`} />
                  </PieChart>
                </ResponsiveContainer>
              ) : <p className="muted">No downtime recorded this month.</p>}
            </div>

            <div className="card">
              <h3>Waste Analysis</h3>
              {wasteData.length ? (
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={wasteData} layout="vertical" margin={{ top: 5, right: 20, left: 20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis type="number" tick={{ fontSize: 11 }} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={140} />
                    <Tooltip />
                    <Bar dataKey="Waste" fill="#dc2626" />
                  </BarChart>
                </ResponsiveContainer>
              ) : <p className="muted">No wastage recorded this month.</p>}
            </div>
          </div>
        </>
      )}

      {selectedDay && <DayModal department={department} date={selectedDay} onClose={() => setSelectedDay(null)} />}
    </div>
  );
}
