const { Router } = require('express');
const { pool, withTransaction } = require('../config/db');
const { asyncHandler, ApiError } = require('../utils/asyncHandler');
const { requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const schemas = require('../validation/schemas');
const { logAudit } = require('../services/auditService');

const router = Router();

router.get('/', asyncHandler(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM categories ORDER BY name');
  res.json({ data: rows, error: null });
}));

router.post('/', requireRole('Admin', 'Inventory Manager'), validate(schemas.categoryCreate), asyncHandler(async (req, res) => {
  const { name, parent_id, product_type } = req.body;
  const result = await withTransaction(async (client) => {
    const { rows } = await client.query(
      'INSERT INTO categories (name, parent_id, product_type) VALUES ($1,$2,$3) RETURNING *',
      [name, parent_id || null, product_type]
    );
    await logAudit(client, { userId: req.user.id, action: 'CREATE', entityType: 'category', entityId: rows[0].id, newValue: rows[0] });
    return rows[0];
  });
  res.status(201).json({ data: result, error: null });
}));

module.exports = router;
