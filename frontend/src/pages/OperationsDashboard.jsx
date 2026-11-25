import { Navigate, Link } from 'react-router-dom';
import { useApi } from '../components/useApi';
import Table from '../components/Table';
import { useAuth } from '../context/AuthContext';

const KPI = [
  ['Pending Requisitions', 'pending_requisitions', '/requisitions'],
  ['PO Approvals', 'pending_po_authorizations', '/procurement'],
  ['Overdue POs', 'overdue_purchase_orders', '/procurement'],
  ['Material Confirmations', 'material_confirmations', '/procurement'],
  ['Invoice Mismatches', 'invoice_mismatches', '/procurement'],
  ['Payment Approvals', 'payment_approvals', '/procurement'],
  ['Low-stock Lines', 'low_stock_lines', '/inventory'],
  ['Production Running', 'active_production_orders', '/production'],
  ['Production Output Approvals', 'pending_production_output_approvals', '/production'],
  ['Open Route Sessions', 'open_route_sessions', '/sales'],
  ['Open Logistics Incidents', 'open_logistics_exceptions', '/logistics']
];

export default function OperationsDashboard() {
  const { user } = useAuth();
  const allowed = ['Admin', 'Operation Manager'].includes(user?.role);
  const { rows: data, loading, error, reload } = useApi(allowed ? '/operations/dashboard' : null, [allowed]);
  if (!allowed) return <Navigate to="/" replace />;
  if (loading && !data) return <div className="page-loading">Loading operations overview…</div>;
  if (error) return <div className="alert alert--error" role="alert">{error} <button className="btn secondary" onClick={reload}>Retry</button></div>;

  const summary = data?.summary || {};
  const statusColumns = [
    { key: 'department_name', header: 'Department' },
    { key: 'pending_requisitions', header: 'Requisitions' },
    { key: 'pending_material_confirmations', header: 'Material Confirmations' }
  ];

  return <div>
    <div className="page-header"><div><h1>Operations Manager Dashboard</h1><p className="muted">Live approvals, exceptions, stock alerts and operational activity.</p></div>
      <button className="btn secondary" onClick={reload}>Refresh</button>
    </div>
    <div className="kpi-grid">
      {KPI.map(([label, key, to]) => <Link className="kpi-card" to={to} key={key} style={{ textDecoration: 'none', color: 'inherit' }}>
        <span>{label}</span><strong>{summary[key] ?? 0}</strong>
      </Link>)}
    </div>

    <section className="card" style={{ marginTop: 16 }}>
      <h2>Department Work Queue</h2>
      <Table columns={statusColumns} rows={data?.department_work || []} emptyText="No department work pending." />
    </section>

    <div className="chart-grid" style={{ marginTop: 16 }}>
      <section className="card"><h2>Requisitions Awaiting Review</h2>
        <Table columns={[
          { key: 'pr_number', header: 'PR' }, { key: 'title', header: 'Request' },
          { key: 'department_name', header: 'Department' }, { key: 'requester', header: 'Requested By' },
          { key: 'status', header: 'Status' }, { key: 'priority', header: 'Priority' }
        ]} rows={data?.pending_requisitions || []} emptyText="No requisitions awaiting review." />
      </section>
      <section className="card"><h2>Purchase Order Exceptions</h2>
        <Table columns={[
          { key: 'po_number', header: 'PO' }, { key: 'supplier_name', header: 'Supplier' },
          { key: 'department_name', header: 'Department' }, { key: 'status', header: 'Status' },
          { key: 'days_overdue', header: 'Days Late' }
        ]} rows={data?.purchase_order_exceptions || []} emptyText="No PO approvals or overdue orders." />
      </section>
      <section className="card"><h2>Supplier Invoice Exceptions</h2>
        <Table columns={[
          { key: 'internal_number', header: 'Invoice' }, { key: 'supplier_name', header: 'Supplier' },
          { key: 'po_number', header: 'PO' }, { key: 'status', header: 'Status' },
          { key: 'total_amount', header: 'Amount', render: (r) => '$' + Number(r.total_amount || 0).toFixed(2) }
        ]} rows={data?.invoice_exceptions || []} emptyText="No invoice mismatches or pending approvals." />
      </section>
      <section className="card"><h2>Supplier Payments Awaiting Decision</h2>
        <Table columns={[
          { key: 'voucher_number', header: 'Voucher' }, { key: 'supplier_name', header: 'Supplier' },
          { key: 'requested_by', header: 'Requested By' },
          { key: 'amount', header: 'Amount', render: (r) => '$' + Number(r.amount || 0).toFixed(2) }
        ]} rows={data?.payment_approvals || []} emptyText="No supplier payments awaiting approval." />
      </section>
      <section className="card"><h2>Low Stock Exceptions</h2>
        <Table columns={[
          { key: 'product_name', header: 'Product' }, { key: 'sku', header: 'SKU' },
          { key: 'warehouse_name', header: 'Warehouse' }, { key: 'quantity', header: 'On Hand' },
          { key: 'reorder_level', header: 'Reorder At' }
        ]} rows={data?.low_stock || []} emptyText="No low-stock alerts." />
      </section>
      <section className="card"><h2>Production Output Awaiting Approval</h2>
        <Table columns={[
          { key: 'batch_number', header: 'Batch' }, { key: 'production_type', header: 'Department' },
          { key: 'product_name', header: 'Product' }, { key: 'machine_name', header: 'Machine' },
          { key: 'actual_qty', header: 'Output', render: (r) => `${r.actual_qty} ${r.unit}` },
          { key: 'supervisor', header: 'Submitted By' }
        ]} rows={data?.production_output_approvals || []} emptyText="No production output approvals pending." />
      </section>
      <section className="card"><h2>Open Route Sessions</h2>
        <Table columns={[
          { key: 'truck_code', header: 'Truck' }, { key: 'driver', header: 'Driver' },
          { key: 'quantity_loaded', header: 'Loaded L' }, { key: 'delivered_liters', header: 'Delivered L' },
          { key: 'remaining_liters', header: 'Remaining L' }
        ]} rows={data?.route_sessions || []} emptyText="No open tanker sessions." />
      </section>
      <section className="card"><h2>Open Logistics Incidents</h2>
        <Table columns={[
          { key: 'created_at', header: 'Reported', render: (r) => new Date(r.created_at).toLocaleString() },
          { key: 'type', header: 'Type' }, { key: 'route_number', header: 'Route' },
          { key: 'plate_number', header: 'Truck' }, { key: 'description', header: 'Description' },
          { key: 'raised_by', header: 'Reported By' }
        ]} rows={data?.logistics_exceptions || []} emptyText="No open logistics incidents." />
      </section>
    </div>
    <section className="card" style={{ marginTop: 16 }}><h2>Recent Procurement Audit Activity</h2>
      <Table columns={[
        { key: 'created_at', header: 'Time', render: (r) => new Date(r.created_at).toLocaleString() },
        { key: 'actor', header: 'User' }, { key: 'actor_role', header: 'Role' },
        { key: 'entity_type', header: 'Record' }, { key: 'entity_id', header: 'ID' }, { key: 'action', header: 'Action' }
      ]} rows={data?.recent_procurement_activity || []} emptyText="No recent procurement audit activity." />
    </section>
  </div>;
}
