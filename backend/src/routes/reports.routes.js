const { Router } = require('express');
const { pool } = require('../config/db');
const { asyncHandler } = require('../utils/asyncHandler');

const router = Router();

// ---------------------------------------------------------------------
// LEGACY REPORT CATALOG — modernized from the predecessor desktop
// customer management system (cash summary, debtors, sales by qaade,
// sales by customer, expenses summary). "Sales report" and generic
// "expenses" listing already exist further down / in finance.routes.js.
// ---------------------------------------------------------------------

// Cash Summary — cash-in by payment method plus the cash/credit sales split,
// for a date range (defaults to today).
router.get('/cash-summary', asyncHandler(async (req, res) => {
  const from = req.query.from || new Date().toISOString().slice(0, 10);
  const to = req.query.to || new Date().toISOString().slice(0, 10);

  const [byMethod, saleTypeSplit, totalRow] = await Promise.all([
    pool.query(
      `SELECT method, COUNT(*) AS count, COALESCE(SUM(amount), 0) AS total
       FROM payments WHERE voided_at IS NULL AND payment_date BETWEEN $1 AND $2
       GROUP BY method ORDER BY total DESC`,
      [from, to]
    ),
    pool.query(
      `SELECT sale_type, COUNT(*) AS order_count, COALESCE(SUM(total_amount), 0) AS total
       FROM sales_orders WHERE status NOT IN ('cancelled','reversed') AND order_date BETWEEN $1 AND $2
       GROUP BY sale_type`,
      [from, to]
    ),
    pool.query(
      `SELECT COALESCE(SUM(amount), 0) AS total_collected FROM payments WHERE voided_at IS NULL AND payment_date BETWEEN $1 AND $2`,
      [from, to]
    )
  ]);

  res.json({
    data: {
      from, to,
      total_collected: Number(totalRow.rows[0].total_collected),
      by_method: byMethod.rows,
      sale_type_split: saleTypeSplit.rows
    },
    error: null
  });
}));

// Debtors Report — every customer with an open/outstanding balance, oldest unpaid
// invoice date, and days overdue against their payment terms. The core "open
// balance" view carried over from the legacy debtor-tracking workflow.
router.get('/debtors', asyncHandler(async (req, res) => {
  const { qaade_id } = req.query;
  const params = [];
  let qaadeFilter = '';
  if (qaade_id) { params.push(qaade_id); qaadeFilter = `AND c.qaade_id = $${params.length}`; }

  const { rows } = await pool.query(
    `SELECT c.id, c.hno, c.code, c.name, c.phone, c.city, c.credit_limit, c.payment_terms_days,
            q.name AS qaade_name,
            SUM(po.order_balance) AS balance,
            MIN(po.order_date) FILTER (WHERE po.order_balance > 0.005) AS oldest_outstanding_date
     FROM customers c
     JOIN (
       SELECT so.id, so.customer_id, so.order_date,
              so.total_amount - COALESCE((SELECT SUM(amount) FROM payments WHERE sales_order_id = so.id AND voided_at IS NULL), 0) AS order_balance
       FROM sales_orders so WHERE so.status NOT IN ('cancelled','reversed')
     ) po ON po.customer_id = c.id
     LEFT JOIN qaades q ON q.id = c.qaade_id
     WHERE 1=1 ${qaadeFilter}
     GROUP BY c.id, c.hno, c.code, c.name, c.phone, c.city, c.credit_limit, c.payment_terms_days, q.name
     HAVING SUM(po.order_balance) > 0.005
     ORDER BY balance DESC`,
    params
  );

  const debtors = rows.map((r) => {
    const daysSinceOldest = r.oldest_outstanding_date
      ? Math.floor((Date.now() - new Date(r.oldest_outstanding_date).getTime()) / 86400000)
      : null;
    const daysOverdue = daysSinceOldest !== null ? Math.max(0, daysSinceOldest - r.payment_terms_days) : null;
    return { ...r, days_overdue: daysOverdue };
  });

  res.json({ data: { debtors, total_outstanding: debtors.reduce((s, d) => s + Number(d.balance), 0) }, error: null });
}));

// Sales by Qaade — cross-route comparison (see also GET /qaades/:id/performance
// for a single route's detail).
router.get('/sales-by-qaade', asyncHandler(async (req, res) => {
  const from = req.query.from || '1900-01-01';
  const to = req.query.to || '2999-12-31';

  const { rows } = await pool.query(
    `SELECT q.id, q.qaade_code, q.name, q.area, u.full_name AS collector_name,
            COUNT(so.id) AS order_count, COALESCE(SUM(so.total_amount), 0) AS total_sales,
            COALESCE(SUM(so.total_amount) FILTER (WHERE so.sale_type = 'cash'), 0) AS cash_sales,
            COALESCE(SUM(so.total_amount) FILTER (WHERE so.sale_type = 'credit'), 0) AS credit_sales
     FROM qaades q
     LEFT JOIN users u ON u.id = q.collector_id
     LEFT JOIN sales_orders so ON so.qaade_id = q.id AND so.status NOT IN ('cancelled','reversed') AND so.order_date BETWEEN $1 AND $2
     GROUP BY q.id, q.qaade_code, q.name, q.area, u.full_name
     ORDER BY total_sales DESC`,
    [from, to]
  );
  res.json({ data: rows, error: null });
}));

// Sales by Customer
router.get('/sales-by-customer', asyncHandler(async (req, res) => {
  const from = req.query.from || '1900-01-01';
  const to = req.query.to || '2999-12-31';

  const { rows } = await pool.query(
    `SELECT c.id, c.hno, c.code, c.name, c.type, q.name AS qaade_name,
            COUNT(so.id) AS order_count, COALESCE(SUM(so.total_amount), 0) AS total_sales
     FROM customers c
     JOIN sales_orders so ON so.customer_id = c.id AND so.status NOT IN ('cancelled','reversed') AND so.order_date BETWEEN $1 AND $2
     LEFT JOIN qaades q ON q.id = c.qaade_id
     GROUP BY c.id, c.hno, c.code, c.name, c.type, q.name
     ORDER BY total_sales DESC`,
    [from, to]
  );
  res.json({ data: rows, error: null });
}));

// Expenses Report — summarized by category for a period (see /finance/expenses for
// the raw filterable ledger).
router.get('/expenses-summary', asyncHandler(async (req, res) => {
  const from = req.query.from || '1900-01-01';
  const to = req.query.to || '2999-12-31';

  const { rows } = await pool.query(
    `SELECT ec.name AS category_name, ec.type, COUNT(*) AS count, COALESCE(SUM(e.amount), 0) AS total
     FROM expenses e JOIN expense_categories ec ON ec.id = e.category_id
     WHERE e.voided_at IS NULL AND e.expense_date BETWEEN $1 AND $2
     GROUP BY ec.name, ec.type ORDER BY total DESC`,
    [from, to]
  );
  const total = rows.reduce((s, r) => s + Number(r.total), 0);
  res.json({ data: { categories: rows, total }, error: null });
}));

// Bulk-water-specific KPIs for the tanker distribution business: today's volume
// delivered, deliveries completed, tanker utilization, top customers by liters,
// unpaid balances, and per-driver route performance for today.
router.get('/water-dashboard', asyncHandler(async (req, res) => {
  const [soldToday, deliveriesToday, utilization, topCustomers, unpaid, routePerformance] = await Promise.all([
    // Two delivery flows exist side by side: the older driver-confirmed
    // `deliveries` table, and the fast POS's tank-dispatch (which settles
    // instantly onto route_stops and never touches `deliveries` at all).
    // Every "today" figure below unions both so a POS sale shows up
    // immediately without needing a second, separate confirmation step.
    pool.query(
      `SELECT (
         COALESCE((SELECT SUM(d.quantity_delivered) FROM deliveries d WHERE d.truck_load_id IS NOT NULL AND d.confirmed_at::date = CURRENT_DATE), 0) +
         COALESCE((SELECT SUM(rs.delivered_liters) FROM route_stops rs WHERE rs.status = 'delivered' AND rs.delivered_at::date = CURRENT_DATE), 0)
       ) AS liters`
    ),
    pool.query(
      `SELECT (
         (SELECT COUNT(*) FROM deliveries WHERE status = 'delivered' AND truck_load_id IS NOT NULL AND confirmed_at::date = CURRENT_DATE) +
         (SELECT COUNT(*) FROM route_stops WHERE status = 'delivered' AND delivered_at::date = CURRENT_DATE)
       ) AS count`
    ),
    pool.query(
      `SELECT
         COALESCE(SUM(tl.quantity_loaded), 0) AS total_loaded,
         COALESCE((SELECT SUM(t.capacity) FROM trucks t WHERE t.id IN (SELECT DISTINCT truck_id FROM truck_loads WHERE route_date = CURRENT_DATE)), 0) AS total_capacity
       FROM truck_loads tl WHERE tl.route_date = CURRENT_DATE`
    ),
    pool.query(
      `SELECT c.name AS customer_name, SUM(soi.quantity) AS liters, SUM(soi.subtotal) AS revenue
       FROM sales_order_items soi
       JOIN sales_orders so ON so.id = soi.sales_order_id
       JOIN customers c ON c.id = so.customer_id
       JOIN products p ON p.id = soi.product_id
       WHERE p.unit = 'liters' AND so.status NOT IN ('cancelled','reversed') AND so.order_date >= CURRENT_DATE - 30
       GROUP BY c.name ORDER BY liters DESC LIMIT 5`
    ),
    pool.query(
      `SELECT c.name AS customer_name, SUM(per_order.balance) AS balance
       FROM (
         SELECT so.customer_id, so.total_amount - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.sales_order_id = so.id AND p.voided_at IS NULL), 0) AS balance
         FROM sales_orders so WHERE so.status NOT IN ('cancelled','reversed')
       ) per_order
       JOIN customers c ON c.id = per_order.customer_id
       GROUP BY c.name HAVING SUM(per_order.balance) > 0
       ORDER BY balance DESC LIMIT 5`
    ),
    pool.query(
      `SELECT driver_name, plate_number,
              SUM(delivered_count) AS delivered_count,
              SUM(pending_count) AS pending_count,
              SUM(liters_delivered) AS liters_delivered
       FROM (
         SELECT u.full_name AS driver_name, t.plate_number,
                COUNT(*) FILTER (WHERE d.status = 'delivered') AS delivered_count,
                COUNT(*) FILTER (WHERE d.status = 'in_transit') AS pending_count,
                COALESCE(SUM(d.quantity_delivered), 0) AS liters_delivered
         FROM deliveries d
         JOIN users u ON u.id = d.driver_id
         JOIN trucks t ON t.id = d.truck_id
         WHERE d.dispatch_time::date = CURRENT_DATE AND d.truck_load_id IS NOT NULL
         GROUP BY u.full_name, t.plate_number
         UNION ALL
         SELECT u.full_name AS driver_name, t.plate_number,
                COUNT(*) FILTER (WHERE rs.status = 'delivered') AS delivered_count,
                COUNT(*) FILTER (WHERE rs.status = 'pending') AS pending_count,
                COALESCE(SUM(rs.delivered_liters), 0) AS liters_delivered
         FROM route_stops rs
         JOIN route_runs rr ON rr.id = rs.route_run_id
         JOIN users u ON u.id = rr.driver_id
         JOIN trucks t ON t.id = rr.truck_id
         WHERE rs.created_at::date = CURRENT_DATE
         GROUP BY u.full_name, t.plate_number
       ) combined
       GROUP BY driver_name, plate_number
       ORDER BY liters_delivered DESC`
    )
  ]);

  const totalUnpaid = unpaid.rows.reduce((sum, r) => sum + Number(r.balance), 0);
  const utilizationPct = Number(utilization.rows[0].total_capacity) > 0
    ? (Number(utilization.rows[0].total_loaded) / Number(utilization.rows[0].total_capacity)) * 100
    : 0;

  res.json({
    data: {
      water_sold_today_liters: Number(soldToday.rows[0].liters),
      deliveries_completed_today: Number(deliveriesToday.rows[0].count),
      tanker_utilization_pct: utilizationPct,
      total_loaded_today: Number(utilization.rows[0].total_loaded),
      top_customers: topCustomers.rows,
      unpaid_balances: unpaid.rows,
      total_unpaid: totalUnpaid,
      route_performance_today: routePerformance.rows
    },
    error: null
  });
}));

// Driver Performance — the Tankers module's per-driver rollup, sourced from
// every tank-fill sale the fast POS has recorded against that driver's route
// runs (route_stops/sales_orders — the live path every POS Save writes to,
// not a separately-synced snapshot). Defaults to the last 30 days.
router.get('/driver-performance', asyncHandler(async (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 365);
  const { rows } = await pool.query(
    `SELECT u.full_name AS driver_name, t.plate_number,
            COUNT(*) AS deliveries,
            COALESCE(SUM(rs.delivered_liters), 0) AS liters_delivered,
            COALESCE(SUM(so.total_amount), 0) AS revenue,
            COALESCE(SUM(rs.cash_received), 0) AS cash_collected
     FROM route_stops rs
     JOIN route_runs rr ON rr.id = rs.route_run_id
     JOIN users u ON u.id = rr.driver_id
     JOIN trucks t ON t.id = rr.truck_id
     LEFT JOIN sales_orders so ON so.id = rs.sales_order_id
     WHERE rs.status = 'delivered' AND rs.created_at >= CURRENT_DATE - $1::int
     GROUP BY u.full_name, t.plate_number
     ORDER BY revenue DESC`,
    [days]
  );
  res.json({ data: rows, error: null });
}));

// Daily revenue (from payments) vs cost (from expenses) for the last N days,
// zero-filled so charts don't show gaps on days with no activity.
router.get('/revenue-trend', asyncHandler(async (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 365);
  const { rows } = await pool.query(
    `WITH days AS (
       SELECT generate_series(CURRENT_DATE - ($1::int - 1), CURRENT_DATE, '1 day')::date AS day
     ),
     rev AS (
       SELECT payment_date AS day, SUM(amount) AS revenue FROM payments
       WHERE voided_at IS NULL AND payment_date >= CURRENT_DATE - ($1::int - 1) GROUP BY payment_date
     ),
     cost AS (
       SELECT expense_date AS day, SUM(amount) AS cost FROM expenses
       WHERE voided_at IS NULL AND expense_date >= CURRENT_DATE - ($1::int - 1) GROUP BY expense_date
     )
     SELECT d.day, COALESCE(r.revenue, 0) AS revenue, COALESCE(c.cost, 0) AS cost
     FROM days d
     LEFT JOIN rev r ON r.day = d.day
     LEFT JOIN cost c ON c.day = d.day
     ORDER BY d.day`,
    [days]
  );
  res.json({ data: rows, error: null });
}));

// Daily completed production output by type for the last N days, zero-filled.
router.get('/production-trend', asyncHandler(async (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 365);
  const { rows } = await pool.query(
    `WITH days AS (
       SELECT generate_series(CURRENT_DATE - ($1::int - 1), CURRENT_DATE, '1 day')::date AS day
     )
     SELECT d.day,
       COALESCE(SUM(pb.actual_qty) FILTER (WHERE pb.production_type = 'RO_WATER'), 0) AS ro_water,
       COALESCE(SUM(pb.actual_qty) FILTER (WHERE pb.production_type = 'BOTTLING'), 0) AS bottling,
       COALESCE(SUM(pb.actual_qty) FILTER (WHERE pb.production_type = 'ICE'), 0) AS ice
     FROM days d
     LEFT JOIN production_batches pb ON pb.start_time::date = d.day AND pb.status = 'completed'
     GROUP BY d.day
     ORDER BY d.day`,
    [days]
  );
  res.json({ data: rows, error: null });
}));

router.get('/inventory', asyncHandler(async (req, res) => {
  const { warehouse_id } = req.query;
  const params = [];
  let where = '';
  if (warehouse_id) { params.push(warehouse_id); where = `WHERE sl.warehouse_id = $1`; }
  const { rows } = await pool.query(
    `SELECT w.name AS warehouse_name, p.sku, p.name AS product_name, p.product_type, p.unit,
            sl.quantity, p.unit_cost, (sl.quantity * p.unit_cost) AS stock_value,
            p.reorder_level, (sl.quantity <= p.reorder_level) AS is_low_stock
     FROM stock_levels sl
     JOIN products p ON p.id = sl.product_id
     JOIN warehouses w ON w.id = sl.warehouse_id
     ${where}
     ORDER BY w.name, p.name`,
    params
  );
  res.json({ data: rows, error: null });
}));

router.get('/production', asyncHandler(async (req, res) => {
  const { year, month, production_type } = req.query;
  const conditions = [];
  const params = [];
  if (year) { params.push(year); conditions.push(`EXTRACT(YEAR FROM start_time) = $${params.length}`); }
  if (month) { params.push(month); conditions.push(`EXTRACT(MONTH FROM start_time) = $${params.length}`); }
  if (production_type) { params.push(production_type); conditions.push(`production_type = $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `SELECT production_type, DATE_TRUNC('day', start_time) AS day,
            SUM(planned_qty) AS total_planned, SUM(actual_qty) AS total_actual, COUNT(*) AS batch_count
     FROM production_batches
     ${where}
     GROUP BY production_type, DATE_TRUNC('day', start_time)
     ORDER BY day DESC`,
    params
  );
  res.json({ data: rows, error: null });
}));

router.get('/sales', asyncHandler(async (req, res) => {
  const { from, to } = req.query;
  const params = [from || '1900-01-01', to || '2999-12-31'];
  const { rows } = await pool.query(
    `SELECT p.name AS product_name, c.name AS customer_name, u.full_name AS sales_rep_name,
            SUM(soi.quantity) AS units_sold, SUM(soi.subtotal) AS revenue
     FROM sales_order_items soi
     JOIN sales_orders so ON so.id = soi.sales_order_id
     JOIN products p ON p.id = soi.product_id
     JOIN customers c ON c.id = so.customer_id
     LEFT JOIN users u ON u.id = so.sales_rep_id
     WHERE so.order_date BETWEEN $1 AND $2 AND so.status NOT IN ('cancelled','reversed')
     GROUP BY p.name, c.name, u.full_name
     ORDER BY revenue DESC`,
    params
  );
  res.json({ data: rows, error: null });
}));

router.get('/stock-movements', asyncHandler(async (req, res) => {
  const { product_id, warehouse_id, from, to } = req.query;
  const conditions = [];
  const params = [];
  if (product_id) { params.push(product_id); conditions.push(`sm.product_id = $${params.length}`); }
  if (warehouse_id) { params.push(warehouse_id); conditions.push(`sm.warehouse_id = $${params.length}`); }
  if (from) { params.push(from); conditions.push(`sm.created_at >= $${params.length}`); }
  if (to) { params.push(to); conditions.push(`sm.created_at <= $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `SELECT sm.created_at, p.sku, p.name AS product_name, w.name AS warehouse_name,
            sm.movement_type, sm.quantity, sm.reference_type, sm.reference_id, u.full_name AS performed_by_name
     FROM stock_movements sm
     JOIN products p ON p.id = sm.product_id
     JOIN warehouses w ON w.id = sm.warehouse_id
     JOIN users u ON u.id = sm.performed_by
     ${where}
     ORDER BY sm.created_at DESC
     LIMIT 1000`,
    params
  );
  res.json({ data: rows, error: null });
}));

// Aggregated widgets for the main dashboard (see docs/DESIGN.md section 5).
router.get('/dashboard-summary', asyncHandler(async (req, res) => {
  const [production, lowStock, salesToday, revenueVsCost, downtime, deliveries, maintenanceDue, receivables] = await Promise.all([
    pool.query(`SELECT production_type, SUM(actual_qty) AS total FROM production_batches WHERE start_time::date = CURRENT_DATE AND status = 'completed' GROUP BY production_type`),
    pool.query(`SELECT COUNT(*) AS count FROM stock_levels sl JOIN products p ON p.id = sl.product_id WHERE sl.quantity <= p.reorder_level AND p.reorder_level > 0`),
    pool.query(`SELECT COUNT(*) AS order_count, COALESCE(SUM(total_amount), 0) AS revenue FROM sales_orders WHERE order_date = CURRENT_DATE AND status NOT IN ('cancelled','reversed')`),
    pool.query(`SELECT
                  (SELECT COALESCE(SUM(amount),0) FROM payments WHERE voided_at IS NULL AND payment_date >= DATE_TRUNC('month', CURRENT_DATE)) AS revenue_mtd,
                  (SELECT COALESCE(SUM(amount),0) FROM expenses WHERE voided_at IS NULL AND expense_date >= DATE_TRUNC('month', CURRENT_DATE)) AS cost_mtd`),
    pool.query(`SELECT m.name AS machine_name, SUM(EXTRACT(EPOCH FROM (COALESCE(dl.end_time, now()) - dl.start_time)) / 3600) AS hours_down
                FROM downtime_logs dl JOIN machines m ON m.id = dl.machine_id
                WHERE dl.start_time >= CURRENT_DATE - INTERVAL '7 days' GROUP BY m.name ORDER BY hours_down DESC`),
    pool.query(`SELECT status, COUNT(*) AS count FROM deliveries WHERE status IN ('scheduled','in_transit') GROUP BY status`),
    pool.query(`SELECT COUNT(*) AS count FROM maintenance_schedules WHERE next_due_date <= CURRENT_DATE + INTERVAL '7 days'`),
    pool.query(`SELECT COALESCE(SUM(total_amount), 0) AS outstanding FROM sales_orders WHERE payment_status != 'paid' AND status NOT IN ('cancelled','reversed')`)
  ]);

  res.json({
    data: {
      production_today: production.rows,
      low_stock_count: Number(lowStock.rows[0].count),
      sales_today: salesToday.rows[0],
      revenue_vs_cost_mtd: revenueVsCost.rows[0],
      downtime_last_7_days: downtime.rows,
      pending_deliveries: deliveries.rows,
      maintenance_due_count: Number(maintenanceDue.rows[0].count),
      outstanding_receivables: Number(receivables.rows[0].outstanding)
    },
    error: null
  });
}));

// =========================================================================
// FULL DOUBLE-ENTRY FINANCIAL REPORTS — General Ledger, Trial Balance, P&L,
// Balance Sheet, Cash Flow, AR/AP subledgers. All computed directly from
// journal_lines, so they always agree with the Chart of Accounts screen.
// =========================================================================

function normalBalance(accountType, debit, credit) {
  return ['asset', 'expense'].includes(accountType) ? debit - credit : credit - debit;
}

// General Ledger — every posted line for one account, in date order, with a running balance.
router.get('/general-ledger', asyncHandler(async (req, res) => {
  const { account_id, from, to } = req.query;
  if (!account_id) return res.json({ data: null, error: 'account_id is required' });

  const { rows: acctRows } = await pool.query('SELECT * FROM chart_of_accounts WHERE id = $1', [account_id]);
  if (!acctRows[0]) return res.status(404).json({ data: null, error: 'Account not found' });
  const account = acctRows[0];

  const conditions = ['jl.account_id = $1', "je.status = 'posted'"];
  const params = [account_id];
  if (from) { params.push(from); conditions.push(`je.entry_date >= $${params.length}`); }
  if (to) { params.push(to); conditions.push(`je.entry_date <= $${params.length}`); }

  const { rows } = await pool.query(
    `SELECT je.entry_date, je.entry_number, je.description, jl.debit, jl.credit, jl.description AS line_description,
            c.name AS customer_name, s.name AS supplier_name
     FROM journal_lines jl
     JOIN journal_entries je ON je.id = jl.journal_entry_id
     LEFT JOIN customers c ON c.id = jl.customer_id
     LEFT JOIN suppliers s ON s.id = jl.supplier_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY je.entry_date, je.id`,
    params
  );

  let running = 0;
  const lines = rows.map((r) => {
    running += normalBalance(account.account_type, Number(r.debit), Number(r.credit));
    return { ...r, running_balance: running };
  });

  res.json({ data: { account, lines, closing_balance: running }, error: null });
}));

// Trial Balance — every account's period activity and balance; total debits must equal
// total credits (the fundamental double-entry check).
router.get('/trial-balance', asyncHandler(async (req, res) => {
  const asOf = req.query.as_of || '2999-12-31';
  const { rows } = await pool.query(
    `SELECT a.id, a.code, a.name, a.account_type,
            COALESCE(SUM(jl.debit) FILTER (WHERE je.id IS NOT NULL), 0) AS total_debit,
            COALESCE(SUM(jl.credit) FILTER (WHERE je.id IS NOT NULL), 0) AS total_credit
     FROM chart_of_accounts a
     LEFT JOIN journal_lines jl ON jl.account_id = a.id
     LEFT JOIN journal_entries je ON je.id = jl.journal_entry_id AND je.status = 'posted' AND je.entry_date <= $1
     WHERE a.is_active = true
     GROUP BY a.id, a.code, a.name, a.account_type
     HAVING COALESCE(SUM(jl.debit) FILTER (WHERE je.id IS NOT NULL), 0) != 0 OR COALESCE(SUM(jl.credit) FILTER (WHERE je.id IS NOT NULL), 0) != 0
     ORDER BY a.code`,
    [asOf]
  );

  const accounts = rows.map((a) => {
    // Trial balance columns are literal net debit vs. net credit — NOT the account's
    // "normal balance" sign, which is only meaningful once you know the account type.
    // A liability with a bigger debit than credit total (unusual, but possible) belongs
    // in the debit column just like an asset would.
    const debit = Number(a.total_debit);
    const credit = Number(a.total_credit);
    return {
      ...a,
      debit_balance: debit > credit ? debit - credit : 0,
      credit_balance: credit > debit ? credit - debit : 0
    };
  });

  const totalDebit = accounts.reduce((s, a) => s + a.debit_balance, 0);
  const totalCredit = accounts.reduce((s, a) => s + a.credit_balance, 0);
  res.json({ data: { as_of: asOf, accounts, total_debit: totalDebit, total_credit: totalCredit, is_balanced: Math.abs(totalDebit - totalCredit) < 0.01 }, error: null });
}));

// Profit & Loss (Income Statement) for a period.
router.get('/profit-loss', asyncHandler(async (req, res) => {
  const from = req.query.from || '1900-01-01';
  const to = req.query.to || '2999-12-31';

  const { rows } = await pool.query(
    `SELECT a.id, a.code, a.name, a.account_type, COALESCE(SUM(jl.debit), 0) AS total_debit, COALESCE(SUM(jl.credit), 0) AS total_credit
     FROM chart_of_accounts a
     JOIN journal_lines jl ON jl.account_id = a.id
     JOIN journal_entries je ON je.id = jl.journal_entry_id
     WHERE a.account_type IN ('revenue', 'expense') AND je.status = 'posted' AND je.entry_date BETWEEN $1 AND $2
     GROUP BY a.id, a.code, a.name, a.account_type
     ORDER BY a.code`,
    [from, to]
  );

  const revenue = rows.filter((r) => r.account_type === 'revenue').map((r) => ({ ...r, amount: normalBalance('revenue', Number(r.total_debit), Number(r.total_credit)) }));
  const expenses = rows.filter((r) => r.account_type === 'expense').map((r) => ({ ...r, amount: normalBalance('expense', Number(r.total_debit), Number(r.total_credit)) }));
  const totalRevenue = revenue.reduce((s, r) => s + r.amount, 0);
  const totalExpenses = expenses.reduce((s, r) => s + r.amount, 0);

  res.json({
    data: { from, to, revenue, expenses, total_revenue: totalRevenue, total_expenses: totalExpenses, net_income: totalRevenue - totalExpenses },
    error: null
  });
}));

// Balance Sheet as of a date — Assets = Liabilities + Equity, with current-period net
// income (revenue - expenses since the books began) folded into equity as "Current
// Year Earnings" so the sheet balances even mid-year, before a formal year closing.
router.get('/balance-sheet', asyncHandler(async (req, res) => {
  const asOf = req.query.as_of || new Date().toISOString().slice(0, 10);

  const { rows } = await pool.query(
    `SELECT a.id, a.code, a.name, a.account_type,
            COALESCE(SUM(jl.debit), 0) AS total_debit, COALESCE(SUM(jl.credit), 0) AS total_credit
     FROM chart_of_accounts a
     JOIN journal_lines jl ON jl.account_id = a.id
     JOIN journal_entries je ON je.id = jl.journal_entry_id
     WHERE je.status = 'posted' AND je.entry_date <= $1
     GROUP BY a.id, a.code, a.name, a.account_type`,
    [asOf]
  );

  const withBalance = (type) => rows.filter((r) => r.account_type === type).map((r) => ({ ...r, balance: normalBalance(type, Number(r.total_debit), Number(r.total_credit)) }));
  const assets = withBalance('asset');
  const liabilities = withBalance('liability');
  const equity = withBalance('equity');
  const revenue = withBalance('revenue');
  const expense = withBalance('expense');

  const totalAssets = assets.reduce((s, a) => s + a.balance, 0);
  const totalLiabilities = liabilities.reduce((s, a) => s + a.balance, 0);
  const currentYearEarnings = revenue.reduce((s, a) => s + a.balance, 0) - expense.reduce((s, a) => s + a.balance, 0);
  const totalEquity = equity.reduce((s, a) => s + a.balance, 0) + currentYearEarnings;

  res.json({
    data: {
      as_of: asOf, assets, liabilities, equity,
      current_year_earnings: currentYearEarnings,
      total_assets: totalAssets, total_liabilities: totalLiabilities, total_equity: totalEquity,
      is_balanced: Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 0.01
    },
    error: null
  });
}));

// Cash Flow — simplified direct method: every posting that touches a Cash/Bank
// account, grouped by the business activity (reference_type) that caused it.
router.get('/cash-flow', asyncHandler(async (req, res) => {
  const from = req.query.from || '1900-01-01';
  const to = req.query.to || '2999-12-31';

  const { rows } = await pool.query(
    `SELECT je.reference_type, COALESCE(SUM(jl.debit - jl.credit), 0) AS net_change, COUNT(*) AS entry_count
     FROM journal_lines jl
     JOIN journal_entries je ON je.id = jl.journal_entry_id
     JOIN chart_of_accounts a ON a.id = jl.account_id
     WHERE a.code IN ('1000', '1010') AND je.status = 'posted' AND je.entry_date BETWEEN $1 AND $2
     GROUP BY je.reference_type
     ORDER BY net_change DESC`,
    [from, to]
  );

  const openingRow = await pool.query(
    `SELECT COALESCE(SUM(jl.debit - jl.credit), 0) AS opening
     FROM journal_lines jl JOIN journal_entries je ON je.id = jl.journal_entry_id JOIN chart_of_accounts a ON a.id = jl.account_id
     WHERE a.code IN ('1000', '1010') AND je.status = 'posted' AND je.entry_date < $1`,
    [from]
  );

  const netChange = rows.reduce((s, r) => s + Number(r.net_change), 0);
  const opening = Number(openingRow.rows[0].opening);
  res.json({ data: { from, to, opening_balance: opening, by_activity: rows, net_change: netChange, closing_balance: opening + netChange }, error: null });
}));

// Accounts Receivable subledger — outstanding balance per customer, from the AR GL
// account itself (independent cross-check against /reports/debtors, which is derived
// from sales_orders/payments directly).
router.get('/accounts-receivable', asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT c.id, c.hno, c.name, COALESCE(SUM(jl.debit - jl.credit), 0) AS balance
     FROM journal_lines jl
     JOIN journal_entries je ON je.id = jl.journal_entry_id AND je.status = 'posted'
     JOIN chart_of_accounts a ON a.id = jl.account_id AND a.code = '1100'
     JOIN customers c ON c.id = jl.customer_id
     GROUP BY c.id, c.hno, c.name
     HAVING COALESCE(SUM(jl.debit - jl.credit), 0) > 0.005
     ORDER BY balance DESC`
  );
  res.json({ data: { customers: rows, total_receivable: rows.reduce((s, r) => s + Number(r.balance), 0) }, error: null });
}));

// Accounts Payable subledger — outstanding balance per supplier.
router.get('/accounts-payable', asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT s.id, s.code, s.name, COALESCE(SUM(jl.credit - jl.debit), 0) AS balance
     FROM journal_lines jl
     JOIN journal_entries je ON je.id = jl.journal_entry_id AND je.status = 'posted'
     JOIN chart_of_accounts a ON a.id = jl.account_id AND a.code = '2000'
     JOIN suppliers s ON s.id = jl.supplier_id
     GROUP BY s.id, s.code, s.name
     HAVING COALESCE(SUM(jl.credit - jl.debit), 0) > 0.005
     ORDER BY balance DESC`
  );
  res.json({ data: { suppliers: rows, total_payable: rows.reduce((s, r) => s + Number(r.balance), 0) }, error: null });
}));

module.exports = router;
