const { ApiError } = require('./asyncHandler');

const IN_TYPES = new Set(['IN', 'TRANSFER_IN']);
const OUT_TYPES = new Set(['OUT', 'TRANSFER_OUT']);

/**
 * Records a stock_movements row and applies the matching delta to stock_levels
 * in the same transaction, so the ledger and the balance can never drift apart.
 * `client` must be a pg client already inside a BEGIN/COMMIT block.
 */
async function postStockMovement(client, {
  productId, warehouseId, movementType, quantity, referenceType = null,
  referenceId = null, relatedWarehouseId = null, performedBy, notes = null,
  allowNegative = false
}) {
  if (quantity <= 0) throw new ApiError(400, 'Movement quantity must be positive');

  let delta = quantity;
  if (OUT_TYPES.has(movementType)) delta = -quantity;
  else if (movementType === 'ADJUSTMENT') delta = quantity; // caller passes signed intent via quantity sign upstream if needed
  else if (!IN_TYPES.has(movementType)) throw new ApiError(400, `Unknown movement_type: ${movementType}`);

  const { rows } = await client.query(
    `INSERT INTO stock_movements
       (product_id, warehouse_id, movement_type, quantity, reference_type, reference_id, related_warehouse_id, performed_by, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING *`,
    [productId, warehouseId, movementType, quantity, referenceType, referenceId, relatedWarehouseId, performedBy, notes]
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
