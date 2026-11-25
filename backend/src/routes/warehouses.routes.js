const { Router } = require('express');
const { pool, withTransaction } = require('../config/db');
const { asyncHandler, ApiError } = require('../utils/asyncHandler');
const { requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const schemas = require('../validation/schemas');
const { PERM } = require('../middleware/permissions');
const { logAudit } = require('../services/auditService');

const router = Router();

router.get('/', requireRole(...PERM.WAREHOUSE_VIEW), asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT w.*, u.full_name AS manager_name FROM warehouses w
     LEFT JOIN users u ON u.id = w.manager_id
     ORDER BY w.name`
  );
  res.json({ data: rows, error: null });
}));

router.post('/', requireRole('Admin', 'Inventory Manager'), validate(schemas.warehouseCreate), asyncHandler(async (req, res) => {
  const { code, name, type, location, manager_id } = req.body;
  const result = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO warehouses (code, name, type, location, manager_id) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [code, name, type, location || null, manager_id || null]
    );
    await logAudit(client, { userId: req.user.id, action: 'CREATE', entityType: 'warehouse', entityId: rows[0].id, newValue: rows[0] });
    return rows[0];
  });
  res.status(201).json({ data: result, error: null });
}));

router.put('/:id', requireRole('Admin', 'Inventory Manager'), validate(schemas.warehouseUpdate), asyncHandler(async (req, res) => {
  const fields = ['code', 'name', 'type', 'location', 'manager_id', 'is_active'];
  const updates = [];
  const params = [];
  for (const f of fields) {
    if (req.body[f] !== undefined) { params.push(req.body[f]); updates.push(`${f} = $${params.length}`); }
  }
  params.push(req.params.id);
  if (!updates.length) throw new ApiError(400, 'No fields to update');
  const result = await withTransaction(async (client) => {
    const before = (await client.query('SELECT * FROM warehouses WHERE id = $1 FOR UPDATE', [req.params.id])).rows[0];
    if (!before) throw new ApiError(404, 'Warehouse not found');
    const { rows } = await client.query(
      `UPDATE warehouses SET ${updates.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params
    );
    await logAudit(client, { userId: req.user.id, action: 'UPDATE', entityType: 'warehouse', entityId: rows[0].id, oldValue: before, newValue: rows[0] });
    return rows[0];
  });
  res.json({ data: result, error: null });
}));

module.exports = router;
