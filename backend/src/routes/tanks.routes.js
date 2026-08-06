const { Router } = require('express');
const { pool } = require('../config/db');
const { asyncHandler, ApiError } = require('../utils/asyncHandler');
const { requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const schemas = require('../validation/schemas');

const router = Router();

router.get('/', asyncHandler(async (req, res) => {
  const { customer_id, status, search } = req.query;
  const conditions = [];
  const params = [];
  if (customer_id) { params.push(customer_id); conditions.push(`t.customer_id = $${params.length}`); }
  if (status) { params.push(status); conditions.push(`t.status = $${params.length}`); }
  if (search) { params.push(`%${search}%`); conditions.push(`(t.tank_code ILIKE $${params.length} OR t.barcode ILIKE $${params.length})`); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  // Real price/liter for Bulk Water, resolved the same way a manual sales order
  // would price it — by the customer's own price tier from price_lists, falling
  // back to the product's own list price when no tiered row is in effect today.
  const { rows } = await pool.query(
    `SELECT t.*, c.name AS customer_name, c.code AS customer_code, c.city AS customer_city, c.type AS customer_type,
            COALESCE(
              (SELECT pl.unit_price FROM price_lists pl
               JOIN products p ON p.id = pl.product_id JOIN categories cat ON cat.id = p.category_id
               WHERE cat.name = 'Bulk Water' AND pl.customer_type = c.type
                 AND pl.effective_from <= CURRENT_DATE AND (pl.effective_to IS NULL OR pl.effective_to >= CURRENT_DATE)
               ORDER BY pl.effective_from DESC LIMIT 1),
              (SELECT p.unit_price FROM products p JOIN categories cat ON cat.id = p.category_id
               WHERE cat.name = 'Bulk Water' LIMIT 1)
            ) AS bulk_water_price_per_liter
     FROM customer_tanks t JOIN customers c ON c.id = t.customer_id
     ${where} ORDER BY t.tank_code`,
    params
  );
  res.json({ data: rows, error: null });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT t.*, c.name AS customer_name FROM customer_tanks t JOIN customers c ON c.id = t.customer_id WHERE t.id = $1`,
    [req.params.id]
  );
  if (!rows[0]) throw new ApiError(404, 'Tank not found');
  res.json({ data: rows[0], error: null });
}));

router.post('/', requireRole('Admin', 'Sales Manager'), validate(schemas.tankCreate), asyncHandler(async (req, res) => {
  const { tank_code, tank_name, customer_id, tank_type, capacity_liters, barcode, location, installed_date, notes } = req.body;
  const { rows } = await pool.query(
    `INSERT INTO customer_tanks (tank_code, tank_name, customer_id, tank_type, capacity_liters, barcode, location, installed_date, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [tank_code, tank_name || null, customer_id, tank_type, capacity_liters, barcode || null, location || null, installed_date || null, notes || null]
  );
  res.status(201).json({ data: rows[0], error: null });
}));

router.put('/:id', requireRole('Admin', 'Sales Manager'), validate(schemas.tankUpdate), asyncHandler(async (req, res) => {
  const fields = ['tank_code', 'tank_name', 'tank_type', 'capacity_liters', 'barcode', 'location', 'installed_date', 'status', 'notes'];
  const updates = [];
  const params = [];
  for (const f of fields) {
    if (req.body[f] !== undefined) { params.push(req.body[f]); updates.push(`${f} = $${params.length}`); }
  }
  params.push(req.params.id);
  const { rows } = await pool.query(
    `UPDATE customer_tanks SET ${updates.join(', ')} WHERE id = $${params.length} RETURNING *`,
    params
  );
  if (!rows[0]) throw new ApiError(404, 'Tank not found');
  res.json({ data: rows[0], error: null });
}));

// Merged refill (delivery) + maintenance history for a tank, newest first.
router.get('/:id/history', asyncHandler(async (req, res) => {
  const { rows: tankRows } = await pool.query('SELECT * FROM customer_tanks WHERE id = $1', [req.params.id]);
  if (!tankRows[0]) throw new ApiError(404, 'Tank not found');

  const { rows: refills } = await pool.query(
    `SELECT d.id, 'refill' AS event_type, COALESCE(d.confirmed_at, d.delivery_time, d.dispatch_time) AS event_date,
            d.quantity_delivered, so.order_number, u.full_name AS driver_name, d.signature_name, t.plate_number
     FROM deliveries d
     JOIN sales_orders so ON so.id = d.sales_order_id
     JOIN users u ON u.id = d.driver_id
     JOIN trucks t ON t.id = d.truck_id
     WHERE d.customer_tank_id = $1
     ORDER BY event_date DESC NULLS LAST`,
    [req.params.id]
  );

  const { rows: maintenance } = await pool.query(
    `SELECT tm.id, 'maintenance' AS event_type, tm.log_date AS event_date, tm.description, tm.cost, u.full_name AS performed_by_name
     FROM tank_maintenance_logs tm LEFT JOIN users u ON u.id = tm.performed_by
     WHERE tm.tank_id = $1
     ORDER BY tm.log_date DESC`,
    [req.params.id]
  );

  const history = [...refills, ...maintenance].sort((a, b) => new Date(b.event_date) - new Date(a.event_date));
  res.json({ data: { tank: tankRows[0], history }, error: null });
}));

router.post('/:id/maintenance', requireRole('Admin', 'Technician', 'Sales Manager'), validate(schemas.tankMaintenanceCreate), asyncHandler(async (req, res) => {
  const { log_date, description, cost } = req.body;
  const { rows } = await pool.query(
    `INSERT INTO tank_maintenance_logs (tank_id, log_date, description, performed_by, cost)
     VALUES ($1, COALESCE($2, CURRENT_DATE), $3, $4, $5) RETURNING *`,
    [req.params.id, log_date || null, description || null, req.user.id, cost || 0]
  );
  res.status(201).json({ data: rows[0], error: null });
}));

module.exports = router;
