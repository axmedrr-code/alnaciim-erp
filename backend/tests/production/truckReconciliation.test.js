const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateTruckReconciliation } = require('../../src/services/truckReconciliation');

test('a route close without a warehouse return keeps measured water on truck', () => {
  const r = calculateTruckReconciliation({ quantityLoaded: 6000, deliveredLiters: 1215, actualRemaining: 4785, returnedLiters: 0 });
  assert.equal(r.previousRemaining, 4785);
  assert.equal(r.remainingOnTruck, 4785);
  assert.equal(r.deliveredLitersAfter, 1215);
});

test('returned water reduces truck balance and is a separate receipt quantity', () => {
  const r = calculateTruckReconciliation({ quantityLoaded: 6000, deliveredLiters: 1215, actualRemaining: 4785, returnedLiters: 2000 });
  assert.equal(r.remainingOnTruck, 2785);
  assert.equal(r.deliveredLitersAfter, 3215);
  assert.equal(r.returnedLiters, 2000);
});

test('water return cannot exceed physical remaining or original loading', () => {
  assert.throws(() => calculateTruckReconciliation({ quantityLoaded: 500, deliveredLiters: 20, actualRemaining: 480, returnedLiters: 481 }), /cannot exceed physical remaining/);
  assert.throws(() => calculateTruckReconciliation({ quantityLoaded: 500, deliveredLiters: 20, actualRemaining: 501 }), /cannot exceed the original/);
});

test('returning all physical water closes the truck balance at zero', () => {
  const r = calculateTruckReconciliation({ quantityLoaded: 6000, deliveredLiters: 1215, actualRemaining: 4785, returnedLiters: 4785 });
  assert.equal(r.remainingOnTruck, 0);
  assert.equal(r.deliveredLitersAfter, 6000);
});
