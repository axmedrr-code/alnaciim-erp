import { useState } from 'react';
import { Wallet, Users, Receipt, TrendingUp, MapPin, Factory, Package, BarChart3 } from 'lucide-react';
import { useApi } from '../../components/useApi';
import Table from '../../components/Table';
import GroupedTabs from '../../components/GroupedTabs';
import DateFilterBar, { defaultDateRange, ComparisonNote } from '../../components/DateFilterBar';

// Reports that only ever describe "current state" (what's in stock right now, who
// currently owes money) don't get the date filter — a date range doesn't mean
// anything for a point-in-time snapshot. Everything else here is a transaction
// report over a period, which is exactly what the global DateFilterBar is for.

function InventoryReport() {
  const { rows } = useApi('/reports/inventory');
  return (
    <div className="card">
      <Table
        columns={[
          { key: 'warehouse_name', header: 'Warehouse' },
          { key: 'product_name', header: 'Product' },
          { key: 'product_type', header: 'Type' },
          { key: 'quantity', header: 'Qty', render: (r) => `${Number(r.quantity).toLocaleString()} ${r.unit}` },
          { key: 'stock_value', header: 'Stock Value', render: (r) => `$${Number(r.stock_value).toFixed(2)}` },
          { key: 'is_low_stock', header: 'Status', render: (r) => <span className={`badge badge--${r.is_low_stock ? 'low' : 'ok'}`}>{r.is_low_stock ? 'Low' : 'OK'}</span> }
        ]}
        rows={rows}
        searchable searchPlaceholder="Search inventory…" sortable pageSize={15}
      />
    </div>
  );
}

function ProductionReport() {
  const { rows } = useApi('/reports/production');
  return (
    <div className="card">
      <Table
        columns={[
          { key: 'day', header: 'Date', render: (r) => new Date(r.day).toLocaleDateString() },
          { key: 'production_type', header: 'Type' },
          { key: 'total_planned', header: 'Planned' },
          { key: 'total_actual', header: 'Actual' },
          { key: 'batch_count', header: 'Batches' }
        ]}
        rows={rows}
        searchable sortable
      />
    </div>
  );
}

function SalesReport() {
  const [dateRange, setDateRange] = useState(defaultDateRange());
  const { rows } = useApi(`/reports/sales?from=${dateRange.from}&to=${dateRange.to}`, [dateRange.from, dateRange.to]);
  const columns = [
    { key: 'product_name', header: 'Product' },
    { key: 'customer_name', header: 'Customer' },
    { key: 'sales_rep_name', header: 'Sales Rep' },
    { key: 'units_sold', header: 'Units Sold' },
    { key: 'revenue', header: 'Revenue', render: (r) => `$${Number(r.revenue).toFixed(2)}` }
  ];
  return (
    <div>
      <div className="toolbar"><DateFilterBar value={dateRange} onChange={setDateRange} columns={columns} rows={rows || []} title="Sales Report" /></div>
      <div className="card">
        <Table columns={columns} rows={rows} searchable searchPlaceholder="Search sales…" sortable pageSize={15} />
      </div>
    </div>
  );
}

function StockMovementReport() {
  const [dateRange, setDateRange] = useState(defaultDateRange());
  const { rows } = useApi(`/reports/stock-movements?from=${dateRange.from}&to=${dateRange.to}`, [dateRange.from, dateRange.to]);
  const columns = [
    { key: 'created_at', header: 'Date', render: (r) => new Date(r.created_at).toLocaleString() },
    { key: 'product_name', header: 'Product' },
    { key: 'warehouse_name', header: 'Warehouse' },
    { key: 'movement_type', header: 'Type' },
    { key: 'quantity', header: 'Qty' },
    { key: 'reference_type', header: 'Reference' },
    { key: 'performed_by_name', header: 'By' }
  ];
  return (
    <div>
      <div className="toolbar"><DateFilterBar value={dateRange} onChange={setDateRange} columns={columns} rows={rows || []} title="Stock Movement Report" /></div>
      <div className="card">
        <Table columns={columns} rows={rows} searchable searchPlaceholder="Search movements…" sortable pageSize={20} />
      </div>
    </div>
  );
}

function CashSummaryReport() {
  const [dateRange, setDateRange] = useState(defaultDateRange());
  const { rows } = useApi(`/reports/cash-summary?from=${dateRange.from}&to=${dateRange.to}`, [dateRange.from, dateRange.to]);
  const { rows: compareRows } = useApi(
    dateRange.compare ? `/reports/cash-summary?from=${dateRange.compare.from}&to=${dateRange.compare.to}` : null,
    [dateRange.compare?.from, dateRange.compare?.to]
  );
  if (!rows) return <p className="muted">Loading…</p>;
  return (
    <div>
      <div className="toolbar"><DateFilterBar value={dateRange} onChange={setDateRange} columns={[{ key: 'method', header: 'Method' }, { key: 'count', header: 'Count' }, { key: 'total', header: 'Total', render: (r) => `$${Number(r.total).toFixed(2)}` }]} rows={rows.by_method} title="Cash Summary" /></div>
      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-card__label">Total Collected</div>
          <div className="kpi-card__value">${Number(rows.total_collected).toFixed(2)}</div>
          <div className="kpi-card__sub">{rows.from} to {rows.to}</div>
          {dateRange.compare && <ComparisonNote current={rows.total_collected} previous={compareRows?.total_collected} />}
        </div>
      </div>
      <div className="card">
        <h3>By Payment Method</h3>
        <Table columns={[{ key: 'method', header: 'Method' }, { key: 'count', header: 'Count' }, { key: 'total', header: 'Total', render: (r) => `$${Number(r.total).toFixed(2)}` }]} rows={rows.by_method} />
      </div>
      <div className="card">
        <h3>Cash vs Credit Sales</h3>
        <Table columns={[{ key: 'sale_type', header: 'Sale Type' }, { key: 'order_count', header: 'Orders' }, { key: 'total', header: 'Total', render: (r) => `$${Number(r.total).toFixed(2)}` }]} rows={rows.sale_type_split} />
      </div>
    </div>
  );
}

function DebtorsReport() {
  const { rows } = useApi('/reports/debtors');
  if (!rows) return <p className="muted">Loading…</p>;
  return (
    <div>
      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-card__label">Total Outstanding</div>
          <div className="kpi-card__value" style={{ color: rows.total_outstanding > 0 ? '#dc2626' : undefined }}>
            ${Number(rows.total_outstanding).toFixed(2)}
          </div>
          <div className="kpi-card__sub">{rows.debtors.length} customers with an open balance</div>
        </div>
      </div>
      <div className="card">
        <Table
          columns={[
            { key: 'hno', header: 'HNO', render: (r) => r.hno || '—' },
            { key: 'name', header: 'Customer' },
            { key: 'phone', header: 'Phone' },
            { key: 'qaade_name', header: 'Qaade', render: (r) => r.qaade_name || '—' },
            { key: 'balance', header: 'Balance', render: (r) => `$${Number(r.balance).toFixed(2)}` },
            { key: 'credit_limit', header: 'Credit Limit', render: (r) => `$${Number(r.credit_limit).toFixed(2)}` },
            { key: 'days_overdue', header: 'Days Overdue', render: (r) => (
                <span className={r.days_overdue > 0 ? 'badge badge--low' : 'badge badge--ok'}>{r.days_overdue ?? 0}</span>
              ) }
          ]}
          rows={rows.debtors}
          emptyText="No outstanding customer balances."
          searchable searchPlaceholder="Search debtors…" sortable
        />
      </div>
    </div>
  );
}

function SalesByQaadeReport() {
  const [dateRange, setDateRange] = useState(defaultDateRange());
  const { rows } = useApi(`/reports/sales-by-qaade?from=${dateRange.from}&to=${dateRange.to}`, [dateRange.from, dateRange.to]);
  const columns = [
    { key: 'qaade_code', header: 'Code' },
    { key: 'name', header: 'Qaade' },
    { key: 'area', header: 'Area', render: (r) => r.area || '—' },
    { key: 'collector_name', header: 'Collector', render: (r) => r.collector_name || '—' },
    { key: 'order_count', header: 'Orders' },
    { key: 'cash_sales', header: 'Cash Sales', render: (r) => `$${Number(r.cash_sales).toFixed(2)}` },
    { key: 'credit_sales', header: 'Credit Sales', render: (r) => `$${Number(r.credit_sales).toFixed(2)}` },
    { key: 'total_sales', header: 'Total', render: (r) => `$${Number(r.total_sales).toFixed(2)}` }
  ];
  return (
    <div>
      <div className="toolbar"><DateFilterBar value={dateRange} onChange={setDateRange} columns={columns} rows={rows || []} title="Sales by Qaade" /></div>
      <div className="card">
        <Table columns={columns} rows={rows} emptyText="No qaades set up yet." searchable sortable />
      </div>
    </div>
  );
}

function SalesByCustomerReport() {
  const [dateRange, setDateRange] = useState(defaultDateRange());
  const { rows } = useApi(`/reports/sales-by-customer?from=${dateRange.from}&to=${dateRange.to}`, [dateRange.from, dateRange.to]);
  const columns = [
    { key: 'hno', header: 'HNO', render: (r) => r.hno || '—' },
    { key: 'name', header: 'Customer' },
    { key: 'type', header: 'Type' },
    { key: 'qaade_name', header: 'Qaade', render: (r) => r.qaade_name || '—' },
    { key: 'order_count', header: 'Orders' },
    { key: 'total_sales', header: 'Total Sales', render: (r) => `$${Number(r.total_sales).toFixed(2)}` }
  ];
  return (
    <div>
      <div className="toolbar"><DateFilterBar value={dateRange} onChange={setDateRange} columns={columns} rows={rows || []} title="Sales by Customer" /></div>
      <div className="card">
        <Table columns={columns} rows={rows} emptyText="No sales recorded yet." searchable searchPlaceholder="Search customers…" sortable pageSize={10} />
      </div>
    </div>
  );
}

function ExpensesReport() {
  const [dateRange, setDateRange] = useState(defaultDateRange());
  const { rows } = useApi(`/reports/expenses-summary?from=${dateRange.from}&to=${dateRange.to}`, [dateRange.from, dateRange.to]);
  const { rows: compareRows } = useApi(
    dateRange.compare ? `/reports/expenses-summary?from=${dateRange.compare.from}&to=${dateRange.compare.to}` : null,
    [dateRange.compare?.from, dateRange.compare?.to]
  );
  const columns = [
    { key: 'category_name', header: 'Category' },
    { key: 'type', header: 'Type' },
    { key: 'count', header: 'Count' },
    { key: 'total', header: 'Total', render: (r) => `$${Number(r.total).toFixed(2)}` }
  ];
  if (!rows) return <p className="muted">Loading…</p>;
  return (
    <div>
      <div className="toolbar"><DateFilterBar value={dateRange} onChange={setDateRange} columns={columns} rows={rows.categories} title="Expenses Report" /></div>
      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-card__label">Total Expenses</div>
          <div className="kpi-card__value">${Number(rows.total).toFixed(2)}</div>
          {dateRange.compare && <ComparisonNote current={rows.total} previous={compareRows?.total} />}
        </div>
      </div>
      <div className="card">
        <Table columns={columns} rows={rows.categories} />
      </div>
    </div>
  );
}

const GROUPS = [
  {
    key: 'financial', label: 'Financial', icon: Wallet,
    items: [
      { key: 'cash', label: 'Cash Summary', icon: Wallet, Component: CashSummaryReport },
      { key: 'debtors', label: 'Debtors', icon: Users, Component: DebtorsReport },
      { key: 'expenses', label: 'Expenses Report', icon: Receipt, Component: ExpensesReport }
    ]
  },
  {
    key: 'sales', label: 'Sales', icon: TrendingUp,
    items: [
      { key: 'sales-qaade', label: 'Sales by Qaade', icon: MapPin, Component: SalesByQaadeReport },
      { key: 'sales-customer', label: 'Sales by Customer', icon: Users, Component: SalesByCustomerReport },
      { key: 'sales', label: 'Sales Report', icon: TrendingUp, Component: SalesReport }
    ]
  },
  {
    key: 'operations', label: 'Operations', icon: Factory,
    items: [
      { key: 'inventory', label: 'Inventory Report', icon: Package, Component: InventoryReport },
      { key: 'production', label: 'Production Report', icon: Factory, Component: ProductionReport },
      { key: 'movements', label: 'Stock Movement Report', icon: Package, Component: StockMovementReport }
    ]
  }
];

export default function ReportsPage() {
  return (
    <div>
      <div className="page-header"><h1><BarChart3 size={22} color="var(--primary)" /> Reports</h1></div>
      <GroupedTabs groups={GROUPS} />
    </div>
  );
}
