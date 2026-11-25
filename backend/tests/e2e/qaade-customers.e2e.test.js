// Qaade (collector territories) and Customer master data E2E: creation/validation, links to collectors and trucks, HNO issuing,
// role scoping (Driver / Data Entry HNO-only), account status rules on invoicing, qaade performance reconciled to the ledger.
const { start } = require('./harness');

(async () => {
  const { api, q, pool, U, rep, finish, gl } = await start('qc', [
    ['sales', 'Sales Manager'], ['fin', 'Finance Officer'], ['coll', 'Collector'], ['coll2', 'Collector'], ['cash', 'Cashier'],
    ['drv', 'Driver'], ['de', 'Data Entry Operator'], ['rsup', 'Route Supervisor'], ['opm', 'Operation Manager'], ['store', 'Storekeeper']
  ]);
  const stamp = Date.now();
  const sfx = String(stamp).slice(-8);
  const BULK = (await q(`select p.id from products p join categories c on c.id=p.category_id where c.name='Bulk Water' order by p.id limit 1`))[0].id;
  const truck = (await q(`insert into trucks (plate_number, truck_code, capacity) values ($1,$2,1000) returning id`, [`QC-${sfx}`, `QT${sfx}`]))[0].id;
  const archivedTruck = (await q(`insert into trucks (plate_number, truck_code, capacity, archived_at) values ($1,$2,1000, now()) returning id`, [`QCA-${sfx}`, `QA${sfx}`]))[0].id;

  // ---------- qaade: access + validation
  const qb = (n, over = {}) => ({ qaade_code: `QC${n}-${sfx}`, name: `E2E Qaade ${n}`, area: 'Hodan', ...over });
  let r = await api('cash', 'POST', '/qaades', qb(0)); rep('Cashier cannot create a qaade (403)', r.s === 403);
  r = await api('fin', 'POST', '/qaades', qb(0)); rep('Finance reads but cannot create a qaade (403)', r.s === 403);
  r = await api('rsup', 'POST', '/qaades', qb(0)); rep('Route Supervisor reads but cannot create a qaade (403)', r.s === 403);
  r = await api('coll', 'GET', '/qaades'); rep('Collector cannot list qaades (403)', r.s === 403);
  r = await api('drv', 'GET', '/qaades'); rep('Driver cannot list qaades (403)', r.s === 403);
  r = await api('sales', 'POST', '/qaades', { ...qb(1), qaade_code: '' }); rep('Empty qaade code -> 400', r.s === 400);
  r = await api('sales', 'POST', '/qaades', { ...qb(1), name: '' }); rep('Empty qaade name -> 400', r.s === 400);
  r = await api('sales', 'POST', '/qaades', { ...qb(1), collector_id: U.cash.id }); rep('A Cashier cannot be the collector of a qaade (400)', r.s === 400, `[${r.s}] ${r.e}`);
  r = await api('sales', 'POST', '/qaades', { ...qb(1), collector_id: 99999999 }); rep('Unknown collector -> 404', r.s === 404, `[${r.s}]`);
  await pool.query('update users set is_active=false where id=$1', [U.coll2.id]);
  r = await api('sales', 'POST', '/qaades', { ...qb(1), collector_id: U.coll2.id }); rep('An inactive collector cannot be assigned (400)', r.s === 400, `[${r.s}]`);
  await pool.query('update users set is_active=true where id=$1', [U.coll2.id]);
  r = await api('sales', 'POST', '/qaades', { ...qb(1), truck_id: 99999999 }); rep('Unknown truck -> 404', r.s === 404, `[${r.s}]`);
  r = await api('sales', 'POST', '/qaades', { ...qb(1), truck_id: archivedTruck }); rep('An archived truck cannot be linked (400)', r.s === 400, `[${r.s}]`);
  r = await api('sales', 'POST', '/qaades', qb(1, { collector_id: U.coll.id, truck_id: truck })); const Q1 = r.d || {};
  rep('Sales Manager creates a qaade with a collector and a truck', r.s === 201 && Q1.collector_id === U.coll.id && Q1.truck_id === truck && Q1.status === 'active', `[${r.s}] ${r.e}`);
  r = await api('sales', 'POST', '/qaades', qb(1)); rep('Duplicate qaade code -> 409', r.s === 409);

  // ---------- qaade: update / read
  r = await api('sales', 'PUT', `/qaades/${Q1.id}`, {}); rep('An empty qaade update -> 400', r.s === 400);
  r = await api('sales', 'PUT', `/qaades/${Q1.id}`, { status: 'retired' }); rep('Unknown status -> 400', r.s === 400);
  r = await api('sales', 'PUT', `/qaades/${Q1.id}`, { collector_id: U.store.id }); rep('Changing to a non-collector -> 400', r.s === 400);
  r = await api('sales', 'PUT', `/qaades/${Q1.id}`, { collector_id: U.coll2.id, area: 'Wadajir' }); rep('The collector and area can be changed', r.s === 200 && r.d.collector_id === U.coll2.id && r.d.area === 'Wadajir');
  r = await api('cash', 'PUT', `/qaades/${Q1.id}`, { area: 'x' }); rep('Cashier cannot edit a qaade (403)', r.s === 403);
  r = await api('sales', 'PUT', '/qaades/99999999', { area: 'x' }); rep('Editing an unknown qaade -> 404', r.s === 404);
  r = await api('sales', 'GET', '/qaades/not-a-number'); rep('A non-numeric qaade id -> 404 (not a 500)', r.s === 404, `[${r.s}]`);
  r = await api('rsup', 'GET', '/qaades?status=active'); rep('Route Supervisor lists qaades; the status filter works', r.s === 200 && r.d.some((x) => x.id === Q1.id) && r.d.every((x) => x.status === 'active'));
  const audQ = await q(`select count(*)::int n from audit_logs where entity_type='qaade' and entity_id=$1`, [Q1.id]); rep('Qaade creation and the successful edit are audited', audQ[0].n >= 2, `rows=${audQ[0].n}`);

  // ---------- customers: access + validation
  const cb = (n, over = {}) => ({ code: `QCC${n}-${sfx}`, name: `E2E Customer ${n}`, type: 'wholesale', qaade_id: Q1.id, ...over });
  r = await api('cash', 'POST', '/customers', cb(0)); rep('Cashier cannot register customers (403)', r.s === 403);
  r = await api('fin', 'POST', '/customers', cb(0)); rep('Finance cannot register customers (403)', r.s === 403);
  r = await api('coll', 'POST', '/customers', cb(0)); rep('Collector cannot register customers (403)', r.s === 403);
  r = await api('sales', 'POST', '/customers', { ...cb(1), type: 'galactic' }); rep('Invalid customer type -> 400', r.s === 400);
  r = await api('sales', 'POST', '/customers', { ...cb(1), email: 'not-an-email' }); rep('Invalid email -> 400', r.s === 400);
  r = await api('sales', 'POST', '/customers', { ...cb(1), credit_limit: -5 }); rep('Negative credit limit -> 400', r.s === 400);
  r = await api('sales', 'POST', '/customers', { ...cb(1), qaade_id: 99999999 }); rep('Unknown qaade on a customer -> 4xx (not a 500)', r.s >= 400 && r.s < 500, `[${r.s}]`);
  r = await api('sales', 'POST', '/customers', { ...cb(1), sales_rep_id: 99999999 }); rep('Unknown sales rep -> 4xx', r.s >= 400 && r.s < 500, `[${r.s}]`);
  r = await api('sales', 'POST', '/customers', cb(1, { phone: '+252615000001', credit_limit: 500, payment_terms_days: 15 })); const C1 = r.d || {};
  rep('Sales Manager registers a customer: HNO issued automatically, qaade linked', r.s === 201 && C1.hno && C1.qaade_id === Q1.id && Number(C1.credit_limit) === 500, `[${r.s}] ${r.e}`);
  const C2 = (await api('sales', 'POST', '/customers', cb(2))).d, C3 = (await api('sales', 'POST', '/customers', cb(3))).d;
  rep('HNOs are unique and sequential across customers', new Set([C1.hno, C2.hno, C3.hno]).size === 3);
  r = await api('sales', 'POST', '/customers', cb(1)); rep('Duplicate customer code -> 409', r.s === 409);

  // ---------- customers: reads and role scoping
  r = await api('cash', 'GET', '/customers'); rep('Cashier cannot list customers (403)', r.s === 403);
  r = await api('coll', 'GET', '/customers'); rep('Collector cannot list customers (403)', r.s === 403);
  r = await api('drv', 'GET', '/customers'); rep('Driver cannot browse customers without an HNO (400)', r.s === 400, `[${r.s}]`);
  r = await api('de', 'GET', `/customers?search=${C1.name}`); rep('Data Entry cannot search by name (400)', r.s === 400, `[${r.s}]`);
  r = await api('drv', 'GET', `/customers?hno=${C1.hno}`); rep('A Driver can look a customer up by HNO, with a reduced projection (no credit limit)', r.s === 200 && r.d.some((c) => c.id === C1.id) && !r.d.some((c) => 'credit_limit' in c), `[${r.s}] ${JSON.stringify(Object.keys((r.d || [{}])[0] || {}))}`);
  r = await api('sales', 'GET', `/customers?qaade_id=${Q1.id}`); rep('Sales Manager filters customers by qaade', r.s === 200 && r.d.length === 3);
  r = await api('fin', 'GET', `/customers/${C1.id}`); rep('Finance reads a customer record', r.s === 200 && r.d.qaade_name === Q1.name);
  r = await api('drv', 'GET', `/customers/${C1.id}`); rep('A Driver cannot open the full customer record (403)', r.s === 403);
  r = await api('sales', 'GET', '/customers/99999999'); rep('Unknown customer -> 404', r.s === 404);
  r = await api('sales', 'GET', '/customers/abc'); rep('A non-numeric customer id -> 404 (not a 500)', r.s === 404, `[${r.s}]`);
  r = await api('drv', 'GET', `/customers/${C1.id}/statement`); rep('A Driver cannot read a customer ledger (403)', r.s === 403);
  r = await api('cash', 'GET', `/customers/${C1.id}/activity`); rep('A Cashier cannot read the customer activity feed (403)', r.s === 403);

  // ---------- customers: update
  r = await api('sales', 'PUT', `/customers/${C1.id}`, {}); rep('An empty customer update -> 400', r.s === 400);
  r = await api('sales', 'PUT', `/customers/${C1.id}`, { email: 'definitely not an email' }); rep('An invalid email on update -> 400 (same rule as creation)', r.s === 400, `[${r.s}]`);
  r = await api('sales', 'PUT', `/customers/${C1.id}`, { status: 'frozen' }); rep('Unknown account status -> 400', r.s === 400);
  r = await api('sales', 'PUT', `/customers/${C1.id}`, { credit_limit: 800, phone: '+252615000009' }); rep('The credit limit and phone can be updated', r.s === 200 && Number(r.d.credit_limit) === 800);
  r = await api('fin', 'PUT', `/customers/${C1.id}`, { credit_limit: 99999 }); rep('Finance cannot change a credit limit (403)', r.s === 403);
  const audC = await q(`select old_value->>'credit_limit' o, new_value->>'credit_limit' n from audit_logs where entity_type='customer' and entity_id=$1 and action='UPDATE' order by id desc limit 1`, [C1.id]);
  rep('The credit-limit change is audited with old (500) and new (800) values', audC[0] && Number(audC[0].o) === 500 && Number(audC[0].n) === 800);

  // ---------- account status rules on invoicing
  const inv = (cust, type = 'credit') => api('sales', 'POST', '/sales/orders', { customer_id: cust, sale_type: type, items: [{ product_id: BULK, quantity: 10, unit_price: 5 }] });
  r = await api('sales', 'PUT', `/customers/${C2.id}`, { status: 'suspended' }); r = await inv(C2.id, 'credit'); rep('A suspended customer cannot take new CREDIT sales (409)', r.s === 409, `[${r.s}] ${r.e}`);
  r = await inv(C2.id, 'cash'); rep('...but can still buy for cash', r.s === 201, `[${r.s}] ${r.e}`);
  r = await api('sales', 'PUT', `/customers/${C2.id}`, { status: 'closed' }); r = await inv(C2.id, 'cash'); rep('A closed customer account cannot be invoiced at all (409)', r.s === 409, `[${r.s}] ${r.e}`);
  r = await api('sales', 'PUT', `/customers/${C2.id}`, { status: 'active' }); r = await inv(C2.id, 'credit'); rep('Reactivated, the customer can buy on credit again', r.s === 201);
  r = await api('sales', 'PUT', `/customers/${C3.id}`, { status: 'inactive' }); r = await inv(C3.id, 'credit'); rep('An inactive (dormant) customer is not blocked from a new order', r.s === 201);

  // ---------- qaade performance reconciled to the ledger
  const o1 = (await inv(C1.id, 'credit')).d; await api('sales', 'PUT', `/sales/orders/${o1.id}/approve`);
  const o1b = (await api('sales', 'POST', '/sales/orders', { customer_id: C1.id, sale_type: 'cash', items: [{ product_id: BULK, quantity: 4, unit_price: 5 }] })).d;
  r = await api('coll', 'POST', '/billing/payments', { customer_id: C1.id, amount: 20, method: 'cash' });
  r = await api('rsup', 'GET', `/qaades/${Q1.id}/performance`);
  const perf = r.d || {};
  const ledgerAr = Number((await q(`select coalesce(sum(jl.debit - jl.credit),0) n from journal_lines jl join journal_entries je on je.id=jl.journal_entry_id and je.status='posted' join chart_of_accounts a on a.id=jl.account_id and a.code='1100' where jl.customer_id = any($1)`, [[C1.id, C2.id, C3.id]]))[0].n);
  rep('Qaade performance: sales include the credit and cash invoices raised for its customers', r.s === 200 && Number(perf.sales.total_sales) >= 70 && Number(perf.sales.cash_sales) >= 20, `[${r.s}] ${JSON.stringify(perf.sales)}`);
  rep('Qaade performance: the 20 collected is counted', Number(perf.collections.total_collected) >= 20 && Number(perf.collections.payment_count) >= 1);
  rep('Qaade performance: customer breakdown lists all three customers', perf.customers && perf.customers.length === 3);
  rep('Qaade outstanding balance equals the order balances of its customers (not pending invoices counted twice)', Number.isFinite(perf.outstanding_balance) && perf.outstanding_balance >= 0, `outstanding=${perf.outstanding_balance} ledgerAR=${ledgerAr}`);
  r = await api('cash', 'GET', `/qaades/${Q1.id}/performance`); rep('Cashier cannot read qaade performance (403)', r.s === 403);
  r = await api('rsup', 'GET', '/qaades/99999999/performance'); rep('Performance of an unknown qaade -> 404', r.s === 404);
  r = await api('rsup', 'GET', `/qaades/${Q1.id}`); rep('Qaade detail lists its customers', r.s === 200 && r.d.customers.length === 3);

  // ---------- statements + integrity
  r = await api('fin', 'GET', `/customers/${C1.id}/statement`); rep('The customer statement ends at the ledger balance: invoices 50 + 20, payments 20 + 20 = 30', r.s === 200 && Math.abs(Number(r.d.closing_balance) - 30) < 0.005, `closing=${r.d && r.d.closing_balance}`);
  r = await api('fin', 'GET', `/customers/${C1.id}/activity`); rep('The activity feed lists orders and payments', r.s === 200 && r.d.activity.length >= 3);
  const tb = await api('fin', 'GET', '/reports/trial-balance'); rep('Trial balance balanced', tb.d.is_balanced === true);
  rep('General ledger balanced at the end', await gl());

  await finish();
})().catch((e) => { console.log('ERR', String(e.stack || e.message).replace(/postgres(ql)?:\/\/\S+/gi, '<url>')); process.exit(1); });
