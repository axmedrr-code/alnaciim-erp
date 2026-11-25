const { Router } = require('express');
const { pool, withTransaction } = require('../config/db');
const { asyncHandler, ApiError } = require('../utils/asyncHandler');
const { requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const schemas = require('../validation/schemas');
const { productReadColumns } = require('../services/productReadPolicy');
const { logAudit } = require('../services/auditService');

const router = Router();
router.param('id', (req, res, next, v) => (/^\d+$/.test(String(v)) && Number(v) <= 2147483647 ? next() : next(new ApiError(404, 'Record not found'))));

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
    `SELECT ${productReadColumns(req.user.role)}, c.name AS category_name FROM products p
     JOIN categories c ON c.id = p.category_id
     ${where} ORDER BY p.name`,
    params
  );
  res.json({ data: rows, error: null });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT ${productReadColumns(req.user.role)}, c.name AS category_name FROM products p
     JOIN categories c ON c.id = p.category_id WHERE p.id = $1`,
    [req.params.id]
  );
  if (!rows[0]) throw new ApiError(404, 'Product not found');
  res.json({ data: rows[0], error: null });
}));

router.post('/', requireRole('Admin', 'Inventory Manager'), validate(schemas.productCreate), asyncHandler(async (req, res) => {
  const { sku, barcode, name, category_id, product_type, unit, unit_cost, unit_price, reorder_level, reorder_qty } = req.body;
  const result = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO products (sku, barcode, name, category_id, product_type, unit, unit_cost, unit_price, reorder_level, reorder_qty)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [sku, barcode || null, name, category_id, product_type, unit, unit_cost || 0, unit_price || 0, reorder_level || 0, reorder_qty || 0]
    );
    await logAudit(client, { userId: req.user.id, action: 'CREATE', entityType: 'product', entityId: rows[0].id, newValue: rows[0] });
    return rows[0];
  });
  res.status(201).json({ data: result, error: null });
}));

router.put('/:id', requireRole('Admin', 'Inventory Manager'), validate(schemas.productUpdate), asyncHandler(async (req, res) => {
  const fields = ['sku', 'barcode', 'name', 'category_id', 'product_type', 'unit', 'unit_cost', 'unit_price', 'reorder_level', 'reorder_qty', 'is_active'];
  const updates = [];
  const params = [];
  for (const f of fields) {
    if (req.body[f] !== undefined) { params.push(req.body[f]); updates.push(`${f} = $${params.length}`); }
  }
  if (!updates.length) throw new ApiError(400, 'No fields to update');
  params.push(req.params.id);
  const result = await withTransaction(async (client) => {
    const before = (await client.query('SELECT * FROM products WHERE id = $1 FOR UPDATE', [req.params.id])).rows[0];
    if (!before) throw new ApiError(404, 'Product not found');
    if (req.body.is_active === false && before.is_active) {
      const onHand = Number((await client.query('SELECT COALESCE(SUM(quantity), 0) AS n FROM stock_levels WHERE product_id = $1', [before.id])).rows[0].n);
      if (onHand > 0) throw new ApiError(409, `This product still has ${onHand} unit(s) in stock: issue, transfer or write them off (stock count) before deactivating it`);
    }
    if (req.body.product_type !== undefined && req.body.product_type !== before.product_type) {
      const used = Number((await client.query('SELECT COUNT(*)::int AS n FROM stock_movements WHERE product_id = $1', [before.id])).rows[0].n);
      if (used > 0) throw new ApiError(409, 'The product type cannot be changed once the product has stock movements: it decides which inventory account its value is booked to');
    }
    const { rows } = await client.query(
      `UPDATE products SET ${updates.join(', ')}, updated_at = now() WHERE id = $${params.length} RETURNING *`,
      params
    );
    await logAudit(client, { userId: req.user.id, action: 'UPDATE', entityType: 'product', entityId: rows[0].id, oldValue: before, newValue: rows[0] });
    return rows[0];
  });
  res.json({ data: result, error: null });
}));

router.delete('/:id', requireRole('Admin', 'Inventory Manager'), asyncHandler(async (req, res) => {
  await withTransaction(async (client) => {
    const before = (await client.query('SELECT * FROM products WHERE id = $1 FOR UPDATE', [req.params.id])).rows[0];
    if (!before) throw new ApiError(404, 'Product not found');
    const onHand = Number((await client.query('SELECT COALESCE(SUM(quantity), 0) AS n FROM stock_levels WHERE product_id = $1', [before.id])).rows[0].n);
    if (onHand > 0) throw new ApiError(409, `This product still has ${onHand} unit(s) in stock: issue, transfer or write them off (stock count) before deactivating it`);
    const { rows } = await client.query(
      `UPDATE products SET is_active = false, updated_at = now() WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    await logAudit(client, { userId: req.user.id, action: 'UPDATE', entityType: 'product', entityId: before.id, oldValue: before, newValue: rows[0] });
  });
  res.status(204).send();
}));

module.exports = router;
