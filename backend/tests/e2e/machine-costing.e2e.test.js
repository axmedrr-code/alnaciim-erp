// Machine costing E2E: recording costs (posts to the ledger), payment methods, validation, role scoping, reversal,
// and the machine profitability report (revenue attribution, machine costs + maintenance costs).
const { start } = require('./harness');

(async () => {
  const { api, q, pool, U, rep, finish, gl } = await start('mcost', [
    ['pm', 'Production Manager'], ['tech', 'Technician'], ['fin', 'Finance Officer'], ['sales', 'Sales Manager'],
    ['cash', 'Cashier'], ['opm', 'Operation Manager'], ['store', 'Storekeeper']
  ]);
  const stamp = Date.now();
  const today = new Date().toISOString().slice(0, 10);
  const bal = async (code) => Number((await api('fin', 'GET', '/finance/chart-of-accounts')).d.find((a) => a.code === code).balance);
  const acctFor = async (cat) => (await q('select a.code from machine_cost_category_accounts m join chart_of_accounts a on a.id=m.coa_account_id where m.category=$1', [cat]))[0].code;

  let r = await api('pm', 'POST', '/production/machines', { code: `TST-MC-${stamp}`, name: 'E2E Costing Machine', type: 'FILLING_LINE' }); const M = r.d || {};
  rep('Setup: machine created', r.s === 201 && M.id > 0);
  const cost = (who, mid, body) => api(who, 'POST', `/production/machines/${mid}/costs`, body);

  // ---------- validation + roles
  r = await cost('cash', M.id, { category: 'parts', amount: 10 }); rep('Cashier cannot record machine costs (403)', r.s === 403);
  r = await cost('store', M.id, { category: 'parts', amount: 10 }); rep('Storekeeper cannot record machine costs (403)', r.s === 403);
  r = await cost('sales', M.id, { category: 'parts', amount: 10 }); rep('Sales Manager cannot record machine costs (403)', r.s === 403);
  r = await cost('fin', M.id, { category: 'parts', amount: 10 }); rep('Finance reads but does not record machine costs (403)', r.s === 403);
  r = await cost('tech', M.id, { category: 'sorcery', amount: 10 }); rep('Unknown cost category -> 400', r.s === 400);
  r = await cost('tech', M.id, { category: 'parts', amount: 0 }); rep('Zero amount -> 400', r.s === 400);
  r = await cost('tech', M.id, { category: 'parts', amount: -20 }); rep('Negative amount -> 400', r.s === 400);
  r = await cost('tech', M.id, { category: 'parts', amount: 10, payment_method: 'bitcoin' }); rep('Unknown payment method -> 400', r.s === 400);
  r = await cost('tech', 99999999, { category: 'parts', amount: 10 }); rep('Unknown machine -> 404', r.s === 404);

  // ---------- recording + ledger
  const cash0 = await bal('1000');
  const fuelAcct = await acctFor('fuel_power'), fuel0 = await bal(fuelAcct);
  r = await cost('tech', M.id, { category: 'fuel_power', amount: 100, description: 'Diesel for generator' }); const C1 = r.d || {};
  rep('Technician records a 100 fuel cost (cost centre defaults to production)', r.s === 201 && Number(C1.amount) === 100 && C1.cost_center_id > 0, `[${r.s}] ${r.e}`);
  rep('Posted Dr expense account / Cr Cash: expense +100, cash -100', (await bal(fuelAcct)) === fuel0 + 100 && (await bal('1000')) === cash0 - 100);
  const bank = (await api('fin', 'POST', '/finance/bank-accounts', { name: `E2E Cost Bank ${stamp}`, opening_balance: 1000 })).d;
  const partsAcct = await acctFor('parts'), parts0 = await bal(partsAcct);
  r = await cost('pm', M.id, { category: 'parts', amount: 60, payment_method: 'bank_transfer', bank_account_id: bank.id }); const C2 = r.d || {};
  const bk = (await api('fin', 'GET', '/finance/bank-accounts')).d.find((b) => b.id === bank.id);
  rep('A bank-paid cost reduces the BANK account (1000 -> 940), not cash', r.s === 201 && Number(bk.current_balance) === 940 && (await bal(partsAcct)) === parts0 + 60 && (await bal('1000')) === cash0 - 100, `bank=${bk && bk.current_balance}`);
  r = await cost('pm', M.id, { category: 'labor', amount: 25, cost_date: '2020-03-15' }); const C3 = r.d || {};
  rep('A back-dated cost keeps its date', r.s === 201 && String(C3.cost_date).slice(0, 10) === '2020-03-15');

  // ---------- reading
  r = await api('fin', 'GET', `/production/machines/${M.id}/costs`); rep('Finance can read machine costs', r.s === 200 && r.d.length === 3);
  r = await api('pm', 'GET', `/production/machines/${M.id}/costs?from=2020-01-01&to=2020-12-31`); rep('Date filter returns only the 2020 cost', r.s === 200 && r.d.length === 1 && r.d[0].id === C3.id);
  r = await api('tech', 'GET', `/production/machines/${M.id}/costs`); rep('Technician records but cannot read cost history (403)', r.s === 403);
  r = await api('opm', 'GET', `/production/machines/${M.id}/costs`); rep('Operation Manager cannot read machine costs (403)', r.s === 403);
  r = await api('cash', 'GET', `/production/machines/${M.id}/profitability`); rep('Cashier cannot read profitability (403)', r.s === 403);

  // ---------- reversal
  r = await api('tech', 'POST', `/production/machine-costs/${C3.id}/reverse`, { reason: 'wrong' }); rep('Technician cannot reverse a cost (403)', r.s === 403);
  r = await api('fin', 'POST', `/production/machine-costs/${C3.id}/reverse`, { reason: 'wrong' }); rep('Finance cannot reverse a machine cost (403)', r.s === 403);
  const lab0 = await bal(await acctFor('labor'));
  r = await api('pm', 'POST', `/production/machine-costs/${C3.id}/reverse`, { reason: 'Entered on wrong machine' });
  rep('Production Manager reverses the labour cost: voided and ledger reversed (-25)', r.s === 200 && r.d.voided_at && (await bal(await acctFor('labor'))) === lab0 - 25, `[${r.s}] ${r.e}`);
  r = await api('pm', 'POST', `/production/machine-costs/${C3.id}/reverse`, { reason: 'again' }); rep('Reversing twice -> 409', r.s === 409);
  r = await api('pm', 'POST', '/production/machine-costs/99999999/reverse', { reason: 'ghost' }); rep('Unknown cost -> 404', r.s === 404);
  r = await api('fin', 'GET', `/production/machines/${M.id}/costs`); rep('Voided costs disappear from the history (2 left)', r.s === 200 && r.d.length === 2 && !r.d.some((c) => c.id === C3.id));

  // ---------- profitability: revenue attribution + maintenance cost
  const cat = (await q(`select id from categories where name='Bottled Water'`))[0].id;
  const FG = (await q(`insert into products (sku, name, category_id, product_type, unit) values ($1,$2,$3,'finished_good','pcs') returning id`, [`TMC-${stamp}`, `E2E costing item ${stamp}`, cat]))[0].id;
  const cust = (await q(`insert into customers (code, name, type) values ($1,'E2E costing customer','retail') returning id`, [`TST-MC-${stamp}`.slice(0, 30)]))[0].id;
  await pool.query(`insert into production_batches (batch_number, production_type, product_id, machine_id, planned_qty, actual_qty, unit, status, start_time, supervisor_id, output_approval_status) values ($1,'BOTTLING',$2,$3,100,100,'pcs','completed',now(),$4,'legacy')`, [`TST-MCB-${stamp}`, FG, M.id, U.pm.id]);
  await pool.query(`insert into maintenance_logs (machine_id, type, cost, log_date, performed_by) values ($1,'corrective',40,CURRENT_DATE,$2)`, [M.id, U.pm.id]);
  r = await api('sales', 'POST', '/sales/orders', { customer_id: cust, sale_type: 'cash', items: [{ product_id: FG, quantity: 100, unit_price: 5 }] }); rep('Setup: a 500 sale of the machine\'s product', r.s === 201 && Number(r.d.total_amount) === 500, `[${r.s}] ${r.e}`);
  r = await api('fin', 'GET', `/production/machines/${M.id}/profitability?from=${today}&to=${today}`);
  rep('Profitability for today: revenue 500 (all of the product the machine made), machine costs 160 excluded?', r.s === 200 && r.d.revenue === 500, JSON.stringify(r.d && [r.d.revenue, r.d.machine_costs, r.d.maintenance_costs, r.d.expenses, r.d.profit]));
  rep('Machine costs for today = 100 fuel + 60 parts, maintenance 40, expenses 200, profit 300', r.d.machine_costs === 160 && r.d.maintenance_costs === 40 && r.d.expenses === 200 && r.d.profit === 300, JSON.stringify([r.d.machine_costs, r.d.maintenance_costs, r.d.expenses, r.d.profit]));
  r = await api('fin', 'GET', `/production/machines/${M.id}/profitability?from=2020-01-01&to=2020-12-31`); rep('A period with the voided cost shows no expense (voided cost excluded)', r.s === 200 && r.d.machine_costs === 0 && r.d.revenue === 0);
  r = await api('fin', 'GET', '/production/machines/99999999/profitability'); rep('Profitability of an unknown machine -> 404', r.s === 404);

  // ---------- audit + integrity
  const aud = await q(`select count(*)::int n from audit_logs where entity_type='machine_cost' and entity_id = any($1)`, [[C1.id, C2.id, C3.id]]);
  rep('Cost creation and reversal are in the audit trail (3 creates + 1 reversal)', aud[0].n >= 4, `rows=${aud[0].n}`);
  const tb = await api('fin', 'GET', '/reports/trial-balance'); rep('Trial balance balanced', tb.d.is_balanced === true);
  rep('General ledger balanced at the end', await gl());

  await finish();
})().catch((e) => { console.log('ERR', String(e.stack || e.message).replace(/postgres(ql)?:\/\/\S+/gi, '<url>')); process.exit(1); });
