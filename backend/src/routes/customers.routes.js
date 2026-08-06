const { Router } = require('express');
const { pool, withTransaction } = require('../config/db');
const { asyncHandler, ApiError } = require('../utils/asyncHandler');
const { requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const schemas = require('../validation/schemas');
const { nextHno } = require('../services/hnoService');
const { logAudit } = require('../services/auditService');

const router = Router();

router.get('/', asyncHandler(async (req, res) => {
  const { type, search, hno, qaade_id, status } = req.query;
  const conditions = [];
  const params = [];
  if (type) { params.push(type); conditions.push(`c.type = $${params.length}`); }
  if (status) { params.push(status); conditions.push(`c.status = $${params.length}`); }
  if (qaade_id) { params.push(qaade_id); conditions.push(`c.qaade_id = $${params.length}`); }
  if (hno) {
    // Every drum has exactly one HNO — this is an exact lookup, never a
    // fuzzy/contains/startsWith search. Commas/spaces are ignored on both
    // sides only so a legacy row still stored as "7,739" (pending cleanup)
    // is found by typing the plain number "7739".
    params.push(hno.replace(/[,\s]/g, ''));
    conditions.push(`regexp_replace(c.hno, '[,\\s]', '', 'g') = $${params.length}`);
  } else if (search) {
    params.push(`%${search}%`);
    conditions.push(`(c.name ILIKE $${params.length} OR c.code ILIKE $${params.length})`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  // Real price/liter for Bulk Water, resolved by the customer's own price
  // tier — the same lookup tanks.routes.js uses, since the POS no longer
  // sources price from a tank record at all.
  const { rows } = await pool.query(
    `SELECT c.*, q.name AS qaade_name, q.qaade_code,
            COALESCE(
              (SELECT pl.unit_price FROM price_lists pl
               JOIN products p ON p.id = pl.product_id JOIN categories cat ON cat.id = p.category_id
               WHERE cat.name = 'Bulk Water' AND pl.customer_type = c.type
                 AND pl.effective_from <= CURRENT_DATE AND (pl.effective_to IS NULL OR pl.effective_to >= CURRENT_DATE)
               ORDER BY pl.effective_from DESC LIMIT 1),
              (SELECT p.unit_price FROM products p JOIN categories cat ON cat.id = p.category_id
               WHERE cat.name = 'Bulk Water' LIMIT 1)
            ) AS bulk_water_price_per_liter,
            COALESCE(
              (SELECT SUM(so.total_amount - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.sales_order_id = so.id AND p.voided_at IS NULL), 0))
               FROM sales_orders so WHERE so.customer_id = c.id AND so.status NOT IN ('cancelled','reversed')),
              0
            ) AS outstanding_balance,
            (SELECT MAX(so.order_date) FROM sales_orders so
             JOIN sales_order_items soi ON soi.sales_order_id = so.id
             JOIN products p ON p.id = soi.product_id JOIN categories cat ON cat.id = p.category_id
             WHERE so.customer_id = c.id AND cat.name = 'Bulk Water' AND so.status = 'delivered'
            ) AS last_delivery_date
     FROM customers c LEFT JOIN qaades q ON q.id = c.qaade_id
     ${where} ORDER BY c.name`,
    params
  );
  res.json({ data: rows, error: null });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT c.*, q.name AS qaade_name, q.qaade_code FROM customers c LEFT JOIN qaades q ON q.id = c.qaade_id WHERE c.id = $1`,
    [req.params.id]
  );
  if (!rows[0]) throw new ApiError(404, 'Customer not found');
  res.json({ data: rows[0], error: null });
}));

// HNO is issued once, automatically, at registration — mirroring the
// predecessor system's permanent customer account number.
router.post('/', requireRole('Admin', 'Sales Manager'), validate(schemas.customerCreate), asyncHandler(async (req, res) => {
  const { code, name, type, phone, email, address, city, credit_limit, payment_terms_days, sales_rep_id, qaade_id } = req.body;

  const result = await withTransaction(async (client) => {
    const hno = await nextHno(client, 'customer');
    const { rows } = await client.query(
      `INSERT INTO customers (code, hno, name, type, phone, email, address, city, credit_limit, payment_terms_days, sales_rep_id, qaade_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [code, hno, name, type, phone || null, email || null, address || null, city || null, credit_limit || 0, payment_terms_days || 0, sales_rep_id || null, qaade_id || null]
    );
    await logAudit(client, { userId: req.user.id, action: 'CREATE', entityType: 'customer', entityId: rows[0].id, newValue: rows[0] });
    return rows[0];
  });

  res.status(201).json({ data: result, error: null });
}));

router.put('/:id', requireRole('Admin', 'Sales Manager'), validate(schemas.customerUpdate), asyncHandler(async (req, res) => {
  const fields = ['name', 'type', 'phone', 'email', 'address', 'city', 'credit_limit', 'payment_terms_days', 'sales_rep_id', 'qaade_id', 'status', 'is_active'];
  const updates = [];
  const params = [];
  for (const f of fields) {
    if (req.body[f] !== undefined) { params.push(req.body[f]); updates.push(`${f} = $${params.length}`); }
  }
  params.push(req.params.id);

  const result = await withTransaction(async (client) => {
    const { rows: before } = await client.query('SELECT * FROM customers WHERE id = $1', [req.params.id]);
    if (!before[0]) throw new ApiError(404, 'Customer not found');
    const { rows } = await client.query(`UPDATE customers SET ${updates.join(', ')} WHERE id = $${params.length} RETURNING *`, params);
    await logAudit(client, { userId: req.user.id, action: 'UPDATE', entityType: 'customer', entityId: rows[0].id, oldValue: before[0], newValue: rows[0] });
    return rows[0];
  });

  res.json({ data: result, error: null });
}));

// Customer account statement: every invoice (debit) and payment (credit) in date order
// with a running balance — the standard bulk-water customer ledger / open-balance view.
router.get('/:id/statement', asyncHandler(async (req, res) => {
  const { rows: customerRows } = await pool.query('SELECT * FROM customers WHERE id = $1', [req.params.id]);
  if (!customerRows[0]) throw new ApiError(404, 'Customer not found');

  const { rows: entries } = await pool.query(
    `SELECT entry_date, entry_type, reference, amount, sales_order_id, payment_id FROM (
       SELECT so.order_date AS entry_date, 'invoice' AS entry_type, COALESCE(so.invoice_hno, so.order_number) AS reference, so.total_amount AS amount, so.created_at AS sort_key, so.id AS sales_order_id, NULL::int AS payment_id
       FROM sales_orders so WHERE so.customer_id = $1 AND so.status NOT IN ('cancelled','reversed')
       UNION ALL
       SELECT p.payment_date AS entry_date, 'payment' AS entry_type, COALESCE(p.transaction_hno, so.order_number) AS reference, -p.amount AS amount, (p.payment_date::timestamp AT TIME ZONE 'UTC') AS sort_key, so.id AS sales_order_id, p.id AS payment_id
       FROM payments p JOIN sales_orders so ON so.id = p.sales_order_id WHERE so.customer_id = $1 AND p.voided_at IS NULL
     ) ledger
     ORDER BY entry_date, sort_key`,
    [req.params.id]
  );

  let balance = 0;
  const statement = entries.map((e) => {
    balance += Number(e.amount);
    return { ...e, running_balance: balance };
  });

  res.json({ data: { customer: customerRows[0], statement, closing_balance: balance }, error: null });
}));

// Broader activity timeline (not just financial): orders, dispatches/deliveries, and
// payments in one feed — "customer activity history" from the legacy system.
router.get('/:id/activity', asyncHandler(async (req, res) => {
  const { rows: customerRows } = await pool.query('SELECT * FROM customers WHERE id = $1', [req.params.id]);
  if (!customerRows[0]) throw new ApiError(404, 'Customer not found');

  const { rows: activity } = await pool.query(
    `SELECT event_date, event_type, reference, details FROM (
       SELECT so.created_at AS event_date, 'order_created' AS event_type, COALESCE(so.invoice_hno, so.order_number) AS reference,
              ('Status: ' || so.status || ' · Total: $' || so.total_amount || ' · ' || so.sale_type) AS details
       FROM sales_orders so WHERE so.customer_id = $1
       UNION ALL
       SELECT COALESCE(d.confirmed_at, d.dispatch_time) AS event_date, 'delivery' AS event_type, so.order_number AS reference,
              ('Status: ' || d.status || COALESCE(' · ' || d.quantity_delivered || ' delivered', '')) AS details
       FROM deliveries d JOIN sales_orders so ON so.id = d.sales_order_id WHERE so.customer_id = $1
       UNION ALL
       SELECT (p.payment_date::timestamp AT TIME ZONE 'UTC') AS event_date, 'payment' AS event_type, COALESCE(p.transaction_hno, so.order_number) AS reference,
              ('$' || p.amount || ' via ' || p.method || CASE WHEN p.voided_at IS NOT NULL THEN ' (REVERSED)' ELSE '' END) AS details
       FROM payments p JOIN sales_orders so ON so.id = p.sales_order_id WHERE so.customer_id = $1
     ) feed
     ORDER BY event_date DESC NULLS LAST
     LIMIT 200`,
    [req.params.id]
  );

  res.json({ data: { customer: customerRows[0], activity }, error: null });
}));

module.exports = router;
