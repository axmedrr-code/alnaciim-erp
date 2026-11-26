const { ApiError } = require('./asyncHandler');

const IN_TYPES = new Set(['IN', 'TRANSFER_IN']);
const OUT_TYPES = new Set(['OUT', 'TRANSFER_OUT']);

// Raw materials, finished goods and spare parts each live in their own kind of warehouse. A 'general' warehouse is unrestricted.
// Only inflows are checked, so legacy stock that already sits in the wrong kind of warehouse can still be moved OUT and corrected.
const WAREHOUSE_FOR_PRODUCT = { raw_material: 'raw_material', finished_good: 'finished_goods', spare_part: 'spare_parts' };
const RESTRICTED_WAREHOUSE_TYPES = new Set(Object.values(WAREHOUSE_FOR_PRODUCT));

async function assertWarehouseAccepts(client, productId, warehouseId) {
  const { rows } = await client.query(
    'SELECT p.product_type, w.type AS warehouse_type FROM products p, warehouses w WHERE p.id = $1 AND w.id = $2', [productId, warehouseId]);
  if (!rows[0]) return; // unknown product/warehouse: the foreign keys / callers report it
  const { product_type: pt, warehouse_type: wt } = rows[0];
  if (RESTRICTED_WAREHOUSE_TYPES.has(wt) && WAREHOUSE_FOR_PRODUCT[pt] && WAREHOUSE_FOR_PRODUCT[pt] !== wt)
    throw new ApiError(400, `A ${String(pt).replace('_', ' ')} item cannot be stored in a ${String(wt).replace('_', ' ')} warehouse`);
}

/**
 * Records a stock_movements row and applies the matching delta to stock_levels
 * in the same transaction, so the ledger and the balance can never drift apart.
 * `client` must be a pg client already inside a BEGIN/COMMIT block.
 */
async function postStockMovement(client, {
  productId, warehouseId, movementType, quantity, referenceType = null,
  referenceId = null, relatedWarehouseId = null, performedBy, notes = null,
  allowNegative = false, adjustmentDelta = null
}) {
  if (quantity <= 0) throw new ApiError(400, 'Movement quantity must be positive');

  let delta = quantity;
  if (OUT_TYPES.has(movementType)) delta = -quantity;
  else if (movementType === 'ADJUSTMENT') {
    if (!Number.isFinite(Number(adjustmentDelta)) || Number(adjustmentDelta) === 0 || Math.abs(Math.abs(Number(adjustmentDelta)) - quantity) > 0.0005)
      throw new ApiError(400, 'A stock adjustment requires a signed delta whose absolute value equals the movement quantity');
    delta = Number(adjustmentDelta);
  }
  else if (!IN_TYPES.has(movementType)) throw new ApiError(400, `Unknown movement_type: ${movementType}`);

  if (delta > 0) await assertWarehouseAccepts(client, productId, warehouseId);

  const { rows } = await client.query(
    `INSERT INTO stock_movements
       (product_id, warehouse_id, movement_type, quantity, reference_type, reference_id, related_warehouse_id, performed_by, notes, signed_quantity)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING *`,
    [productId, warehouseId, movementType, quantity, referenceType, referenceId, relatedWarehouseId, performedBy, notes, delta]
  );

  const upsert = await client.query(
    `INSERT INTO stock_levels (product_id, warehouse_id, quantity, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (product_id, warehouse_id)
     DO UPDATE SET quantity = stock_levels.quantity + $3, updated_at = now()
     RETURNING quantity`,
    [productId, warehouseId, delta]
  );

  if (!allowNegative && Number(upsert.rows[0].quantity) < 0) {
    throw new ApiError(400, 'Insufficient stock for this movement');
  }

  return rows[0];
}

module.exports = { postStockMovement };
