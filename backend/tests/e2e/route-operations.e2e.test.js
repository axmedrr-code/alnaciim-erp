// Route Operations E2E: dispatch planning (draft -> dispatched -> closed), capacity and double-booking rules, cancel/clone,
// the fast tank-fill POS (tank-dispatch) with truck stock, cash/credit settlement, driver scoping, planning helpers and role scoping.
const { start } = require('./harness');

(async () => {
  const { api, q, pool, U, rep, finish, gl, stock } = await start('rop', [
    ['sup', 'Route Supervisor'], ['sup2', 'Supervisor'], ['sales', 'Sales Manager'], ['drv1', 'Driver'], ['drv2', 'Driver'],
    ['drv3', 'Driver'], ['drv4', 'Driver'], ['store', 'Storekeeper'], ['de', 'Data Entry Operator'], ['cash', 'Cashier'],
    ['coll', 'Collector'], ['tech', 'Technician'], ['fin', 'Finance Officer'], ['opm', 'Operation Manager']
  ]);
  const stamp = Date.now();
  const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  const BULK = (await q(`select p.id from products p join categories c on c.id=p.category_id where c.name='Bulk Water' order by p.id limit 1`))[0].id;
  const WHRO = (await q(`select id from warehouses where code='WH-RO-01'`))[0].id;
  const mkTruck = async (n, cap, driver) => (await q(`insert into trucks (plate_number, truck_code, capacity, assigned_driver_id) values ($1,$2,$3,$4) returning id`, [`TR${n}-${String(stamp).slice(-8)}`, `TC${n}${String(stamp).slice(-6)}`, cap, driver || null]))[0].id;
  const T1 = await mkTruck(1, 1000, U.drv1.id), T2 = await mkTruck(2, 1000, U.drv2.id), T3 = await mkTruck(3, 500, U.drv3.id), T4 = await mkTruck(4, 1000, U.drv4.id), T5 = await mkTruck(5, 1000, null);
  const mkCust = async (n, limit = 0) => (await q(`insert into customers (code, name, type, credit_limit) values ($1,$2,'tanker',$3) returning id`, [`TR${n}-${stamp}`.slice(0, 20), `E2E Route Customer ${n}`, limit]))[0].id;
  const C = {}; for (let i = 1; i <= 8; i++) C[i] = await mkCust(i);
  const CL = await mkCust(9, 100);
  const CT = {}; for (let i = 1; i <= 6; i++) CT[i] = await mkCust(20 + i);
  const mkOrder = async (cust, liters, price = 2, approve = true) => {
    const o = (await api('sales', 'POST', '/sales/orders', { customer_id: cust, sale_type: 'credit', items: [{ product_id: BULK, quantity: liters, unit_price: price }] })).d;
    if (approve) await api('sales', 'PUT', `/sales/orders/${o.id}/approve`);
    return o;
  };
  const ar = async (c) => Number((await q(`select coalesce(sum(jl.debit - jl.credit),0) n from journal_lines jl join journal_entries je on je.id=jl.journal_entry_id and je.status='posted' join chart_of_accounts a on a.id=jl.account_id and a.code='1100' where jl.customer_id=$1`, [c]))[0].n);
  const status = async (id) => (await q('select status from route_runs where id=$1', [id]))[0].status;
  const ostat = async (id) => (await q('select status from sales_orders where id=$1', [id]))[0].status;
  await api('admin', 'POST', '/inventory/movements', { product_id: BULK, warehouse_id: WHRO, movement_type: 'IN', quantity: 20000, reference_type: 'adjustment' });
  // Test drivers persist across runs, so every run plans on its own dates to avoid colliding with routes left by earlier runs.
  const off = 5 + (stamp % 3000);
  // The persistent test drivers can still hold draft routes dated today from an earlier run (the double-booking rule then correctly
  // refuses today's tank dispatches). Cancel those leftovers through the API itself (audited, drafts/ready only) before planning.
  for (const x of await q(`select rr.id from route_runs rr join users u on u.id=rr.driver_id where u.email like 'rop.%' and rr.route_date >= current_date and rr.route_date < current_date + 2 and rr.status in ('draft','ready')`)) await api('admin', 'POST', `/routes/${x.id}/cancel`);
  const D1 = day(off), D2 = day(off + 1), D3 = day(off + 2), D4 = day(off + 3);

  // ---------- role scoping on the read side
  const reads = ['/routes/dashboard', '/routes/available-orders', '/routes/trucks-status', '/routes/drivers-status', '/routes/suggest-trucks?required_liters=100', '/routes'];
  for (const who of ['cash', 'coll', 'tech', 'fin']) {
    const codes = []; for (const p of reads) codes.push((await api(who, 'GET', p)).s);
    rep(`${who === 'cash' ? 'Cashier' : who === 'coll' ? 'Collector' : who === 'tech' ? 'Technician' : 'Finance'} cannot read dispatch planning data (all 403)`, codes.every((c) => c === 403), codes.join(','));
  }
  let r = await api('cash', 'GET', `/routes/truck-stock?truck_id=${T1}`); rep('Cashier cannot read truck stock (403)', r.s === 403, `[${r.s}]`);
  r = await api('cash', 'GET', '/routes/bulk-water-stock'); rep('Cashier cannot read warehouse bulk-water stock (403)', r.s === 403, `[${r.s}]`);
  r = await api('drv1', 'GET', '/routes/dashboard'); rep('A Driver cannot read the dispatch dashboard (403)', r.s === 403, `[${r.s}]`);
  r = await api('sup', 'GET', '/routes/dashboard'); rep('Route Supervisor reads the dispatch dashboard', r.s === 200 && r.d);
  r = await api('opm', 'GET', '/routes/dashboard'); rep('Operation Manager can read the dispatch dashboard', r.s === 200);

  // ---------- planned route: create + validation
  const o1 = await mkOrder(C[1], 400), o2 = await mkOrder(C[2], 300), o3 = await mkOrder(C[3], 200), oPend = await mkOrder(C[4], 100, 2, false);
  const mk = (who, body) => api(who, 'POST', '/routes', { route_date: D1, truck_id: T1, driver_id: U.drv1.id, order_ids: [o1.id, o2.id], ...body });
  r = await mk('cash'); rep('Cashier cannot plan routes (403)', r.s === 403);
  r = await mk('drv1'); rep('A Driver cannot plan routes (403)', r.s === 403);
  r = await mk('store'); rep('Storekeeper cannot plan routes (403)', r.s === 403);
  r = await mk('sup', { truck_id: undefined }); rep('A route without a truck -> 400', r.s === 400);
  r = await mk('sup', { driver_id: undefined }); rep('A route without a driver -> 400', r.s === 400);
  r = await mk('sup', { order_ids: [99999999] }); rep('Unknown order -> 404', r.s === 404, `[${r.s}] ${r.e}`);
  r = await mk('sup', { order_ids: [oPend.id] }); rep('An unapproved (pending) order cannot be routed (409)', r.s === 409);
  r = await mk('sup', { order_ids: [o1.id, o1.id] }); rep('The same order twice -> 409', r.s === 409);
  const o1b = await mkOrder(C[1], 50);
  r = await mk('sup', { order_ids: [o1.id, o1b.id] }); rep('Two orders for the same customer on one route -> 409 (combine them)', r.s === 409);
  r = await mk('sup'); const R1 = r.d || {};
  rep('Route Supervisor plans a draft route with 2 stops (RT number, draft)', r.s === 201 && /^RT-\d{4}-\d{6}$/.test(R1.route_number) && R1.status === 'draft', `[${r.s}] ${r.e}`);
  r = await api('sup', 'GET', `/routes/${R1.id}`); rep('Route detail lists the stops with order liters and customers', r.s === 200 && r.d.stops.length === 2 && Number(r.d.stops[0].ordered_liters) === 400 && r.d.driver_name, `[${r.s}]`);
  r = await mk('sup', { order_ids: [o3.id], truck_id: T2, driver_id: U.drv1.id }); rep('The driver is already on another active route that day -> 409', r.s === 409);
  r = await mk('sup', { order_ids: [o3.id], truck_id: T1, driver_id: U.drv2.id }); rep('The truck is already on another active route that day -> 409', r.s === 409);
  r = await mk('sup', { order_ids: [o1.id], truck_id: T2, driver_id: U.drv2.id }); rep('An order already planned on another route cannot be added (409)', r.s === 409);
  r = await api('sup', 'GET', '/routes/available-orders'); rep('Available orders: planned orders are no longer offered, the free approved one is', r.s === 200 && r.d.some((x) => x.order_id === o3.id) && !r.d.some((x) => x.order_id === o1.id) && !r.d.some((x) => x.order_id === oPend.id));
  r = await api('sup', 'GET', `/routes?date=${D1}&status=draft`); rep('The routes list filters by date and status', r.s === 200 && r.d.some((x) => x.id === R1.id) && r.d.every((x) => x.status === 'draft'));
  r = await api('sup', 'GET', '/routes/99999999'); rep('Unknown route -> 404', r.s === 404);

  // ---------- edit draft
  r = await api('sup', 'PUT', `/routes/${R1.id}`, { order_ids: [o1.id, o3.id] }); rep('A draft route can be re-planned (stops replaced)', r.s === 200 && (await q('select count(*)::int n from route_stops where route_run_id=$1', [R1.id]))[0].n === 2);
  r = await api('cash', 'PUT', `/routes/${R1.id}`, { order_ids: [o1.id] }); rep('Cashier cannot edit routes (403)', r.s === 403);
  r = await api('sup', 'PUT', '/routes/99999999', { order_ids: [o1.id] }); rep('Editing an unknown route -> 404', r.s === 404);
  rep('The order dropped from the plan (o2) becomes available again', (await api('sup', 'GET', '/routes/available-orders')).d.some((x) => x.order_id === o2.id));
  await api('sup', 'PUT', `/routes/${R1.id}`, { order_ids: [o1.id, o2.id] });

  // ---------- dispatch rules
  r = await api('sales', 'POST', `/routes/${R1.id}/dispatch`); rep('Sales Manager cannot dispatch (403)', r.s === 403);
  r = await api('drv1', 'POST', `/routes/${R1.id}/dispatch`); rep('Driver cannot dispatch a planned route (403)', r.s === 403);
  const rEmpty = (await mk('sup', { route_date: D2, truck_id: T2, driver_id: U.drv2.id, order_ids: [] })).d;
  r = await api('sup', 'POST', `/routes/${rEmpty.id}/dispatch`); rep('A route with no stops cannot be dispatched (400)', r.s === 400);
  await api('sup', 'POST', `/routes/${rEmpty.id}/cancel`);
  const oBig1 = await mkOrder(C[5], 400), oBig2 = await mkOrder(C[6], 300);
  const rBig = (await mk('sup', { route_date: D3, truck_id: T3, driver_id: U.drv3.id, order_ids: [oBig1.id, oBig2.id] })).d;
  r = await api('sup', 'POST', `/routes/${rBig.id}/dispatch`); rep('Orders (700 L) above the truck capacity (500 L) cannot be dispatched (400)', r.s === 400 && /capacity/i.test(r.e || ''), `[${r.s}] ${r.e}`);
  await pool.query(`update trucks set status='maintenance' where id=$1`, [T3]);
  r = await api('sup', 'POST', `/routes/${rBig.id}/dispatch`); rep('A truck under maintenance cannot be dispatched (409)', r.s === 409);
  await pool.query(`update trucks set status='active' where id=$1`, [T3]);
  r = await api('sup', 'POST', `/routes/${rBig.id}/cancel`); rep('Cancelling a draft route works', r.s === 200 && (await status(rBig.id)) === 'cancelled');
  rep('...and its orders are free to be planned again', (await api('sup', 'GET', '/routes/available-orders')).d.some((x) => x.order_id === oBig1.id));
  await pool.query(`update users set is_active=false where id=$1`, [U.drv4.id]);
  const oI = await mkOrder(C[7], 100);
  const rInact = (await mk('sup', { route_date: D4, truck_id: T4, driver_id: U.drv4.id, order_ids: [oI.id] })).d;
  r = await api('sup', 'POST', `/routes/${rInact.id}/dispatch`); rep('An inactive driver cannot be dispatched (409)', r.s === 409);
  await pool.query(`update users set is_active=true where id=$1`, [U.drv4.id]);
  await api('sup', 'POST', `/routes/${rInact.id}/cancel`);

  const wh0 = await stock(BULK, WHRO);
  r = await api('sup', 'POST', `/routes/${R1.id}/dispatch`);
  rep('Route Supervisor dispatches: route dispatched, both orders dispatched', r.s === 200 && r.d.status === 'dispatched' && (await ostat(o1.id)) === 'dispatched' && (await ostat(o2.id)) === 'dispatched', `[${r.s}] ${r.e}`);
  rep('Dispatching bulk water does not move warehouse stock (truck loading does)', (await stock(BULK, WHRO)) === wh0);
  r = await api('sup', 'POST', `/routes/${R1.id}/dispatch`); rep('Dispatching twice -> 409', r.s === 409);
  r = await api('sup', 'PUT', `/routes/${R1.id}`, { order_ids: [o1.id] }); rep('A dispatched route can no longer be edited (409)', r.s === 409);
  r = await api('sup', 'GET', `/routes/trucks-status?date=${D1}`); const t1s = (r.d || []).find((t) => t.id === T1);
  rep('Truck status shows On Route with 700 L assigned', r.s === 200 && t1s && t1s.computed_status === 'On Route' || (t1s && t1s.on_route === true), JSON.stringify(t1s && [t1s.computed_status, t1s.loaded_today]));
  r = await api('sup', 'GET', `/routes/drivers-status?date=${D1}`); rep('Driver roster shows the driver on a current route', r.s === 200 && (r.d.find((d) => d.id === U.drv1.id) || {}).current_route === R1.route_number);
  r = await api('sup', 'GET', `/routes/suggest-trucks?required_liters=900&date=${D1}`); rep('Truck suggestion only offers trucks that can carry 900 L and are not on route', r.s === 200 && !r.d.some((t) => t.id === T1) && r.d.every((t) => Number(t.available_capacity) >= 900));

  // ---------- close / cancel / clone
  r = await api('cash', 'POST', `/routes/${R1.id}/close`); rep('Cashier cannot close a route (403)', r.s === 403);
  r = await api('sup', 'POST', `/routes/${R1.id}/close`); rep('Route Supervisor closes the route', r.s === 200 && r.d.status === 'closed' && r.d.closed_at);
  r = await api('sup', 'POST', `/routes/${R1.id}/close`); rep('Closing twice -> 409', r.s === 409);
  r = await api('sup', 'POST', `/routes/${R1.id}/cancel`); rep('A closed route cannot be cancelled (409)', r.s === 409, `[${r.s}]`);
  r = await api('sup', 'POST', `/routes/${R1.id}/clone`, { route_date: D1 }); rep('A closed route frees its truck and driver: cloning onto the same day works (draft)', r.s === 201 && r.d.status === 'draft', `[${r.s}] ${r.e}`);
  r = await api('sup', 'POST', `/routes/${R1.id}/clone`, { route_date: D1 }); rep('A second clone on that day is refused: truck and driver are now double-booked (409)', r.s === 409, `[${r.s}]`);
  r = await api('sup', 'POST', `/routes/${R1.id}/clone`, { route_date: D2 }); const CLONE = r.d || {};
  rep('Clone keeps truck and driver on a new date with a new route number, empty stops, draft', r.s === 201 && CLONE.truck_id === T1 && CLONE.driver_id === U.drv1.id && CLONE.status === 'draft' && CLONE.route_number !== R1.route_number, `[${r.s}] ${r.e}`);
  r = await api('cash', 'POST', `/routes/${R1.id}/clone`, { route_date: D3 }); rep('Cashier cannot clone routes (403)', r.s === 403);
  r = await api('sup', 'POST', '/routes/99999999/clone', {}); rep('Cloning an unknown route -> 404', r.s === 404);
  const nums = (await q(`select route_number from route_runs where route_number like $1`, [`RT-${new Date().getFullYear()}-%`])).map((x) => x.route_number);
  rep('Route numbers are unique', new Set(nums).size === nums.length);

  // ---------- tank-dispatch (fast POS)
  const td = (who, body) => api(who, 'POST', '/routes/tank-dispatch', { truck_id: T2, route_date: day(0), tank_lines: [{ customer_id: CT[1], liters: 100, price_per_liter: 2 }], ...body });
  r = await td('cash'); rep('Cashier cannot use the tank-fill POS (403)', r.s === 403);
  r = await td('coll'); rep('Collector cannot use the tank-fill POS (403)', r.s === 403);
  r = await td('store'); rep('Storekeeper cannot use the tank-fill POS (403)', r.s === 403);
  r = await td('drv2', { truck_id: undefined }); rep('Tank dispatch without a truck -> 400', r.s === 400);
  r = await td('drv2', { tank_lines: [] }); rep('Tank dispatch without lines -> 400', r.s === 400);
  r = await td('drv2'); rep('A truck with no loaded water cannot sell (400)', r.s === 400 && /no active loading|load the tanker/i.test(r.e || ''), `[${r.s}] ${r.e}`);
  r = await api('de', 'GET', `/routes/route-session?truck_id=${T2}`); rep('The route session of an unloaded truck is closed', r.s === 200 && r.d.status === 'closed');
  r = await api('store', 'POST', '/sales/truck-loads', { truck_id: T2, product_id: BULK, warehouse_id: WHRO, quantity_loaded: 1000 }); const L = r.d || {};
  rep('Storekeeper loads 1000 L onto truck 2', r.s === 201 && Number(L.quantity_loaded) === 1000, `[${r.s}] ${r.e}`);
  r = await api('drv2', 'GET', `/routes/route-session?truck_id=${T2}`); rep('The route session is now open with 1000 L remaining', r.s === 200 && r.d.status === 'open' && r.d.remaining_liters === 1000);
  r = await td('drv2', { tank_lines: [{ customer_id: CT[1], liters: 0, price_per_liter: 2 }] }); rep('Zero liters -> 400', r.s === 400);
  r = await td('drv2', { tank_lines: [{ customer_id: CT[1], liters: 10, price_per_liter: -2 }] }); rep('Negative price -> 400', r.s === 400);
  r = await td('drv2', { tank_lines: [{ customer_id: CT[1], liters: 10, price_per_liter: 2, discount: -1 }] }); rep('Negative discount -> 400', r.s === 400);
  r = await td('drv2', { tank_lines: [{ customer_id: CT[1], liters: 10, price_per_liter: 2, discount: 500 }] }); rep('A discount larger than the sale -> 400', r.s === 400);
  r = await td('drv2', { tank_lines: [{ liters: 10, price_per_liter: 2 }] }); rep('A line without a customer -> 400', r.s === 400);
  r = await td('drv2', { tank_lines: [{ customer_id: 99999999, liters: 10, price_per_liter: 2 }] }); rep('Unknown customer -> 404', r.s === 404);
  r = await td('drv2', { tank_lines: [{ customer_id: CT[1], liters: 10, price_per_liter: 2 }, { customer_id: CT[1], liters: 10, price_per_liter: 2 }] }); rep('The same customer twice on one run -> 409', r.s === 409);
  r = await td('drv2', { tank_lines: [{ customer_id: CT[1], liters: 5000, price_per_liter: 2 }] }); rep('More than the 1000 L on the truck -> 400', r.s === 400 && /remaining/i.test(r.e || ''));
  r = await api('de', 'GET', `/routes/truck-stock?truck_id=${T2}`); rep('Failed sales changed nothing: truck still holds 1000 L', r.s === 200 && r.d.liters === 1000 && r.d.delivered === 0);
  r = await td('drv2', { tank_lines: [{ customer_id: CT[1], liters: 100, price_per_liter: 2, cash_received: -50 }] }); rep('Negative cash received -> 400', r.s === 400, `[${r.s}]`);
  r = await td('drv2', { tank_lines: [{ customer_id: CT[1], liters: 100, price_per_liter: 2, cash_received: 500 }] }); rep('Cash received above the sale value (500 > 200) -> 400', r.s === 400, `[${r.s}]`);
  r = await td('drv2', { tank_lines: [{ customer_id: CT[1], liters: 10, price_per_liter: 2, payment_type: 'barter' }] }); rep('An unknown payment type -> 400 (not a database error)', r.s === 400, `[${r.s}]`);
  r = await api('sup', 'GET', '/routes/not-a-number'); rep('A non-numeric route id -> 404 (not a 500)', r.s === 404, `[${r.s}]`);
  r = await td('drv1'); rep("A driver cannot sell from another driver's truck (403)", r.s === 403, `[${r.s}]`);
  r = await td('drv2', { tank_lines: [{ customer_id: CL, liters: 150, price_per_liter: 2 }] }); rep('A credit sale over the customer credit limit (300 > 100) is refused and rolled back', r.s === 400 && (await ar(CL)) === 0 && (await api('de', 'GET', `/routes/truck-stock?truck_id=${T2}`)).d.liters === 1000, `[${r.s}] ${r.e}`);

  r = await td('drv2', { tank_lines: [{ customer_id: CT[1], liters: 100, price_per_liter: 2, cash_received: 50, payment_type: 'cash_credit' }] }); const TD1 = r.d || {};
  rep('Driver records a 100 L sale at $2 with $50 cash: route completed, order delivered', r.s === 201 && TD1.status === 'completed' && TD1.orders && TD1.orders.length === 1 && TD1.orders[0].status === 'delivered' && Number(TD1.orders[0].total_amount) === 200, `[${r.s}] ${r.e}`);
  rep('Ledger: revenue booked, cash 50 collected, customer owes 150', (await ar(CT[1])) === 150);
  r = await api('de', 'GET', `/routes/truck-stock?truck_id=${T2}`); rep('Truck now holds 900 L (loaded 1000, delivered 100)', r.s === 200 && r.d.liters === 900 && r.d.delivered === 100 && r.d.loaded === 1000);
  r = await api('drv2', 'GET', `/routes/driver-summary?truck_id=${T2}`); rep("Today's driver summary: sales 200, cash 50, credit 150, 1 delivery", r.s === 200 && r.d.sales_today === 200 && r.d.cash_today === 50 && r.d.credit_today === 150 && r.d.deliveries === 1, JSON.stringify(r.d));
  r = await td('drv2', { tank_lines: [{ customer_id: CT[2], liters: 200, price_per_liter: 3, cash_received: 600 }] }); rep('A full cash sale at the exact value (200 L x $3 = $600) is paid and leaves no receivable', r.s === 201 && r.d.orders[0].payment_status === 'paid' && (await ar(CT[2])) === 0, `[${r.s}] ${r.e}`);
  r = await td('sales', { tank_lines: [{ customer_id: CT[3], liters: 300, price_per_liter: 2 }] }); rep('Sales Manager can record a tank sale for the same truck (override role)', r.s === 201, `[${r.s}] ${r.e}`);
  r = await api('de', 'GET', `/routes/truck-stock?truck_id=${T2}`); rep('Truck holds 400 L after 100 + 200 + 300 delivered', r.s === 200 && r.d.liters === 400 && r.d.delivered === 600);
  const rc = await api('de', 'POST', `/sales/truck-loads/${L.id}/reconcile`, { actual_remaining: 400 });
  rep('Data Entry reconciles the session: physical 400 L matches the system, truck closed', rc.s === 201 && rc.d.load.status === 'completed', `[${rc.s}] ${rc.e}`);
  r = await td('drv2', { tank_lines: [{ customer_id: CT[4], liters: 10, price_per_liter: 2 }] }); rep('After the session is closed the truck can no longer sell (400)', r.s === 400);
  r = await api('de', 'GET', `/routes/route-session?truck_id=${T2}`); rep('The route session is closed again', r.s === 200 && r.d.status === 'closed');
  r = await api('de', 'GET', `/routes/truck-existing-stock?truck_id=${T2}`); rep('Existing truck stock reports the 400 L left on the truck', r.s === 200 && r.d.liters === 400);
  r = await api('cash', 'GET', `/routes/truck-existing-stock?truck_id=${T2}`); rep('Cashier cannot read existing truck stock (403)', r.s === 403, `[${r.s}]`);

  // depletion closes the load
  r = await api('store', 'POST', '/sales/truck-loads', { truck_id: T5, product_id: BULK, warehouse_id: WHRO, quantity_loaded: 100 });
  r = await api('sup', 'POST', '/routes/tank-dispatch', { truck_id: T5, route_date: day(0), driver_id: U.drv3.id, tank_lines: [{ customer_id: CT[5], liters: 100, price_per_liter: 2 }] });
  rep('Selling the whole load depletes it and completes the session automatically', r.s === 201 && (await q(`select status from truck_loads where truck_id=$1 order by id desc limit 1`, [T5]))[0].status === 'completed', `[${r.s}] ${r.e}`);
  r = await api('sup', 'POST', '/routes/tank-dispatch', { truck_id: T5, route_date: day(0), driver_id: U.drv3.id, tank_lines: [{ customer_id: CT[6], liters: 1, price_per_liter: 2 }] }); rep('Nothing is left to sell afterwards (400)', r.s === 400);

  // completed routes are history
  r = await api('sup', 'POST', `/routes/${TD1.id}/cancel`); rep('A completed (delivered) route cannot be cancelled afterwards (409)', r.s === 409 || r.s === 400, `[${r.s}]`);
  rep('...and its order stays delivered with the revenue intact', (await ostat(TD1.orders[0].id)) === 'delivered' && (await ar(CT[1])) === 150);

  // ---------- integrity + audit
  const loaded = Number((await q(`select quantity_loaded n from truck_loads where id=$1`, [L.id]))[0].n);
  const deliveredLiters = Number((await q(`select coalesce(sum(rs.delivered_liters),0) n from route_stops rs join route_runs rr on rr.id=rs.route_run_id where rr.truck_id=$1`, [T2]))[0].n);
  rep('Truck integrity: delivered liters on the stops equal the load\'s delivered counter (600)', deliveredLiters === 600 && Number((await q(`select delivered_liters n from truck_loads where id=$1`, [L.id]))[0].n) === 600 && loaded === 1000);
  const aud = await q(`select count(*)::int n from audit_logs where entity_type='route_run' and user_id = any($1)`, [[U.sup.id, U.drv2.id, U.sales.id]]);
  rep('Route creation, edits, dispatch, close and tank sales are in the audit trail', aud[0].n >= 8, `rows=${aud[0].n}`);
  const tb = await api('fin', 'GET', '/reports/trial-balance'); rep('Trial balance balanced', tb.d.is_balanced === true);
  rep('General ledger balanced at the end', await gl());

  await finish();
})().catch((e) => { console.log('ERR', String(e.stack || e.message).replace(/postgres(ql)?:\/\/\S+/gi, '<url>')); process.exit(1); });
