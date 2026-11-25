const test = require('node:test');
const assert = require('node:assert/strict');
const { safeCustomerImportFailure } = require('../src/services/customerImportErrors');

test('customer import report never exposes raw unique-constraint messages', () => {
  const result = safeCustomerImportFailure({ code: '23505', message: 'duplicate key value violates secret_constraint' });
  assert.deepEqual(result, {
    reason: 'Import error',
    fix: 'Check that this HNO and customer code are unique, then retry this row.'
  });
  assert.equal(JSON.stringify(result).includes('secret_constraint'), false);
});

test('customer import report uses a plain-language fallback for database failures', () => {
  const result = safeCustomerImportFailure({ code: 'XX999', message: 'internal hostname and table details' });
  assert.equal(result.reason, 'Import error');
  assert.equal(result.fix, 'Check this row against the template and retry it. Contact an administrator if it still fails.');
  assert.equal(JSON.stringify(result).includes('hostname'), false);
});
