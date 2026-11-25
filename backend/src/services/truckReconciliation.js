function calculateTruckReconciliation({ quantityLoaded, deliveredLiters, actualRemaining, returnedLiters = 0 }) {
  const loaded = Number(quantityLoaded);
  const delivered = Number(deliveredLiters);
  const actual = Number(actualRemaining);
  const returned = Number(returnedLiters);
  if (![loaded, delivered, actual, returned].every(Number.isFinite) || loaded < 0 || delivered < 0 || actual < 0 || returned < 0)
    throw new RangeError('Truck reconciliation quantities must be finite and non-negative');
  if (delivered > loaded) throw new RangeError('Delivered liters cannot exceed the original loaded quantity');
  if (actual > loaded) throw new RangeError('Physical remaining cannot exceed the original loaded quantity');
  if (returned > actual) throw new RangeError('Returned liters cannot exceed physical remaining');
  const previousRemaining = loaded - delivered;
  const remainingOnTruck = actual - returned;
  return {
    previousRemaining,
    actualRemaining: actual,
    returnedLiters: returned,
    difference: actual - previousRemaining,
    remainingOnTruck,
    deliveredLitersAfter: loaded - remainingOnTruck
  };
}

module.exports = { calculateTruckReconciliation };
