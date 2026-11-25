const test = require('node:test');
const assert = require('node:assert/strict');
const { assertDriverOwnsDelivery, assertDriverStatusChange, assertDriverCanConfirm } = require('../src/services/deliveryAccessPolicy');

test('a driver can only access their own assigned delivery', () => {
  const delivery = { id: 4, driver_id: 12, status: 'scheduled' };
  assert.doesNotThrow(() => assertDriverOwnsDelivery({ id: 12, role: 'Driver' }, delivery));
  assert.throws(() => assertDriverOwnsDelivery({ id: 13, role: 'Driver' }, delivery), (error) => error.statusCode === 403);
  assert.doesNotThrow(() => assertDriverOwnsDelivery({ id: 13, role: 'Admin' }, delivery));
});

test('driver state transitions require start before completion and block direct delivered status', () => {
  const scheduled = { id: 4, driver_id: 12, status: 'scheduled' };
  assert.doesNotThrow(() => assertDriverStatusChange({ id: 12, role: 'Driver' }, scheduled, 'in_transit'));
  assert.doesNotThrow(() => assertDriverStatusChange({ id: 12, role: 'Driver' }, scheduled, 'failed'));
  assert.throws(() => assertDriverStatusChange({ id: 12, role: 'Driver' }, scheduled, 'delivered'), (error) => error.statusCode === 403);
  assert.throws(() => assertDriverStatusChange({ id: 12, role: 'Driver' }, { ...scheduled, status: 'delivered' }, 'in_transit'), (error) => error.statusCode === 403);
  assert.doesNotThrow(() => assertDriverStatusChange({ id: 3, role: 'Sales Manager' }, scheduled, 'delivered'));
});

test('only a started assigned delivery can be confirmed by its driver', () => {
  assert.doesNotThrow(() => assertDriverCanConfirm({ id: 12, role: 'Driver' }, { driver_id: 12, status: 'in_transit' }));
  assert.throws(() => assertDriverCanConfirm({ id: 13, role: 'Driver' }, { driver_id: 12, status: 'in_transit' }), (error) => error.statusCode === 403);
  assert.throws(() => assertDriverCanConfirm({ id: 12, role: 'Driver' }, { driver_id: 12, status: 'scheduled' }), (error) => error.statusCode === 409);
});
