const test = require('node:test');
const assert = require('node:assert/strict');
const { matchSupplierInvoice } = require('../../src/services/supplierInvoiceMatcher');

const validLine = {
  purchase_item_id: 7, product_name: 'Bottle caps', quantity: 5,
  quantity_accepted: 8, previously_invoiced: 2, unit_price: 1.25,
  unit_cost: 1.25, line_total: 6.25
};

test('accepts invoice quantities and prices within accepted receipt and PO', () => {
  const result = matchSupplierInvoice(6.25, [validLine]);
  assert.equal(result.matched, true);
  assert.deepEqual(result.exceptions, []);
});

test('rejects invoice quantity above uninvoiced accepted receipt quantity', () => {
  const result = matchSupplierInvoice(8.75, [{ ...validLine, quantity: 7, line_total: 8.75 }]);
  assert.equal(result.matched, false);
  assert.ok(result.exceptions.some((e) => e.type === 'quantity' && e.accepted_uninvoiced_quantity === 6));
});

test('rejects a unit price outside the PO match tolerance', () => {
  const result = matchSupplierInvoice(6.35, [{ ...validLine, unit_price: 1.27, line_total: 6.35 }]);
  assert.ok(result.exceptions.some((e) => e.type === 'unit_price'));
});

test('rejects a line extension that does not equal quantity times price', () => {
  const result = matchSupplierInvoice(6.25, [{ ...validLine, line_total: 6.2 }]);
  assert.ok(result.exceptions.some((e) => e.type === 'line_total'));
  assert.ok(result.exceptions.some((e) => e.type === 'invoice_total'));
});

test('allows only documented rounding tolerance at one cent', () => {
  const result = matchSupplierInvoice(6.26, [{ ...validLine, line_total: 6.26 }]);
  assert.equal(result.matched, true);
});
