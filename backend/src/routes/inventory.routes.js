const { Router } = require('express');
const { pool, withTransaction } = require('../config/db');
const { asyncHandler, ApiError } = require('../utils/asyncHandler');
const { requireRole } = require('../middleware/auth');
const { postStockMovement } = require('../utils/stockLedger');
const { validate } = require('../middleware/validate');
const schemas = require('../validation/schemas');

const router = Router();

router.get('/stock-levels', asyncHandler(async (req, res) => {
  const { warehouse_id, product_id } = req.query;
  const conditions = [];
  const params = [];
  if (warehouse_id) { params.push(warehouse_id); conditions.push(`sl.warehouse_id = $${params.length}`); }
  if (product_id) { params.push(product_id); conditions.push(`sl.product_id = $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows } = await pool.query(
    `SELECT sl.*, p.sku, p.name AS product_name, p.unit, w.name AS warehouse_name
     FROM stock_levels sl
     JOIN products p ON p.id = sl.product_id
     JOIN warehouses w ON w.id = sl.warehouse_id
     ${where}
     ORDER BY p.name`,
    params
  );
  res.json({ data: rows, error: null });
}));

// Only checks warehouses that naturally stock a product's type (raw_material -> raw_material
// warehouses, finished_good -> finished_goods, spare_part -> spare_parts) OR that already have
// a tracked stock relationship for that product. A plain CROSS JOIN would flag e.g. raw materials
// as "low" in every warehouse that has never carried them (including ones of unrelated types).
router.get('/low-stock', asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT p.id AS product_id, p.sku, p.name, p.reorder_level, p.reorder_qty, w.id AS warehouse_id, w.name AS warehouse_name,
            COALESCE(sl.quantity, 0) AS quantity
     FROM products p
     JOIN warehouses w ON (
       w.type = CASE p.product_type
                  WHEN 'raw_material' THEN 'raw_material'
                  WHEN 'finished_good' THEN 'finished_goods'
                  WHEN 'spare_part' THEN 'spare_parts'
                END
       OR EXISTS (SELECT 1 FROM stock_levels existing WHERE existing.product_id = p.id AND existing.warehouse_id = w.id)
     )
     LEFT JOIN stock_levels sl ON sl.product_id = p.id AND sl.warehouse_id = w.id
     WHERE p.is_active = true AND COALESCE(sl.quantity, 0) <= p.reorder_level AND p.reorder_level > 0
     ORDER BY (COALESCE(sl.quantity, 0) - p.reorder_level) ASC`
  );
  res.json({ data: rows, error: null });
}));

router.get('/movements', asyncHandler(async (req, res) => {
  const { product_id, warehouse_id, from, to, movement_type } = req.query;
  const conditions = [];
  const params = [];
  if (product_id) { params.push(product_id); conditions.push(`sm.product_id = $${params.length}`); }
  if (warehouse_id) { params.push(warehouse_id); conditions.push(`sm.warehouse_id = $${params.length}`); }
  if (movement_type) { params.push(movement_type); conditions.push(`sm.movement_type = $${params.length}`); }
  if (from) { params.push(from); conditions.push(`sm.created_at >= $${params.length}`); }
  if (to) { params.push(to); conditions.push(`sm.created_at <= $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows } = await pool.query(
    `SELECT sm.*, p.sku, p.name AS product_name, w.name AS warehouse_name, u.full_name AS performed_by_name
     FROM stock_movements sm
     JOIN products p ON p.id = sm.product_id
     JOIN warehouses w ON w.id = sm.warehouse_id
     JOIN users u ON u.id = sm.performed_by
     ${where}
     ORDER BY sm.created_at DESC
     LIMIT 500`,
    params
  );
  res.json({ data: rows, error: null });
}));

router.post('/movements', requireRole('Admin', 'Inventory Manager', 'Storekeeper'), validate(schemas.stockMovementCreate), asyncHandler(async (req, res) => {
  const { product_id, warehouse_id, movement_type, quantity, reference_type, reference_id, notes } = req.body;
  if (req.user.role === 'Storekeeper' && req.user.assignedWarehouseId && Number(warehouse_id) !== req.user.assignedWarehouseId) {
    throw new ApiError(403, 'Storekeepers may only record movements for their assigned warehouse');
  }

  const movement = await withTransaction((client) => postStockMovement(client, {
    productId: product_id, warehouseId: warehouse_id, movementType: movement_type, quantity,
    referenceType: reference_type || 'adjustment', referenceId: reference_id || null,
    performedBy: req.user.id, notes, allowNegative: movement_type === 'ADJUSTMENT'
  }));

  res.status(201).json({ data: movement, error: null });
}));

router.post('/transfer', requireRole('Admin', 'Inventory Manager', 'Storekeeper'), validate(schemas.stockTransferCreate), asyncHandler(async (req, res) => {
  const { product_id, from_warehouse_id, to_warehouse_id, quantity, notes } = req.body;

  const result = await withTransaction(async (client) => {
    const out = await postStockMovement(client, {
      productId: product_id, warehouseId: from_warehouse_id, movementType: 'TRANSFER_OUT',
      quantity, referenceType: 'transfer', relatedWarehouseId: to_warehouse_id,
      performedBy: req.user.id, notes
    });
    const inn = await postStockMovement(client, {
      productId: product_id, warehouseId: to_warehouse_id, movementType: 'TRANSFER_IN',
      quantity, referenceType: 'transfer', referenceId: out.id, relatedWarehouseId: from_warehouse_id,
      performedBy: req.user.id, notes
    });
    return { out, in: inn };
  });

  res.status(201).json({ data: result, error: null });
}));

module.exports = router;
