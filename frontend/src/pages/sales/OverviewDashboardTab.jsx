import { useMemo } from 'react';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend } from 'recharts';
import { DollarSign, ClipboardList, Truck, AlertTriangle } from 'lucide-react';
import { useApi } from '../../components/useApi';
import Table from '../../components/Table';
import { buildProductLineMap, LINE_LABEL } from './productLines';

const LINE_COLOR = { bulk: '#0F5E75', bottled: '#14B8A6', ice: '#7dd3fc', other: '#cbd5e1' };

// The one cross-line view in the module — everything else (RO Water, Bottled Water,
// Ice) is deliberately scoped to a single product line so their numbers never mix.
// This page exists purely to answer "how is the whole sales operation doing today",
// and every figure here is a genuine total across all three lines, not a stand-in
// for any one of them.
export default function OverviewDashboardTab() {
  const { rows: cash } = useApi('/reports/cash-summary');
  const { rows: debtors } = useApi('/reports/debtors');
  const { rows: deliveries } = useApi('/sales/deliveries');
  const { rows: orders } = useApi('/sales/orders');
  const { rows: products } = useApi('/products?type=finished_good');
  const { rows: sales } = useApi('/reports/sales');

  const lineMap = useMemo(() => buildProductLineMap(products), [products]);
  const revenueByLine = useMemo(() => {
    const totals = { bulk: 0, bottled: 0, ice: 0, other: 0 };
    for (const r of sales || []) {
      const line = lineMap[r.product_name] || 'other';
      totals[line] += Number(r.revenue);
    }
    return Object.entries(totals).filter(([, v]) => v > 0).map(([key, value]) => ({ name: LINE_LABEL[key], value, key }));
  }, [sales, lineMap]);

  const today = new Date().toISOString().slice(0, 10);
  const ordersToday = (orders || []).filter((o) => String(o.order_date).slice(0, 10) === today);
  const ordersTodayRevenue = ordersToday.reduce((s, o) => s + Number(o.total_amount), 0);
  const pendingDeliveries = (deliveries || []).filter((d) => ['scheduled', 'in_transit'].includes(d.status)).length;

  if (!cash || !debtors) return <p className="muted">Loading…</p>;

  return (
    <div>
      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-card__top"><div className="kpi-card__icon"><DollarSign size={18} /></div></div>
          <div className="kpi-card__label">Collected Today</div>
          <div className="kpi-card__value">${Number(cash.total_collected).toFixed(2)}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-card__top"><div className="kpi-card__icon kpi-card__icon--accent"><ClipboardList size={18} /></div></div>
          <div className="kpi-card__label">Orders Today</div>
          <div className="kpi-card__value">{ordersToday.length}</div>
          <div className="kpi-card__sub">${ordersTodayRevenue.toFixed(2)} total</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-card__top"><div className="kpi-card__icon kpi-card__icon--warning"><Truck size={18} /></div></div>
          <div className="kpi-card__label">Pending Deliveries</div>
          <div className="kpi-card__value">{pendingDeliveries}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-card__top"><div className="kpi-card__icon kpi-card__icon--danger"><AlertTriangle size={18} /></div></div>
          <div className="kpi-card__label">Outstanding Receivables</div>
          <div className="kpi-card__value">${Number(debtors.total_outstanding).toFixed(2)}</div>
          <div className="kpi-card__sub">{debtors.debtors.length} customers</div>
        </div>
      </div>

      <div className="chart-grid">
        <div className="card">
          <h3>Revenue Split by Business Line</h3>
          {revenueByLine.length ? (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie data={revenueByLine} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label={(e) => `${e.name}: $${e.value.toFixed(0)}`}>
                  {revenueByLine.map((entry) => <Cell key={entry.key} fill={LINE_COLOR[entry.key]} />)}
                </Pie>
                <Tooltip formatter={(v) => `$${Number(v).toFixed(2)}`} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          ) : <p className="muted">No sales recorded yet.</p>}
        </div>
        <div className="card">
          <h3>Cash vs Credit (Today)</h3>
          <Table
            columns={[
              { key: 'sale_type', header: 'Sale Type' },
              { key: 'order_count', header: 'Orders' },
              { key: 'total', header: 'Total', render: (r) => `$${Number(r.total).toFixed(2)}` }
            ]}
            rows={cash.sale_type_split}
            emptyText="No sales recorded today."
          />
        </div>
      </div>

      <div className="card">
        <h3>Top Debtors</h3>
        <Table
          columns={[
            { key: 'hno', header: 'HNO', render: (r) => r.hno || '—' },
            { key: 'name', header: 'Customer' },
            { key: 'qaade_name', header: 'Route', render: (r) => r.qaade_name || '—' },
            { key: 'balance', header: 'Balance', render: (r) => `$${Number(r.balance).toFixed(2)}` }
          ]}
          rows={debtors.debtors.slice(0, 8)}
          emptyText="No outstanding balances."
        />
      </div>
    </div>
  );
}
