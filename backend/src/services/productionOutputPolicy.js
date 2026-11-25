function outputApprovalState({ productId, destinationWarehouseId, qcStatus, actualQty }) {
  return productId && destinationWarehouseId && qcStatus === 'passed' && Number(actualQty) > 0
    ? 'pending'
    : 'not_required';
}

function outputWasPosted(batch) {
  return Boolean(batch.product_id && batch.destination_warehouse_id && batch.qc_status === 'passed' &&
    Number(batch.actual_qty) > 0 && ['legacy', 'approved'].includes(batch.output_approval_status));
}

module.exports = { outputApprovalState, outputWasPosted };
