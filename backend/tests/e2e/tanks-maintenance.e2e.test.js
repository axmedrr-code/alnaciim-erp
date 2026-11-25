// Customer tanks, machine maintenance and the audit trail E2E: tank registry rules, tank levels from deliveries, maintenance
// schedules/logs with spare-part consumption (stock ledger), cross-record checks, role scoping, and an append-only audit log.
const { start } = require('./harness');

(async () => {
  const { api, q, pool, U, rep, finish, gl, stock } = await start('tm', [
    ['sales', 'Sales Manager'], ['fin', 'Finance Officer'], ['rsup', 'Route Supervisor'], ['tech', 'Technician'], ['pm', 'Production Manager'],
    ['cash', 'Cashier'], ['store', 'Storekeeper'], ['drv', 'Driver'], ['opm', 'Operation Manager']
  ]);
  const stamp = Date.now();
  const sfx = String(stamp).slice(-8);
  await pool.query('update trucks set assigned_driver_id = NULL where assigned_driver_id = $1', [U.drv.id]);
  const mkCust = async (n, status = 'active') => (await q(`insert into customers (code, name, type, status) values ($1,$2,'tanker',$3) returning id`, [`TM${n}-${sfx}`, `E2E Tank Customer ${n}`, status]))[0].id;
  const C1 = await mkCust(1), CC = await mkCust(2, 'closed');

  // ---------- tanks: access + validation
  const tb = (n, over = {}) => ({ tank_code: `TK${n}-${sfx}`, tank_name: `E2E Tank ${n}`, customer_id: C1, tank_type: 'tank', capacity_liters: 1000, barcode: `BC${n}-${sfx}`, location: 'Hodan', ...over });
  let r = await api('cash', 'POST', '/tanks', tb(0)); rep('Cashier cannot register tanks (403)', r.s === 403);
  r = await api('fin', 'POST', '/tanks', tb(0)); rep('Finance reads but cannot register tanks (403)', r.s === 403);
  r = await api('rsup', 'POST', '/tanks', tb(0)); rep('Route Supervisor reads but cannot register tanks (403)', r.s === 403);
  r = await api('sales', 'POST', '/tanks', { ...tb(1), tank_code: '' }); rep('Empty tank code -> 400', r.s === 400);
  r = await api('sales', 'POST', '/tanks', { ...tb(1), tank_type: 'swimming_pool' }); rep('Invalid tank type -> 400', r.s === 400);
  r = await api('sales', 'POST', '/tanks', { ...tb(1), capacity_liters: 0 }); rep('Zero capacity -> 400', r.s === 400);
  r = await api('sales', 'POST', '/tanks', { ...tb(1), capacity_liters: -50 }); rep('Negative capacity -> 400', r.s === 400);
  r = await api('sales', 'POST', '/tanks', { ...tb(1), customer_id: 99999999 }); rep('Unknown customer -> 404', r.s === 404, `[${r.s}]`);
  r = await api('sales', 'POST', '/tanks', { ...tb(1), customer_id: CC }); rep('A closed customer account cannot receive a tank (409)', r.s === 409, `[${r.s}] ${r.e}`);
  r = await api('sales', 'POST', '/tanks', tb(1)); const K1 = r.d || {}; rep('Sales Manager registers a tank', r.s === 201 && K1.id > 0 && Number(K1.capacity_liters) === 1000, `[${r.s}] ${r.e}`);
  r = await api('sales', 'POST', '/tanks', tb(1, { barcode: `BCX-${sfx}` })); rep('Duplicate tank code -> 409', r.s === 409);
  r = await api('sales', 'POST', '/tanks', tb(2, { barcode: K1.barcode })); rep('Duplicate barcode -> 409', r.s === 409);
  const K2 = (await api('sales', 'POST', '/tanks', tb(3, { tank_type: 'drum', capacity_liters: 200 }))).d;

  // ---------- tanks: reads and update
  r = await api('cash', 'GET', '/tanks'); rep('Cashier cannot list tanks (403)', r.s === 403);
  r = await api('drv', 'GET', `/tanks/${K1.id}`); rep('Driver cannot read a tank record (403)', r.s === 403);
  r = await api('rsup', 'GET', `/tanks?customer_id=${C1}`); rep('Route Supervisor lists a customer\'s tanks', r.s === 200 && r.d.length === 2 && r.d.every((t) => t.customer_id === C1 && 'bulk_water_price_per_liter' in t));
  r = await api('fin', 'GET', `/tanks?search=${K1.barcode}`); rep('Search by barcode', r.s === 200 && r.d.length === 1 && r.d[0].id === K1.id);
  r = await api('rsup', 'GET', '/tanks/abc'); rep('A non-numeric tank id -> 404 (not a 500)', r.s === 404, `[${r.s}]`);
  r = await api('rsup', 'GET', '/tanks/99999999'); rep('Unknown tank -> 404', r.s === 404);
  r = await api('sales', 'PUT', `/tanks/${K1.id}`, {}); rep('An empty tank update -> 400', r.s === 400);
  r = await api('sales', 'PUT', `/tanks/${K1.id}`, { status: 'broken' }); rep('Unknown tank status -> 400', r.s === 400);
  r = await api('sales', 'PUT', `/tanks/${K1.id}`, { tank_code: K2.tank_code }); rep('Changing to an existing tank code -> 409', r.s === 409);
  r = await api('sales', 'PUT', `/tanks/${K1.id}`, { capacity_liters: 1500, location: 'Wadajir' }); rep('Capacity and location can be updated', r.s === 200 && Number(r.d.capacity_liters) === 1500);
  r = await api('cash', 'PUT', `/tanks/${K1.id}`, { capacity_liters: 1 }); rep('Cashier cannot edit tanks (403)', r.s === 403);
  r = await api('sales', 'PUT', '/tanks/99999999', { location: 'x' }); rep('Editing an unknown tank -> 404', r.s === 404);
  const audK = await q(`select old_value->>'capacity_liters' o, new_value->>'capacity_liters' n from audit_logs where entity_type='customer_tank' and entity_id=$1 and action='UPDATE' order by id desc limit 1`, [K1.id]);
  rep('The capacity change is audited (1000 -> 1500)', audK[0] && Number(audK[0].o) === 1000 && Number(audK[0].n) === 1500);
  await api('sales', 'PUT', `/tanks/${K1.id}`, { capacity_liters: 1000 });

  // ---------- tank maintenance + history
  r = await api('cash', 'POST', `/tanks/${K1.id}/maintenance`, { description: 'x' }); rep('Cashier cannot log tank maintenance (403)', r.s === 403);
  r = await api('tech', 'POST', `/tanks/${K1.id}/maintenance`, { description: 'Replaced float valve', cost: -5 }); rep('Negative maintenance cost -> 400', r.s === 400);
  r = await api('tech', 'POST', '/tanks/99999999/maintenance', { description: 'ghost' }); rep('Maintenance on an unknown tank -> 404', r.s === 404, `[${r.s}]`);
  r = await api('tech', 'POST', `/tanks/${K1.id}/maintenance`, { description: 'Replaced float valve', cost: 12.5, log_date: '2026-01-10' }); rep('Technician logs tank maintenance with cost', r.s === 201 && Number(r.d.cost) === 12.5 && r.d.performed_by === U.tech.id, `[${r.s}] ${r.e}`);
  r = await api('sales', 'POST', `/tanks/${K1.id}/maintenance`, { description: 'Cleaning', log_date: '2026-02-01' }); rep('Sales Manager can log maintenance too (cost defaults to 0)', r.s === 201 && Number(r.d.cost) === 0);
  r = await api('rsup', 'GET', `/tanks/${K1.id}/history`); rep('Tank history merges events, newest first', r.s === 200 && r.d.history.length >= 2 && r.d.history[0].event_type === 'maintenance' && new Date(r.d.history[0].event_date) >= new Date(r.d.history[1].event_date), `[${r.s}]`);
  r = await api('drv', 'GET', `/tanks/${K1.id}/history`); rep('A Driver cannot read tank history (403)', r.s === 403);

  // ---------- tank level from a delivery (field POS) and capacity enforcement
  const BULK = (await q(`select p.id from products p join categories c on c.id=p.category_id where c.name='Bulk Water' order by p.id limit 1`))[0].id;
  const WHRO = (await q(`select id from warehouses where code='WH-RO-01'`))[0].id;
  const truck = (await q(`insert into trucks (plate_number, truck_code, capacity, assigned_driver_id) values ($1,$2,5000,$3) returning id`, [`TMT-${sfx}`, `TT${sfx}`, U.drv.id]))[0].id;
  await api('admin', 'POST', '/inventory/movements', { product_id: BULK, warehouse_id: WHRO, movement_type: 'IN', quantity: 3000, reference_type: 'adjustment' });
  await api('store', 'POST', '/sales/truck-loads', { truck_id: truck, product_id: BULK, warehouse_id: WHRO, quantity_loaded: 2500 });
  const fill = (tank, liters) => api('drv', 'POST', '/routes/tank-dispatch', { truck_id: truck, route_date: new Date().toISOString().slice(0, 10), tank_lines: [{ customer_tank_id: tank, liters, price_per_liter: 1 }] });
  r = await fill(K1.id, 1500); rep('A delivery above the tank capacity (1500 L into a 1000 L tank) is refused (400)', r.s === 400 && /capacity/i.test(r.e || ''), `[${r.s}] ${r.e}`);
  r = await fill(K1.id, 400); rep('A 400 L delivery into the tank succeeds', r.s === 201, `[${r.s}] ${r.e}`);
  rep('The tank\'s last known level is updated to 400 L', Number((await q('select last_known_level_liters n from customer_tanks where id=$1', [K1.id]))[0].n) === 400);
  r = await fill(K1.id, 900); rep('A second delivery tops the tank up but never above capacity (level capped at 1000)', r.s === 201 && Number((await q('select last_known_level_liters n from customer_tanks where id=$1', [K1.id]))[0].n) === 1000, `[${r.s}] ${r.e}`);
  r = await api('rsup', 'GET', `/tanks/${K1.id}/history`); rep('The history now also lists the two refills made through the field POS', r.s === 200 && r.d.history.filter((h) => h.event_type === 'refill').length === 2, `[${r.s}] ${JSON.stringify(r.d && r.d.history.map((h) => h.event_type))}`);

  // ---------- machines + maintenance schedules
  const M = (await api('pm', 'POST', '/production/machines', { code: `TM-M-${sfx}`, name: 'E2E Maintenance Machine', type: 'FILLING_LINE' })).d;
  const M2 = (await api('pm', 'POST', '/production/machines', { code: `TM-N-${sfx}`, name: 'E2E Other Machine', type: 'FILLING_LINE' })).d;
  r = await api('cash', 'GET', '/maintenance/schedules'); rep('Cashier cannot read maintenance schedules (403)', r.s === 403);
  r = await api('fin', 'GET', '/maintenance/schedules'); rep('Finance cannot read maintenance schedules (403)', r.s === 403);
  r = await api('opm', 'GET', '/maintenance/logs'); rep('Operation Manager has no access to maintenance logs (403)', r.s === 403);
  r = await api('cash', 'POST', '/maintenance/schedules', { machine_id: M.id, maintenance_type: 'preventive' }); rep('Cashier cannot create schedules (403)', r.s === 403);
  r = await api('pm', 'POST', '/maintenance/schedules', { machine_id: M.id, maintenance_type: 'weekly' }); rep('Invalid maintenance type -> 400', r.s === 400);
  r = await api('pm', 'POST', '/maintenance/schedules', { machine_id: M.id, maintenance_type: 'preventive', frequency_days: 0 }); rep('Zero frequency -> 400', r.s === 400);
  r = await api('pm', 'POST', '/maintenance/schedules', { machine_id: M.id, maintenance_type: 'preventive', frequency_days: -7 }); rep('Negative frequency -> 400', r.s === 400);
  r = await api('pm', 'POST', '/maintenance/schedules', { machine_id: 99999999, maintenance_type: 'preventive' }); rep('Unknown machine -> 404', r.s === 404, `[${r.s}]`);
  await pool.query('update users set is_active=false where id=$1', [U.tech.id]);
  r = await api('pm', 'POST', '/maintenance/schedules', { machine_id: M.id, maintenance_type: 'preventive', assigned_to: U.tech.id }); rep('An inactive technician cannot be assigned (400)', r.s === 400, `[${r.s}]`);
  await pool.query('update users set is_active=true where id=$1', [U.tech.id]);
  const soon = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10), later = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);
  r = await api('pm', 'POST', '/maintenance/schedules', { machine_id: M.id, maintenance_type: 'preventive', frequency_days: 14, next_due_date: soon, assigned_to: U.tech.id, description: 'Lubrication' }); const SC1 = r.d || {}; rep('Production Manager schedules preventive maintenance every 14 days', r.s === 201 && SC1.id > 0, `[${r.s}] ${r.e}`);
  const SC2 = (await api('tech', 'POST', '/maintenance/schedules', { machine_id: M2.id, maintenance_type: 'preventive', frequency_days: 30, next_due_date: later })).d;
  r = await api('tech', 'GET', `/maintenance/schedules?machine_id=${M.id}`); rep('Technician reads schedules filtered by machine', r.s === 200 && r.d.length === 1 && r.d[0].machine_name);
  r = await api('tech', 'GET', '/maintenance/schedules?due_within=7'); rep('"Due within 7 days" lists the near schedule and not the 60-day one', r.s === 200 && r.d.some((x) => x.id === SC1.id) && !r.d.some((x) => x.id === SC2.id), `[${r.s}] ${r.e} n=${(r.d || []).length} ids=${JSON.stringify((r.d || []).slice(0, 4).map((x) => [x.id, x.next_due_date]))} want=${SC1.id}/${soon}`);
  r = await api('tech', 'GET', '/maintenance/schedules?due_within=abc'); rep('A non-numeric due_within -> 400 (not a 500)', r.s === 400, `[${r.s}]`);
  r = await api('tech', 'GET', '/maintenance/logs?machine_id=abc'); rep('A non-numeric machine filter -> 400', r.s === 400, `[${r.s}]`);

  // ---------- maintenance logs: spare parts consume stock
  const cat = (await q(`select id from categories order by id limit 1`))[0].id;
  const part = (await q(`insert into products (sku, name, category_id, product_type, unit) values ($1,$2,$3,'spare_part','pcs') returning id`, [`TMP-${sfx}`, `E2E Spare ${sfx}`, cat]))[0].id;
  const sw = (await q(`insert into warehouses (code, name, type) values ('TST-TM-W','E2E Spare Store','spare_parts') on conflict (code) do update set is_active=true returning id`))[0].id;
  await api('admin', 'POST', '/inventory/movements', { product_id: part, warehouse_id: sw, movement_type: 'IN', quantity: 10, reference_type: 'purchase' });
  const log = (who, body) => api(who, 'POST', '/maintenance/logs', { machine_id: M.id, type: 'preventive', description: 'Service', ...body });
  r = await log('cash'); rep('Cashier cannot log maintenance (403)', r.s === 403);
  r = await log('tech', { type: 'overhaul' }); rep('Invalid log type -> 400', r.s === 400);
  r = await log('tech', { cost: -10 }); rep('Negative cost -> 400', r.s === 400);
  r = await log('tech', { machine_id: 99999999 }); rep('Unknown machine -> 404', r.s === 404, `[${r.s}]`);
  r = await log('tech', { schedule_id: 99999999 }); rep('Unknown schedule -> 404', r.s === 404, `[${r.s}]`);
  r = await log('tech', { schedule_id: SC2.id }); rep("A schedule that belongs to another machine is refused (400)", r.s === 400, `[${r.s}] ${r.e}`);
  r = await log('tech', { parts_used: [{ product_id: part, quantity: 0, warehouse_id: sw }] }); rep('A part with zero quantity -> 400', r.s === 400);
  const nLogs0 = Number((await q('select count(*)::int n from maintenance_logs where machine_id=$1', [M.id]))[0].n);
  r = await log('tech', { cost: 25, parts_used: [{ product_id: part, quantity: 50, warehouse_id: sw }] });
  rep('Using more spare parts than in stock is refused and the whole log rolls back', r.s === 400 && (await stock(part, sw)) === 10 && Number((await q('select count(*)::int n from maintenance_logs where machine_id=$1', [M.id]))[0].n) === nLogs0, `[${r.s}] ${r.e}`);
  r = await log('tech', { schedule_id: SC1.id, cost: 40, description: 'Lubricated bearings', parts_used: [{ product_id: part, quantity: 4, warehouse_id: sw }] }); const L1 = r.d || {};
  rep('Technician logs completed maintenance with 4 spare parts: status completed, default maintenance cost centre', r.s === 201 && L1.status === 'completed' && L1.cost_center_id > 0 && Number(L1.cost) === 40, `[${r.s}] ${r.e}`);
  rep('The 4 parts left the spare-parts store (10 -> 6) with a maintenance ledger entry', (await stock(part, sw)) === 6 && (await q(`select count(*)::int n from stock_movements where reference_type='maintenance' and reference_id=$1 and movement_type='OUT'`, [L1.id]))[0].n === 1);
  const sch = (await q('select last_done_date::text ld, next_due_date::text nd from maintenance_schedules where id=$1', [SC1.id]))[0];
  const todayStr = new Date().toISOString().slice(0, 10), due14 = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
  rep('Completing the log resets the schedule: last done today, next due in 14 days', Math.abs(new Date(sch.ld) - new Date(todayStr)) <= 86400000, `${sch.ld} ${sch.nd}`);
  rep('...next due date = today + 14 days (within one day of timezone)', Math.abs(new Date(sch.nd) - new Date(due14)) <= 86400000, `${sch.nd} vs ${due14}`);
  const dt = (await api('tech', 'POST', `/production/machines/${M.id}/downtime`, { start_time: new Date().toISOString(), category: 'breakdown', reason: 'Seal leak' })).d;
  const dtOther = (await api('tech', 'POST', `/production/machines/${M2.id}/downtime`, { start_time: new Date().toISOString(), category: 'breakdown' })).d;
  r = await log('tech', { type: 'breakdown_repair', downtime_id: dtOther.id }); rep("Another machine's downtime cannot be linked (400)", r.s === 400, `[${r.s}]`);
  r = await log('tech', { type: 'breakdown_repair', downtime_id: dt.id, cost: 15 }); rep('A repair log can be linked to the machine\'s own downtime', r.s === 201, `[${r.s}] ${r.e}`);
  const inactiveCC = (await q(`insert into cost_centers (code, name, type, is_active) values ($1,'E2E inactive CC','maintenance', false) returning id`, [`TMCC-${sfx}`]))[0].id;
  r = await log('tech', { cost_center_id: inactiveCC }); rep('A deactivated cost centre cannot receive maintenance cost (409)', r.s === 409, `[${r.s}]`);
  r = await api('pm', 'GET', `/maintenance/logs?machine_id=${M.id}`); rep('Logs list shows machine and technician names, newest first', r.s === 200 && r.d.length >= 2 && r.d.every((x) => x.machine_name && x.performed_by_name));
  r = await api('fin', 'GET', `/production/machines/${M.id}/profitability`); rep('Machine profitability counts the maintenance spend (40 + 15 = 55)', r.s === 200 && Number(r.d.maintenance_costs) === 55, `maintenance=${r.d && r.d.maintenance_costs}`);
  const sl = Number((await q('select coalesce(sum(quantity),0) n from stock_levels where product_id=$1', [part]))[0].n), sm = Number((await q('select coalesce(sum(signed_quantity),0) n from stock_movements where product_id=$1', [part]))[0].n);
  rep('Inventory integrity: spare-part stock equals its signed movement ledger', Math.abs(sl - sm) < 0.0005, `levels=${sl} ledger=${sm}`);
  const audM = await q(`select count(*)::int n from audit_logs where entity_type in ('maintenance_log','maintenance_schedule') and user_id = any($1)`, [[U.tech.id, U.pm.id]]); rep('Schedules and maintenance logs are audited', audM[0].n >= 4, `rows=${audM[0].n}`);

  // ---------- audit trail
  r = await api('fin', 'GET', '/audit-logs'); rep('Finance cannot read the audit trail (403)', r.s === 403);
  r = await api('sales', 'GET', '/audit-logs'); rep('Sales Manager cannot read the audit trail (403)', r.s === 403);
  r = await api('admin', 'GET', `/audit-logs?entity_type=maintenance_log&entity_id=${L1.id}`); rep('Admin reads the audit trail, filtered by record', r.s === 200 && r.d.length >= 1 && r.d.every((a) => a.entity_type === 'maintenance_log' && a.entity_id === L1.id) && r.d[0].user_name);
  r = await api('admin', 'GET', `/audit-logs?user_id=${U.tech.id}&action=CREATE`); rep('Filter by user and action', r.s === 200 && r.d.length > 0 && r.d.every((a) => a.user_id === U.tech.id && a.action === 'CREATE'));
  r = await api('admin', 'GET', '/audit-logs'); rep('Newest entries first and capped at 300', r.s === 200 && r.d.length <= 300 && new Date(r.d[0].created_at) >= new Date(r.d[r.d.length - 1].created_at));
  r = await api('admin', 'GET', '/audit-logs?user_id=abc'); rep('A non-numeric user id -> 400 (not a 500)', r.s === 400, `[${r.s}]`);
  let blocked = ''; try { await pool.query(`update audit_logs set action='TAMPERED' where id = (select max(id) from audit_logs)`); } catch (e) { blocked = e.message; }
  rep('An audit record cannot be altered, even directly in the database (append-only)', /append-only/.test(blocked), blocked);
  blocked = ''; try { await pool.query(`delete from audit_logs where id = (select max(id) from audit_logs)`); } catch (e) { blocked = e.message; }
  rep('An audit record cannot be deleted, even directly in the database', /append-only/.test(blocked), blocked);

  rep('General ledger balanced at the end', await gl());
  await finish();
})().catch((e) => { console.log('ERR', String(e.stack || e.message).replace(/postgres(ql)?:\/\/\S+/gi, '<url>')); process.exit(1); });
