const test = require('node:test');
const assert = require('node:assert/strict');
const { customerReadPolicy } = require('../src/services/customerReadPolicy');

test('Driver and Data Entry customer reads require HNO and are capped at eight', () => {
  assert.equal(customerReadPolicy('Driver', {}), null);
  assert.deepEqual(customerReadPolicy('Driver', { hno: '7739' }), { hnoOnly: true, maxResults: 8 });
  assert.deepEqual(customerReadPolicy('Data Entry Operator', { hno_like: '77' }), { hnoOnly: true, maxResults: 8 });
});

test('office customer readers can use broader customer filters with the standard cap', () => {
  assert.deepEqual(customerReadPolicy('Sales Manager', {}), { hnoOnly: false, maxResults: 50 });
});
