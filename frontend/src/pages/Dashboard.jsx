import { useState } from 'react';
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend
} from 'recharts';
import {
  LayoutDashboard, Droplets, Snowflake, AlertTriangle, DollarSign, TrendingUp,
  TrendingDown, Truck, Wrench, Users, Wallet, Package, Receipt
} from 'lucide-react';
import { useApi } from '../components/useApi';
import Table from '../components/Table';
import DateFilterBar, { defaultDateRange } from '../components/DateFilterBar';
import { daysBetween } from '../utils/dateRanges';

const COLORS = { revenue: '#0F5E75', cost: '#dc2626', roWater: '#0b4a5c', bottling: '#0F5E75', ice: '#14B8A6', bar: '#0F5E75' };

function shortDate(d) {
  return new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
function money(v) { return `$${Number(v || 0).toFixed(2)}`; }

function RevenueCostChart({ dateRange }) {
  const days = daysBetween(dateRange.from, dateRange.to);
  const { rows } = useApi(`/reports/revenue-trend?days=${days}`, [days]);
  if (!rows) return <p className="muted">Loading…</p>;
  const data = rows.map((r) => ({ day: shortDate(r.day), Revenue: Number(r.revenue), Cost: Number(r.cost) }));
  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis dataKey="day" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
        <YAxis tick={{ fontSize: 11 }} width={50} />
        <Tooltip formatter={(v) => `$${Number(v).toFixed(2)}`} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Line type="monotone" dataKey="Revenue" stroke={COLORS.revenue} strokeWidth={2} dot={false} />
        <Line type="monotone" dataKey="Cost" stroke={COLORS.cost} strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

function ProductionTrendChart({ dateRange }) {
  const days = daysBetween(dateRange.from, dateRange.to);
  const { rows } = useApi(`/reports/production-trend?days=${days}`, [days]);
  if (!rows) return <p className="muted">Loading…</p>;
  const data = rows.map((r) => ({ day: shortDate(r.day), 'RO Water (m³)': Number(r.ro_water), 'Bottling (box)': Number(r.bottling), 'Ice (kg)': Number(r.ice) }));
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis dataKey="day" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
        <YAxis tick={{ fontSize: 11 }} width={50} />
        <Tooltip />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="RO Water (m³)" stackId="a" fill={COLORS.roWater} />
        <Bar dataKey="Bottling (box)" stackId="a" fill={COLORS.bottling} />
        <Bar dataKey="Ice (kg)" stackId="a" fill={COLORS.ice} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function TopProductsChart({ dateRange }) {
  const { rows } = useApi(`/reports/sales?from=${dateRange.from}&to=${dateRange.to}`, [dateRange.from, dateRange.to]);
  if (!rows) return <p className="muted">Loading…</p>;
  const byProduct = {};
  for (const r of rows) byProduct[r.product_name] = (byProduct[r.product_name] || 0) + Number(r.revenue);
  const data = Object.entries(byProduct)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, revenue]) => ({ name: name.length > 20 ? name.slice(0, 18) + '…' : name, Revenue: revenue }));

  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} layout="vertical" margin={{ top: 5, right: 20, left: 10, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis type="number" tick={{ fontSize: 11 }} />
        <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={130} />
        <Tooltip formatter={(v) => `$${Number(v).toFixed(2)}`} />
        <Bar dataKey="Revenue" fill={COLORS.bar} radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function StockValueByWarehouseChart() {
  const { rows } = useApi('/reports/inventory');
  if (!rows) return <p className="muted">Loading…</p>;
  const byWarehouse = {};
  for (const r of rows) byWarehouse[r.warehouse_name] = (byWarehouse[r.warehouse_name] || 0) + Number(r.stock_value);
  const data = Object.entries(byWarehouse).map(([name, value]) => ({ name, Value: value }));

  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis dataKey="name" tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 11 }} width={60} />
        <Tooltip formatter={(v) => `$${Number(v).toFixed(2)}`} />
        <Bar dataKey="Value" fill={COLORS.bar} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function KpiCard({ icon: Icon, tone, label, value, sub }) {
  return (
    <div className="kpi-card">
      <div className="kpi-card__top">
        <div className={`kpi-card__icon${tone ? ` kpi-card__icon--${tone}` : ''}`}><Icon size={18} /></div>
      </div>
      <div className="kpi-card__label">{label}</div>
      <div className="kpi-card__value">{value}</div>
      {sub && <div className="kpi-card__sub">{sub}</div>}
    </div>
  );
}

function RecentTransactionsCard() {
  const { rows } = useApi('/finance/journal-entries');
  const recent = rows?.slice(0, 6);
  return (
    <div className="card">
      <div className="card__header"><h3><Receipt size={16} /> Recent Transactions</h3></div>
      <Table
        columns={[
          { key: 'entry_number', header: 'Entry #' },
          { key: 'description', header: 'Description' },
          { key: 'status', header: 'Status', render: (r) => <span className={`badge badge--${r.status === 'posted' ? 'ok' : r.status === 'draft' ? 'pending' : 'low'}`}>{r.status}</span> },
          { key: 'total', header: 'Amount', render: (r) => money(r.total) }
        ]}
        rows={recent}
        emptyText="No transactions recorded yet."
      />
    </div>
  );
}

function TopCustomersCard() {
  const { rows } = useApi('/reports/sales-by-customer');
  const top = rows?.slice(0, 5);
  return (
    <div className="card">
      <div className="card__header"><h3><Users size={16} /> Top Customers</h3></div>
      <Table
        columns={[
          { key: 'name', header: 'Customer' },
          { key: 'order_count', header: 'Orders' },
          { key: 'total_sales', header: 'Total Sales', render: (r) => money(r.total_sales) }
        ]}
        rows={top}
        emptyText="No sales recorded yet."
      />
    </div>
  );
}

function OutstandingReceivablesCard() {
  const { rows } = useApi('/reports/debtors');
  const top = rows?.debtors?.slice(0, 5);
  return (
    <div className="card">
      <div className="card__header">
        <h3><DollarSign size={16} /> Outstanding Receivables</h3>
        {rows && <span className="badge badge--low">{money(rows.total_outstanding)} total</span>}
      </div>
      <Table
        columns={[
          { key: 'name', header: 'Customer' },
          { key: 'balance', header: 'Balance', render: (r) => money(r.balance) },
          { key: 'days_overdue', header: 'Overdue', render: (r) => <span className={r.days_overdue > 0 ? 'badge badge--low' : 'badge badge--ok'}>{r.days_overdue ?? 0}d</span> }
        ]}
        rows={top}
        emptyText="No outstanding balances."
      />
    </div>
  );
}

function CashPositionCard() {
  const { rows: flow } = useApi('/reports/cash-flow');
  const { rows: banks } = useApi('/finance/bank-accounts');
  return (
    <div className="card">
      <div className="card__header"><h3><Wallet size={16} /> Cash Position</h3></div>
      {flow && (
        <div className="kpi-card__value" style={{ marginBottom: 12 }}>{money(flow.closing_balance)}</div>
      )}
      <Table
        columns={[
          { key: 'name', header: 'Account' },
          { key: 'current_balance', header: 'Balance', render: (r) => money(r.current_balance) }
        ]}
        rows={banks}
        emptyText="No bank accounts configured."
      />
    </div>
  );
}

function InventoryAlertsCard() {
  const { rows } = useApi('/inventory/low-stock');
  return (
    <div className="card">
      <div className="card__header">
        <h3><AlertTriangle size={16} /> Inventory Alerts</h3>
        {rows && <span className="badge badge--low">{rows.length} low</span>}
      </div>
      <Table
        columns={[
          { key: 'name', header: 'Product' },
          { key: 'warehouse_name', header: 'Warehouse' },
          { key: 'quantity', header: 'Qty', render: (r) => Number(r.quantity).toLocaleString() },
          { key: 'reorder_level', header: 'Reorder At' }
        ]}
        rows={rows?.slice(0, 6)}
        emptyText="Nothing below reorder level."
      />
    </div>
  );
}

export default function Dashboard() {
  const { rows: summary } = useApi('/reports/dashboard-summary');
  const [dateRange, setDateRange] = useState(defaultDateRange());

  if (!summary) return <p className="muted">Loading dashboard…</p>;

  const revenueMtd = Number(summary.revenue_vs_cost_mtd.revenue_mtd);
  const costMtd = Number(summary.revenue_vs_cost_mtd.cost_mtd);
  const profitMtd = revenueMtd - costMtd;
  const productionToday = summary.production_today.reduce((acc, p) => ({ ...acc, [p.production_type]: p.total }), {});
  const pendingDeliveries = summary.pending_deliveries.reduce((sum, d) => sum + Number(d.count), 0);

  return (
    <div>
      <div className="page-header">
        <h1><LayoutDashboard size={22} color="var(--primary)" /> Dashboard</h1>
        <DateFilterBar value={dateRange} onChange={setDateRange} title="Dashboard Trends" />
      </div>

      <div className="kpi-grid">
        <KpiCard icon={Droplets} tone="info" label="RO Water Today" value={`${productionToday.RO_WATER || 0} m³`} />
        <KpiCard icon={Snowflake} tone="accent" label="Ice Produced Today" value={`${productionToday.ICE || 0} kg`} />
        <KpiCard icon={AlertTriangle} tone={summary.low_stock_count > 0 ? 'danger' : 'success'} label="Low Stock Alerts" value={summary.low_stock_count} />
        <KpiCard icon={TrendingUp} tone="success" label="Sales Today" value={money(summary.sales_today.revenue)} sub={`${summary.sales_today.order_count} orders`} />
        <KpiCard
          icon={profitMtd >= 0 ? TrendingUp : TrendingDown} tone={profitMtd >= 0 ? 'success' : 'danger'}
          label="Revenue vs Cost (MTD)" value={money(revenueMtd)} sub={`Cost: ${money(costMtd)} · Profit: ${money(profitMtd)}`}
        />
        <KpiCard icon={Truck} tone="info" label="Pending Deliveries" value={pendingDeliveries} />
        <KpiCard icon={Wrench} tone="warning" label="Maintenance Due (7 days)" value={summary.maintenance_due_count} />
        <KpiCard icon={DollarSign} tone="danger" label="Outstanding Receivables" value={money(summary.outstanding_receivables)} />
      </div>

      <div className="chart-grid">
        <div className="card">
          <h3>Revenue vs Cost — {dateRange.label}</h3>
          <RevenueCostChart dateRange={dateRange} />
        </div>
        <div className="card">
          <h3>Production Output — {dateRange.label}</h3>
          <ProductionTrendChart dateRange={dateRange} />
        </div>
        <div className="card">
          <h3>Top Products by Revenue — {dateRange.label}</h3>
          <TopProductsChart dateRange={dateRange} />
        </div>
        <div className="card">
          <h3>Stock Value by Warehouse</h3>
          <StockValueByWarehouseChart />
        </div>
      </div>

      <div className="chart-grid">
        <RecentTransactionsCard />
        <TopCustomersCard />
        <OutstandingReceivablesCard />
        <CashPositionCard />
        <InventoryAlertsCard />
        <div className="card">
          <div className="card__header"><h3><Package size={16} /> Machine Downtime — Last 7 Days</h3></div>
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
    </div>
  );
}
