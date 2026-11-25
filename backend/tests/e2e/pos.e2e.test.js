// Retail POS E2E (Bottled Water + Ice counter sales): cash and credit sales, stock deduction, department rules, credit limit,
// cashier scoping, receipts, customer lookup/statement, reports, and the stock/ledger integrity each sale must leave behind.
const { start } = require('./harness');

(async () => {
  const { api, q, pool, U, rep, finish, gl, stock } = await start('pos', [
    ['cash', 'Cashier'], ['sales', 'Sales Manager'], ['fin', 'Finance Officer'], ['drv', 'Driver'], ['store', 'Storekeeper'],
    ['coll', 'Collector'], ['de', 'Data Entry Operator'], ['opm', 'Operation Manager']
  ]);
  const stamp = Date.now();
  const catId = async (n) => (await q('select id from categories where name=$1', [n]))[0].id;
  const BW = await catId('Bottled Water'), ICEC = await catId('Ice Products'), BULKC = await catId('Bulk Water');
  const mkP = async (cat, sku, name) => (await q(`insert into products (sku, name, category_id, product_type, unit) values ($1,$2,$3,'finished_good','pcs') returning id`, [`${sku}-${stamp}`, `${name} ${stamp}`, cat]))[0].id;
  const BOT = await mkP(BW, 'PBOT', 'E2E Bottle 1.5L'), ICE = await mkP(ICEC, 'PICE', 'E2E Ice 5kg'), BULK = await mkP(BULKC, 'PBLK', 'E2E Tanker water');
  const W = (await q(`insert into warehouses (code, name, type) values ('TST-POS-W','E2E POS Store','finished_goods') on conflict (code) do update set is_active=true returning id`))[0].id;
  const W2 = (await q(`insert into warehouses (code, name, type) values ('TST-POS-W2','E2E POS Store 2','finished_goods') on conflict (code) do update set is_active=true returning id`))[0].id;
  const mkC = async (n, limit = 0) => (await q(`insert into customers (code, name, hno, type, credit_limit, status) values ($1,$2,$3,'retail',$4,'active') returning id`, [`TST-P${n}-${stamp}`.slice(0, 30), `E2E POS Customer ${n}`, `${700000 + (stamp % 90000) + n}`, limit]))[0].id;
  const CU = await mkC(1), CUL = await mkC(2, 100);
  await api('admin', 'POST', '/inventory/movements', { product_id: BOT, warehouse_id: W, movement_type: 'IN', quantity: 200, reference_type: 'adjustment' });
  await api('admin', 'POST', '/inventory/movements', { product_id: ICE, warehouse_id: W, movement_type: 'IN', quantity: 100, reference_type: 'adjustment' });
  const AR = async (c) => Number((await q(`select coalesce(sum(jl.debit - jl.credit),0) n from journal_lines jl join journal_entries je on je.id=jl.journal_entry_id and je.status='posted' join chart_of_accounts a on a.id=jl.account_id and a.code='1100' where jl.customer_id=$1`, [c]))[0].n);
  const cashBal = async () => Number((await api('fin', 'GET', '/finance/chart-of-accounts')).d.find((a) => a.code === '1000').balance);
  const sale = (who, body) => api(who, 'POST', '/retail/sales', { customer_id: CU, department: 'bottled_water', warehouse_id: W, payment_type: 'cash', items: [{ product_id: BOT, quantity: 10, unit_price: 2 }], ...body });
  rep('Setup: 200 bottles + 100 ice in the POS store', (await stock(BOT, W)) === 200 && (await stock(ICE, W)) === 100);

  // ---------- access
  let r = await api('drv', 'GET', '/retail/departments'); rep('Driver cannot use the POS (403)', r.s === 403);
  r = await api('store', 'GET', '/retail/departments'); rep('Storekeeper cannot use the POS (403)', r.s === 403);
  r = await api('coll', 'GET', '/retail/departments'); rep('Collector cannot use the POS (403)', r.s === 403);
  r = await api('de', 'GET', '/retail/departments'); rep('Data Entry cannot use the POS (403)', r.s === 403);
  r = await api('cash', 'GET', '/retail/departments'); rep('Cashier sees exactly two retail departments (bottled water, ice) - never bulk water', r.s === 200 && r.d.length === 2 && !JSON.stringify(r.d).toLowerCase().includes('bulk'));
  r = await sale('drv', {}); rep('Driver cannot ring up a sale (403)', r.s === 403);
  r = await sale('fin', {}); rep('Finance can read but not ring up POS sales (403)', r.s === 403);
  r = await api('cash', 'GET', '/retail/products?department=bottled_water'); rep('POS product list shows bottled-water products only', r.s === 200 && r.d.some((p) => p.id === BOT) && !r.d.some((p) => p.id === ICE || p.id === BULK));
  r = await api('cash', 'GET', '/retail/products?department=bulk_water'); rep('Bulk water is not a POS department (400)', r.s === 400);
  r = await api('cash', 'GET', '/retail/warehouses?department=ice'); rep('POS warehouse list only offers stores that hold ice', r.s === 200 && r.d.some((w) => w.id === W));
  r = await api('cash', 'GET', `/retail/customers/search?q=${700000 + (stamp % 90000) + 1}`); rep('Cashier finds a customer by H.NO (minimal fields only)', r.s === 200 && r.d.some((c) => c.id === CU) && !('credit_limit' in (r.d[0] || {})));
  r = await api('cash', 'GET', '/retail/customers/search?q=a'); rep('A one-letter search is not allowed to dump the customer table', r.s === 200 && r.d.length <= 20);

  // ---------- validation
  r = await sale('cash', { customer_id: undefined }); rep('Sale without a customer -> 400', r.s === 400);
  r = await sale('cash', { warehouse_id: undefined }); rep('Sale without a warehouse -> 400', r.s === 400);
  r = await sale('cash', { items: [] }); rep('Sale without items -> 400', r.s === 400);
  r = await sale('cash', { payment_type: 'barter' }); rep('Unknown payment type -> 400', r.s === 400);
  r = await sale('cash', { department: 'bulk_water' }); rep('Department bulk_water -> 400', r.s === 400);
  r = await sale('cash', { items: [{ product_id: ICE, quantity: 1, unit_price: 1 }] }); rep('An ice product on a bottled-water sale -> 400', r.s === 400);
  r = await sale('cash', { items: [{ product_id: BULK, quantity: 1, unit_price: 1 }] }); rep('A bulk-water product can never be sold at the POS -> 400', r.s === 400);
  const s0 = await stock(BOT, W), c0 = await cashBal();
  r = await sale('cash', { items: [{ product_id: BOT, quantity: 0, unit_price: 2 }] }); rep('Zero quantity -> 400, nothing sold', r.s === 400 && (await stock(BOT, W)) === s0);
  r = await sale('cash', { items: [{ product_id: BOT, quantity: -5, unit_price: 2 }] }); rep('Negative quantity -> 400, nothing sold', r.s === 400 && (await stock(BOT, W)) === s0, `[${r.s}]`);
  r = await sale('cash', { items: [{ product_id: BOT, quantity: 5, unit_price: -2 }] }); rep('Negative price -> 400, nothing sold or posted', r.s === 400 && (await stock(BOT, W)) === s0 && (await cashBal()) === c0, `[${r.s}]`);
  r = await sale('cash', { items: [{ product_id: BOT, quantity: 5, unit_price: 2, discount: 50 }] }); rep('A line discount larger than the line -> 400', r.s === 400, `[${r.s}]`);
  r = await sale('cash', { items: [{ product_id: BOT, quantity: 5000, unit_price: 2 }] }); rep('Selling more than the store holds -> 400 and the whole sale rolls back (no order, no stock, no cash)', r.s === 400 && (await stock(BOT, W)) === s0 && (await cashBal()) === c0 && (await q(`select count(*)::int n from sales_orders where customer_id=$1`, [CU]))[0].n === 0, `[${r.s}] ${r.e}`);

  // ---------- cash sale
  r = await sale('cash', { items: [{ product_id: BOT, quantity: 10, unit_price: 2 }], discount: 2, tax: 1 }); const S1 = r.d || {};
  rep('Cashier rings up a cash sale: 20 - 2 + 1 = 19, approved and paid at once, invoice number issued', r.s === 201 && Number(S1.total_amount) === 19 && S1.status === 'approved' && S1.payment_status === 'paid' && S1.invoice_hno, `[${r.s}] ${r.e}`);
  rep('Stock left the store (200 -> 190) and cash rose by 19 in the ledger', (await stock(BOT, W)) === 190 && (await cashBal()) === c0 + 19, `stock=${await stock(BOT, W)} cash=${(await cashBal()) - c0}`);
  rep('A cash sale leaves no receivable', (await AR(CU)) === 0 && (await q('select count(*)::int n from payments where sales_order_id=$1', [S1.id]))[0].n === 1);
  const mv = (await q(`select movement_type, quantity, signed_quantity from stock_movements where reference_type='sales' and reference_id=$1`, [S1.id]))[0];
  rep('The stock ledger row is an OUT of 10 with signed quantity -10', mv && mv.movement_type === 'OUT' && Number(mv.signed_quantity) === -10);
  r = await api('cash', 'GET', `/retail/sales/${S1.id}/invoice`); rep('The retail invoice PDF can be printed', r.s === 200, `[${r.s}]`);

  // ---------- credit sale
  r = await sale('cash', { payment_type: 'credit', items: [{ product_id: ICE, quantity: 20, unit_price: 3 }], department: 'ice' }); const S2 = r.d || {};
  rep('Credit sale of ice (60): final at once - approved, receivable posted, stock out (100 -> 80), no payment recorded', r.s === 201 && S2.status === 'approved' && S2.payment_status !== 'paid' && (await AR(CU)) === 60 && (await stock(ICE, W)) === 80 && (await q('select count(*)::int n from payments where sales_order_id=$1', [S2.id]))[0].n === 0, `[${r.s}] ${r.e}`);
  r = await sale('cash', { customer_id: CUL, payment_type: 'credit', items: [{ product_id: BOT, quantity: 30, unit_price: 5 }] }); rep('A credit sale that would exceed the customer credit limit (150 > 100) is refused and rolled back (400)', r.s === 400 && (await AR(CUL)) === 0 && (await stock(BOT, W)) === 190, `[${r.s}] ${r.e}`);
  r = await sale('cash', { customer_id: CUL, payment_type: 'credit', items: [{ product_id: BOT, quantity: 10, unit_price: 5 }] }); rep('A credit sale within the limit (50 <= 100) is accepted', r.s === 201 && (await AR(CUL)) === 50);
  r = await sale('sales', { payment_type: 'cash', items: [{ product_id: BOT, quantity: 10, unit_price: 2 }], cash_payment_method: 'bank_transfer' }); rep('Sales Manager can also ring up a (bank-transfer) sale', r.s === 201, `[${r.s}] ${r.e}`);

  // ---------- collecting on a POS credit sale (cashier scope)
  r = await api('cash', 'POST', '/billing/payments', { customer_id: CU, amount: 20, method: 'cash', department: 'ice' });
  rep('Cashier collects 20 of the ice debt through Billing (department ice)', r.s === 201 && (await AR(CU)) === 40, `[${r.s}] ${r.e}`);
  r = await api('cash', 'POST', '/billing/payments', { customer_id: CU, amount: 20, method: 'cash', department: 'bulk_water' }); rep('Cashier cannot collect bulk-water debt (403)', r.s === 403);

  // ---------- lists, statement, profile
  r = await api('cash', 'GET', '/retail/sales?department=ice'); rep('The sales list is department-scoped (ice sale present, bottled cash sale absent)', r.s === 200 && r.d.some((x) => x.id === S2.id) && !r.d.some((x) => x.id === S1.id));
  r = await api('cash', 'GET', '/retail/sales?department=rockets'); rep('Unknown department filter -> 400', r.s === 400);
  r = await api('cash', 'GET', `/retail/sales?search=${S1.invoice_hno}`); rep('Search by invoice number', r.s === 200 && r.d.some((x) => x.id === S1.id));
  r = await api('cash', 'GET', `/retail/customers/${CU}/statement`);
  rep('Cashier statement: invoices minus payments = closing balance 40 (retail only)', r.s === 200 && Number(r.d.closing_balance) === 40 && r.d.statement.every((e) => ['invoice', 'payment'].includes(e.entry_type)), `[${r.s}] ${r.d && r.d.closing_balance}`);
  r = await api('cash', 'GET', `/retail/customers/${CU}/profile`); rep('Customer profile shows the retail balance and history', r.s === 200 && Number(r.d.outstanding_balance) === 40 && r.d.purchase_history.length >= 2 && r.d.payment_history.length >= 1);
  r = await api('cash', 'GET', `/retail/customers/${CU}/profile?department=rockets`); rep('Profile with an invalid department -> 400', r.s === 400);
  r = await api('cash', 'GET', '/retail/customers/99999999/profile'); rep('Unknown customer profile -> 404', r.s === 404);

  // ---------- reports
  r = await api('cash', 'GET', '/retail/reports/daily-sales'); rep('Reports are closed to Cashier (403)', r.s === 403);
  r = await api('drv', 'GET', '/retail/reports/daily-sales'); rep('Reports are closed to Driver (403)', r.s === 403);
  const rpt = {};
  for (const k of ['cash-sales', 'credit-sales', 'outstanding-invoices', 'paid-invoices', 'daily-sales', 'monthly-sales', 'top-customers', 'top-products']) { rpt[k] = await api('sales', 'GET', `/retail/reports/${k}`); }
  rep('Sales Manager reads all 8 retail reports', Object.values(rpt).every((x) => x.s === 200), Object.entries(rpt).filter(([, x]) => x.s !== 200).map(([k, x]) => `${k}=${x.s}`).join(' '));
  rep('Cash-sales report includes the 19 cash sale; credit-sales includes the 60 ice invoice', rpt['cash-sales'].d.rows.some((x) => x.id === S1.id && Number(x.total_amount) === 19) && rpt['credit-sales'].d.rows.some((x) => x.id === S2.id && Number(x.total_amount) === 60));
  const o = rpt['outstanding-invoices'].d.rows.find((x) => x.id === S2.id);
  rep('Outstanding-invoices report shows the ice invoice with a balance of 40', o && Number(o.balance) === 40);
  rep('Paid-invoices report includes the cash sale and excludes the unpaid ice invoice', rpt['paid-invoices'].d.rows.some((x) => x.id === S1.id) && !rpt['paid-invoices'].d.rows.some((x) => x.id === S2.id));
  rep('Daily sales over the last 30 days total at least the 19 + 60 + 50 + 20 we rang up', rpt['daily-sales'].d.reduce((t, d) => t + Number(d.total), 0) >= 149);
  r = await api('fin', 'GET', '/retail/reports/top-products?department=ice'); rep('Finance reads top products for one department', r.s === 200 && r.d.some((p) => p.id === ICE));
  r = await api('sales', 'GET', '/retail/reports/cash-sales?department=ice'); rep('Department filter on a report (ice has no cash sale from us)', r.s === 200 && !r.d.rows.some((x) => x.id === S1.id));

  // ---------- integrity
  const sl = Number((await q('select coalesce(sum(quantity),0) n from stock_levels where product_id=$1', [BOT]))[0].n);
  const sm = Number((await q('select coalesce(sum(signed_quantity),0) n from stock_movements where product_id=$1', [BOT]))[0].n);
  rep('Inventory integrity: stock level equals the signed movement ledger for the bottle product', Math.abs(sl - sm) < 0.0005, `levels=${sl} ledger=${sm}`);
  const ordTotal = Number((await q(`select coalesce(sum(total_amount),0) n from sales_orders where customer_id=$1 and status not in ('cancelled','reversed')`, [CU]))[0].n);
  const paid = Number((await q(`select coalesce(sum(p.amount),0) n from payments p join sales_orders so on so.id=p.sales_order_id where so.customer_id=$1 and p.voided_at is null`, [CU]))[0].n);
  rep('Customer sub-ledger (invoices - payments) equals the ledger AR for customer 1', ordTotal === 99 && paid === 59 && (await AR(CU)) === 40, `ord=${ordTotal} paid=${paid} ar=${await AR(CU)}`);
  const aud = await q(`select count(*)::int n from audit_logs where entity_type='sales_order' and user_id=$1`, [U.cash.id]);
  rep('POS sales are in the audit trail with the cashier recorded', aud[0].n >= 2, `rows=${aud[0].n}`);
  const tb = await api('fin', 'GET', '/reports/trial-balance'); rep('Trial balance balanced', tb.d.is_balanced === true);
  rep('General ledger balanced at the end', await gl());

  await finish();
})().catch((e) => { console.log('ERR', String(e.stack || e.message).replace(/postgres(ql)?:\/\/\S+/gi, '<url>')); process.exit(1); });
