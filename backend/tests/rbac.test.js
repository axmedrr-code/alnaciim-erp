const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { requireRole } = require('../src/middleware/auth');
const { PERM, canSee } = require('../src/middleware/permissions');

function checkRole(roles, user) {
  let error = null;
  let successCalls = 0;
  requireRole(...roles)({ user }, {}, (err) => { error = err || null; if (!err) successCalls++; });
  return { error, successCalls };
}

test('requireRole permits explicitly allowed users and denies missing or other roles', () => {
  for (const role of ['Admin', 'Finance Officer']) {
    const result = checkRole(['Admin', 'Finance Officer'], { id: 7, role });
    assert.equal(result.error, null);
    assert.equal(result.successCalls, 1);
  }

  const noAuth = checkRole(['Admin'], null);
  assert.equal(noAuth.error.statusCode, 401);
  assert.equal(noAuth.successCalls, 0);

  const forbidden = checkRole(['Admin', 'Finance Officer'], { id: 8, role: 'Collector' });
  assert.equal(forbidden.error.statusCode, 403);
  assert.equal(forbidden.successCalls, 0);
});

test('read permission groups match their declared role lists and unknown groups deny safely', () => {
  for (const [group, roles] of Object.entries(PERM)) {
    for (const role of roles) assert.equal(canSee(role, group), true, `${role} should see ${group}`);
    for (const role of ['Driver', 'Data Entry', 'Unknown']) {
      if (!roles.includes(role)) assert.equal(canSee(role, group), false, `${role} should not see ${group}`);
    }
  }
  assert.equal(canSee('Admin', 'NOT_A_PERMISSION_GROUP'), false);
});

test('frontend permission groups exactly mirror backend enforcement groups', async () => {
  const frontend = await import(pathToFileURL(path.join(__dirname, '../../frontend/src/utils/permissions.js')).href);
  assert.deepEqual(frontend.PERM, PERM);
});

test('warehouse and legacy tank reads are restricted to operational roles', () => {
  for (const role of ['Admin', 'Inventory Manager', 'Storekeeper', 'Procurement Officer', 'Technician']) {
    assert.equal(canSee(role, 'WAREHOUSE_VIEW'), true, `${role} should read warehouse master data`);
  }
  for (const role of ['Driver', 'Data Entry Operator', 'Cashier', 'Collector']) {
    assert.equal(canSee(role, 'WAREHOUSE_VIEW'), false, `${role} should not read warehouse master data`);
    assert.equal(canSee(role, 'TANK_VIEW'), false, `${role} should not read legacy tank records`);
  }
  assert.equal(canSee('Route Supervisor', 'TANK_VIEW'), true);
});

test('product prices and costs are exposed only to designated roles', () => {
  assert.equal(canSee('Sales Manager', 'PRODUCT_PRICE_VIEW'), true);
  assert.equal(canSee('Production Manager', 'PRODUCT_COST_VIEW'), true);
  assert.equal(canSee('Procurement Officer', 'PRODUCT_COST_VIEW'), true);
  for (const role of ['Driver', 'Data Entry Operator', 'Cashier', 'Storekeeper', 'Collector']) {
    assert.equal(canSee(role, 'PRODUCT_PRICE_VIEW'), false, `${role} must not see catalog prices`);
    assert.equal(canSee(role, 'PRODUCT_COST_VIEW'), false, `${role} must not see product costs`);
  }
});
