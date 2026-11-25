const test = require('node:test');
const assert = require('node:assert/strict');
const { outputApprovalState, outputWasPosted } = require('../../src/services/productionOutputPolicy');

test('QC-passed positive output assigned to a warehouse awaits independent approval', () => {
  assert.equal(outputApprovalState({ productId: 3, destinationWarehouseId: 8, qcStatus: 'passed', actualQty: 12 }), 'pending');
});

test('failed QC, missing destination, or zero output never creates an approval/stock receipt', () => {
  assert.equal(outputApprovalState({ productId: 3, destinationWarehouseId: 8, qcStatus: 'failed', actualQty: 12 }), 'not_required');
  assert.equal(outputApprovalState({ productId: 3, destinationWarehouseId: null, qcStatus: 'passed', actualQty: 12 }), 'not_required');
  assert.equal(outputApprovalState({ productId: 3, destinationWarehouseId: 8, qcStatus: 'passed', actualQty: 0 }), 'not_required');
});

test('reversal removes output only when the original receipt was posted', () => {
  const base = { product_id: 3, destination_warehouse_id: 8, qc_status: 'passed', actual_qty: 12 };
  assert.equal(outputWasPosted({ ...base, output_approval_status: 'legacy' }), true);
  assert.equal(outputWasPosted({ ...base, output_approval_status: 'approved' }), true);
  assert.equal(outputWasPosted({ ...base, output_approval_status: 'pending' }), false);
  assert.equal(outputWasPosted({ ...base, output_approval_status: 'rejected' }), false);
});
