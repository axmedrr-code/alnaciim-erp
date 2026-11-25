const test = require('node:test');
const assert = require('node:assert/strict');
const schemas = require('../../src/validation/schemas');

test('damaged-goods incident requires a route, quantity, and description', () => {
  assert.equal(schemas.exceptionCreate.safeParse({ body: { type: 'damaged_goods' } }).success, false);
  assert.equal(schemas.exceptionCreate.safeParse({ body: { type: 'damaged_goods', route_run_id: 5, quantity: 2, description: 'Crushed cartons' } }).success, true);
});

test('known route incident types remain valid', () => {
  for (const type of ['shortage', 'leakage', 'customer_dispute', 'wrong_delivery', 'missing_payment']) {
    assert.equal(schemas.exceptionCreate.safeParse({ body: { type, description: 'Driver reported incident' } }).success, true);
  }
});

test('resolving an exception requires useful resolution notes', () => {
  assert.equal(schemas.exceptionResolve.safeParse({ body: { resolution_notes: 'ok' } }).success, false);
  assert.equal(schemas.exceptionResolve.safeParse({ body: { resolution_notes: 'Confirmed and corrected stock record' } }).success, true);
});

test('starting an investigation requires a substantive note', () => {
  assert.equal(schemas.exceptionInvestigate.safeParse({ body: { investigation_notes: 'x' } }).success, false);
  assert.equal(schemas.exceptionInvestigate.safeParse({ body: { investigation_notes: 'Warehouse verified returned cartons' } }).success, true);
});
