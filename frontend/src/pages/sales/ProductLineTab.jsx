import { useMemo } from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { Package, DollarSign, AlertTriangle, TrendingUp } from 'lucide-react';
import { useApi } from '../../components/useApi';
import Table from '../../components/Table';
import { CATEGORY_ID } from './productLines';

// Shared shell for a single-business-line dashboard (Bottled Water, Ice, ...). Every
// number here is scoped to products in ONE category, joined client-side against the
// existing /reports/sales and /reports/inventory endpoints (both already return
// product_name) against the /products list for that category_id — no backend change,
// no cross-contamination with the other product lines.
export default function ProductLineTab({ categoryKey, label, color = 'var(--primary)' }) {
  const categoryId = CATEGORY_ID[categoryKey];
  const { rows: products } = useApi(`/products?category_id=${categoryId}`);
  const { rows: sales } = useApi('/reports/sales');
  const { rows: inventory } = useApi('/reports/inventory');

  const productNames = useMemo(() => new Set((products || []).map((p) => p.name)), [products]);

  const lineSales = useMemo(() => (sales || []).filter((r) => productNames.has(r.product_name)), [sales, productNames]);
  const lineInventory = useMemo(() => (inventory || []).filter((r) => productNames.has(r.product_name)), [inventory, productNames]);

  const totalRevenue = lineSales.reduce((s, r) => s + Number(r.revenue), 0);
  const totalUnits = lineSales.reduce((s, r) => s + Number(r.units_sold), 0);
  const lowStockCount = lineInventory.filter((r) => r.is_low_stock).length;
  const stockValue = lineInventory.reduce((s, r) => s + Number(r.stock_value), 0);

  const byProduct = useMemo(() => {
    const map = {};
    for (const r of lineSales) {
      map[r.product_name] = (map[r.product_name] || 0) + Number(r.revenue);
    }
    return Object.entries(map).sort((a, b) => b[1] - a[1]).map(([name, revenue]) => ({ name: name.replace(label, '').trim() || name, Revenue: revenue }));
  }, [lineSales, label]);

  const byCustomer = useMemo(() => {
    const map = {};
    for (const r of lineSales) {
      if (!map[r.customer_name]) map[r.customer_name] = { customer_name: r.customer_name, units: 0, revenue: 0 };
      map[r.customer_name].units += Number(r.units_sold);
      map[r.customer_name].revenue += Number(r.revenue);
    }
    return Object.values(map).sort((a, b) => b.revenue - a.revenue).slice(0, 8);
  }, [lineSales]);

  if (!products || !sales || !inventory) return <p className="muted">Loading…</p>;

  return (
    <div>
      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-card__top"><div className="kpi-card__icon"><DollarSign size={18} /></div></div>
          <div className="kpi-card__label">Total Revenue</div>
          <div className="kpi-card__value">${totalRevenue.toFixed(2)}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-card__top"><div className="kpi-card__icon kpi-card__icon--accent"><TrendingUp size={18} /></div></div>
          <div className="kpi-card__label">Units Sold</div>
          <div className="kpi-card__value">{totalUnits.toLocaleString()}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-card__top"><div className="kpi-card__icon kpi-card__icon--success"><Package size={18} /></div></div>
          <div className="kpi-card__label">Stock Value</div>
          <div className="kpi-card__value">${stockValue.toFixed(2)}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-card__top"><div className={`kpi-card__icon${lowStockCount > 0 ? ' kpi-card__icon--danger' : ' kpi-card__icon--success'}`}><AlertTriangle size={18} /></div></div>
          <div className="kpi-card__label">Low Stock SKUs</div>
          <div className="kpi-card__value" style={{ color: lowStockCount > 0 ? 'var(--danger)' : undefined }}>{lowStockCount}</div>
        </div>
      </div>

      <div className="chart-grid">
        <div className="card">
          <h3>Revenue by Product</h3>
          {byProduct.length ? (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={byProduct} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-20} textAnchor="end" height={60} />
                <YAxis tick={{ fontSize: 11 }} width={55} />
                <Tooltip formatter={(v) => `$${Number(v).toFixed(2)}`} />
                <Bar dataKey="Revenue" fill={color} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <p className="muted">No sales recorded for {label} yet.</p>}
        </div>
        <div className="card">
          <h3>Top Customers</h3>
          <Table
            columns={[
              { key: 'customer_name', header: 'Customer' },
              { key: 'units', header: 'Units', render: (r) => Number(r.units).toLocaleString() },
              { key: 'revenue', header: 'Revenue', render: (r) => `$${r.revenue.toFixed(2)}` }
            ]}
            rows={byCustomer}
            emptyText={`No ${label} sales recorded yet.`}
          />
        </div>
      </div>

      <div className="card">
        <h3>Stock Levels</h3>
        <Table
          columns={[
            { key: 'warehouse_name', header: 'Warehouse' },
            { key: 'product_name', header: 'Product' },
            { key: 'quantity', header: 'Qty', render: (r) => `${Number(r.quantity).toLocaleString()} ${r.unit}` },
            { key: 'stock_value', header: 'Stock Value', render: (r) => `$${Number(r.stock_value).toFixed(2)}` },
            { key: 'is_low_stock', header: 'Status', render: (r) => <span className={`badge badge--${r.is_low_stock ? 'low' : 'ok'}`}>{r.is_low_stock ? 'Low' : 'OK'}</span> }
          ]}
          rows={lineInventory}
          emptyText={`No ${label} stock recorded yet.`}
          searchable sortable
        />
      </div>
    </div>
  );
}
