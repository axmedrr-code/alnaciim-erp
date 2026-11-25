const test = require('node:test');
const assert = require('node:assert/strict');
const { assertCashierPaymentDepartment } = require('../src/services/billingAccessPolicy');

test('cashiers may only collect against an explicitly selected retail department', () => {
  assert.doesNotThrow(() => assertCashierPaymentDepartment({ role: 'Cashier' }, 'bottled_water'));
  assert.doesNotThrow(() => assertCashierPaymentDepartment({ role: 'Cashier' }, 'ice'));
  for (const department of [undefined, 'all', 'bulk_water', 'unknown']) {
    assert.throws(() => assertCashierPaymentDepartment({ role: 'Cashier' }, department), (error) => error.statusCode === 403);
  }
  assert.doesNotThrow(() => assertCashierPaymentDepartment({ role: 'Finance Officer' }, 'bulk_water'));
});
