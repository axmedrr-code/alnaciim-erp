const { Router } = require('express');
const bcrypt = require('bcryptjs');
const { pool, withTransaction } = require('../config/db');
const { asyncHandler, ApiError } = require('../utils/asyncHandler');
const { requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const schemas = require('../validation/schemas');
const { logAudit } = require('../services/auditService');

const router = Router();

router.get('/', requireRole('Admin'), asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT u.id, u.employee_code, u.full_name, u.email, u.department, u.phone, u.is_active,
            r.name AS role_name, w.name AS assigned_warehouse_name
     FROM users u JOIN roles r ON r.id = u.role_id LEFT JOIN warehouses w ON w.id = u.assigned_warehouse_id
     ORDER BY u.full_name`
  );
  res.json({ data: rows, error: null });
}));

router.post('/', requireRole('Admin'), validate(schemas.userCreate), asyncHandler(async (req, res) => {
  const { employee_code, full_name, email, password, role_id, department, phone, assigned_warehouse_id } = req.body;
  const passwordHash = await bcrypt.hash(password, 10);

  const result = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO users (employee_code, full_name, email, password_hash, role_id, department, phone, assigned_warehouse_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id, employee_code, full_name, email, role_id, department, phone, assigned_warehouse_id, is_active`,
      [employee_code, full_name, email, passwordHash, role_id, department || null, phone || null, assigned_warehouse_id || null]
    );
    await logAudit(client, { userId: req.user.id, action: 'CREATE', entityType: 'user', entityId: rows[0].id, newValue: rows[0] });
    return rows[0];
  });

  res.status(201).json({ data: result, error: null });
}));

router.put('/:id', requireRole('Admin'), validate(schemas.userUpdate), asyncHandler(async (req, res) => {
  const fields = ['full_name', 'email', 'role_id', 'department', 'phone', 'assigned_warehouse_id', 'is_active', 'commission_rate'];
  const updates = [];
  const params = [];
  for (const f of fields) {
    if (req.body[f] !== undefined) { params.push(req.body[f]); updates.push(`${f} = $${params.length}`); }
  }
  params.push(req.params.id);

  const result = await withTransaction(async (client) => {
    const { rows: before } = await client.query(
      'SELECT id, employee_code, full_name, email, role_id, department, phone, assigned_warehouse_id, is_active, commission_rate FROM users WHERE id = $1',
      [req.params.id]
    );
    if (!before[0]) throw new ApiError(404, 'User not found');
    const { rows } = await client.query(
      `UPDATE users SET ${updates.join(', ')}, updated_at = now() WHERE id = $${params.length}
       RETURNING id, employee_code, full_name, email, role_id, department, phone, assigned_warehouse_id, is_active, commission_rate`,
      params
    );
    await logAudit(client, { userId: req.user.id, action: 'UPDATE', entityType: 'user', entityId: rows[0].id, oldValue: before[0], newValue: rows[0] });
    return rows[0];
  });

  res.json({ data: result, error: null });
}));

router.get('/roles', asyncHandler(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM roles ORDER BY id');
  res.json({ data: rows, error: null });
}));

// Driver performance: revenue (via deliveries -> sales_orders), trips, collections (via
// payments on those orders), fuel usage (via vehicle_expenses on whichever trucks this
// driver was dispatched on), commission = collections x commission_rate, and net
// profitability = collections - commission - fuel. All derived from existing tables —
// no separate "driver" entity, drivers are just users with role = Driver.
router.get('/:id/driver-performance', asyncHandler(async (req, res) => {
  const { from, to } = req.query;
  const params = [req.params.id, from || '1900-01-01', to || '2999-12-31'];

  const { rows: userRows } = await pool.query(
    'SELECT id, full_name, employee_code, commission_rate FROM users WHERE id = $1', [req.params.id]
  );
  if (!userRows[0]) throw new ApiError(404, 'Driver not found');

  const { rows: tripRows } = await pool.query(
    `SELECT COUNT(*) AS trips, COALESCE(SUM(so.total_amount), 0) AS revenue
     FROM deliveries d JOIN sales_orders so ON so.id = d.sales_order_id
     WHERE d.driver_id = $1 AND d.status = 'delivered' AND so.status NOT IN ('cancelled','reversed')
       AND d.dispatch_time::date BETWEEN $2 AND $3`,
    params
  );
  const { rows: collectionRows } = await pool.query(
    `SELECT COALESCE(SUM(p.amount), 0) AS collections
     FROM payments p JOIN sales_orders so ON so.id = p.sales_order_id JOIN deliveries d ON d.sales_order_id = so.id
     WHERE d.driver_id = $1 AND p.voided_at IS NULL AND p.payment_date BETWEEN $2 AND $3`,
    params
  );
  const { rows: fuelRows } = await pool.query(
    `SELECT COALESCE(SUM(ve.amount), 0) AS fuel_cost
     FROM vehicle_expenses ve
     WHERE ve.category = 'fuel' AND ve.voided_at IS NULL AND ve.expense_date BETWEEN $2 AND $3
       AND ve.truck_id IN (SELECT DISTINCT truck_id FROM deliveries WHERE driver_id = $1)`,
    params
  );

  const revenue = Number(tripRows[0].revenue);
  const collections = Number(collectionRows[0].collections);
  const fuelCost = Number(fuelRows[0].fuel_cost);
  const commissionRate = Number(userRows[0].commission_rate) || 0;
  const commission = collections * (commissionRate / 100);

  res.json({
    data: {
      driver: userRows[0], trips: Number(tripRows[0].trips), revenue, collections, fuel_cost: fuelCost,
      commission_rate: commissionRate, commission, profitability: collections - commission - fuelCost
    },
    error: null
  });
}));

module.exports = router;
