const test = require('node:test');
const assert = require('node:assert/strict');
const { buildRetailCustomerSearch } = require('../src/services/retailCustomerSearch');

test('retail customer search normalizes HNO commas and whitespace', () => {
  assert.deepEqual(buildRetailCustomerSearch(' 7, 739 '), {
    rawQuery: '7, 739',
    compactQuery: '7739',
    likeQuery: '%7, 739%',
    compactLikeQuery: '%7739%'
  });
});

test('retail customer search rejects short and punctuation-only lookups', () => {
  assert.equal(buildRetailCustomerSearch('a'), null);
  assert.equal(buildRetailCustomerSearch(' ,,'), null);
  assert.equal(buildRetailCustomerSearch('  '), null);
});

test('retail customer search preserves a useful name or phone query', () => {
  const result = buildRetailCustomerSearch('Aadan Cali');
  assert.equal(result.rawQuery, 'Aadan Cali');
  assert.equal(result.compactQuery, 'AadanCali');
  assert.equal(result.likeQuery, '%Aadan Cali%');
});
