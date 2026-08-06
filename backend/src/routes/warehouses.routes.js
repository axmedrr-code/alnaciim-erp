const { Router } = require('express');
const { pool } = require('../config/db');
const { asyncHandler, ApiError } = require('../utils/asyncHandler');
const { requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const schemas = require('../validation/schemas');

const router = Router();

router.get('/', asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT w.*, u.full_name AS manager_name FROM warehouses w
     LEFT JOIN users u ON u.id = w.manager_id
     ORDER BY w.name`
  );
  res.json({ data: rows, error: null });
}));

router.post('/', requireRole('Admin', 'Inventory Manager'), validate(schemas.warehouseCreate), asyncHandler(async (req, res) => {
  const { code, name, type, location, manager_id } = req.body;
  const { rows } = await pool.query(
    `INSERT INTO warehouses (code, name, type, location, manager_id) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [code, name, type, location || null, manager_id || null]
  );
  res.status(201).json({ data: rows[0], error: null });
}));

router.put('/:id', requireRole('Admin', 'Inventory Manager'), validate(schemas.warehouseUpdate), asyncHandler(async (req, res) => {
  const fields = ['code', 'name', 'type', 'location', 'manager_id', 'is_active'];
  const updates = [];
  const params = [];
  for (const f of fields) {
    if (req.body[f] !== undefined) { params.push(req.body[f]); updates.push(`${f} = $${params.length}`); }
  }
  params.push(req.params.id);
  const { rows } = await pool.query(
    `UPDATE warehouses SET ${updates.join(', ')} WHERE id = $${params.length} RETURNING *`,
    params
  );
  if (!rows[0]) throw new ApiError(404, 'Warehouse not found');
  res.json({ data: rows[0], error: null });
}));

module.exports = router;
