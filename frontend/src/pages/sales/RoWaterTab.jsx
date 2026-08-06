import { Droplets, Truck, DollarSign, Gauge } from 'lucide-react';
import { useApi } from '../../components/useApi';
import Table from '../../components/Table';
import TanksTab from './TanksTab';

// RO / Bulk Water is its own business line — tanker-delivered water sold by the liter,
// invoiced with a delivery fee, tracked against customer-owned tanks. Kept fully
// separate from Bottled Water and Ice, which have different units, pricing, and
// customer bases.
export default function RoWaterTab() {
  const { rows: d } = useApi('/reports/water-dashboard');
  if (!d) return <p className="muted">Loading…</p>;

  return (
    <div>
      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-card__top"><div className="kpi-card__icon"><Droplets size={18} /></div></div>
          <div className="kpi-card__label">Water Sold Today</div>
          <div className="kpi-card__value">{Number(d.water_sold_today_liters).toLocaleString()} L</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-card__top"><div className="kpi-card__icon kpi-card__icon--accent"><Truck size={18} /></div></div>
          <div className="kpi-card__label">Deliveries Completed Today</div>
          <div className="kpi-card__value">{d.deliveries_completed_today}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-card__top"><div className="kpi-card__icon kpi-card__icon--success"><Gauge size={18} /></div></div>
          <div className="kpi-card__label">Tanker Utilization</div>
          <div className="kpi-card__value">{d.tanker_utilization_pct.toFixed(0)}%</div>
          <div className="kpi-card__sub">{Number(d.total_loaded_today).toLocaleString()} L loaded today</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-card__top"><div className="kpi-card__icon kpi-card__icon--danger"><DollarSign size={18} /></div></div>
          <div className="kpi-card__label">Total Unpaid Balances</div>
          <div className="kpi-card__value" style={{ color: d.total_unpaid > 0 ? 'var(--danger)' : undefined }}>
            ${Number(d.total_unpaid).toFixed(2)}
          </div>
        </div>
      </div>

      <div className="chart-grid">
        <div className="card">
          <h3>Top Bulk Water Customers (last 30 days)</h3>
          <Table
            columns={[
              { key: 'customer_name', header: 'Customer' },
              { key: 'liters', header: 'Liters', render: (r) => Number(r.liters).toLocaleString() },
              { key: 'revenue', header: 'Revenue', render: (r) => `$${Number(r.revenue).toFixed(2)}` }
            ]}
            rows={d.top_customers}
            emptyText="No bulk water sales in the last 30 days."
          />
        </div>
        <div className="card">
          <h3>Unpaid Balances</h3>
          <Table
            columns={[
              { key: 'customer_name', header: 'Customer' },
              { key: 'balance', header: 'Balance', render: (r) => `$${Number(r.balance).toFixed(2)}` }
            ]}
            rows={d.unpaid_balances}
            emptyText="No outstanding balances."
          />
        </div>
      </div>

      <div className="card">
        <h3>Today's Route Performance</h3>
        <Table
          columns={[
            { key: 'driver_name', header: 'Driver' },
            { key: 'plate_number', header: 'Truck' },
            { key: 'delivered_count', header: 'Delivered' },
            { key: 'pending_count', header: 'Pending' },
            { key: 'liters_delivered', header: 'Liters Delivered', render: (r) => Number(r.liters_delivered).toLocaleString() }
          ]}
          rows={d.route_performance_today}
          emptyText="No routes dispatched today."
        />
      </div>

      <div style={{ marginTop: 24 }}>
        <h3 className="section-title">Customer Tanks</h3>
        <p className="muted" style={{ marginTop: -6, marginBottom: 14 }}>Bulk water storage assets registered per customer — tanks, drums, and underground reservoirs.</p>
        <TanksTab />
      </div>
    </div>
  );
}
