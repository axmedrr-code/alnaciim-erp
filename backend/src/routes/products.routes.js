const { Router } = require('express');
const { pool } = require('../config/db');
const { asyncHandler, ApiError } = require('../utils/asyncHandler');
const { requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const schemas = require('../validation/schemas');

const router = Router();

router.get('/', asyncHandler(async (req, res) => {
  const { type, category_id, search, is_active } = req.query;
  const conditions = [];
  const params = [];

  if (type) { params.push(type); conditions.push(`p.product_type = $${params.length}`); }
  if (category_id) { params.push(category_id); conditions.push(`p.category_id = $${params.length}`); }
  if (search) { params.push(`%${search}%`); conditions.push(`(p.name ILIKE $${params.length} OR p.sku ILIKE $${params.length})`); }
  if (is_active !== undefined) { params.push(is_active === 'true'); conditions.push(`p.is_active = $${params.length}`); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `SELECT p.*, c.name AS category_name FROM products p
     JOIN categories c ON c.id = p.category_id
     ${where} ORDER BY p.name`,
    params
  );
  res.json({ data: rows, error: null });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT p.*, c.name AS category_name FROM products p
     JOIN categories c ON c.id = p.category_id WHERE p.id = $1`,
    [req.params.id]
  );
  if (!rows[0]) throw new ApiError(404, 'Product not found');
  res.json({ data: rows[0], error: null });
}));

router.post('/', requireRole('Admin', 'Inventory Manager'), validate(schemas.productCreate), asyncHandler(async (req, res) => {
  const { sku, barcode, name, category_id, product_type, unit, unit_cost, unit_price, reorder_level, reorder_qty } = req.body;
  const { rows } = await pool.query(
    `INSERT INTO products (sku, barcode, name, category_id, product_type, unit, unit_cost, unit_price, reorder_level, reorder_qty)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [sku, barcode || null, name, category_id, product_type, unit, unit_cost || 0, unit_price || 0, reorder_level || 0, reorder_qty || 0]
  );
  res.status(201).json({ data: rows[0], error: null });
}));

router.put('/:id', requireRole('Admin', 'Inventory Manager'), validate(schemas.productUpdate), asyncHandler(async (req, res) => {
  const fields = ['sku', 'barcode', 'name', 'category_id', 'product_type', 'unit', 'unit_cost', 'unit_price', 'reorder_level', 'reorder_qty', 'is_active'];
  const updates = [];
  const params = [];
  for (const f of fields) {
    if (req.body[f] !== undefined) { params.push(req.body[f]); updates.push(`${f} = $${params.length}`); }
  }
  params.push(req.params.id);
  const { rows } = await pool.query(
    `UPDATE products SET ${updates.join(', ')}, updated_at = now() WHERE id = $${params.length} RETURNING *`,
    params
  );
  if (!rows[0]) throw new ApiError(404, 'Product not found');
  res.json({ data: rows[0], error: null });
}));

router.delete('/:id', requireRole('Admin', 'Inventory Manager'), asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    `UPDATE products SET is_active = false, updated_at = now() WHERE id = $1 RETURNING id`,
    [req.params.id]
  );
  if (!rows[0]) throw new ApiError(404, 'Product not found');
  res.status(204).send();
}));

module.exports = router;
