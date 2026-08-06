// Billing & Collections — a Finance module built entirely on top of the
// ERP's existing customers/sales_orders/payments tables. There is no
// second ledger here: "outstanding balance" is always
// total_amount - SUM(non-voided payments), the exact calculation every
// other statement/report in this app already uses. This module only adds
// what's genuinely new — collector assignment, a payment note, and a
// follow-up log — and otherwise reads/writes the same rows Sales,
// Route Operations, and Finance already read/write.
const { Router } = require('express');
const { pool, withTransaction } = require('../config/db');
const { asyncHandler, ApiError } = require('../utils/asyncHandler');
const { requireRole } = require('../middleware/auth');
const { nextHno } = require('../services/hnoService');
const { logAudit } = require('../services/auditService');
const { postJournalEntry, getAccountByCode } = require('../services/accountingService');

const router = Router();

// Finance owns payments end to end (receive/edit/reports); Collector can only
// record one; Admin can do anything. Driver/Data Entry never create or edit a
// payment — they may only ever read (no route below requires a role for GET).
const RECEIVE_PAYMENT_ROLES = ['Admin', 'Finance Officer', 'Collector'];
const EDIT_PAYMENT_ROLES = ['Admin', 'Finance Officer'];

async function resolveCashOrBankAccount(client, method, bankAccountId) {
  if (method === 'cash') return (await getAccountByCode(client, '1000')).id;
  if (bankAccountId) {
    const { rows } = await client.query('SELECT coa_account_id FROM bank_accounts WHERE id = $1', [bankAccountId]);
    if (rows[0]) return rows[0].coa_account_id;
  }
  return (await getAccountByCode(client, '1010')).id;
}

// The one balance formula this whole module is built on.
const BALANCE_SQL = `so.total_amount - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.sales_order_id = so.id AND p.voided_at IS NULL), 0)`;

// ---------------------------------------------------------------------
// Departments — the business's operating lines, each backed by one or more
// product categories. This is the ONLY place department scope is defined;
// every dashboard/report/filter below resolves it generically from this
// list, so adding a future department (a new line of business, or one that
// spans several categories) is a one-line addition here and nothing else
// needs to change.
// ---------------------------------------------------------------------
const DEPARTMENTS = [
  { key: 'bulk_water', label: 'Bulk Water (Tankers)', categories: ['Bulk Water'] },
  { key: 'bottled_water', label: 'Bottled Water', categories: ['Bottled Water'] },
  { key: 'ice', label: 'Ice', categories: ['Ice Products'] }
];
function findDepartment(key) { return DEPARTMENTS.find((d) => d.key === key); }

// An order can legitimately mix departments (e.g. one invoice with both
// bottled water and ice on it), so "department scope" is never a WHERE
// clause on sales_orders — it's a fraction of that order's value, derived
// from how much of its line-item subtotal falls in the selected
// department's categories. Applying that same fraction to whatever's being
// measured (balance, a payment, a sale total) keeps every figure exactly
// consistent with the order's real total_amount; nothing is re-derived
// into a second number that could drift.
function deptFractionSql(orderAlias, paramIdx) {
  return `COALESCE((SELECT SUM(soi.subtotal) FROM sales_order_items soi
            JOIN products pr ON pr.id = soi.product_id JOIN categories cat ON cat.id = pr.category_id
            WHERE soi.sales_order_id = ${orderAlias}.id AND cat.name = ANY($${paramIdx}))
          / NULLIF((SELECT SUM(soi2.subtotal) FROM sales_order_items soi2 WHERE soi2.sales_order_id = ${orderAlias}.id), 0), 0)`;
}
// Scopes a raw SQL expression (referencing `orderAlias`) to the selected
// department. paramIdx === null means "All" — the expression passes through
// unchanged, so nothing about the All-departments queries changes at all.
function deptScoped(expr, orderAlias, paramIdx) {
  return paramIdx ? `((${expr}) * ${deptFractionSql(orderAlias, paramIdx)})` : expr;
}
function balanceSql(paramIdx) { return deptScoped(BALANCE_SQL, 'so', paramIdx); }

// Reads ?department=<key> off the request, and — if it's a real, non-"all"
// department — pushes its categories onto `params` and returns the 1-based
// bind position for deptFractionSql/deptScoped to reference. Returns null
// for "All", which every call site treats as "don't scope this query".
function resolveDeptParam(req, params) {
  const key = req.query.department;
  if (!key || key === 'all') return null;
  const dept = findDepartment(key);
  if (!dept) return null;
  params.push(dept.categories);
  return params.length;
}

router.get('/departments', asyncHandler(async (req, res) => {
  res.json({ data: [{ key: 'all', label: 'All' }, ...DEPARTMENTS.map((d) => ({ key: d.key, label: d.label }))], error: null });
}));

// Lightweight staff pickers for the Receivables filters — /users itself is
// Admin-only, but every role here needs to filter by collector/driver.
router.get('/collectors', asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT u.id, u.full_name FROM users u JOIN roles r ON r.id = u.role_id
     WHERE r.name = 'Collector' AND u.is_active = true ORDER BY u.full_name`
  );
  res.json({ data: rows, error: null });
}));

router.get('/drivers', asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT u.id, u.full_name FROM users u JOIN roles r ON r.id = u.role_id
     WHERE r.name = 'Driver' AND u.is_active = true ORDER BY u.full_name`
  );
  res.json({ data: rows, error: null });
}));

// ---------------------------------------------------------------------
// 1. Collection Dashboard
// ---------------------------------------------------------------------
router.get('/dashboard', asyncHandler(async (req, res) => {
  const p1 = []; const idx1 = resolveDeptParam(req, p1);
  const p2 = []; const idx2 = resolveDeptParam(req, p2);
  const p3 = []; const idx3 = resolveDeptParam(req, p3);
  const p4 = []; const idx4 = resolveDeptParam(req, p4);
  const p5 = []; const idx5 = resolveDeptParam(req, p5);
  const p6 = []; const idx6 = resolveDeptParam(req, p6);
  const p7 = []; const idx7 = resolveDeptParam(req, p7);
  const p8 = []; const idx8 = resolveDeptParam(req, p8);

  const paymentAmount = (idx) => (idx ? `p.amount * ${deptFractionSql('so', idx)}` : 'p.amount');
  const paymentsJoin = (idx) => (idx ? 'payments p JOIN sales_orders so ON so.id = p.sales_order_id' : 'payments p');

  const [outstanding, cashToday, cashMonth, creditMonth, custWithBalance, overdue, dailyTrend, monthlyTrend, topCollectors] = await Promise.all([
    pool.query(
      `SELECT COALESCE(SUM(${balanceSql(idx1)}), 0) AS total FROM sales_orders so WHERE so.status NOT IN ('cancelled','reversed')`,
      p1
    ),
    pool.query(
      `SELECT COALESCE(SUM(${paymentAmount(idx2)}), 0) AS total FROM ${paymentsJoin(idx2)} WHERE p.voided_at IS NULL AND p.payment_date = CURRENT_DATE`,
      p2
    ),
    pool.query(
      `SELECT COALESCE(SUM(${paymentAmount(idx3)}), 0) AS total FROM ${paymentsJoin(idx3)} WHERE p.voided_at IS NULL AND date_trunc('month', p.payment_date) = date_trunc('month', CURRENT_DATE)`,
      p3
    ),
    pool.query(
      `SELECT COALESCE(SUM(${deptScoped('so.total_amount', 'so', idx4)}), 0) AS total FROM sales_orders so
       WHERE so.sale_type = 'credit' AND so.status NOT IN ('cancelled','reversed')
         AND date_trunc('month', so.order_date) = date_trunc('month', CURRENT_DATE)`,
      p4
    ),
    pool.query(
      `SELECT COUNT(DISTINCT so.customer_id) AS n FROM sales_orders so
       WHERE so.status NOT IN ('cancelled','reversed') GROUP BY so.customer_id HAVING SUM(${balanceSql(idx5)}) > 0`,
      p5
    ),
    pool.query(
      `SELECT COUNT(DISTINCT so.customer_id) AS n FROM sales_orders so
       WHERE so.status NOT IN ('cancelled','reversed') AND so.order_date < CURRENT_DATE - 30
       GROUP BY so.customer_id HAVING SUM(${balanceSql(idx6)}) > 0`,
      p6
    ),
    pool.query(
      `SELECT p.payment_date AS day, SUM(${paymentAmount(idx7)}) AS total FROM ${paymentsJoin(idx7)}
       WHERE p.voided_at IS NULL AND p.payment_date >= CURRENT_DATE - 13 GROUP BY p.payment_date ORDER BY p.payment_date`,
      p7
    ),
    pool.query(
      `SELECT date_trunc('month', p.payment_date)::date AS month, SUM(${paymentAmount(idx7)}) AS total FROM ${paymentsJoin(idx7)}
       WHERE p.voided_at IS NULL AND p.payment_date >= CURRENT_DATE - INTERVAL '11 months' GROUP BY 1 ORDER BY 1`,
      p7
    ),
    pool.query(
      `SELECT u.full_name AS collector_name, SUM(${paymentAmount(idx8)}) AS total, COUNT(*) AS payment_count
       FROM ${paymentsJoin(idx8)} JOIN users u ON u.id = p.recorded_by
       WHERE p.voided_at IS NULL AND date_trunc('month', p.payment_date) = date_trunc('month', CURRENT_DATE)
       GROUP BY u.full_name ORDER BY total DESC LIMIT 5`,
      p8
    )
  ]);

  // Collection rate: this month's collections vs. this month's credit sales +
  // opening receivables — a standard "how much of what's collectible did we
  // actually collect" ratio. Average Collection Days: mean gap between an
  // invoice's order_date and the payment(s) that actually cleared it,
  // weighted by amount paid.
  const p9 = []; const idx9 = resolveDeptParam(req, p9);
  const p10 = []; const idx10 = resolveDeptParam(req, p10);
  const [collectionRate, avgDays] = await Promise.all([
    pool.query(
      `SELECT
         COALESCE((SELECT SUM(${paymentAmount(idx9)}) FROM ${paymentsJoin(idx9)} WHERE p.voided_at IS NULL AND date_trunc('month', p.payment_date) = date_trunc('month', CURRENT_DATE)), 0) AS collected,
         COALESCE((SELECT SUM(${deptScoped('so.total_amount', 'so', idx9)}) FROM sales_orders so WHERE so.status NOT IN ('cancelled','reversed') AND date_trunc('month', so.order_date) = date_trunc('month', CURRENT_DATE)), 0) AS billed`,
      p9
    ),
    pool.query(
      `SELECT COALESCE(AVG(p.payment_date - so.order_date), 0) AS avg_days
       FROM payments p JOIN sales_orders so ON so.id = p.sales_order_id
       WHERE p.voided_at IS NULL ${idx10 ? `AND ${deptFractionSql('so', idx10)} > 0` : ''}`,
      p10
    )
  ]);
  const billed = Number(collectionRate.rows[0].billed);
  const collected = Number(collectionRate.rows[0].collected);
  const collectionRatePct = billed > 0 ? Math.min(100, (collected / billed) * 100) : 0;

  res.json({
    data: {
      total_outstanding: Number(outstanding.rows[0].total),
      cash_collected_today: Number(cashToday.rows[0].total),
      cash_collected_month: Number(cashMonth.rows[0].total),
      credit_collected_month: Number(creditMonth.rows[0].total),
      customers_with_balance: custWithBalance.rows.length,
      overdue_customers: overdue.rows.length,
      collection_rate_pct: collectionRatePct,
      avg_collection_days: Number(avgDays.rows[0].avg_days),
      daily_collections: dailyTrend.rows,
      monthly_collections: monthlyTrend.rows,
      top_collectors: topCollectors.rows
    },
    error: null
  });
}));

// Overdue > 30 days, no payment for 60 days, no water for X days, and large
// balances — every figure here is a live query, never a cached/precomputed
// alert row, so it can never go stale.
router.get('/alerts', asyncHandler(async (req, res) => {
  const noWaterDays = Number(req.query.no_water_days) || 30;
  const largeBalanceThreshold = Number(req.query.large_balance) || 500;
  const deptKey = req.query.department && req.query.department !== 'all' ? req.query.department : null;

  const p1 = []; const idx1 = resolveDeptParam(req, p1);
  const p2 = []; const idx2 = resolveDeptParam(req, p2);
  const p4 = [largeBalanceThreshold]; const idx4 = resolveDeptParam(req, p4);

  // "No water for X days" is inherently a Bulk Water delivery signal — when
  // a different single department is selected it simply doesn't apply, so
  // it comes back empty rather than showing a stale/irrelevant list.
  const waterAlertApplicable = !deptKey || deptKey === 'bulk_water';

  const [overdue30, noPayment60, noWater, largeBalances] = await Promise.all([
    pool.query(
      `SELECT c.id, c.name, c.hno, SUM(${balanceSql(idx1)}) AS balance
       FROM customers c JOIN sales_orders so ON so.customer_id = c.id
       WHERE so.status NOT IN ('cancelled','reversed') AND so.order_date < CURRENT_DATE - 30
       GROUP BY c.id, c.name, c.hno HAVING SUM(${balanceSql(idx1)}) > 0 ORDER BY balance DESC LIMIT 20`,
      p1
    ),
    pool.query(
      `SELECT c.id, c.name, c.hno,
              (SELECT MAX(p.payment_date) FROM payments p JOIN sales_orders so2 ON so2.id = p.sales_order_id
               WHERE so2.customer_id = c.id AND p.voided_at IS NULL
                 ${idx2 ? `AND ${deptFractionSql('so2', idx2)} > 0` : ''}) AS last_payment
       FROM customers c
       WHERE c.status = 'active'
         AND ((SELECT MAX(p.payment_date) FROM payments p JOIN sales_orders so2 ON so2.id = p.sales_order_id
                WHERE so2.customer_id = c.id AND p.voided_at IS NULL
                  ${idx2 ? `AND ${deptFractionSql('so2', idx2)} > 0` : ''}) IS NULL
              OR (SELECT MAX(p.payment_date) FROM payments p JOIN sales_orders so2 ON so2.id = p.sales_order_id
                   WHERE so2.customer_id = c.id AND p.voided_at IS NULL
                     ${idx2 ? `AND ${deptFractionSql('so2', idx2)} > 0` : ''}) < CURRENT_DATE - 60)
         AND EXISTS (SELECT 1 FROM sales_orders so3 WHERE so3.customer_id = c.id
                       ${idx2 ? `AND ${deptFractionSql('so3', idx2)} > 0` : ''})
       LIMIT 20`,
      p2
    ),
    waterAlertApplicable
      ? pool.query(
          `SELECT c.id, c.name, c.hno,
                  (SELECT MAX(so.order_date) FROM sales_orders so JOIN sales_order_items soi ON soi.sales_order_id = so.id
                   JOIN products p ON p.id = soi.product_id JOIN categories cat ON cat.id = p.category_id
                   WHERE so.customer_id = c.id AND cat.name = 'Bulk Water' AND so.status = 'delivered') AS last_delivery
           FROM customers c WHERE c.status = 'active'
             AND (SELECT MAX(so.order_date) FROM sales_orders so JOIN sales_order_items soi ON soi.sales_order_id = so.id
                   JOIN products p ON p.id = soi.product_id JOIN categories cat ON cat.id = p.category_id
                   WHERE so.customer_id = c.id AND cat.name = 'Bulk Water' AND so.status = 'delivered') < CURRENT_DATE - $1::int
           LIMIT 20`,
          [noWaterDays]
        )
      : Promise.resolve({ rows: [] }),
    pool.query(
      `SELECT c.id, c.name, c.hno, SUM(${balanceSql(idx4)}) AS balance
       FROM customers c JOIN sales_orders so ON so.customer_id = c.id
       WHERE so.status NOT IN ('cancelled','reversed')
       GROUP BY c.id, c.name, c.hno HAVING SUM(${balanceSql(idx4)}) >= $1 ORDER BY balance DESC LIMIT 20`,
      p4
    )
  ]);

  res.json({
    data: {
      overdue_30_days: overdue30.rows,
      no_payment_60_days: noPayment60.rows,
      no_water_delivery: noWater.rows,
      large_balances: largeBalances.rows
    },
    error: null
  });
}));

// ---------------------------------------------------------------------
// 2. Customer Receivables
// ---------------------------------------------------------------------
router.get('/receivables', asyncHandler(async (req, res) => {
  const { search, area, collector_id, driver_id, outstanding_only, overdue_only, no_water_days, status } = req.query;
  const conditions = [];
  const params = [];
  if (search) {
    params.push(`%${search}%`);
    conditions.push(`(c.name ILIKE $${params.length} OR c.phone ILIKE $${params.length} OR regexp_replace(c.hno, '[,\\s]', '', 'g') ILIKE regexp_replace($${params.length}, '[,\\s]', '', 'g'))`);
  }
  if (area) { params.push(area); conditions.push(`c.route = $${params.length}`); }
  if (collector_id) { params.push(collector_id); conditions.push(`c.collector_id = $${params.length}`); }
  if (status) { params.push(status); conditions.push(`c.status = $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const deptIdx = resolveDeptParam(req, params);

  const { rows } = await pool.query(
    `SELECT c.id, c.hno, c.name, c.phone, c.route AS area, c.credit_limit, c.status,
            collector.full_name AS collector_name,
            COALESCE((SELECT SUM(${balanceSql(deptIdx)}) FROM sales_orders so WHERE so.customer_id = c.id AND so.status NOT IN ('cancelled','reversed')), 0) AS current_balance,
            (SELECT STRING_AGG(DISTINCT cat.name, ', ' ORDER BY cat.name) FROM sales_orders so
             JOIN sales_order_items soi ON soi.sales_order_id = so.id
             JOIN products p ON p.id = soi.product_id JOIN categories cat ON cat.id = p.category_id
             WHERE so.customer_id = c.id) AS departments,
            (SELECT MAX(so.order_date) FROM sales_orders so JOIN sales_order_items soi ON soi.sales_order_id = so.id
             JOIN products p ON p.id = soi.product_id JOIN categories cat ON cat.id = p.category_id
             WHERE so.customer_id = c.id AND cat.name = 'Bulk Water' AND so.status = 'delivered') AS last_delivery_date,
            (SELECT MAX(p.payment_date) FROM payments p JOIN sales_orders so ON so.id = p.sales_order_id
             WHERE so.customer_id = c.id AND p.voided_at IS NULL) AS last_payment_date,
            (SELECT rr.driver_id FROM route_stops rs JOIN route_runs rr ON rr.id = rs.route_run_id
             WHERE rs.customer_id = c.id ORDER BY rs.created_at DESC LIMIT 1) AS last_driver_id,
            (SELECT u2.full_name FROM route_stops rs JOIN route_runs rr ON rr.id = rs.route_run_id JOIN users u2 ON u2.id = rr.driver_id
             WHERE rs.customer_id = c.id ORDER BY rs.created_at DESC LIMIT 1) AS driver_name
     FROM customers c LEFT JOIN users collector ON collector.id = c.collector_id
     ${where}
     ORDER BY c.name`,
    params
  );

  const today = new Date();
  const rowsWithComputed = rows
    .map((r) => {
      const daysSincePayment = r.last_payment_date ? Math.floor((today - new Date(r.last_payment_date)) / 86400000) : null;
      const daysSinceDelivery = r.last_delivery_date ? Math.floor((today - new Date(r.last_delivery_date)) / 86400000) : null;
      return { ...r, days_since_last_payment: daysSincePayment, days_since_last_delivery: daysSinceDelivery };
    })
    .filter((r) => {
      if (outstanding_only === 'true' && !(Number(r.current_balance) > 0)) return false;
      if (overdue_only === 'true' && !(r.days_since_last_payment === null || r.days_since_last_payment > 30)) return false;
      if (driver_id && String(r.last_driver_id) !== String(driver_id)) return false;
      if (no_water_days && !(r.days_since_last_delivery === null || r.days_since_last_delivery >= Number(no_water_days))) return false;
      return true;
    });

  res.json({ data: rowsWithComputed, error: null });
}));

// ---------------------------------------------------------------------
// 3. Receive Payment — searches customers the same exact-match-first way the
// fast POS does (HNO/phone/name), then allocates the amount across that
// customer's outstanding orders oldest-first (FIFO). Every payments row
// created here is a real row against a real sales_order — there is no
// second, customer-level ledger, so a customer's balance is always still
// exactly total_amount - SUM(payments) per order, summed.
// ---------------------------------------------------------------------
router.get('/customers/search', asyncHandler(async (req, res) => {
  const { q } = req.query;
  if (!q) throw new ApiError(400, 'q is required');
  const params = [q, `%${q}%`];
  const deptIdx = resolveDeptParam(req, params);
  const { rows } = await pool.query(
    `SELECT c.id, c.hno, c.name, c.phone, c.status,
            COALESCE((SELECT SUM(${balanceSql(deptIdx)}) FROM sales_orders so WHERE so.customer_id = c.id AND so.status NOT IN ('cancelled','reversed')), 0) AS outstanding_balance,
            (SELECT MAX(so.order_date) FROM sales_orders so JOIN sales_order_items soi ON soi.sales_order_id = so.id
             JOIN products p ON p.id = soi.product_id JOIN categories cat ON cat.id = p.category_id
             WHERE so.customer_id = c.id AND cat.name = 'Bulk Water' AND so.status = 'delivered') AS last_delivery_date,
            (SELECT MAX(p.payment_date) FROM payments p JOIN sales_orders so ON so.id = p.sales_order_id
             WHERE so.customer_id = c.id AND p.voided_at IS NULL) AS last_payment_date
     FROM customers c
     WHERE regexp_replace(c.hno, '[,\\s]', '', 'g') = regexp_replace($1, '[,\\s]', '', 'g')
        OR c.phone ILIKE $2 OR c.name ILIKE $2
        OR EXISTS (SELECT 1 FROM sales_orders so WHERE so.customer_id = c.id AND so.invoice_hno ILIKE $2)
     ORDER BY c.name LIMIT 20`,
    params
  );

  // For each match, break down its outstanding balance per department too —
  // Receive Payment needs this to know whether the collector must be asked
  // which department a payment applies to (i.e. more than one department
  // actually has a balance) or whether there's only one real answer.
  const withBreakdown = await Promise.all(rows.map(async (customer) => {
    const breakdown = [];
    for (const dept of DEPARTMENTS) {
      const { rows: balRows } = await pool.query(
        `SELECT COALESCE(SUM(${balanceSql(1)}), 0) AS balance FROM sales_orders so
         WHERE so.customer_id = $2 AND so.status NOT IN ('cancelled','reversed')`,
        [dept.categories, customer.id]
      );
      const balance = Number(balRows[0].balance);
      if (balance > 0.005) breakdown.push({ key: dept.key, label: dept.label, balance });
    }
    return { ...customer, department_balances: breakdown };
  }));

  res.json({ data: withBreakdown, error: null });
}));

router.post('/payments', requireRole(...RECEIVE_PAYMENT_ROLES), asyncHandler(async (req, res) => {
  const { customer_id, amount, method, reference_number, payment_date, bank_account_id, notes, department } = req.body;
  if (!customer_id) throw new ApiError(400, 'customer_id is required');
  const amt = Number(amount);
  if (!(amt > 0)) throw new ApiError(400, 'Amount must be greater than zero');
  if (!method) throw new ApiError(400, 'Payment method is required');

  const dept = department && department !== 'all' ? findDepartment(department) : null;
  if (department && department !== 'all' && !dept) throw new ApiError(400, 'Unknown department');

  const result = await withTransaction(async (client) => {
    // When a department is specified, FIFO only ever considers orders that
    // actually carry an item in that department — a payment recorded
    // against "Ice" can never be applied to a pure Bulk Water invoice.
    const deptFilterParams = dept ? [dept.categories] : [];
    const deptFilterSql = dept
      ? `AND EXISTS (SELECT 1 FROM sales_order_items soi JOIN products pr ON pr.id = soi.product_id
                     JOIN categories cat ON cat.id = pr.category_id
                     WHERE soi.sales_order_id = so.id AND cat.name = ANY($2))`
      : '';
    const { rows: openOrders } = await client.query(
      `SELECT so.id, so.total_amount, ${BALANCE_SQL} AS balance
       FROM sales_orders so
       WHERE so.customer_id = $1 AND so.status NOT IN ('cancelled','reversed') ${deptFilterSql}
       ORDER BY so.order_date ASC, so.id ASC FOR UPDATE`,
      [customer_id, ...deptFilterParams]
    );
    const withBalance = openOrders.filter((o) => Number(o.balance) > 0);
    if (!withBalance.length) {
      throw new ApiError(400, dept
        ? `This customer has no outstanding balance in ${dept.label} to collect against.`
        : 'This customer has no outstanding balance to collect against.');
    }

    let remaining = amt;
    const paymentsCreated = [];
    const arAcct = await getAccountByCode(client, '1100');
    const cashOrBankAcct = await resolveCashOrBankAccount(client, method, bank_account_id);

    for (const order of withBalance) {
      if (remaining <= 0) break;
      const applyAmount = Math.min(remaining, Number(order.balance));
      const transactionHno = await nextHno(client, 'transaction');
      const { rows: payRows } = await client.query(
        `INSERT INTO payments (sales_order_id, amount, payment_date, method, reference_number, transaction_hno, recorded_by, bank_account_id, notes)
         VALUES ($1,$2,COALESCE($3, CURRENT_DATE),$4,$5,$6,$7,$8,$9) RETURNING *`,
        [order.id, applyAmount, payment_date || null, method, reference_number || null, transactionHno, req.user.id, bank_account_id || null, notes || null]
      );
      const payment = payRows[0];
      paymentsCreated.push(payment);
      remaining -= applyAmount;

      const { rows: totals } = await client.query(
        `SELECT so.total_amount, COALESCE(SUM(p.amount), 0) AS paid FROM sales_orders so
         LEFT JOIN payments p ON p.sales_order_id = so.id AND p.voided_at IS NULL WHERE so.id = $1 GROUP BY so.total_amount`,
        [order.id]
      );
      const paymentStatus = Number(totals[0].paid) >= Number(totals[0].total_amount) ? 'paid' : 'partial';
      await client.query(`UPDATE sales_orders SET payment_status = $1 WHERE id = $2`, [paymentStatus, order.id]);

      await postJournalEntry(client, {
        entryDate: payment.payment_date, description: `Payment ${payment.transaction_hno} - Order #${order.id}${dept ? ` (${dept.label})` : ''}`,
        source: 'system', referenceType: 'payment', referenceId: payment.id, createdBy: req.user.id,
        lines: [
          { accountId: cashOrBankAcct, debit: applyAmount, credit: 0 },
          { accountId: arAcct.id, debit: 0, credit: applyAmount, customerId: Number(customer_id) }
        ]
      });

      await logAudit(client, { userId: req.user.id, action: 'CREATE', entityType: 'payment', entityId: payment.id, newValue: payment });
    }

    // Any amount left over after every outstanding order is fully cleared is
    // simply not collected against anything — this endpoint only ever
    // reduces real balances, never invents a credit-balance/overpayment
    // ledger that doesn't exist elsewhere in this ERP.
    return { payments: paymentsCreated, applied: amt - remaining, unapplied: remaining };
  });

  res.status(201).json({ data: result, error: null });
}));

// Edit is deliberately narrow — never the amount (that would silently
// desync the journal entry already posted). Only Finance/Admin may touch
// even this much; Collector/Data Entry/Driver cannot reach this route at all.
router.put('/payments/:id', requireRole(...EDIT_PAYMENT_ROLES), asyncHandler(async (req, res) => {
  const { reference_number, notes } = req.body;
  const { rows } = await pool.query(
    `UPDATE payments SET reference_number = COALESCE($1, reference_number), notes = COALESCE($2, notes) WHERE id = $3 AND voided_at IS NULL RETURNING *`,
    [reference_number ?? null, notes ?? null, req.params.id]
  );
  if (!rows[0]) throw new ApiError(404, 'Payment not found or already voided');
  res.json({ data: rows[0], error: null });
}));

// ---------------------------------------------------------------------
// 4. Payment History
// ---------------------------------------------------------------------
router.get('/payments', asyncHandler(async (req, res) => {
  const { date_from, date_to, collector_id, customer_id, method } = req.query;
  const conditions = ['p.voided_at IS NULL'];
  const params = [];
  if (date_from) { params.push(date_from); conditions.push(`p.payment_date >= $${params.length}`); }
  if (date_to) { params.push(date_to); conditions.push(`p.payment_date <= $${params.length}`); }
  if (collector_id) { params.push(collector_id); conditions.push(`p.recorded_by = $${params.length}`); }
  if (customer_id) { params.push(customer_id); conditions.push(`so.customer_id = $${params.length}`); }
  if (method) { params.push(method); conditions.push(`p.method = $${params.length}`); }
  const deptIdx = resolveDeptParam(req, params);
  if (deptIdx) conditions.push(`${deptFractionSql('so', deptIdx)} > 0`);

  const { rows } = await pool.query(
    `SELECT p.id, p.payment_date, p.transaction_hno AS receipt_number, p.amount, p.method, p.reference_number, p.notes,
            c.id AS customer_id, c.name AS customer_name, c.hno,
            u.full_name AS collector_name,
            (SELECT STRING_AGG(DISTINCT cat.name, ', ' ORDER BY cat.name) FROM sales_order_items soi
             JOIN products pr ON pr.id = soi.product_id JOIN categories cat ON cat.id = pr.category_id
             WHERE soi.sales_order_id = so.id) AS department
     FROM payments p
     JOIN sales_orders so ON so.id = p.sales_order_id
     JOIN customers c ON c.id = so.customer_id
     JOIN users u ON u.id = p.recorded_by
     WHERE ${conditions.join(' AND ')}
     ORDER BY p.payment_date DESC, p.id DESC LIMIT 500`,
    params
  );
  res.json({ data: rows, error: null });
}));

// ---------------------------------------------------------------------
// 5. Employee Collection Performance
// ---------------------------------------------------------------------
router.get('/employee-performance', asyncHandler(async (req, res) => {
  const params = [];
  const deptIdx = resolveDeptParam(req, params);
  const paymentDeptFilter = deptIdx ? `AND ${deptFractionSql('so', deptIdx)} > 0` : '';

  // customers_with_balance: a per-collector count of their assigned
  // customers that currently owe something — computed as its own
  // aggregated subquery (not a correlated scalar with GROUP BY, which
  // isn't valid SQL) and left-joined in, so a collector with zero such
  // customers still shows 0 rather than being dropped entirely.
  const { rows } = await pool.query(
    `SELECT u.id, u.full_name AS employee_name,
            (SELECT COUNT(*) FROM customers c WHERE c.collector_id = u.id) AS customers_assigned,
            (SELECT COUNT(DISTINCT c.id) FROM customers c WHERE c.collector_id = u.id
               AND EXISTS (SELECT 1 FROM payments p JOIN sales_orders so ON so.id = p.sales_order_id
                           WHERE so.customer_id = c.id AND p.voided_at IS NULL
                             AND date_trunc('month', p.payment_date) = date_trunc('month', CURRENT_DATE)
                             ${paymentDeptFilter})) AS customers_paid_this_month,
            COALESCE(owing.customers_with_balance, 0) AS customers_with_balance,
            COALESCE((SELECT SUM(p.amount) FROM payments p JOIN sales_orders so ON so.id = p.sales_order_id
                        WHERE p.recorded_by = u.id AND p.voided_at IS NULL AND p.payment_date = CURRENT_DATE ${paymentDeptFilter}), 0) AS cash_collected_today,
            COALESCE((SELECT SUM(p.amount) FROM payments p JOIN sales_orders so ON so.id = p.sales_order_id
                        WHERE p.recorded_by = u.id AND p.voided_at IS NULL AND date_trunc('month', p.payment_date) = date_trunc('month', CURRENT_DATE) ${paymentDeptFilter}), 0) AS cash_collected_month,
            COALESCE((SELECT SUM(${balanceSql(deptIdx)}) FROM customers c2 JOIN sales_orders so ON so.customer_id = c2.id WHERE c2.collector_id = u.id AND so.status NOT IN ('cancelled','reversed')), 0) AS outstanding_balance,
            COALESCE((SELECT AVG(p.payment_date - so.order_date) FROM payments p JOIN sales_orders so ON so.id = p.sales_order_id
                        WHERE p.recorded_by = u.id AND p.voided_at IS NULL ${paymentDeptFilter}), 0) AS avg_collection_days
     FROM users u
     JOIN roles r ON r.id = u.role_id
     LEFT JOIN LATERAL (
       SELECT COUNT(*) AS customers_with_balance FROM (
         SELECT c.id FROM customers c JOIN sales_orders so ON so.customer_id = c.id
         WHERE c.collector_id = u.id AND so.status NOT IN ('cancelled','reversed')
         GROUP BY c.id HAVING SUM(${balanceSql(deptIdx)}) > 0
       ) x
     ) owing ON true
     WHERE r.name = 'Collector' OR EXISTS (SELECT 1 FROM customers c WHERE c.collector_id = u.id)
     ORDER BY cash_collected_month DESC`,
    params
  );
  const withRate = rows.map((r) => {
    const assigned = Number(r.customers_assigned) || 0;
    const paid = Number(r.customers_paid_this_month) || 0;
    return {
      ...r,
      customers_outstanding: Number(r.customers_with_balance) || 0,
      collection_rate_pct: assigned > 0 ? Math.round((paid / assigned) * 100) : 0
    };
  });
  res.json({ data: withRate, error: null });
}));

// ---------------------------------------------------------------------
// 6. Driver Accountability
// ---------------------------------------------------------------------
router.get('/driver-accountability', asyncHandler(async (req, res) => {
  const params = [];
  const deptIdx = resolveDeptParam(req, params);
  const saleAmount = deptScoped('so.total_amount', 'so', deptIdx);
  const cashAmount = deptIdx ? `rs.cash_received * ${deptFractionSql('so', deptIdx)}` : 'rs.cash_received';

  const { rows } = await pool.query(
    `SELECT u.id, u.full_name AS driver_name,
            COALESCE(SUM(${saleAmount}), 0) AS total_sales,
            COALESCE(SUM(${cashAmount}), 0) AS cash_returned,
            COALESCE(SUM(${saleAmount}) - SUM(${cashAmount}), 0) AS credit_given,
            COALESCE(SUM(${balanceSql(deptIdx)}), 0) AS outstanding
     FROM users u
     JOIN route_runs rr ON rr.driver_id = u.id
     JOIN route_stops rs ON rs.route_run_id = rr.id AND rs.status = 'delivered'
     JOIN sales_orders so ON so.id = rs.sales_order_id
     GROUP BY u.id, u.full_name
     ORDER BY total_sales DESC`,
    params
  );
  const withRate = rows.map((r) => ({
    ...r,
    collection_pct: Number(r.total_sales) > 0 ? Math.round((Number(r.cash_returned) / Number(r.total_sales)) * 100) : 0
  }));
  res.json({ data: withRate, error: null });
}));

// ---------------------------------------------------------------------
// 7. Aging Report
// ---------------------------------------------------------------------
router.get('/aging', asyncHandler(async (req, res) => {
  const params = [];
  const deptIdx = resolveDeptParam(req, params);
  const { rows } = await pool.query(
    `SELECT
       CASE
         WHEN CURRENT_DATE - so.order_date <= 0 THEN 'current'
         WHEN CURRENT_DATE - so.order_date BETWEEN 1 AND 30 THEN 'days_1_30'
         WHEN CURRENT_DATE - so.order_date BETWEEN 31 AND 60 THEN 'days_31_60'
         WHEN CURRENT_DATE - so.order_date BETWEEN 61 AND 90 THEN 'days_61_90'
         ELSE 'over_90'
       END AS bucket,
       SUM(${balanceSql(deptIdx)}) AS total
     FROM sales_orders so
     WHERE so.status NOT IN ('cancelled','reversed')
     GROUP BY bucket`,
    params
  );
  const buckets = { current: 0, days_1_30: 0, days_31_60: 0, days_61_90: 0, over_90: 0 };
  for (const r of rows) {
    if (Number(r.total) > 0) buckets[r.bucket] = Number(r.total);
  }
  const total = Object.values(buckets).reduce((s, v) => s + v, 0);
  const pct = {};
  for (const k of Object.keys(buckets)) pct[k] = total > 0 ? (buckets[k] / total) * 100 : 0;

  res.json({ data: { buckets, percentages: pct, total }, error: null });
}));

// ---------------------------------------------------------------------
// 8. Customer Profile
// ---------------------------------------------------------------------
router.get('/customers/:id/profile', asyncHandler(async (req, res) => {
  const { rows: custRows } = await pool.query(
    `SELECT c.*, collector.full_name AS collector_name FROM customers c LEFT JOIN users collector ON collector.id = c.collector_id WHERE c.id = $1`,
    [req.params.id]
  );
  if (!custRows[0]) throw new ApiError(404, 'Customer not found');
  const customer = custRows[0];

  const balanceParams = [req.params.id];
  const deptIdx = resolveDeptParam(req, balanceParams);

  const [balanceRows, paymentRows, deliveryRows] = await Promise.all([
    pool.query(
      `SELECT COALESCE(SUM(${balanceSql(deptIdx)}), 0) AS balance FROM sales_orders so
       WHERE so.customer_id = $1 AND so.status NOT IN ('cancelled','reversed')`,
      balanceParams
    ),
    pool.query(
      `SELECT p.payment_date, p.transaction_hno AS receipt_number, p.amount, p.method, u.full_name AS collector_name
       FROM payments p JOIN sales_orders so ON so.id = p.sales_order_id JOIN users u ON u.id = p.recorded_by
       WHERE so.customer_id = $1 AND p.voided_at IS NULL ORDER BY p.payment_date DESC LIMIT 50`,
      [req.params.id]
    ),
    pool.query(
      `SELECT so.order_date, soi.quantity AS liters, so.total_amount, so.status
       FROM sales_orders so JOIN sales_order_items soi ON soi.sales_order_id = so.id
       JOIN products p ON p.id = soi.product_id JOIN categories cat ON cat.id = p.category_id
       WHERE so.customer_id = $1 AND cat.name = 'Bulk Water' ORDER BY so.order_date DESC LIMIT 50`,
      [req.params.id]
    )
  ]);

  const lastDelivery = deliveryRows.rows.find((d) => d.status === 'delivered');
  const daysSinceDelivery = lastDelivery ? Math.floor((new Date() - new Date(lastDelivery.order_date)) / 86400000) : null;
  const balance = Number(balanceRows.rows[0].balance);

  res.json({
    data: {
      customer,
      outstanding_balance: balance,
      credit_limit: Number(customer.credit_limit),
      payment_status: balance <= 0 ? 'clear' : Number(customer.credit_limit) > 0 && balance > Number(customer.credit_limit) ? 'over_limit' : 'outstanding',
      payment_history: paymentRows.rows,
      delivery_history: deliveryRows.rows,
      last_delivery_date: lastDelivery?.order_date || null,
      days_since_last_delivery: daysSinceDelivery
    },
    error: null
  });
}));

// ---------------------------------------------------------------------
// 9. Follow-Up
// ---------------------------------------------------------------------
router.get('/customers/:id/follow-ups', asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT f.*, u.full_name AS created_by_name FROM follow_ups f JOIN users u ON u.id = f.created_by
     WHERE f.customer_id = $1 ORDER BY f.created_at DESC`,
    [req.params.id]
  );
  res.json({ data: rows, error: null });
}));

router.post('/customers/:id/follow-ups', asyncHandler(async (req, res) => {
  const { action_type, notes, promise_amount, promise_date, next_followup_date } = req.body;
  if (!action_type) throw new ApiError(400, 'action_type is required');
  const { rows } = await pool.query(
    `INSERT INTO follow_ups (customer_id, action_type, notes, promise_amount, promise_date, next_followup_date, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [req.params.id, action_type, notes || null, promise_amount || null, promise_date || null, next_followup_date || null, req.user.id]
  );
  res.status(201).json({ data: rows[0], error: null });
}));

// Reminders due today or overdue, across every customer — the follow-up
// worklist a collector opens their day with.
router.get('/follow-ups/due', asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT f.*, c.name AS customer_name, c.hno, c.phone FROM follow_ups f
     JOIN customers c ON c.id = f.customer_id
     WHERE f.next_followup_date IS NOT NULL AND f.next_followup_date <= CURRENT_DATE AND f.completed_at IS NULL
     ORDER BY f.next_followup_date ASC`
  );
  res.json({ data: rows, error: null });
}));

module.exports = router;
