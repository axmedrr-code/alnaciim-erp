// Read-only cross-department Operations Manager dashboard.
const { Router } = require('express');
const { pool } = require('../config/db');
const { asyncHandler } = require('../utils/asyncHandler');
const { requireRole } = require('../middleware/auth');

const router = Router();

router.get('/dashboard', requireRole('Admin', 'Operation Manager'), asyncHandler(async (_req, res) => {
  const [
    counts, requisitions, purchaseOrders, materialIssues, invoiceExceptions, payments,
    lowStock, production, productionApprovals, routeSessions, logisticsExceptions, activity, departmentWork
  ] = await Promise.all([
    pool.query(
      "SELECT (SELECT COUNT(*)::int FROM purchase_requisitions WHERE status IN ('submitted','dept_approved')) AS pending_requisitions, " +
      "(SELECT COUNT(*)::int FROM purchase_orders WHERE status='pending_authorization') AS pending_po_authorizations, " +
      "(SELECT COUNT(*)::int FROM purchase_orders WHERE status IN ('authorized','sent','partially_received') AND expected_date<CURRENT_DATE) AS overdue_purchase_orders, " +
      "(SELECT COUNT(*)::int FROM material_issues WHERE status='issued') AS material_confirmations, " +
      "(SELECT COUNT(*)::int FROM supplier_invoices WHERE status='matched') AS invoices_awaiting_approval, " +
      "(SELECT COUNT(*)::int FROM supplier_invoices WHERE status='mismatch') AS invoice_mismatches, " +
      "(SELECT COUNT(*)::int FROM supplier_payments WHERE status='pending') AS payment_approvals, " +
      "(SELECT COUNT(*)::int FROM products p JOIN warehouses w ON (w.type=CASE p.product_type WHEN 'raw_material' THEN 'raw_material' WHEN 'finished_good' THEN 'finished_goods' WHEN 'spare_part' THEN 'spare_parts' END OR EXISTS (SELECT 1 FROM stock_levels ex WHERE ex.product_id=p.id AND ex.warehouse_id=w.id)) " +
      "LEFT JOIN stock_levels sl ON sl.product_id=p.id AND sl.warehouse_id=w.id WHERE p.is_active=true AND p.reorder_level>0 AND COALESCE(sl.quantity,0)<=p.reorder_level) AS low_stock_lines, " +
      "(SELECT COUNT(*)::int FROM production_batches WHERE status='in_progress') AS active_production_orders, " +
      "(SELECT COUNT(*)::int FROM production_batches WHERE output_approval_status='pending') AS pending_production_output_approvals, " +
      "(SELECT COUNT(*)::int FROM truck_loads WHERE status='loaded') AS open_route_sessions"
      + ", (SELECT COUNT(*)::int FROM exceptions WHERE status IN ('open','investigating')) AS open_logistics_exceptions"
    ),
    pool.query(
      "SELECT pr.id,pr.pr_number,pr.title,pr.status,pr.priority,pr.required_date,d.name AS department_name,u.full_name AS requester " +
      "FROM purchase_requisitions pr JOIN departments d ON d.id=pr.department_id JOIN users u ON u.id=pr.requested_by " +
      "WHERE pr.status IN ('submitted','dept_approved') ORDER BY CASE pr.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 ELSE 2 END,pr.created_at LIMIT 50"
    ),
    pool.query(
      "SELECT po.id,po.po_number,po.status,po.total_amount,po.expected_date,s.name AS supplier_name,d.name AS department_name, " +
      "CASE WHEN po.expected_date<CURRENT_DATE THEN CURRENT_DATE-po.expected_date ELSE 0 END AS days_overdue " +
      "FROM purchase_orders po JOIN suppliers s ON s.id=po.supplier_id LEFT JOIN departments d ON d.id=po.department_id " +
      "WHERE po.status='pending_authorization' OR (po.status IN ('authorized','sent','partially_received') AND po.expected_date<CURRENT_DATE) " +
      "ORDER BY po.expected_date NULLS LAST LIMIT 50"
    ),
    pool.query(
      "SELECT m.id,m.issue_number,m.status,m.issued_at,pr.pr_number,pr.title,d.name AS department_name,w.name AS warehouse_name " +
      "FROM material_issues m JOIN purchase_requisitions pr ON pr.id=m.requisition_id JOIN departments d ON d.id=m.department_id " +
      "JOIN warehouses w ON w.id=m.warehouse_id WHERE m.status='issued' ORDER BY m.issued_at LIMIT 50"
    ),
    pool.query(
      "SELECT si.id,si.internal_number,si.supplier_invoice_no,si.status,si.total_amount,si.match_result,s.name AS supplier_name,po.po_number " +
      "FROM supplier_invoices si JOIN suppliers s ON s.id=si.supplier_id JOIN purchase_orders po ON po.id=si.purchase_order_id " +
      "WHERE si.status IN ('mismatch','matched') ORDER BY si.invoice_date LIMIT 50"
    ),
    pool.query(
      "SELECT sp.id,sp.voucher_number,sp.amount,sp.payment_date,sp.method,s.name AS supplier_name,si.supplier_invoice_no,u.full_name AS requested_by " +
      "FROM supplier_payments sp JOIN supplier_invoices si ON si.id=sp.supplier_invoice_id JOIN suppliers s ON s.id=si.supplier_id " +
      "JOIN users u ON u.id=sp.recorded_by WHERE sp.status='pending' ORDER BY sp.created_at LIMIT 50"
    ),
    pool.query(
      "SELECT p.id AS product_id,p.name AS product_name,p.sku,p.reorder_level,w.name AS warehouse_name,COALESCE(sl.quantity,0) AS quantity " +
      "FROM products p JOIN warehouses w ON w.type=CASE p.product_type WHEN 'raw_material' THEN 'raw_material' WHEN 'finished_good' THEN 'finished_goods' WHEN 'spare_part' THEN 'spare_parts' END " +
      "LEFT JOIN stock_levels sl ON sl.product_id=p.id AND sl.warehouse_id=w.id " +
      "WHERE p.is_active=true AND p.reorder_level>0 AND COALESCE(sl.quantity,0)<=p.reorder_level " +
      "ORDER BY (COALESCE(sl.quantity,0)-p.reorder_level),p.name LIMIT 50"
    ),
    pool.query(
      "SELECT COUNT(*) FILTER (WHERE status='planned')::int AS planned,COUNT(*) FILTER (WHERE status='in_progress')::int AS running, " +
      "COUNT(*) FILTER (WHERE status='completed' AND end_time::date=CURRENT_DATE)::int AS completed_today " +
      "FROM production_batches WHERE status IN ('planned','in_progress') OR end_time::date=CURRENT_DATE"
    ),
    pool.query(
      "SELECT pb.id,pb.batch_number,pb.production_type,pb.actual_qty,pb.unit,pb.qc_status,pb.end_time, " +
      "p.name AS product_name,m.name AS machine_name,u.full_name AS supervisor " +
      "FROM production_batches pb LEFT JOIN products p ON p.id=pb.product_id JOIN machines m ON m.id=pb.machine_id " +
      "JOIN users u ON u.id=pb.supervisor_id WHERE pb.output_approval_status='pending' ORDER BY pb.end_time LIMIT 50"
    ),
    pool.query(
      "SELECT tl.id,t.truck_code,t.plate_number,u.full_name AS driver,tl.quantity_loaded,tl.delivered_liters, " +
      "GREATEST(0,tl.quantity_loaded-tl.delivered_liters) AS remaining_liters,tl.loaded_at " +
      "FROM truck_loads tl JOIN trucks t ON t.id=tl.truck_id LEFT JOIN users u ON u.id=t.assigned_driver_id " +
      "WHERE tl.status='loaded' ORDER BY tl.loaded_at"
    ),
    pool.query(
      "SELECT e.id,e.type,e.description,e.quantity,e.status,e.created_at,rr.route_number,t.plate_number,u.full_name AS raised_by " +
      "FROM exceptions e LEFT JOIN route_runs rr ON rr.id=e.route_run_id LEFT JOIN trucks t ON t.id=COALESCE(e.truck_id,rr.truck_id) " +
      "JOIN users u ON u.id=e.raised_by WHERE e.status IN ('open','investigating') ORDER BY e.created_at DESC LIMIT 50"
    ),
    pool.query(
      "SELECT a.id,a.entity_type,a.entity_id,a.action,a.actor_role,a.created_at,u.full_name AS actor " +
      "FROM procurement_audit_logs a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.created_at DESC LIMIT 20"
    ),
    pool.query(
      "SELECT d.id,d.name,COUNT(DISTINCT pr.id) FILTER (WHERE pr.status IN ('submitted','dept_approved'))::int AS pending_requisitions, " +
      "COUNT(DISTINCT mi.id) FILTER (WHERE mi.status='issued')::int AS pending_material_confirmations " +
      "FROM departments d LEFT JOIN purchase_requisitions pr ON pr.department_id=d.id " +
      "LEFT JOIN material_issues mi ON mi.department_id=d.id GROUP BY d.id,d.name ORDER BY d.name"
    )
  ]);

  const totals = counts.rows[0];
  res.json({
    data: {
      summary: {
        ...totals,
        low_stock_lines: Number(totals.low_stock_lines),
        active_production_orders: Number(totals.active_production_orders),
        open_route_sessions: Number(totals.open_route_sessions),
        pending_production_output_approvals: Number(totals.pending_production_output_approvals)
      },
      pending_requisitions: requisitions.rows,
      purchase_order_exceptions: purchaseOrders.rows,
      material_confirmations: materialIssues.rows,
      invoice_exceptions: invoiceExceptions.rows,
      payment_approvals: payments.rows,
      low_stock: lowStock.rows,
      production: production.rows[0],
      production_output_approvals: productionApprovals.rows,
      route_sessions: routeSessions.rows,
      logistics_exceptions: logisticsExceptions.rows,
      department_work: departmentWork.rows,
      recent_procurement_activity: activity.rows
    },
    error: null
  });
}));

module.exports = router;
