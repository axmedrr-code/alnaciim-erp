const { ApiError } = require('../utils/asyncHandler');

function assertDriverOwnsDelivery(actor, delivery) {
  if (actor?.role === 'Driver' && Number(actor.id) !== Number(delivery.driver_id))
    throw new ApiError(403, 'Drivers can only access deliveries assigned to them');
}

function assertDriverStatusChange(actor, delivery, nextStatus) {
  assertDriverOwnsDelivery(actor, delivery);
  if (actor?.role !== 'Driver') return;
  if (nextStatus === 'in_transit' && delivery.status === 'scheduled') return;
  if (nextStatus === 'failed' && ['scheduled', 'in_transit'].includes(delivery.status)) return;
  throw new ApiError(403, 'Drivers may only start or fail their assigned deliveries; use delivery confirmation to mark delivery complete');
}

function assertDriverCanConfirm(actor, delivery) {
  assertDriverOwnsDelivery(actor, delivery);
  if (actor?.role === 'Driver' && delivery.status !== 'in_transit')
    throw new ApiError(409, 'Start the assigned delivery before confirming it');
}

module.exports = { assertDriverOwnsDelivery, assertDriverStatusChange, assertDriverCanConfirm };
