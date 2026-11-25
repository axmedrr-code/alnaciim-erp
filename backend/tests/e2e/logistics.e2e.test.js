// Logistics E2E: tanker loading (Route Sessions), reconciliation / water returns, session closing, cancellation,
// route visibility, and the damaged-goods / incident (exceptions) workflow with separation of duties.
const { start } = require('./harness');

(async () => {
  const { api, q, pool, U, rep, finish, gl, stock } = await start('log', [
    ['store', 'Storekeeper'], ['de', 'Data Entry Operator'], ['drv1', 'Driver'], ['drv2', 'Driver'], ['rsup', 'Route Supervisor'],
    ['opm', 'Operation Manager'], ['sales', 'Sales Manager'], ['cash', 'Cashier']
  ]);
  const stamp = Date.now();
  const WHRO = (await q(`select id from warehouses where code='WH-RO-01'`))[0].id;
  const BULK = (await q(`select p.id from products p join categories c on c.id=p.category_id where c.name='Bulk Water' order by p.id limit 1`))[0].id;
  const OTHER = (await q(`select p.id from products p join categories c on c.id=p.category_id where c.name<>'Bulk Water' and p.product_type='raw_material' order by p.id limit 1`))[0].id;
  const otherWh = (await q(`select id from warehouses where code<>'WH-RO-01' order by id limit 1`))[0].id;
  const cust = (await q('select id from customers where is_active order by id limit 2')).map((c) => c.id);
  const mkTruck = async (n) => (await q(`insert into trucks (plate_number, truck_code) values ($1,$2) returning id`, [`TST-${n}-${stamp}`.slice(0, 20), `TT${n}${String(stamp).slice(-6)}`]))[0].id;
  const T = {}; for (const n of ['1', '2', '3', '4', '5']) T[n] = await mkTruck(n);
  const mkRoute = async (truck, driver, n) => (await q(`insert into route_runs (route_number, truck_id, driver_id, created_by, route_date) values ($1,$2,$3,$4,CURRENT_DATE) returning id`, [`TST-RR${n}-${stamp}`.slice(0, 30), truck, driver, U.admin.id]))[0].id;
  const R1 = await mkRoute(T[4], U.drv1.id, 1), R2 = await mkRoute(T[5], U.drv2.id, 2);
  const S1 = (await q(`insert into route_stops (route_run_id, customer_id, sequence_number) values ($1,$2,1) returning id`, [R1, cust[0]]))[0].id;
  const S2 = (await q(`insert into route_stops (route_run_id, customer_id, sequence_number) values ($1,$2,1) returning id`, [R2, cust[0]]))[0].id;
  await api('admin', 'POST', '/inventory/movements', { product_id: BULK, warehouse_id: WHRO, movement_type: 'IN', quantity: 5000, reference_type: 'adjustment' });
  const base = await stock(BULK, WHRO);
  rep('Setup: Finished Water Warehouse seeded', base >= 5000);

  // ---------- loading
  const load = (who, truck, body) => api(who, 'POST', '/sales/truck-loads', { truck_id: truck, product_id: BULK, warehouse_id: WHRO, ...body });
  let r = await load('de', T[1], { quantity_loaded: 1000 }); rep('Data Entry cannot load a tanker (403)', r.s === 403);
  r = await load('drv1', T[1], { quantity_loaded: 1000 }); rep('Driver cannot load a tanker (403)', r.s === 403);
  r = await load('store', T[1], { quantity_loaded: -5 }); rep('Negative loading -> 400', r.s === 400);
  r = await api('store', 'POST', '/sales/truck-loads', { truck_id: T[1], product_id: BULK, warehouse_id: otherWh, quantity_loaded: 100 }); rep('Loading from any warehouse other than the Finished Water Warehouse -> 400', r.s === 400);
  r = await api('store', 'POST', '/sales/truck-loads', { truck_id: T[1], product_id: OTHER, warehouse_id: WHRO, quantity_loaded: 100 }); rep('Loading a product that is not Bulk Water -> 400', r.s === 400);
  r = await load('store', T[1], { quantity_loaded: 99999999 }); rep('Loading more than the warehouse holds -> 400, nothing moves', r.s === 400 && (await stock(BULK, WHRO)) === base);
  r = await load('store', T[1], { quantity_loaded: 0 }); rep('Opening a session on a truck with no remaining water and no quantity -> 400', r.s === 400);
  r = await load('store', T[1], { quantity_loaded: 1000 }); const L1 = r.d || {};
  rep('Storekeeper loads 1000 L: session opened, warehouse -1000', r.s === 201 && (await stock(BULK, WHRO)) === base - 1000, `[${r.s}] ${r.e}`);
  r = await load('store', T[1], { quantity_loaded: 100 }); rep('A truck cannot have two active sessions (409)', r.s === 409);

  // ---------- reconcile / close
  const rec = (who, id, body) => api(who, 'POST', `/sales/truck-loads/${id}/reconcile`, body);
  r = await rec('store', L1.id, { actual_remaining: 1000 }); rep('Storekeeper cannot close/reconcile a session they opened (403)', r.s === 403);
  r = await rec('de', L1.id, { actual_remaining: 900 }); rep('A mismatch without a reason -> 400', r.s === 400);
  r = await rec('de', L1.id, { actual_remaining: 900, reason: 'other' }); rep('Reason "other" needs a note -> 400', r.s === 400);
  r = await rec('de', L1.id, { actual_remaining: 900, reason: 'aliens' }); rep('Unknown reason -> 400', r.s === 400);
  r = await rec('de', L1.id, { actual_remaining: 1000, returned_liters: 300 }); rep('A water return must use the "returned_to_warehouse" reason -> 400', r.s === 400);
  r = await rec('de', L1.id, { actual_remaining: 1000, reason: 'returned_to_warehouse' }); rep('"returned_to_warehouse" needs liters returned -> 400', r.s === 400);
  r = await rec('de', L1.id, { actual_remaining: 1000.123 }); rep('More than 2 decimals -> 400', r.s === 400);
  r = await api('de', 'POST', `/sales/truck-loads/${L1.id}/complete`); rep('Plain Complete is refused while water remains (400)', r.s === 400);
  r = await rec('de', L1.id, { actual_remaining: 1000, returned_liters: 300, reason: 'returned_to_warehouse' });
  rep('Data Entry closes the session returning 300 L to the warehouse (net -700)', r.s === 201 && (await stock(BULK, WHRO)) === base - 700, `[${r.s}] ${r.e} stock=${await stock(BULK, WHRO)}`);
  r = await rec('de', L1.id, { actual_remaining: 1000 }); rep('A closed session cannot be reconciled again (404)', r.s === 404);
  r = await load('store', T[1], { quantity_loaded: 0 }); const L2 = r.d || {};
  rep('Next session opens on the 700 L still on the truck with NO warehouse movement', r.s === 201 && Number(L2.quantity_loaded) === 700 && (await stock(BULK, WHRO)) === base - 700, `[${r.s}] ${r.e} qty=${L2.quantity_loaded}`);
  r = await rec('de', L2.id, { actual_remaining: 650, reason: 'spillage' });
  rep('Closing with a 50 L spillage records the difference, warehouse unchanged', r.s === 201 && Number(r.d.reconciliation.difference) === -50 && (await stock(BULK, WHRO)) === base - 700, `[${r.s}] ${r.e}`);
  r = await load('store', T[1], { quantity_loaded: 0 }); const L3 = r.d || {};
  rep('The following session starts from the measured 650 L', r.s === 201 && Number(L3.quantity_loaded) === 650, `qty=${L3.quantity_loaded}`);
  r = await api('de', 'POST', `/sales/truck-loads/${L3.id}/cancel`); rep('Data Entry cannot cancel a loading (403)', r.s === 403);
  r = await api('store', 'POST', `/sales/truck-loads/${L3.id}/cancel`); rep('Cancelling a session that used existing truck water does not touch warehouse stock', r.s === 200 && (await stock(BULK, WHRO)) === base - 700, `[${r.s}]`);

  // ---------- cancellation returns the water
  r = await load('store', T[2], { quantity_loaded: 200 }); const L4 = r.d || {};
  r = await api('store', 'POST', `/sales/truck-loads/${L4.id}/cancel`);
  rep('Cancelling a fresh 200 L loading puts the water back into the warehouse', r.s === 200 && (await stock(BULK, WHRO)) === base - 700, `[${r.s}] stock=${await stock(BULK, WHRO)} expected=${base - 700}`);
  r = await api('store', 'POST', `/sales/truck-loads/${L4.id}/cancel`); rep('Cancelling twice -> 404', r.s === 404);
  r = await load('store', T[2], { quantity_loaded: 100 }); const L5 = r.d || {};
  await pool.query('update truck_loads set delivered_liters = 40 where id=$1', [L5.id]);
  r = await api('store', 'POST', `/sales/truck-loads/${L5.id}/cancel`); rep('A loading that already delivered water cannot be cancelled (409)', r.s === 409, `[${r.s}]`);

  // ---------- normal completion
  r = await load('store', T[3], { quantity_loaded: 100 }); const L6 = r.d || {};
  await pool.query('update truck_loads set delivered_liters = quantity_loaded where id=$1', [L6.id]);
  r = await api('de', 'POST', `/sales/truck-loads/${L6.id}/complete`); rep('A fully delivered session is closed by Data Entry', r.s === 200 && r.d.status === 'completed');
  r = await api('store', 'POST', `/sales/truck-loads/${L6.id}/complete`); rep('Storekeeper cannot close sessions (403/404)', r.s === 403 || r.s === 404);

  // ---------- session history visibility
  r = await api('sales', 'GET', '/sales/route-sessions'); rep('Sales Manager can view route session history', r.s === 200 && r.d.length > 0);
  r = await api('cash', 'GET', '/sales/route-sessions'); rep('Cashier cannot view route session history (403)', r.s === 403);
  r = await api('de', 'GET', `/sales/stock-reconciliations?truck_id=${T[1]}`); rep('Reconciliation history lists both adjustments with reasons', r.s === 200 && r.d.length >= 2 && r.d.some((x) => x.reason === 'spillage') && r.d.some((x) => x.reason === 'returned_to_warehouse'));

  // ---------- routes
  r = await api('drv1', 'GET', '/logistics/routes'); rep('A driver sees only their own route', r.s === 200 && r.d.some((x) => x.id === R1) && !r.d.some((x) => x.id === R2));
  r = await api('drv1', 'GET', `/logistics/routes/${R2}/stops`); rep("A driver cannot read another driver's stops (404)", r.s === 404);
  r = await api('drv1', 'GET', `/logistics/routes/${R1}/stops`); rep('A driver reads their own stops', r.s === 200 && r.d.length === 1);
  r = await api('cash', 'GET', '/logistics/routes'); rep('Cashier cannot read logistics routes (403)', r.s === 403);
  r = await api('opm', 'GET', '/logistics/routes'); rep('Operation Manager sees all routes', r.s === 200 && r.d.some((x) => x.id === R1) && r.d.some((x) => x.id === R2));

  // ---------- incidents / damaged goods
  const exc = (who, body) => api(who, 'POST', '/logistics/exceptions', body);
  r = await exc('cash', { type: 'shortage', route_run_id: R1 }); rep('Cashier cannot raise logistics incidents (403)', r.s === 403);
  r = await exc('drv1', { type: 'meteor', route_run_id: R1 }); rep('Invalid incident type -> 400', r.s === 400);
  r = await exc('drv1', { type: 'shortage', description: 'No route given' }); rep('A driver incident must be tied to their route (400)', r.s === 400);
  r = await exc('drv1', { type: 'shortage', route_run_id: R2, description: 'Not mine' }); rep("A driver cannot report on another driver's route (403)", r.s === 403);
  r = await exc('drv1', { type: 'wrong_delivery', route_run_id: R1, route_stop_id: S2 }); rep('A stop that belongs to a different route -> 400', r.s === 400);
  r = await exc('drv1', { type: 'shortage', route_run_id: 99999999 }); rep('Unknown route -> 404', r.s === 404);
  r = await exc('drv1', { type: 'damaged_goods', route_run_id: R1, description: 'Broken jars' }); rep('Damaged goods without a quantity -> 400', r.s === 400);
  r = await exc('drv1', { type: 'damaged_goods', quantity: 3, description: 'Broken jars' }); rep('Damaged goods not linked to a route -> 400', r.s === 400);
  r = await exc('drv1', { type: 'damaged_goods', route_run_id: R1, quantity: 3 }); rep('Damaged goods without a description -> 400', r.s === 400);
  r = await exc('drv1', { type: 'damaged_goods', route_run_id: R1, route_stop_id: S1, quantity: 3, description: 'Three 20L jars cracked in transit' }); const X1 = r.d || {};
  rep('Driver reports damaged goods on their route and stop (status open, truck inferred)', r.s === 201 && X1.status === 'open' && X1.truck_id === T[4] && Number(X1.quantity) === 3, `[${r.s}] ${r.e}`);
  r = await exc('drv2', { type: 'leakage', route_run_id: R2, quantity: 20, description: 'Valve leak' }); const X2 = r.d || {}; rep("The other driver reports a leakage on their route", r.s === 201);
  r = await exc('rsup', { type: 'customer_dispute', route_run_id: R1, description: 'Customer disputes volume' }); const X3 = r.d || {}; rep('Route Supervisor raises a customer dispute', r.s === 201);

  r = await api('drv1', 'POST', `/logistics/exceptions/${X1.id}/investigate`, { investigation_notes: 'Looking into it' }); rep('A driver cannot investigate incidents (403)', r.s === 403);
  r = await api('rsup', 'POST', `/logistics/exceptions/${X3.id}/investigate`, { investigation_notes: 'Self investigation' }); rep('Nobody investigates an incident they raised (403)', r.s === 403);
  r = await api('rsup', 'POST', `/logistics/exceptions/${X1.id}/investigate`, { investigation_notes: '' }); rep('Investigation needs notes (400)', r.s === 400);
  r = await api('rsup', 'POST', `/logistics/exceptions/${X1.id}/investigate`, { investigation_notes: 'Checked photos and load sheet' }); rep('Route Supervisor investigates -> investigating', r.s === 200 && r.d.status === 'investigating');
  r = await api('opm', 'POST', `/logistics/exceptions/${X1.id}/investigate`, { investigation_notes: 'Again' }); rep('Investigating an already-investigating incident -> 409', r.s === 409);
  r = await api('rsup', 'POST', `/logistics/exceptions/${X1.id}/resolve`, { resolution_notes: 'ok' }); rep('Resolution notes shorter than 3 characters -> 400', r.s === 400);
  r = await api('drv1', 'POST', `/logistics/exceptions/${X1.id}/resolve`, { resolution_notes: 'Resolved by me' }); rep('A driver cannot resolve incidents (403)', r.s === 403);
  r = await api('opm', 'POST', `/logistics/exceptions/${X1.id}/resolve`, { resolution_notes: 'Credit note issued, jars written off' }); rep('Operation Manager resolves it (resolved_by recorded)', r.s === 200 && r.d.status === 'resolved' && r.d.resolved_by === U.opm.id);
  r = await api('opm', 'POST', `/logistics/exceptions/${X1.id}/resolve`, { resolution_notes: 'Again please' }); rep('Resolving twice -> 409', r.s === 409);
  r = await api('rsup', 'POST', `/logistics/exceptions/${X3.id}/resolve`, { resolution_notes: 'Self resolution' }); rep('Nobody resolves an incident they raised (403)', r.s === 403);
  r = await api('opm', 'POST', `/logistics/exceptions/99999999/resolve`, { resolution_notes: 'ghost' }); rep('Unknown incident -> 404', r.s === 404);

  r = await api('drv1', 'GET', '/logistics/exceptions'); rep('A driver sees only incidents on their own route / raised by them', r.s === 200 && r.d.some((x) => x.id === X1.id) && !r.d.some((x) => x.id === X2.id));
  r = await api('de', 'GET', '/logistics/exceptions'); rep('Data Entry sees all incidents', r.s === 200 && [X1, X2, X3].every((x) => r.d.some((y) => y.id === x.id)));
  r = await api('opm', 'GET', '/logistics/exceptions?status=open&type=leakage'); rep('Filters by status and type work', r.s === 200 && r.d.some((x) => x.id === X2.id) && r.d.every((x) => x.status === 'open' && x.type === 'leakage'));
  r = await api('cash', 'GET', '/logistics/exceptions'); rep('Cashier cannot read incidents (403)', r.s === 403);

  // ---------- operations dashboard
  r = await api('opm', 'GET', '/operations/dashboard'); rep('Operations Manager dashboard shows open logistics incidents and route sessions', r.s === 200 && JSON.stringify(r.d).includes('open_logistics_exceptions') && JSON.stringify(r.d).includes('open_route_sessions'), `[${r.s}] ${r.e}`);
  r = await api('store', 'GET', '/operations/dashboard'); rep('Storekeeper cannot open the Operations dashboard (403)', r.s === 403);
  r = await api('sales', 'GET', '/operations/dashboard'); rep('Sales Manager cannot open the Operations dashboard (403)', r.s === 403);

  // ---------- audit + integrity
  const aud = await q(`select count(*)::int n from audit_logs where entity_type='logistics_exception' and entity_id = any($1)`, [[X1.id, X2.id, X3.id]]);
  rep('Incident create / investigate / resolve are in the audit trail (3 creates + 1 investigate + 1 resolve)', aud[0].n >= 5, `rows=${aud[0].n}`);
  const recs = await q(`select count(*)::int n from audit_logs where entity_type='stock_reconciliation'`); rep('Reconciliations are in the audit trail', recs[0].n >= 2);
  rep('No negative stock anywhere in the water warehouse', Number((await q('select count(*)::int n from stock_levels where warehouse_id=$1 and quantity<0', [WHRO]))[0].n) === 0);
  rep('General ledger still balanced', await gl());

  await finish();
})().catch((e) => { console.log('ERR', String(e.stack || e.message).replace(/postgres(ql)?:\/\/\S+/gi, '<url>')); process.exit(1); });
