const test = require('node:test');
const assert = require('node:assert/strict');
const { chartAccountUpdateViolation } = require('../src/services/chartOfAccountsPolicy');

test('chart account parent updates reject self-parenting and descendant cycles', () => {
  assert.match(chartAccountUpdateViolation({ accountId: 4, parentId: 4 }), /own parent/);
  assert.match(chartAccountUpdateViolation({ accountId: 4, parentId: 9, descendantIds: [7, 9] }), /descendants/);
  assert.equal(chartAccountUpdateViolation({ accountId: 4, parentId: 2, descendantIds: [7, 9] }), null);
  assert.equal(chartAccountUpdateViolation({ accountId: 4, parentId: null, descendantIds: [7, 9] }), null);
});

test('active system accounts cannot be deactivated', () => {
  assert.match(chartAccountUpdateViolation({ accountId: 4, parentId: null, isSystem: true, isActive: true, requestedActive: false }), /System accounts/);
  assert.equal(chartAccountUpdateViolation({ accountId: 4, isSystem: false, isActive: true, requestedActive: false }), null);
  assert.equal(chartAccountUpdateViolation({ accountId: 4, isSystem: true, isActive: false, requestedActive: true }), null);
});
