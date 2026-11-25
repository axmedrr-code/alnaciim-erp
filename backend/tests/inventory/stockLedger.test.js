const test = require('node:test');
const assert = require('node:assert/strict');
const { postStockMovement } = require('../../src/utils/stockLedger');

function fakeClient(finalQuantity) {
  const calls = [];
  return {
    calls,
    async query(sql, values) {
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
