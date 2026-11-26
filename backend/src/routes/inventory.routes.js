const { Router } = require('express');
const { pool, withTransaction } = require('../config/db');
const { asyncHandler, ApiError } = require('../utils/asyncHandler');
const { requireRole } = require('../middleware/auth');
const { postStockMovement } = require('../utils/stockLedger');
const { validate } = require('../middleware/validate');
const schemas = require('../validation/schemas');
const { logAudit } = require('../services/auditService');
const { PERM } = require('../middleware/permissions');

const router = Router();

// Storekeepers only see their own assigned warehouse. A Storekeeper without one sees nothing; asking for another warehouse is 403.
function storekeeperScope(req) {
  if (req.user.role !== 'Storekeeper') return null;
  const wh = req.user.assignedWarehouseId;
  if (!wh) return { none: true };
  const asked = req.query.warehouse_id;
  if (asked && Number(asked) !== wh) throw new ApiError(403, 'Storekeepers may only view stock in their assigned warehouse');
  return { warehouseId: wh };
}

router.get('/stock-levels', requireRole(...PERM.INVENTORY_VIEW), asyncHandler(async (req, res) => {
  const { warehouse_id, product_id } = req.query;
  const scope = storekeeperScope(req);
  if (scope && scope.none) return res.json({ data: [], error: null });
  const conditions = [];
  const params = [];
  if (scope) { params.push(scope.warehouseId); conditions.push(`sl.warehouse_id = $${params.length}`); }
  else if (warehouse_id) { params.push(warehouse_id); conditions.push(`sl.warehouse_id = $${params.length}`); }
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
router.get('/low-stock', requireRole(...PERM.INVENTORY_VIEW), asyncHandler(async (req, res) => {
  const scope = storekeeperScope(req);
  if (scope && scope.none) return res.json({ data: [], error: null });
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
       AND ($1::int IS NULL OR w.id = $1::int)
     ORDER BY (COALESCE(sl.quantity, 0) - p.reorder_level) ASC`,
    [scope ? scope.warehouseId : null]
  );
  res.json({ data: rows, error: null });
}));

router.get('/movements', requireRole(...PERM.INVENTORY_VIEW), asyncHandler(async (req, res) => {
  const { product_id, warehouse_id, from, to, movement_type } = req.query;
  const scope = storekeeperScope(req);
  if (scope && scope.none) return res.json({ data: [], error: null });
  const conditions = [];
  const params = [];
  if (product_id) { params.push(product_id); conditions.push(`sm.product_id = $${params.length}`); }
  if (scope) { params.push(scope.warehouseId); conditions.push(`sm.warehouse_id = $${params.length}`); }
  else if (warehouse_id) { params.push(warehouse_id); conditions.push(`sm.warehouse_id = $${params.length}`); }
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
  if (req.user.role === 'Storekeeper' && (!req.user.assignedWarehouseId || Number(warehouse_id) !== req.user.assignedWarehouseId)) {
    throw new ApiError(403, 'Storekeepers may only record movements for their assigned warehouse');
  }

  const movement = await withTransaction((client) => postStockMovement(client, {
    productId: product_id, warehouseId: warehouse_id, movementType: movement_type, quantity,
    referenceType: reference_type || 'adjustment', referenceId: reference_id || null,
    performedBy: req.user.id, notes
  }));

  res.status(201).json({ data: movement, error: null });
}));

router.get('/stock-counts', requireRole('Admin', 'Inventory Manager', 'Storekeeper', 'Operation Manager'), asyncHandler(async (req, res) => {
  if (req.user.role === 'Storekeeper' && !req.user.assignedWarehouseId) return res.json({ data: [], error: null });
  const params = req.user.role === 'Storekeeper' ? [req.user.assignedWarehouseId] : [];
  const scope = req.user.role === 'Storekeeper' ? 'WHERE c.warehouse_id=$1' : '';
  const { rows } = await pool.query(
    `SELECT c.*,p.sku,p.name AS product_name,p.unit,w.name AS warehouse_name,
            maker.full_name AS counted_by_name,approver.full_name AS decided_by_name
     FROM inventory_stock_counts c JOIN products p ON p.id=c.product_id JOIN warehouses w ON w.id=c.warehouse_id
     JOIN users maker ON maker.id=c.counted_by LEFT JOIN users approver ON approver.id=c.decided_by
     ${scope} ORDER BY c.created_at DESC LIMIT 500`, params
  );
  res.json({ data: rows, error: null });
}));

router.post('/stock-counts', requireRole('Admin', 'Inventory Manager', 'Storekeeper'), validate(schemas.stockCountCreate), asyncHandler(async (req, res) => {
  const { product_id, warehouse_id, counted_quantity, reason, notes } = req.body;
  if (req.user.role === 'Storekeeper' && (!req.user.assignedWarehouseId || Number(warehouse_id) !== req.user.assignedWarehouseId))
    throw new ApiError(403, 'Storekeepers may only count stock in their assigned warehouse');
  let created;
  try {
    created = await withTransaction(async (client) => {
      const product = (await client.query('SELECT id FROM products WHERE id=$1 AND is_active=true', [product_id])).rows[0];
      const warehouse = (await client.query('SELECT id FROM warehouses WHERE id=$1 AND is_active=true', [warehouse_id])).rows[0];
      if (!product || !warehouse) throw new ApiError(404, 'Active product or warehouse not found');
      const stock = (await client.query('SELECT quantity FROM stock_levels WHERE product_id=$1 AND warehouse_id=$2 FOR UPDATE', [product_id, warehouse_id])).rows[0];
      const systemQty = Number(stock?.quantity || 0);
      const variance = Number((Number(counted_quantity) - systemQty).toFixed(3));
      const row = (await client.query(
        `INSERT INTO inventory_stock_counts (product_id,warehouse_id,system_quantity,counted_quantity,variance,reason,notes,counted_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [product_id, warehouse_id, systemQty, counted_quantity, variance, reason, notes || null, req.user.id]
      )).rows[0];
      const countNumber = `SC-${new Date().getFullYear()}-${String(row.id).padStart(6, '0')}`;
      const numbered = (await client.query('UPDATE inventory_stock_counts SET count_number=$1 WHERE id=$2 RETURNING *', [countNumber, row.id])).rows[0];
      await logAudit(client, { userId: req.user.id, action: 'CREATE', entityType: 'inventory_stock_count', entityId: row.id,
        newValue: { count_number: countNumber, product_id, warehouse_id, system_quantity: systemQty, counted_quantity, variance, reason } });
      return numbered;
    });
  } catch (err) {
    if (err.code === '23505') throw new ApiError(409, 'A stock count is already pending for this product and warehouse');
    throw err;
  }
  res.status(201).json({ data: created, error: null });
}));

router.post('/stock-counts/:id/decision', requireRole('Admin', 'Inventory Manager'), validate(schemas.stockCountDecision), asyncHandler(async (req, res) => {
  const result = await withTransaction(async (client) => {
    const count = (await client.query('SELECT * FROM inventory_stock_counts WHERE id=$1 FOR UPDATE', [Number(req.params.id)])).rows[0];
    if (!count) throw new ApiError(404, 'Stock count not found');
    if (count.status !== 'pending') throw new ApiError(409, 'This stock count has already been decided');
    if (count.counted_by === req.user.id && req.user.role !== 'Admin') throw new ApiError(403, 'The stock counter cannot approve their own count');
    if (req.body.decision === 'reject') {
      const rejected = (await client.query("UPDATE inventory_stock_counts SET status='rejected',decided_by=$1,decision_reason=$2,decided_at=now() WHERE id=$3 RETURNING *",
        [req.user.id, req.body.reason, count.id])).rows[0];
      await logAudit(client, { userId: req.user.id, action: 'UPDATE', entityType: 'inventory_stock_count', entityId: count.id,
        oldValue: { status: 'pending' }, newValue: { status: 'rejected', reason: req.body.reason } });
      return rejected;
    }
    const stock = (await client.query('SELECT quantity FROM stock_levels WHERE product_id=$1 AND warehouse_id=$2 FOR UPDATE', [count.product_id, count.warehouse_id])).rows[0];
    const currentQty = Number(stock?.quantity || 0);
    if (Math.abs(currentQty - Number(count.system_quantity)) > 0.0005)
      throw new ApiError(409, 'System stock changed after this count was submitted; create a new count before approval');
    const variance = Number(count.variance);
    if (variance !== 0) await postStockMovement(client, {
      productId: count.product_id, warehouseId: count.warehouse_id, movementType: 'ADJUSTMENT', quantity: Math.abs(variance),
      adjustmentDelta: variance, referenceType: 'adjustment', referenceId: count.id,
      performedBy: req.user.id, notes: `Approved ${count.count_number}: ${count.reason}. ${req.body.reason}`
    });
    const approved = (await client.query("UPDATE inventory_stock_counts SET status='approved',decided_by=$1,decision_reason=$2,decided_at=now() WHERE id=$3 RETURNING *",
      [req.user.id, req.body.reason, count.id])).rows[0];
    await logAudit(client, { userId: req.user.id, action: 'UPDATE', entityType: 'inventory_stock_count', entityId: count.id,
      oldValue: { status: 'pending', system_quantity: Number(count.system_quantity) },
      newValue: { status: 'approved', counted_quantity: Number(count.counted_quantity), variance } });
    return approved;
  });
  res.json({ data: result, error: null });
}));

router.post('/transfer', requireRole('Admin', 'Inventory Manager', 'Storekeeper'), validate(schemas.stockTransferCreate), asyncHandler(async (req, res) => {
  const { product_id, from_warehouse_id, to_warehouse_id, quantity, notes } = req.body;
  if (req.user.role === 'Storekeeper' && (!req.user.assignedWarehouseId ||
      Number(from_warehouse_id) !== req.user.assignedWarehouseId || Number(to_warehouse_id) !== req.user.assignedWarehouseId)) {
    throw new ApiError(403, 'Storekeepers may only transfer stock within their assigned warehouse; request a manager for inter-warehouse transfers');
  }

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
