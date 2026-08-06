const { Router } = require('express');
const { pool } = require('../config/db');
const { asyncHandler, ApiError } = require('../utils/asyncHandler');
const { requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const schemas = require('../validation/schemas');

const router = Router();

router.get('/', asyncHandler(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM categories ORDER BY name');
  res.json({ data: rows, error: null });
}));

router.post('/', requireRole('Admin', 'Inventory Manager'), validate(schemas.categoryCreate), asyncHandler(async (req, res) => {
  const { name, parent_id, product_type } = req.body;
  const { rows } = await pool.query(
    'INSERT INTO categories (name, parent_id, product_type) VALUES ($1,$2,$3) RETURNING *',
    [name, parent_id || null, product_type]
  );
  res.status(201).json({ data: rows[0], error: null });
}));

module.exports = router;
