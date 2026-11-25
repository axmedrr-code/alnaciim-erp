const test = require('node:test');
const assert = require('node:assert/strict');
const { canResolveDowntime, shouldRestoreMachineOperational } = require('../../src/services/productionDowntimePolicy');

test('resolved downtime cannot be resolved a second time', () => {
  assert.equal(canResolveDowntime({ id: 1, end_time: null }), true);
  assert.equal(canResolveDowntime({ id: 1, end_time: '2026-11-23T10:00:00Z' }), false);
  assert.equal(canResolveDowntime(null), false);
});

test('machine returns to operational only after its last open breakdown is resolved', () => {
  assert.equal(shouldRestoreMachineOperational('breakdown', 0), true);
  assert.equal(shouldRestoreMachineOperational('breakdown', 1), false);
  assert.equal(shouldRestoreMachineOperational('retired', 0), false);
  assert.equal(shouldRestoreMachineOperational('maintenance', 0), false);
});
