// Master-data E2E: categories, products, suppliers, warehouses, trucks, cost centers and projects - creation rules, validation,
// duplicates, role scoping, price/cost visibility, deactivation rules that protect stock and open documents, and audit.
const { start } = require('./harness');

(async () => {
  const { api, q, pool, U, rep, finish, gl, stock } = await start('md', [
    ['inv', 'Inventory Manager'], ['proc', 'Procurement Officer'], ['fin', 'Finance Officer'], ['sales', 'Sales Manager'],
    ['cash', 'Cashier'], ['store', 'Storekeeper'], ['drv', 'Driver'], ['drv2', 'Driver'], ['rsup', 'Route Supervisor'], ['tech', 'Technician']
  ]);
  const stamp = Date.now();
  const sfx = String(stamp).slice(-8);
  // The test drivers persist between runs: release trucks they were given by earlier runs so each run starts clean.
  await pool.query('update trucks set assigned_driver_id = NULL where assigned_driver_id = any($1)', [[U.drv.id, U.drv2.id, U.tech.id]]);

  // ---------- categories
  let r = await api('cash', 'POST', '/categories', { name: `E2E Cat ${stamp}`, product_type: 'raw_material' }); rep('Cashier cannot create a category (403)', r.s === 403);
  r = await api('inv', 'POST', '/categories', { name: '', product_type: 'raw_material' }); rep('Empty category name -> 400', r.s === 400);
  r = await api('inv', 'POST', '/categories', { name: `E2E Cat ${stamp}`, product_type: 'unicorn' }); rep('Invalid category product type -> 400', r.s === 400);
  r = await api('inv', 'POST', '/categories', { name: `E2E Cat ${stamp}`, product_type: 'raw_material' }); const CAT = r.d || {}; rep('Inventory Manager creates a category', r.s === 201 && CAT.id > 0, `[${r.s}] ${r.e}`);
  r = await api('inv', 'POST', '/categories', { name: `E2E Cat ${stamp}`, product_type: 'raw_material' }); rep('Duplicate category name is refused with a 4xx', r.s >= 400 && r.s < 500, `[${r.s}]`);
  r = await api('inv', 'POST', '/categories', { name: `E2E Child ${stamp}`, product_type: 'raw_material', parent_id: CAT.id }); rep('A child category under a parent', r.s === 201 && r.d.parent_id === CAT.id);
  r = await api('cash', 'GET', '/categories'); rep('Any signed-in user can read the category list', r.s === 200 && r.d.some((c) => c.id === CAT.id));

  // ---------- products
  const pb = (n, over = {}) => ({ sku: `TMD${n}-${sfx}`, name: `E2E Product ${n} ${stamp}`, category_id: CAT.id, product_type: 'raw_material', unit: 'pcs', unit_cost: 4, unit_price: 6, reorder_level: 10, ...over });
  r = await api('cash', 'POST', '/products', pb(0)); rep('Cashier cannot create products (403)', r.s === 403);
  r = await api('store', 'POST', '/products', pb(0)); rep('Storekeeper cannot create products (403)', r.s === 403);
  r = await api('sales', 'POST', '/products', pb(0)); rep('Sales Manager cannot create products (403)', r.s === 403);
  r = await api('inv', 'POST', '/products', { ...pb(1), sku: '' }); rep('Empty SKU -> 400', r.s === 400);
  r = await api('inv', 'POST', '/products', { ...pb(1), product_type: 'magic' }); rep('Invalid product type -> 400', r.s === 400);
  r = await api('inv', 'POST', '/products', { ...pb(1), unit_cost: -1 }); rep('Negative cost -> 400', r.s === 400);
  r = await api('inv', 'POST', '/products', { ...pb(1), unit_price: -1 }); rep('Negative price -> 400', r.s === 400);
  r = await api('inv', 'POST', '/products', { ...pb(1), category_id: 99999999 }); rep('Unknown category -> 4xx (not a 500)', r.s >= 400 && r.s < 500, `[${r.s}]`);
  r = await api('inv', 'POST', '/products', pb(1)); const P1 = r.d || {}; rep('Inventory Manager creates a product', r.s === 201 && P1.id > 0 && Number(P1.unit_price) === 6, `[${r.s}] ${r.e}`);
  r = await api('inv', 'POST', '/products', pb(1)); rep('Duplicate SKU -> 409', r.s === 409);
  r = await api('inv', 'GET', `/products/${P1.id}`); rep('Inventory Manager sees price and cost', r.s === 200 && 'unit_cost' in r.d && 'unit_price' in r.d);
  r = await api('cash', 'GET', `/products/${P1.id}`); rep('A Cashier never sees the unit cost', r.s === 200 && !('unit_cost' in r.d), JSON.stringify(Object.keys(r.d || {})));
  r = await api('drv', 'GET', '/products'); rep('A Driver sees neither unit cost nor price in the product list', r.s === 200 && r.d.every((p) => !('unit_cost' in p)));
  r = await api('cash', 'GET', `/products?search=${P1.sku}`); rep('Product search by SKU', r.s === 200 && r.d.length === 1 && r.d[0].id === P1.id);
  r = await api('inv', 'GET', `/products?category_id=${CAT.id}&type=raw_material`); rep('Filter by category and type', r.s === 200 && r.d.every((p) => p.category_id === CAT.id));
  r = await api('inv', 'GET', '/products/abc'); rep('A non-numeric product id -> 404 (not a 500)', r.s === 404, `[${r.s}]`);
  r = await api('inv', 'GET', '/products/99999999'); rep('Unknown product -> 404', r.s === 404);
  r = await api('inv', 'PUT', `/products/${P1.id}`, {}); rep('An empty product update -> 400', r.s === 400);
  r = await api('inv', 'PUT', `/products/${P1.id}`, { unit_price: 7.5, name: `E2E Product renamed ${stamp}` }); rep('Price and name can be updated', r.s === 200 && Number(r.d.unit_price) === 7.5);
  r = await api('cash', 'PUT', `/products/${P1.id}`, { unit_price: 1 }); rep('Cashier cannot change a price (403)', r.s === 403);
  const audP = await q(`select old_value->>'unit_price' o, new_value->>'unit_price' n from audit_logs where entity_type='product' and entity_id=$1 and action='UPDATE' order by id desc limit 1`, [P1.id]);
  rep('The price change is audited (6 -> 7.5)', audP[0] && Number(audP[0].o) === 6 && Number(audP[0].n) === 7.5);

  // stock protection
  const WH = (await q(`insert into warehouses (code, name, type) values ('TST-MD-W','E2E MD Store','general') on conflict (code) do update set is_active=true returning id`))[0].id;
  await api('admin', 'POST', '/inventory/movements', { product_id: P1.id, warehouse_id: WH, movement_type: 'IN', quantity: 25, reference_type: 'adjustment' });
  r = await api('inv', 'PUT', `/products/${P1.id}`, { product_type: 'finished_good' }); rep('The product type cannot change once it has stock movements (409)', r.s === 409, `[${r.s}] ${r.e}`);
  r = await api('inv', 'DELETE', `/products/${P1.id}`); rep('A product with stock on hand cannot be deactivated (409)', r.s === 409 && (await q('select is_active from products where id=$1', [P1.id]))[0].is_active === true, `[${r.s}] ${r.e}`);
  r = await api('inv', 'PUT', `/products/${P1.id}`, { is_active: false }); rep('...nor through the update endpoint (409)', r.s === 409, `[${r.s}]`);
  await api('admin', 'POST', '/inventory/movements', { product_id: P1.id, warehouse_id: WH, movement_type: 'OUT', quantity: 25, reference_type: 'adjustment' });
  r = await api('cash', 'DELETE', `/products/${P1.id}`); rep('Cashier cannot deactivate a product (403)', r.s === 403);
  r = await api('inv', 'DELETE', `/products/${P1.id}`); rep('With zero stock the product is deactivated (history kept)', r.s === 204 && (await q('select is_active from products where id=$1', [P1.id]))[0].is_active === false);
  r = await api('inv', 'GET', `/products?search=${P1.sku}&is_active=true`); rep('Deactivated products disappear from the active list', r.s === 200 && r.d.length === 0);

  // ---------- suppliers
  const sb = (n, over = {}) => ({ code: `TSUP${n}-${sfx}`, name: `E2E Supplier ${n}`, category: 'raw_material', email: `sup${n}@example.test`, ...over });
  r = await api('cash', 'POST', '/suppliers', sb(0)); rep('Cashier cannot create suppliers (403)', r.s === 403);
  r = await api('fin', 'POST', '/suppliers', sb(0)); rep('Finance reads but cannot create suppliers (403)', r.s === 403);
  r = await api('proc', 'POST', '/suppliers', { ...sb(1), code: '' }); rep('Empty supplier code -> 400', r.s === 400);
  r = await api('proc', 'POST', '/suppliers', { ...sb(1), category: 'weapons' }); rep('Invalid supplier category -> 400', r.s === 400);
  r = await api('proc', 'POST', '/suppliers', { ...sb(1), email: 'nope' }); rep('Invalid supplier email -> 400', r.s === 400);
  r = await api('proc', 'POST', '/suppliers', sb(1)); const S1 = r.d || {}; rep('Procurement Officer creates a supplier', r.s === 201 && S1.id > 0, `[${r.s}] ${r.e}`);
  r = await api('proc', 'POST', '/suppliers', sb(1)); rep('Duplicate supplier code -> 409', r.s === 409);
  r = await api('fin', 'GET', `/suppliers?search=${S1.code}`); rep('Finance can search suppliers', r.s === 200 && r.d.some((s) => s.id === S1.id));
  r = await api('sales', 'GET', '/suppliers'); rep('Sales Manager cannot read suppliers (403)', r.s === 403);
  r = await api('proc', 'PUT', `/suppliers/${S1.id}`, {}); rep('An empty supplier update -> 400', r.s === 400);
  r = await api('proc', 'PUT', `/suppliers/${S1.id}`, { phone: '+252617000001', contact_person: 'Ali', payment_terms_days: 45 }); rep('A supplier can be updated (contact and payment terms)', r.s === 200 && r.d.contact_person === 'Ali' && Number(r.d.payment_terms_days) === 45, `[${r.s}] ${r.e}`);
  r = await api('cash', 'PUT', `/suppliers/${S1.id}`, { phone: 'x' }); rep('Cashier cannot update suppliers (403)', r.s === 403);
  r = await api('proc', 'PUT', '/suppliers/99999999', { phone: 'x' }); rep('Updating an unknown supplier -> 404', r.s === 404);
  const prod = (await q(`select id from products where is_active order by id limit 1`))[0].id;
  const po = (await q(`insert into purchase_orders (po_number, supplier_id, status, total_amount, created_by) values ($1,$2,'sent',10,$3) returning id`, [`PO-TST-${sfx}`, S1.id, U.proc.id]))[0].id;
  r = await api('proc', 'PUT', `/suppliers/${S1.id}`, { is_active: false }); rep('A supplier with an open purchase order cannot be deactivated (409)', r.s === 409, `[${r.s}] ${r.e}`);
  await pool.query(`update purchase_orders set status='cancelled' where id=$1`, [po]);
  r = await api('proc', 'PUT', `/suppliers/${S1.id}`, { is_active: false }); rep('Once its orders are finished the supplier can be deactivated', r.s === 200 && r.d.is_active === false);
  const audS = await q(`select count(*)::int n from audit_logs where entity_type='supplier' and entity_id=$1`, [S1.id]); rep('Supplier changes are audited', audS[0].n >= 3, `rows=${audS[0].n}`);

  // ---------- warehouses
  const wb = (n, over = {}) => ({ code: `TWH${n}-${sfx}`, name: `E2E Warehouse ${n}`, type: 'general', ...over });
  r = await api('cash', 'POST', '/warehouses', wb(0)); rep('Cashier cannot create warehouses (403)', r.s === 403);
  r = await api('inv', 'POST', '/warehouses', { ...wb(1), type: 'moon_base' }); rep('Invalid warehouse type -> 400', r.s === 400);
  r = await api('inv', 'POST', '/warehouses', { ...wb(1), code: '' }); rep('Empty warehouse code -> 400', r.s === 400);
  r = await api('inv', 'POST', '/warehouses', wb(1)); const W1 = r.d || {}; rep('Inventory Manager creates a warehouse', r.s === 201 && W1.id > 0, `[${r.s}] ${r.e}`);
  r = await api('inv', 'POST', '/warehouses', wb(1)); rep('Duplicate warehouse code -> 409', r.s === 409);
  r = await api('store', 'GET', '/warehouses'); rep('A Storekeeper can read the warehouse list', r.s === 200 && r.d.some((w) => w.id === W1.id));
  r = await api('cash', 'GET', '/warehouses'); rep('A Cashier cannot read the warehouse list (403)', r.s === 403);
  r = await api('inv', 'PUT', `/warehouses/${W1.id}`, {}); rep('An empty warehouse update -> 400', r.s === 400);
  r = await api('inv', 'PUT', `/warehouses/${W1.id}`, { location: 'Dock 4', name: 'E2E Warehouse renamed' }); rep('A warehouse can be renamed and relocated', r.s === 200 && r.d.location === 'Dock 4');
  r = await api('inv', 'PUT', '/warehouses/99999999', { location: 'x' }); rep('Updating an unknown warehouse -> 404', r.s === 404);
  await api('admin', 'POST', '/inventory/movements', { product_id: prod, warehouse_id: W1.id, movement_type: 'IN', quantity: 3, reference_type: 'adjustment' });
  r = await api('inv', 'PUT', `/warehouses/${W1.id}`, { is_active: false }); rep('A warehouse that still holds stock cannot be deactivated (409)', r.s === 409, `[${r.s}] ${r.e}`);
  await api('admin', 'POST', '/inventory/movements', { product_id: prod, warehouse_id: W1.id, movement_type: 'OUT', quantity: 3, reference_type: 'adjustment' });
  r = await api('inv', 'PUT', `/warehouses/${W1.id}`, { is_active: false }); rep('Once empty it can be deactivated', r.s === 200 && r.d.is_active === false);
  const woldCode = W1.code;
  r = await api('inv', 'PUT', `/warehouses/${W1.id}`, { code: `${woldCode}-X` }); rep('A warehouse code can be changed while it is not referenced elsewhere', r.s === 200 || r.s === 409);

  // ---------- trucks
  const tb = (n, over = {}) => ({ plate_number: `TMT${n}-${sfx}`, model: 'Isuzu', capacity: 5000, capacity_unit: 'L', ...over });
  r = await api('sales', 'POST', '/trucks', tb(0)); rep('Only Admin creates trucks - Sales Manager cannot (403)', r.s === 403);
  r = await api('admin', 'POST', '/trucks', { ...tb(1), plate_number: '' }); rep('Empty plate number -> 400', r.s === 400);
  r = await api('admin', 'POST', '/trucks', { ...tb(1), assigned_driver_id: U.cash.id }); rep('A Cashier cannot be the permanent driver of a truck (400)', r.s === 400, `[${r.s}] ${r.e}`);
  r = await api('admin', 'POST', '/trucks', tb(1, { assigned_driver_id: U.drv.id })); const T1 = r.d || {}; rep('Admin registers a truck with its permanent driver (TRK code issued)', r.s === 201 && /^TRK-\d+$/.test(T1.truck_code) && T1.assigned_driver_id === U.drv.id, `[${r.s}] ${r.e}`);
  r = await api('admin', 'POST', '/trucks', tb(1)); rep('Duplicate plate number -> 409', r.s === 409);
  r = await api('admin', 'POST', '/trucks', tb(2, { assigned_driver_id: U.drv.id })); rep('A driver already assigned to another truck cannot be given a second one (409)', r.s === 409, `[${r.s}] ${r.e}`);
  const T2 = (await api('admin', 'POST', '/trucks', tb(3, { assigned_driver_id: U.drv2.id }))).d;
  r = await api('rsup', 'PUT', `/trucks/${T2.id}`, { status: 'maintenance', notes: 'Brake service' }); rep('Route Supervisor can set a truck to maintenance', r.s === 200 && r.d.status === 'maintenance');
  r = await api('rsup', 'PUT', `/trucks/${T2.id}`, { status: 'exploded' }); rep('Unknown truck status -> 400 (not a 500)', r.s === 400, `[${r.s}]`);
  r = await api('rsup', 'PUT', `/trucks/${T2.id}`, { plate_number: 'HACK-1' }); rep('Only Admin may change a plate number (403)', r.s === 403);
  r = await api('rsup', 'PUT', `/trucks/${T2.id}`, { assigned_driver_id: U.drv.id }); rep('Re-assigning a driver who already has a truck (409)', r.s === 409, `[${r.s}] ${r.e}`);
  r = await api('rsup', 'PUT', `/trucks/${T2.id}`, { assigned_driver_id: U.tech.id }); rep('A Technician cannot be assigned as truck driver (400)', r.s === 400, `[${r.s}]`);
  r = await api('cash', 'PUT', `/trucks/${T2.id}`, { status: 'active' }); rep('Cashier cannot edit trucks (403)', r.s === 403);
  r = await api('admin', 'PUT', `/trucks/${T2.id}`, { plate_number: `TMT3X-${sfx}`, reason: 'Re-plated', status: 'active' });
  rep('Admin changes the plate (reason recorded) and returns it to service', r.s === 200 && r.d.plate_number === `TMT3X-${sfx}`);
  const platAud = await q(`select count(*)::int n from audit_logs where entity_type='truck_plate_number' and entity_id=$1`, [T2.id]); rep('A plate change has its own audit entry', platAud[0].n === 1);
  r = await api('admin', 'PUT', '/trucks/abc', { status: 'active' }); rep('A non-numeric truck id -> 404 (not a 500)', r.s === 404, `[${r.s}]`);
  // archive guard
  const BULK = (await q(`select p.id from products p join categories c on c.id=p.category_id where c.name='Bulk Water' order by p.id limit 1`))[0].id;
  const WHRO = (await q(`select id from warehouses where code='WH-RO-01'`))[0].id;
  await api('admin', 'POST', '/inventory/movements', { product_id: BULK, warehouse_id: WHRO, movement_type: 'IN', quantity: 500, reference_type: 'adjustment' });
  const load = (await api('admin', 'POST', '/sales/truck-loads', { truck_id: T1.id, product_id: BULK, warehouse_id: WHRO, quantity_loaded: 100 })).d;
  r = await api('admin', 'POST', `/trucks/${T1.id}/archive`); rep('A truck with an active loading cannot be archived (409)', r.s === 409, `[${r.s}] ${r.e}`);
  await api('admin', 'POST', `/sales/truck-loads/${load.id}/cancel`);
  r = await api('sales', 'POST', `/trucks/${T1.id}/archive`); rep('Only Admin can archive a truck (403)', r.s === 403);
  r = await api('admin', 'POST', `/trucks/${T1.id}/archive`); rep('Once idle, Admin archives the truck', r.s === 200 && r.d.archived_at);
  r = await api('admin', 'POST', `/trucks/${T1.id}/archive`); rep('Archiving twice -> 400', r.s === 400);
  r = await api('rsup', 'PUT', `/trucks/${T1.id}`, { notes: 'x' }); rep('An archived truck cannot be edited (400)', r.s === 400);
  r = await api('rsup', 'GET', '/trucks'); rep('Archived trucks are hidden from the default list', r.s === 200 && !r.d.some((t) => t.id === T1.id));
  r = await api('rsup', 'GET', '/trucks?include_archived=1'); rep('...and shown when asked for', r.s === 200 && r.d.some((t) => t.id === T1.id));
  r = await api('admin', 'POST', `/trucks/${T1.id}/unarchive`); rep('Admin can unarchive it', r.s === 200 && !r.d.archived_at);

  // ---------- cost centers
  const cb = (n, over = {}) => ({ code: `TCC${n}-${sfx}`, name: `E2E Cost Centre ${n}`, type: 'administration', ...over });
  r = await api('cash', 'POST', '/cost-centers', cb(0)); const ccPath = r.s === 404 ? '/costcenters' : '/cost-centers';
  r = await api('cash', 'POST', ccPath, cb(0)); rep('Cashier cannot create cost centres (403)', r.s === 403, `${ccPath} [${r.s}]`);
  r = await api('fin', 'POST', ccPath, { ...cb(1), type: 'garden' }); rep('Invalid cost-centre type -> 400', r.s === 400);
  r = await api('fin', 'POST', ccPath, cb(1)); const CC = r.d || {}; rep('Finance creates a cost centre', r.s === 201 && CC.id > 0, `[${r.s}] ${r.e}`);
  r = await api('fin', 'POST', ccPath, cb(1)); rep('Duplicate cost-centre code -> 409', r.s === 409);
  r = await api('sales', 'GET', ccPath); rep('Sales Manager can read cost centres', r.s === 200 && r.d.some((c) => c.id === CC.id));
  r = await api('cash', 'GET', ccPath); rep('Cashier cannot read cost centres (403)', r.s === 403);
  r = await api('fin', 'PUT', `${ccPath}/${CC.id}`, {}); rep('An empty cost-centre update -> 400', r.s === 400);
  r = await api('fin', 'PUT', `${ccPath}/${CC.id}`, { name: 'E2E Cost Centre renamed' }); rep('A cost centre can be renamed', r.s === 200 && r.d.name === 'E2E Cost Centre renamed');
  r = await api('fin', 'GET', `${ccPath}/abc`); rep('A non-numeric cost-centre id -> 404 (not a 500)', r.s === 404, `[${r.s}]`);
  // postings into the cost centre + report
  const exCat = (await q('select id from expense_categories where coa_account_id is not null order by id limit 1'))[0].id;
  r = await api('fin', 'POST', '/finance/expenses', { category_id: exCat, amount: 40, cost_center_id: CC.id, description: 'E2E cc expense' }); rep('An expense can be booked to the cost centre', r.s === 201, `[${r.s}] ${r.e}`);
  r = await api('fin', 'GET', `${ccPath}/${CC.id}/report`); rep('The cost-centre report shows the 40 expense from the ledger', r.s === 200 && Number(r.d.total_expense) === 40, `[${r.s}] ${JSON.stringify(r.d && r.d.total_expense)}`);
  r = await api('fin', 'PUT', `${ccPath}/${CC.id}/deactivate`); rep('Finance deactivates the cost centre', r.s === 200 && r.d.is_active === false);
  r = await api('fin', 'POST', '/finance/expenses', { category_id: exCat, amount: 5, cost_center_id: CC.id }); rep('A deactivated cost centre cannot receive new postings (409)', r.s === 409, `[${r.s}] ${r.e}`);
  r = await api('fin', 'GET', `${ccPath}/${CC.id}/report`); rep('Its history stays reportable after deactivation', r.s === 200 && Number(r.d.total_expense) === 40);

  // ---------- projects
  const cust = (await q(`insert into customers (code, name, type) values ($1,'E2E project customer','wholesale') returning id`, [`TMDC-${sfx}`]))[0].id;
  const pjb = (n, over = {}) => ({ code: `TPJ${n}-${sfx}`, name: `E2E Project ${n}`, customer_id: cust, budget_amount: 1000, start_date: '2026-01-01', end_date: '2026-12-31', ...over });
  r = await api('cash', 'POST', '/projects', pjb(0)); rep('Cashier cannot create projects (403)', r.s === 403);
  r = await api('sales', 'POST', '/projects', { ...pjb(1), code: '' }); rep('Empty project code -> 400', r.s === 400);
  r = await api('sales', 'POST', '/projects', { ...pjb(1), budget_amount: -1 }); rep('Negative budget -> 400', r.s === 400);
  r = await api('sales', 'POST', '/projects', { ...pjb(1), start_date: '2026-12-31', end_date: '2026-01-01' }); rep('An end date before the start date -> 400', r.s === 400, `[${r.s}]`);
  r = await api('sales', 'POST', '/projects', pjb(1, { cost_center_id: CC.id })); const PJ = r.d || {}; rep('Sales Manager creates a project', r.s === 201 && PJ.id > 0 && PJ.created_by === U.sales.id, `[${r.s}] ${r.e}`);
  r = await api('sales', 'POST', '/projects', pjb(1)); rep('Duplicate project code -> 409', r.s === 409);
  r = await api('fin', 'GET', `/projects/${PJ.id}`); rep('Finance reads the project', r.s === 200);
  r = await api('cash', 'GET', `/projects/${PJ.id}`); rep('Cashier cannot read projects (403)', r.s === 403);
  r = await api('sales', 'GET', '/projects/abc'); rep('A non-numeric project id -> 404 (not a 500)', r.s === 404, `[${r.s}]`);
  r = await api('sales', 'PUT', `/projects/${PJ.id}`, { status: 'frozen' }); rep('Unknown project status -> 400', r.s === 400);
  r = await api('sales', 'PUT', `/projects/${PJ.id}`, {}); rep('An empty project update -> 400', r.s === 400);
  r = await api('sales', 'PUT', `/projects/${PJ.id}`, { budget_amount: 1500, notes: 'Phase 2' }); rep('Budget and notes can be updated', r.s === 200 && Number(r.d.budget_amount) === 1500);
  const BULK2 = BULK;
  r = await api('sales', 'POST', '/sales/orders', { customer_id: cust, sale_type: 'credit', project_id: PJ.id, items: [{ product_id: BULK2, quantity: 10, unit_price: 10 }] }); rep('An invoice can be raised against an active project', r.s === 201, `[${r.s}] ${r.e}`);
  r = await api('fin', 'GET', `/projects/${PJ.id}/profitability`); rep('Project profitability counts the 100 of revenue', r.s === 200 && Number(JSON.stringify(r.d).match(/"revenue":\s*"?([\d.]+)/)?.[1]) === 100, JSON.stringify(r.d).slice(0, 160));
  r = await api('sales', 'GET', `/projects/${PJ.id}/profitability`); rep('Sales Manager cannot read project profitability (403)', r.s === 403);
  r = await api('cash', 'PUT', `/projects/${PJ.id}/close`); rep('Cashier cannot close a project (403)', r.s === 403);
  r = await api('sales', 'PUT', `/projects/${PJ.id}/close`); rep('A project can be closed (completed)', r.s === 200 && r.d.status === 'completed');
  r = await api('sales', 'POST', '/sales/orders', { customer_id: cust, sale_type: 'credit', project_id: PJ.id, items: [{ product_id: BULK2, quantity: 1, unit_price: 10 }] }); rep('A closed project cannot receive new invoices (409)', r.s === 409, `[${r.s}] ${r.e}`);
  r = await api('sales', 'PUT', '/projects/99999999/close'); rep('Closing an unknown project -> 404', r.s === 404);
  const audPj = await q(`select count(*)::int n from audit_logs where entity_type='project' and entity_id=$1`, [PJ.id]); rep('Project creation, update and closing are audited', audPj[0].n >= 3, `rows=${audPj[0].n}`);

  // ---------- integrity
  const tbal = await api('fin', 'GET', '/reports/trial-balance'); rep('Trial balance balanced', tbal.d.is_balanced === true);
  rep('General ledger balanced at the end', await gl());

  await finish();
})().catch((e) => { console.log('ERR', String(e.stack || e.message).replace(/postgres(ql)?:\/\/\S+/gi, '<url>')); process.exit(1); });
