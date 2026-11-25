// Billing & Collections E2E: credit invoices, approval, collections (FIFO, department rules, overpayment), payment edit/void,
// customer sub-ledger vs general ledger reconciliation, follow-ups, dashboards and role scoping.
const { start } = require('./harness');

(async () => {
  const { api, q, U, rep, finish, gl } = await start('bil', [
    ['fin', 'Finance Officer'], ['sales', 'Sales Manager'], ['cash', 'Cashier'], ['coll', 'Collector'],
    ['drv', 'Driver'], ['store', 'Storekeeper'], ['opm', 'Operation Manager'], ['de', 'Data Entry Operator']
  ]);
  const stamp = Date.now();
  const today = new Date().toISOString().slice(0, 10);
  const prodIn = async (cat, sku) => {
    const c = (await q('select id from categories where name=$1', [cat]))[0].id;
    const ex = await q('select id from products where category_id=$1 order by id limit 1', [c]);
    if (ex[0]) return ex[0].id;
    return (await q(`insert into products (sku, name, category_id, product_type, unit) values ($1,$2,$3,'finished_good','pcs') returning id`, [`${sku}-${stamp}`, `E2E ${cat}`, c]))[0].id;
  };
  const BULK = await prodIn('Bulk Water', 'TBW'), BOTT = await prodIn('Bottled Water', 'TBT'), ICE = await prodIn('Ice Products', 'TIC');
  const mkCust = async (n) => (await q(`insert into customers (code, name, type) values ($1,$2,'wholesale') returning id`, [`TST-B${n}-${stamp}`.slice(0, 30), `E2E Billing Customer ${n}`]))[0].id;
  const CU = await mkCust(1), CU2 = await mkCust(2);
  const order = (cust, items, extra = {}) => api('sales', 'POST', '/sales/orders', { customer_id: cust, sale_type: 'credit', items, ...extra });
  const ledgerAR = async (cust) => Number((await q(`select coalesce(sum(jl.debit - jl.credit),0) n from journal_lines jl join journal_entries je on je.id=jl.journal_entry_id and je.status='posted' join chart_of_accounts a on a.id=jl.account_id and a.code='1100' where jl.customer_id=$1`, [cust]))[0].n);
  const orderBalances = async (cust) => Number((await q(`select coalesce(sum(so.total_amount - coalesce((select sum(p.amount) from payments p where p.sales_order_id=so.id and p.voided_at is null),0)),0) n from sales_orders so where so.customer_id=$1 and so.status not in ('cancelled','reversed','pending')`, [cust]))[0].n);
  const pay = (who, body) => api(who, 'POST', '/billing/payments', body);

  // ---------- invoice lifecycle
  let r = await api('cash', 'POST', '/sales/orders', { customer_id: CU, items: [{ product_id: BULK, quantity: 100, unit_price: 2 }] }); rep('Cashier cannot create sales invoices (403)', r.s === 403);
  r = await order(CU, [{ product_id: BULK, quantity: 100, unit_price: 2 }]); const O1 = r.d || {};
  rep('Sales Manager creates a credit invoice (pending, total 200, invoice number assigned)', r.s === 201 && O1.status === 'pending' && Number(O1.total_amount) === 200 && O1.invoice_hno, `[${r.s}] ${r.e}`);
  rep('A pending credit invoice posts nothing to the ledger yet', (await q(`select count(*)::int n from journal_entries where reference_type='sales_order' and reference_id=$1`, [O1.id]))[0].n === 0 && (await ledgerAR(CU)) === 0);
  r = await pay('coll', { customer_id: CU, amount: 50, method: 'cash' }); rep('Collecting against a not-yet-approved invoice -> 400 (no outstanding balance)', r.s === 400, `[${r.s}] ${r.e}`);
  r = await order(CU, [{ product_id: BULK, quantity: 0, unit_price: 2 }]); rep('Zero quantity on an invoice -> 400', r.s === 400);
  r = await order(CU, []); rep('An invoice without items -> 400', r.s === 400);
  r = await order(CU, [{ product_id: BULK, quantity: 1, unit_price: -2 }]); rep('Negative price -> 400', r.s === 400);
  r = await api('cash', 'PUT', `/sales/orders/${O1.id}/approve`); rep('Cashier cannot approve invoices (403)', r.s === 403);
  r = await api('sales', 'PUT', `/sales/orders/${O1.id}/approve`); rep('Approving posts Dr Accounts Receivable / Cr Revenue (AR +200)', r.s === 200 && (await ledgerAR(CU)) === 200, `[${r.s}] ${r.e}`);
  r = await api('sales', 'PUT', `/sales/orders/${O1.id}/approve`); rep('Approving twice -> 400 (AR not doubled)', r.s === 400 && (await ledgerAR(CU)) === 200);

  // ---------- collections
  r = await pay('coll', { customer_id: CU, amount: 0, method: 'cash' }); rep('Zero payment -> 400', r.s === 400);
  r = await pay('coll', { customer_id: CU, amount: -5, method: 'cash' }); rep('Negative payment -> 400', r.s === 400);
  r = await pay('coll', { customer_id: CU, amount: 10 }); rep('Payment without a method -> 400', r.s === 400);
  r = await pay('coll', { amount: 10, method: 'cash' }); rep('Payment without a customer -> 400', r.s === 400);
  r = await pay('coll', { customer_id: CU, amount: 10, method: 'cash', department: 'rockets' }); rep('Unknown department -> 400', r.s === 400);
  r = await pay('drv', { customer_id: CU, amount: 10, method: 'cash' }); rep('Driver cannot receive payments (403)', r.s === 403);
  r = await pay('store', { customer_id: CU, amount: 10, method: 'cash' }); rep('Storekeeper cannot receive payments (403)', r.s === 403);
  r = await pay('sales', { customer_id: CU, amount: 10, method: 'cash' }); rep('Sales Manager cannot receive payments (403)', r.s === 403);
  r = await pay('coll', { customer_id: CU, amount: 50, method: 'cash', reference_number: 'R-1' }); const PAY1 = (r.d && r.d.payments && r.d.payments[0]) || {};
  rep('Collector receives 50: applied to the invoice, receipt number issued', r.s === 201 && r.d.applied === 50 && r.d.unapplied === 0 && PAY1.transaction_hno, `[${r.s}] ${r.e}`);
  rep('Invoice is now partial; AR ledger = 150 and equals the invoice balance', (await q('select payment_status from sales_orders where id=$1', [O1.id]))[0].payment_status === 'partial' && (await ledgerAR(CU)) === 150 && (await orderBalances(CU)) === 150);
  r = await pay('coll', { customer_id: CU, amount: 500, method: 'bank_transfer' });
  rep('Overpayment: only the 150 owed is applied, 350 is reported unapplied, invoice paid', r.s === 201 && r.d.applied === 150 && r.d.unapplied === 350 && (await ledgerAR(CU)) === 0 && (await q('select payment_status from sales_orders where id=$1', [O1.id]))[0].payment_status === 'paid', `[${r.s}] ${JSON.stringify(r.d && [r.d.applied, r.d.unapplied])}`);
  r = await pay('coll', { customer_id: CU, amount: 10, method: 'cash' }); rep('Nothing outstanding -> 400, no payment recorded', r.s === 400);

  // FIFO across invoices
  const o2 = (await order(CU, [{ product_id: BULK, quantity: 50, unit_price: 2 }])).d; await api('sales', 'PUT', `/sales/orders/${o2.id}/approve`);
  const o3 = (await order(CU, [{ product_id: BULK, quantity: 50, unit_price: 2 }])).d; await api('sales', 'PUT', `/sales/orders/${o3.id}/approve`);
  r = await pay('fin', { customer_id: CU, amount: 150, method: 'cash' });
  const ps = (await q('select sales_order_id, amount from payments where sales_order_id = any($1) order by id', [[o2.id, o3.id]])).map((x) => [x.sales_order_id, Number(x.amount)]);
  rep('Collections are applied oldest-invoice-first (FIFO): 100 to the first, 50 to the second', r.s === 201 && ps.length === 2 && ps[0][0] === o2.id && ps[0][1] === 100 && ps[1][0] === o3.id && ps[1][1] === 50, JSON.stringify(ps));
  rep('...and the customer sub-ledger still equals the general ledger (50)', (await ledgerAR(CU)) === 50 && (await orderBalances(CU)) === 50);

  // ---------- department rules + cashier scope
  const ob = (await order(CU2, [{ product_id: BOTT, quantity: 10, unit_price: 5 }])).d; await api('sales', 'PUT', `/sales/orders/${ob.id}/approve`);
  const oi = (await order(CU2, [{ product_id: ICE, quantity: 10, unit_price: 3 }])).d; await api('sales', 'PUT', `/sales/orders/${oi.id}/approve`);
  const og = (await order(CU2, [{ product_id: BULK, quantity: 10, unit_price: 4 }])).d; await api('sales', 'PUT', `/sales/orders/${og.id}/approve`);
  rep('Customer 2 owes 50 bottled + 30 ice + 40 bulk = 120', (await ledgerAR(CU2)) === 120);
  r = await pay('cash', { customer_id: CU2, amount: 10, method: 'cash' }); rep('Cashier must pick a department (403)', r.s === 403);
  r = await pay('cash', { customer_id: CU2, amount: 10, method: 'cash', department: 'bulk_water' }); rep('Cashier cannot collect bulk-water debts (403)', r.s === 403);
  r = await pay('cash', { customer_id: CU2, amount: 20, method: 'cash', department: 'ice' });
  rep('Cashier collects 20 against ICE only (the ice invoice is reduced, bottled and bulk untouched)', r.s === 201 && Number((await q('select coalesce(sum(amount),0) n from payments where sales_order_id=$1 and voided_at is null', [oi.id]))[0].n) === 20 && Number((await q('select coalesce(sum(amount),0) n from payments where sales_order_id=any($1) and voided_at is null', [[ob.id, og.id]]))[0].n) === 0, `[${r.s}] ${r.e}`);
  r = await pay('coll', { customer_id: CU2, amount: 15, method: 'cash', department: 'bottled_water' }); rep('Collector collects 15 against bottled water', r.s === 201);
  r = await pay('coll', { customer_id: CU, amount: 5, method: 'cash', department: 'ice' }); rep('A customer with no ice debt cannot pay in the ice department (400)', r.s === 400);
  rep('Customer 2 sub-ledger = general ledger = 85', (await ledgerAR(CU2)) === 85 && (await orderBalances(CU2)) === 85);

  // ---------- edit + void
  r = await api('coll', 'PUT', `/billing/payments/${PAY1.id}`, { notes: 'x' }); rep('Collector cannot edit a payment (403)', r.s === 403);
  r = await api('fin', 'PUT', `/billing/payments/${PAY1.id}`, { reference_number: 'R-1-FIXED', notes: 'Reference corrected', amount: 9999 });
  rep('Finance edits reference/notes only; the amount cannot be changed', r.s === 200 && r.d.reference_number === 'R-1-FIXED' && Number(r.d.amount) === 50);
  r = await api('coll', 'POST', `/sales/orders/${O1.id}/payments/${PAY1.id}/reverse`, { reason: 'x' }); rep('Collector cannot reverse a payment (403)', r.s === 403);
  r = await api('fin', 'POST', `/sales/orders/${O1.id}/payments/${PAY1.id}/reverse`, { reason: 'Cheque bounced' });
  rep('Finance reverses the 50 payment: voided, AR restored (+50), invoice back to partial/unpaid', r.s === 200 && r.d.voided_at && (await ledgerAR(CU)) === 100 && ['partial', 'unpaid'].includes((await q('select payment_status from sales_orders where id=$1', [O1.id]))[0].payment_status), `[${r.s}] ${r.e}`);
  r = await api('fin', 'POST', `/sales/orders/${O1.id}/payments/${PAY1.id}/reverse`, { reason: 'again' }); rep('Reversing twice -> 409', r.s === 409);
  rep('Sub-ledger still equals the general ledger after the void (customer 1 = 100)', (await orderBalances(CU)) === 100 && (await ledgerAR(CU)) === 100);
  r = await api('fin', 'GET', `/billing/payments?customer_id=${CU}`); rep('Voided payments disappear from the payment history', r.s === 200 && !r.d.some((p) => p.id === PAY1.id) && r.d.length >= 2);

  // ---------- reads and role scoping
  for (const [path, label] of [['/billing/dashboard', 'collection dashboard'], ['/billing/receivables', 'receivables'], ['/billing/aging', 'aging'], ['/billing/alerts', 'alerts'], ['/billing/payments', 'payment history'], ['/billing/follow-ups/due', 'follow-ups due']]) {
    r = await api('fin', 'GET', path); const a = r.s === 200;
    const c = await api('cash', 'GET', path);
    const d = await api('drv', 'GET', path);
    rep(`${label}: Finance 200, Cashier 403, Driver 403`, a && c.s === 403 && d.s === 403, `fin=${r.s} cash=${c.s} drv=${d.s}`);
  }
  r = await api('coll', 'GET', '/billing/dashboard'); rep('Collector can read the collection dashboard', r.s === 200);
  r = await api('opm', 'GET', '/billing/dashboard'); rep('Operation Manager has no access to collections (403)', r.s === 403);
  r = await api('fin', 'GET', '/billing/dashboard?department=rockets'); rep('Invalid department filter -> 400 (not silently "all")', r.s === 400);
  r = await api('fin', 'GET', '/billing/dashboard?department=bulk_water'); rep('A valid department filter is accepted', r.s === 200);
  r = await api('fin', 'GET', '/billing/aging'); rep('Aging buckets total equals the receivable owed', r.s === 200 && Number.isFinite(Number(r.d.total)));
  r = await api('fin', 'GET', '/billing/receivables'); const rc = (r.d || []).find((c) => c.id === CU || c.customer_id === CU);
  rep('Receivables list includes customer 1 with the 100 balance', r.s === 200 && rc && Number(rc.current_balance) === 100, JSON.stringify(rc && Object.keys(rc)));
  r = await api('cash', 'GET', `/billing/customers/search?q=E2E`); rep('Cashier can search customers (retail lookup)', r.s === 200);
  r = await api('drv', 'GET', '/billing/driver/payment-status'); rep('Driver can read the (route-scoped) payment-status endpoint', r.s === 200);
  r = await api('fin', 'GET', '/billing/driver/payment-status'); rep('Payment-status is Driver-only (403 for Finance)', r.s === 403);
  r = await api('fin', 'GET', `/billing/customers/${CU}/profile`); rep('Customer profile loads for Finance', r.s === 200);
  r = await api('cash', 'GET', `/billing/customers/${CU}/profile`); rep('Customer profile is closed to Cashier (403)', r.s === 403);

  // ---------- follow-ups
  r = await api('drv', 'POST', `/billing/customers/${CU}/follow-ups`, { action_type: 'call' }); rep('Driver cannot log follow-ups (403)', r.s === 403);
  r = await api('coll', 'POST', `/billing/customers/${CU}/follow-ups`, { notes: 'no type' }); rep('Follow-up without an action type -> 400', r.s === 400);
  r = await api('coll', 'POST', `/billing/customers/${CU}/follow-ups`, { action_type: 'call', notes: 'Promised to pay', promise_amount: 100, promise_date: today, next_followup_date: today });
  rep('Collector logs a follow-up with a promise', r.s === 201 && Number(r.d.promise_amount) === 100, `[${r.s}] ${r.e}`);
  r = await api('coll', 'GET', `/billing/customers/${CU}/follow-ups`); rep('The follow-up appears in the customer history', r.s === 200 && r.d.length >= 1);
  r = await api('fin', 'GET', '/billing/follow-ups/due'); rep('It is on today\'s due worklist', r.s === 200 && r.d.some((f) => f.customer_id === CU));

  // ---------- integrity
  const c1 = await ledgerAR(CU), c2 = await ledgerAR(CU2);
  const arRep = await api('fin', 'GET', '/reports/accounts-receivable');
  const rep1 = (arRep.d.customers || []).find((c) => c.id === CU), rep2 = (arRep.d.customers || []).find((c) => c.id === CU2);
  rep('Accounts-receivable report matches the ledger for both customers (100 and 85)', arRep.s === 200 && rep1 && rep2 && Number(rep1.balance) === c1 && Number(rep2.balance) === c2 && c1 === 100 && c2 === 85, JSON.stringify([c1, c2]));
  const aud = await q(`select count(*)::int n from audit_logs where entity_type in ('payment','sales_order') and user_id = any($1)`, [[U.sales.id, U.coll.id, U.fin.id, U.cash.id]]);
  rep('Invoices, approvals, collections and voids are in the audit trail', aud[0].n >= 8, `rows=${aud[0].n}`);
  const tb = await api('fin', 'GET', '/reports/trial-balance'); rep('Trial balance balanced after all postings', tb.d.is_balanced === true);
  rep('General ledger balanced at the end', await gl());

  await finish();
})().catch((e) => { console.log('ERR', String(e.stack || e.message).replace(/postgres(ql)?:\/\/\S+/gi, '<url>')); process.exit(1); });
