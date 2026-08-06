// Retail Sales & Billing — a POS-style invoice workflow for Bottled Water and
// Ice, deliberately separate from Route Operations (tanker dispatch, truck
// loads, reconciliation), which stays exactly as-is for Bulk Water.
//
// This module still reuses the exact same sales_orders/sales_order_items/
// payments tables and the exact same order-creation logic (createSalesOrderFromItems,
// postCreditApprovalRevenue) that Sales already uses for Bulk Water — a retail
// sale IS a sales_order, an invoice IS that order's invoice_hno, a receipt IS
// the same thing under a different name. The one real difference: a retail
// sale has no dispatch stage at all. It settles at the counter, so stock
// leaves the warehouse and (for credit) Accounts Receivable is debited in the
// very same request that rings up the sale — never staged as "pending" the
// way a bulk-water credit order is until someone explicitly approves it.
const { Router } = require('express');
const { pool, withTransaction } = require('../config/db');
const { asyncHandler, ApiError } = require('../utils/asyncHandler');
const { requireRole } = require('../middleware/auth');
const { postStockMovement } = require('../utils/stockLedger');
const { logAudit } = require('../services/auditService');
const { createSalesOrderFromItems, postCreditApprovalRevenue } = require('./sales.routes');

const router = Router();

const RECORD_SALE_ROLES = ['Admin', 'Sales Manager', 'Cashier'];

// The only two departments this module ever touches — Bulk Water never
// appears here. Adding a future retail department is a one-line addition.
const RETAIL_DEPARTMENTS = [
  { key: 'bottled_water', label: 'Bottled Water', categories: ['Bottled Water'] },
  { key: 'ice', label: 'Ice', categories: ['Ice Products'] }
];
const ALL_RETAIL_CATEGORIES = RETAIL_DEPARTMENTS.flatMap((d) => d.categories);
function findDepartment(key) { return RETAIL_DEPARTMENTS.find((d) => d.key === key); }

const BALANCE_SQL = `so.total_amount - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.sales_order_id = so.id AND p.voided_at IS NULL), 0)`;

// A retail order is defined as one whose lines are ALL in Bottled Water/Ice
// (enforced at creation below) — so, unlike Billing & Collections' general
// department math, no per-order fraction weighting is ever needed here: an
// order is either wholly retail or it isn't.
function retailOrderExistsSql(alias, paramIdx) {
  return `EXISTS (SELECT 1 FROM sales_order_items soi JOIN products p ON p.id = soi.product_id
            JOIN categories cat ON cat.id = p.category_id
            WHERE soi.sales_order_id = ${alias}.id AND cat.name = ANY($${paramIdx}))`;
}

router.get('/departments', asyncHandler(async (req, res) => {
  res.json({ data: RETAIL_DEPARTMENTS.map((d) => ({ key: d.key, label: d.label })), error: null });
}));

router.get('/products', asyncHandler(async (req, res) => {
  const dept = findDepartment(req.query.department);
  if (!dept) throw new ApiError(400, 'department must be bottled_water or ice');
  const { rows } = await pool.query(
    `SELECT p.id, p.name, p.sku, p.unit FROM products p
     JOIN categories c ON c.id = p.category_id
     WHERE c.name = ANY($1) AND p.is_active = true
     ORDER BY p.name`,
    [dept.categories]
  );
  res.json({ data: rows, error: null });
}));

// ---------------------------------------------------------------------
// 1/2/3. Sales Screen — cash settles and posts immediately; credit posts
// Accounts Receivable immediately too (no separate approval/dispatch stage —
// that's the one deliberate behavioral difference from the general Sales
// module's credit-order draft flow, since a retail sale is meant to be final
// the moment it's rung up, like any POS).
// ---------------------------------------------------------------------
router.post('/sales', requireRole(...RECORD_SALE_ROLES), asyncHandler(async (req, res) => {
  const { customer_id, department, warehouse_id, items, discount, tax, payment_type, cash_payment_method, notes } = req.body;
  if (!customer_id) throw new ApiError(400, 'customer_id is required');
  if (!warehouse_id) throw new ApiError(400, 'warehouse_id is required');
  if (!Array.isArray(items) || !items.length) throw new ApiError(400, 'At least one item is required');
  if (!['cash', 'credit'].includes(payment_type)) throw new ApiError(400, 'payment_type must be cash or credit');
  const dept = findDepartment(department);
  if (!dept) throw new ApiError(400, 'department must be bottled_water or ice');

  const result = await withTransaction(async (client) => {
    const productIds = [...new Set(items.map((it) => Number(it.product_id)))];
    const { rows: matching } = await client.query(
      `SELECT p.id FROM products p JOIN categories c ON c.id = p.category_id WHERE p.id = ANY($1) AND c.name = ANY($2)`,
      [productIds, dept.categories]
    );
    if (matching.length !== productIds.length) {
      throw new ApiError(400, `Every item on a ${dept.label} sale must be a ${dept.label} product.`);
    }

    const order = await createSalesOrderFromItems(client, {
      customerId: customer_id, deliveryDate: null, items, discount, tax, deliveryFee: 0, notes,
      saleType: payment_type, cashPaymentMethod: cash_payment_method || 'cash',
      costCenterIdInput: null, projectId: null,
      actorId: req.user.id, actorRole: req.user.role
    });

    // Retail has no dispatch stage — the sale is final the instant it's rung
    // up, for both cash and credit.
    const { rows: approvedRows } = await client.query(
      `UPDATE sales_orders SET status = 'approved' WHERE id = $1 RETURNING *`,
      [order.id]
    );
    let finalOrder = approvedRows[0];

    if (finalOrder.sale_type === 'credit') {
      await postCreditApprovalRevenue(client, finalOrder, req.user.id);
    }

    for (const it of items) {
      await postStockMovement(client, {
        productId: it.product_id, warehouseId: warehouse_id, movementType: 'OUT', quantity: it.quantity,
        referenceType: 'sales', referenceId: order.id, performedBy: req.user.id,
        notes: `${dept.label} sale ${finalOrder.invoice_hno || finalOrder.order_number}`
      });
    }

    await logAudit(client, { userId: req.user.id, action: 'UPDATE', entityType: 'sales_order', entityId: order.id, newValue: finalOrder });
    return finalOrder;
  });

  res.status(201).json({ data: result, error: null });
}));

// ---------------------------------------------------------------------
// 6. Sales List
// ---------------------------------------------------------------------
router.get('/sales', asyncHandler(async (req, res) => {
  const { department, status, search, date_from, date_to } = req.query;
  const params = [ALL_RETAIL_CATEGORIES];
  const conditions = [retailOrderExistsSql('so', 1)];

  if (department && department !== 'all') {
    const dept = findDepartment(department);
    if (dept) { params.push(dept.categories); conditions.push(retailOrderExistsSql('so', params.length)); }
  }
  if (status) { params.push(status); conditions.push(`so.status = $${params.length}`); }
  if (search) {
    params.push(`%${search}%`);
    conditions.push(`(c.name ILIKE $${params.length} OR so.invoice_hno ILIKE $${params.length} OR so.order_number ILIKE $${params.length})`);
  }
  if (date_from) { params.push(date_from); conditions.push(`so.order_date >= $${params.length}`); }
  if (date_to) { params.push(date_to); conditions.push(`so.order_date <= $${params.length}`); }

  const { rows } = await pool.query(
    `SELECT so.id, so.invoice_hno, so.order_number, so.order_date, so.sale_type, so.status, so.payment_status,
            so.total_amount, c.id AS customer_id, c.name AS customer_name,
            COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.sales_order_id = so.id AND p.voided_at IS NULL), 0) AS amount_paid,
            ${BALANCE_SQL} AS balance,
            (SELECT STRING_AGG(DISTINCT cat.name, ', ' ORDER BY cat.name) FROM sales_order_items soi
             JOIN products p ON p.id = soi.product_id JOIN categories cat ON cat.id = p.category_id
             WHERE soi.sales_order_id = so.id) AS department,
            (SELECT STRING_AGG(p2.name, ', ') FROM sales_order_items soi2 JOIN products p2 ON p2.id = soi2.product_id
             WHERE soi2.sales_order_id = so.id) AS products
     FROM sales_orders so JOIN customers c ON c.id = so.customer_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY so.created_at DESC LIMIT 500`,
    params
  );
  res.json({ data: rows, error: null });
}));

// ---------------------------------------------------------------------
// 5. Customer Statement extras — the retail-specific slice (purchase
// history + last purchase) that the existing, department-agnostic
// GET /customers/:id/statement doesn't carry. Full invoice/payment ledger
// still comes from that existing endpoint — never duplicated here.
// ---------------------------------------------------------------------
router.get('/customers/:id/profile', asyncHandler(async (req, res) => {
  const reqDept = req.query.department && req.query.department !== 'all' ? findDepartment(req.query.department) : null;
  const params = [reqDept ? reqDept.categories : ALL_RETAIL_CATEGORIES];
  const deptCondition = retailOrderExistsSql('so', 1);

  const { rows: custRows } = await pool.query('SELECT * FROM customers WHERE id = $1', [req.params.id]);
  if (!custRows[0]) throw new ApiError(404, 'Customer not found');

  const [balanceRows, purchaseRows, paymentRows] = await Promise.all([
    pool.query(
      `SELECT COALESCE(SUM(${BALANCE_SQL}), 0) AS balance FROM sales_orders so
       WHERE so.customer_id = $${params.length + 1} AND so.status NOT IN ('cancelled','reversed') AND ${deptCondition}`,
      [...params, req.params.id]
    ),
    pool.query(
      `SELECT so.id, so.invoice_hno, so.order_date, so.sale_type, so.total_amount, so.payment_status,
              (SELECT STRING_AGG(p.name, ', ') FROM sales_order_items soi JOIN products p ON p.id = soi.product_id WHERE soi.sales_order_id = so.id) AS products
       FROM sales_orders so
       WHERE so.customer_id = $${params.length + 1} AND ${deptCondition}
       ORDER BY so.order_date DESC LIMIT 50`,
      [...params, req.params.id]
    ),
    pool.query(
      `SELECT p.payment_date, p.transaction_hno AS receipt_number, p.amount, p.method, u.full_name AS recorded_by_name
       FROM payments p JOIN sales_orders so ON so.id = p.sales_order_id JOIN users u ON u.id = p.recorded_by
       WHERE so.customer_id = $1 AND p.voided_at IS NULL AND ${retailOrderExistsSql('so', 2)}
       ORDER BY p.payment_date DESC LIMIT 50`,
      [req.params.id, ALL_RETAIL_CATEGORIES]
    )
  ]);

  res.json({
    data: {
      customer: custRows[0],
      outstanding_balance: Number(balanceRows.rows[0].balance),
      purchase_history: purchaseRows.rows,
      payment_history: paymentRows.rows,
      last_purchase_date: purchaseRows.rows[0]?.order_date || null
    },
    error: null
  });
}));

// ---------------------------------------------------------------------
// 8. Reports
// ---------------------------------------------------------------------
function deptParams(req) {
  const dept = req.query.department && req.query.department !== 'all' ? findDepartment(req.query.department) : null;
  const params = [dept ? dept.categories : ALL_RETAIL_CATEGORIES];
  return { params, condition: retailOrderExistsSql('so', 1) };
}

router.get('/reports/cash-sales', asyncHandler(async (req, res) => {
  const { params, condition } = deptParams(req);
  const { rows } = await pool.query(
    `SELECT so.id, so.invoice_hno, so.order_date, c.name AS customer_name, so.total_amount
     FROM sales_orders so JOIN customers c ON c.id = so.customer_id
     WHERE so.sale_type = 'cash' AND so.status NOT IN ('cancelled','reversed') AND ${condition}
     ORDER BY so.order_date DESC LIMIT 500`,
    params
  );
  res.json({ data: { rows, total: rows.reduce((s, r) => s + Number(r.total_amount), 0) }, error: null });
}));

router.get('/reports/credit-sales', asyncHandler(async (req, res) => {
  const { params, condition } = deptParams(req);
  const { rows } = await pool.query(
    `SELECT so.id, so.invoice_hno, so.order_date, c.name AS customer_name, so.total_amount,
            COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.sales_order_id = so.id AND p.voided_at IS NULL), 0) AS amount_paid,
            ${BALANCE_SQL} AS balance, so.payment_status
     FROM sales_orders so JOIN customers c ON c.id = so.customer_id
     WHERE so.sale_type = 'credit' AND so.status NOT IN ('cancelled','reversed') AND ${condition}
     ORDER BY so.order_date DESC LIMIT 500`,
    params
  );
  res.json({ data: { rows, total: rows.reduce((s, r) => s + Number(r.total_amount), 0) }, error: null });
}));

router.get('/reports/outstanding-invoices', asyncHandler(async (req, res) => {
  const { params, condition } = deptParams(req);
  const { rows } = await pool.query(
    `SELECT so.id, so.invoice_hno, so.order_date, c.name AS customer_name, so.total_amount,
            COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.sales_order_id = so.id AND p.voided_at IS NULL), 0) AS amount_paid,
            ${BALANCE_SQL} AS balance, so.payment_status
     FROM sales_orders so JOIN customers c ON c.id = so.customer_id
     WHERE so.status NOT IN ('cancelled','reversed') AND ${condition} AND ${BALANCE_SQL} > 0.005
     ORDER BY so.order_date ASC LIMIT 500`,
    params
  );
  res.json({ data: { rows, total: rows.reduce((s, r) => s + Number(r.balance), 0) }, error: null });
}));

router.get('/reports/paid-invoices', asyncHandler(async (req, res) => {
  const { params, condition } = deptParams(req);
  const { rows } = await pool.query(
    `SELECT so.id, so.invoice_hno, so.order_date, c.name AS customer_name, so.total_amount, so.sale_type
     FROM sales_orders so JOIN customers c ON c.id = so.customer_id
     WHERE so.payment_status = 'paid' AND so.status NOT IN ('cancelled','reversed') AND ${condition}
     ORDER BY so.order_date DESC LIMIT 500`,
    params
  );
  res.json({ data: { rows, total: rows.reduce((s, r) => s + Number(r.total_amount), 0) }, error: null });
}));

router.get('/reports/daily-sales', asyncHandler(async (req, res) => {
  const { params, condition } = deptParams(req);
  const { rows } = await pool.query(
    `SELECT so.order_date AS day, SUM(so.total_amount) AS total, COUNT(*) AS invoice_count
     FROM sales_orders so
     WHERE so.status NOT IN ('cancelled','reversed') AND so.order_date >= CURRENT_DATE - 29 AND ${condition}
     GROUP BY so.order_date ORDER BY so.order_date`,
    params
  );
  res.json({ data: rows, error: null });
}));

router.get('/reports/monthly-sales', asyncHandler(async (req, res) => {
  const { params, condition } = deptParams(req);
  const { rows } = await pool.query(
    `SELECT date_trunc('month', so.order_date)::date AS month, SUM(so.total_amount) AS total, COUNT(*) AS invoice_count
     FROM sales_orders so
     WHERE so.status NOT IN ('cancelled','reversed') AND so.order_date >= CURRENT_DATE - INTERVAL '11 months' AND ${condition}
     GROUP BY 1 ORDER BY 1`,
    params
  );
  res.json({ data: rows, error: null });
}));

router.get('/reports/top-customers', asyncHandler(async (req, res) => {
  const { params, condition } = deptParams(req);
  const { rows } = await pool.query(
    `SELECT c.id, c.name, SUM(so.total_amount) AS total, COUNT(*) AS invoice_count
     FROM sales_orders so JOIN customers c ON c.id = so.customer_id
     WHERE so.status NOT IN ('cancelled','reversed') AND ${condition}
     GROUP BY c.id, c.name ORDER BY total DESC LIMIT 10`,
    params
  );
  res.json({ data: rows, error: null });
}));

router.get('/reports/top-products', asyncHandler(async (req, res) => {
  const dept = findDepartment(req.query.department);
  const categories = dept ? dept.categories : ALL_RETAIL_CATEGORIES;
  const { rows } = await pool.query(
    `SELECT p.id, p.name, SUM(soi.quantity) AS units_sold, SUM(soi.subtotal) AS revenue
     FROM sales_order_items soi
     JOIN products p ON p.id = soi.product_id
     JOIN categories cat ON cat.id = p.category_id
     JOIN sales_orders so ON so.id = soi.sales_order_id
     WHERE cat.name = ANY($1) AND so.status NOT IN ('cancelled','reversed')
     GROUP BY p.id, p.name ORDER BY revenue DESC LIMIT 10`,
    [categories]
  );
  res.json({ data: rows, error: null });
}));

module.exports = router;
