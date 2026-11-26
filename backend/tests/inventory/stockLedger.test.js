const test = require('node:test');
const assert = require('node:assert/strict');
const { postStockMovement } = require('../../src/utils/stockLedger');

function fakeClient(finalQuantity, types = { product_type: 'raw_material', warehouse_type: 'raw_material' }) {
  const calls = [];
  return {
    calls,
    async query(sql, values) {
      if (sql.includes('FROM products p, warehouses w')) return { rows: [types] }; // product/warehouse type lookup (not a stock write)
      calls.push({ sql, values });
      if (sql.includes('INSERT INTO stock_movements')) return { rows: [{ id: 12, quantity: values[3] }] };
      if (sql.includes('INSERT INTO stock_levels')) return { rows: [{ quantity: finalQuantity }] };
      throw new Error('Unexpected query');
    }
  };
}

test('approved count can post a positive stock variance', async () => {
  const client = fakeClient(14);
  const move = await postStockMovement(client, { productId: 1, warehouseId: 2, movementType: 'ADJUSTMENT', quantity: 4,
    adjustmentDelta: 4, referenceType: 'adjustment', referenceId: 7, performedBy: 9 });
  assert.equal(move.id, 12);
  assert.equal(client.calls[1].values[2], 4);
});

test('approved count can post a negative variance without allowing negative stock', async () => {
  const client = fakeClient(3);
  await postStockMovement(client, { productId: 1, warehouseId: 2, movementType: 'ADJUSTMENT', quantity: 5,
    adjustmentDelta: -5, referenceType: 'adjustment', referenceId: 7, performedBy: 9 });
  assert.equal(client.calls[1].values[2], -5);
  await assert.rejects(() => postStockMovement(fakeClient(-1), { productId: 1, warehouseId: 2, movementType: 'ADJUSTMENT', quantity: 1,
    adjustmentDelta: -1, referenceType: 'adjustment', referenceId: 7, performedBy: 9 }), /Insufficient stock/);
});

test('adjustments require an explicit signed variance matching the movement quantity', async () => {
  const client = fakeClient(1);
  await assert.rejects(() => postStockMovement(client, { productId: 1, warehouseId: 2, movementType: 'ADJUSTMENT', quantity: 1,
    referenceType: 'adjustment', referenceId: 7, performedBy: 9 }), /signed delta/);
  assert.equal(client.calls.length, 0);
});

test('raw materials, finished goods and spare parts are refused in the wrong kind of warehouse', async () => {
  const bad = [['raw_material', 'finished_goods'], ['raw_material', 'spare_parts'], ['finished_good', 'raw_material'], ['spare_part', 'raw_material'], ['spare_part', 'finished_goods']];
  for (const [product_type, warehouse_type] of bad) {
    const client = fakeClient(5, { product_type, warehouse_type });
    await assert.rejects(postStockMovement(client, { productId: 1, warehouseId: 2, movementType: 'IN', quantity: 5, performedBy: 9 }), (e) => e.statusCode === 400 || e.status === 400);
    assert.equal(client.calls.length, 0, `${product_type} in ${warehouse_type} must not write anything`);
  }
});

test('matching and general warehouses accept inflows', async () => {
  for (const [product_type, warehouse_type] of [['raw_material', 'raw_material'], ['finished_good', 'finished_goods'], ['spare_part', 'spare_parts'], ['raw_material', 'general'], ['finished_good', 'general']]) {
    const client = fakeClient(5, { product_type, warehouse_type });
    const move = await postStockMovement(client, { productId: 1, warehouseId: 2, movementType: 'IN', quantity: 5, performedBy: 9 });
    assert.equal(move.id, 12);
  }
});

test('outflows are never blocked by the type rule, so legacy stock in the wrong warehouse can be moved out', async () => {
  const client = fakeClient(2, { product_type: 'finished_good', warehouse_type: 'raw_material' });
  const move = await postStockMovement(client, { productId: 1, warehouseId: 2, movementType: 'OUT', quantity: 3, performedBy: 9, allowNegative: true });
  assert.equal(move.id, 12);
});
