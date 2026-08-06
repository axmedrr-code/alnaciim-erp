import { useState } from 'react';
import { MapPin, Users } from 'lucide-react';
import { useApi } from '../../components/useApi';
import Table from '../../components/Table';
import DateFilterBar, { defaultDateRange } from '../../components/DateFilterBar';
import QaadesTab from './QaadesTab';

// Sales-domain reports: route (qaade) performance and customer ranking. Broader
// company-wide reports (finance, inventory, production) stay on the global Reports
// page — this section is scoped to what a sales manager actually needs day to day.
function SalesByQaadeReport({ dateRange }) {
  const { rows } = useApi(`/reports/sales-by-qaade?from=${dateRange.from}&to=${dateRange.to}`, [dateRange.from, dateRange.to]);
  const columns = [
    { key: 'qaade_code', header: 'Code' },
    { key: 'name', header: 'Route' },
    { key: 'collector_name', header: 'Collector', render: (r) => r.collector_name || '—' },
    { key: 'order_count', header: 'Orders' },
    { key: 'cash_sales', header: 'Cash', render: (r) => `$${Number(r.cash_sales).toFixed(2)}` },
    { key: 'credit_sales', header: 'Credit', render: (r) => `$${Number(r.credit_sales).toFixed(2)}` },
    { key: 'total_sales', header: 'Total', render: (r) => `$${Number(r.total_sales).toFixed(2)}` }
  ];
  return (
    <div className="card">
      <h3><MapPin size={15} /> Sales by Route (Qaade)</h3>
      <Table columns={columns} rows={rows} emptyText="No routes set up yet." sortable />
    </div>
  );
}

function SalesByCustomerReport({ dateRange }) {
  const { rows } = useApi(`/reports/sales-by-customer?from=${dateRange.from}&to=${dateRange.to}`, [dateRange.from, dateRange.to]);
  const columns = [
    { key: 'hno', header: 'HNO', render: (r) => r.hno || '—' },
    { key: 'name', header: 'Customer' },
    { key: 'type', header: 'Type' },
    { key: 'qaade_name', header: 'Route', render: (r) => r.qaade_name || '—' },
    { key: 'order_count', header: 'Orders' },
    { key: 'total_sales', header: 'Total Sales', render: (r) => `$${Number(r.total_sales).toFixed(2)}` }
  ];
  return (
    <div className="card">
      <h3><Users size={15} /> Sales by Customer</h3>
      <Table columns={columns} rows={rows} emptyText="No sales recorded yet." searchable searchPlaceholder="Search customers…" sortable pageSize={10} />
    </div>
  );
}

export default function SalesReportsTab() {
  const [dateRange, setDateRange] = useState(defaultDateRange());
  return (
    <div>
      <div className="toolbar"><DateFilterBar value={dateRange} onChange={setDateRange} title="Sales Reports" /></div>
      <SalesByQaadeReport dateRange={dateRange} />
      <SalesByCustomerReport dateRange={dateRange} />
      <div style={{ marginTop: 28 }}>
        <h3 className="section-title">Route (Qaade) Management</h3>
        <QaadesTab />
      </div>
    </div>
  );
}
