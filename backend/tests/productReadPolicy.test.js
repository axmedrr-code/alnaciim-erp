const test = require('node:test');
const assert = require('node:assert/strict');
const { productReadColumns } = require('../src/services/productReadPolicy');

test('product catalog projection exposes price and cost only to their role groups', () => {
  const sales = productReadColumns('Sales Manager');
  assert.match(sales, /p\.unit_price/);
  assert.doesNotMatch(sales, /p\.unit_cost/);

  const procurement = productReadColumns('Procurement Officer');
  assert.match(procurement, /p\.unit_cost/);
  assert.doesNotMatch(procurement, /p\.unit_price/);

  const finance = productReadColumns('Finance Officer');
  assert.match(finance, /p\.unit_cost/);
  assert.match(finance, /p\.unit_price/);

  for (const role of ['Driver', 'Data Entry Operator', 'Cashier', 'Storekeeper', 'Collector']) {
    const columns = productReadColumns(role);
    assert.doesNotMatch(columns, /p\.unit_cost|p\.unit_price/, `${role} must not receive cost or price fields`);
  }
});
