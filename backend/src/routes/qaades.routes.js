const { Router } = require('express');
const { pool, withTransaction } = require('../config/db');
const { asyncHandler, ApiError } = require('../utils/asyncHandler');
const { requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const schemas = require('../validation/schemas');
const { logAudit } = require('../services/auditService');

const router = Router();

router.get('/', asyncHandler(async (req, res) => {
  const { status } = req.query;
  const conditions = [];
  const params = [];
  if (status) { params.push(status); conditions.push(`q.status = $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows } = await pool.query(
    `SELECT q.*, u.full_name AS collector_name, t.plate_number,
            (SELECT COUNT(*) FROM customers c WHERE c.qaade_id = q.id) AS customer_count
     FROM qaades q
     LEFT JOIN users u ON u.id = q.collector_id
     LEFT JOIN trucks t ON t.id = q.truck_id
     ${where} ORDER BY q.name`,
    params
  );
  res.json({ data: rows, error: null });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT q.*, u.full_name AS collector_name, t.plate_number
     FROM qaades q LEFT JOIN users u ON u.id = q.collector_id LEFT JOIN trucks t ON t.id = q.truck_id
     WHERE q.id = $1`,
    [req.params.id]
  );
  if (!rows[0]) throw new ApiError(404, 'Qaade not found');
  const { rows: customers } = await pool.query(
    `SELECT id, code, hno, name, phone, city, status FROM customers WHERE qaade_id = $1 ORDER BY name`,
    [req.params.id]
  );
  res.json({ data: { ...rows[0], customers }, error: null });
}));

router.post('/', requireRole('Admin', 'Sales Manager'), validate(schemas.qaadeCreate), asyncHandler(async (req, res) => {
  const { qaade_code, name, area, collector_id, truck_id, notes } = req.body;

  const result = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO qaades (qaade_code, name, area, collector_id, truck_id, notes) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [qaade_code, name, area || null, collector_id || null, truck_id || null, notes || null]
    );
    await logAudit(client, { userId: req.user.id, action: 'CREATE', entityType: 'qaade', entityId: rows[0].id, newValue: rows[0] });
    return rows[0];
  });

  res.status(201).json({ data: result, error: null });
}));

router.put('/:id', requireRole('Admin', 'Sales Manager'), validate(schemas.qaadeUpdate), asyncHandler(async (req, res) => {
  const fields = ['name', 'area', 'collector_id', 'truck_id', 'status', 'notes'];
  const updates = [];
  const params = [];
  for (const f of fields) {
    if (req.body[f] !== undefined) { params.push(req.body[f]); updates.push(`${f} = $${params.length}`); }
  }
  params.push(req.params.id);

  const result = await withTransaction(async (client) => {
    const { rows: before } = await client.query('SELECT * FROM qaades WHERE id = $1', [req.params.id]);
    if (!before[0]) throw new ApiError(404, 'Qaade not found');
    const { rows } = await client.query(`UPDATE qaades SET ${updates.join(', ')} WHERE id = $${params.length} RETURNING *`, params);
    await logAudit(client, { userId: req.user.id, action: 'UPDATE', entityType: 'qaade', entityId: rows[0].id, oldValue: before[0], newValue: rows[0] });
    return rows[0];
  });

  res.json({ data: result, error: null });
}));

// Qaade performance: route sales, collections (payments made against that route's
// orders), and outstanding balance, for a given period — the legacy "sales by qaade" /
// "qaade performance" report combined into one call.
router.get('/:id/performance', asyncHandler(async (req, res) => {
  const { from, to } = req.query;
  const params = [req.params.id, from || '1900-01-01', to || '2999-12-31'];

  const { rows: qaadeRows } = await pool.query('SELECT * FROM qaades WHERE id = $1', [req.params.id]);
  if (!qaadeRows[0]) throw new ApiError(404, 'Qaade not found');

  const [sales, collections, outstanding, customerBreakdown] = await Promise.all([
    pool.query(
      `SELECT COUNT(*) AS order_count, COALESCE(SUM(total_amount), 0) AS total_sales,
              COALESCE(SUM(total_amount) FILTER (WHERE sale_type = 'cash'), 0) AS cash_sales,
              COALESCE(SUM(total_amount) FILTER (WHERE sale_type = 'credit'), 0) AS credit_sales
       FROM sales_orders WHERE qaade_id = $1 AND status NOT IN ('cancelled','reversed') AND order_date BETWEEN $2 AND $3`,
      params
    ),
    pool.query(
      `SELECT COALESCE(SUM(p.amount), 0) AS total_collected, COUNT(*) AS payment_count
       FROM payments p JOIN sales_orders so ON so.id = p.sales_order_id
       WHERE so.qaade_id = $1 AND p.voided_at IS NULL AND p.payment_date BETWEEN $2 AND $3`,
      params
    ),
    pool.query(
      `SELECT COALESCE(SUM(order_balance), 0) AS balance FROM (
         SELECT so.total_amount - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.sales_order_id = so.id AND p.voided_at IS NULL), 0) AS order_balance
         FROM sales_orders so WHERE so.qaade_id = $1 AND so.status NOT IN ('cancelled','reversed')
       ) per_order`,
      [req.params.id]
    ),
    pool.query(
      `SELECT c.id AS customer_id, c.name, c.hno, COUNT(so.id) AS order_count, COALESCE(SUM(so.total_amount), 0) AS total_sales
       FROM customers c LEFT JOIN sales_orders so ON so.customer_id = c.id AND so.status NOT IN ('cancelled','reversed') AND so.order_date BETWEEN $2 AND $3
       WHERE c.qaade_id = $1
       GROUP BY c.id, c.name, c.hno ORDER BY total_sales DESC`,
      params
    )
  ]);

  res.json({
    data: {
      qaade: qaadeRows[0],
      sales: sales.rows[0],
      collections: collections.rows[0],
      outstanding_balance: Number(outstanding.rows[0].balance),
      customers: customerBreakdown.rows
    },
    error: null
  });
}));

module.exports = router;
