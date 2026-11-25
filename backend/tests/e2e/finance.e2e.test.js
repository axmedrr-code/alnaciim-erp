// Finance E2E: chart of accounts, journal lifecycle, reversals, cash entries, bank accounts, expenses, budgets,
// fiscal-year closing and period lock, and the financial reports (trial balance, P&L, balance sheet, cash flow, AR/AP).
const { start } = require('./harness');

(async () => {
  const { api, q, U, rep, finish, gl } = await start('fin', [
    ['fin', 'Finance Officer'], ['sales', 'Sales Manager'], ['cash', 'Cashier'], ['coll', 'Collector'], ['opm', 'Operation Manager'], ['store', 'Storekeeper']
  ]);
  const stamp = Date.now();
  const acct = async (code) => (await q('select id from chart_of_accounts where code=$1', [code]))[0].id;
  const CASH = await acct('1000'), REV = await acct('4000'), EXP = await acct('5300'), RET = await acct('3900');
  const coaBalance = async (id) => Number((await api('fin', 'GET', '/finance/chart-of-accounts')).d.find((a) => a.id === id).balance);
  const day = (y, m = 6, d = 1) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const today = new Date().toISOString().slice(0, 10);

  // ---------- chart of accounts
  let r = await api('cash', 'GET', '/finance/chart-of-accounts'); rep('Cashier cannot read the chart of accounts (403)', r.s === 403);
  r = await api('sales', 'GET', '/finance/chart-of-accounts'); rep('Sales Manager cannot read the chart of accounts (403)', r.s === 403);
  r = await api('opm', 'GET', '/finance/chart-of-accounts'); rep('Operation Manager cannot read the chart of accounts (403)', r.s === 403);
  r = await api('fin', 'GET', '/finance/chart-of-accounts'); rep('Finance reads the chart of accounts with balances', r.s === 200 && r.d.length > 10 && r.d.every((a) => 'balance' in a));
  r = await api('cash', 'POST', '/finance/chart-of-accounts', { code: `TF${stamp}`, name: 'x', account_type: 'expense' }); rep('Cashier cannot create accounts (403)', r.s === 403);
  r = await api('fin', 'POST', '/finance/chart-of-accounts', { code: `TF${stamp}`, name: 'E2E parent', account_type: 'wizardry' }); rep('Invalid account type -> 400', r.s === 400);
  r = await api('fin', 'POST', '/finance/chart-of-accounts', { code: `TFP${stamp}`, name: 'E2E parent', account_type: 'expense' }); const P = r.d || {}; rep('Finance creates an account', r.s === 201 && P.id > 0, `[${r.s}] ${r.e}`);
  r = await api('fin', 'POST', '/finance/chart-of-accounts', { code: `TFP${stamp}`, name: 'Duplicate code', account_type: 'expense' }); rep('Duplicate account code is refused with a 4xx (not a 500)', r.s >= 400 && r.s < 500, `[${r.s}]`);
  r = await api('fin', 'POST', '/finance/chart-of-accounts', { code: `TFC${stamp}`, name: 'E2E child', account_type: 'expense', parent_id: P.id }); const C = r.d || {}; rep('Child account under a parent', r.s === 201 && C.parent_id === P.id);
  r = await api('fin', 'PUT', `/finance/chart-of-accounts/${P.id}`, { parent_id: C.id }); rep('Re-parenting an account under its own descendant (cycle) -> 409', r.s === 409);
  r = await api('fin', 'PUT', `/finance/chart-of-accounts/${P.id}`, { parent_id: P.id }); rep('An account cannot be its own parent -> 409', r.s === 409);
  r = await api('fin', 'PUT', `/finance/chart-of-accounts/${CASH}`, { is_active: false }); rep('A system account (Cash) cannot be deactivated -> 409', r.s === 409);
  r = await api('fin', 'PUT', `/finance/chart-of-accounts/${C.id}`, { name: 'E2E child renamed' }); rep('Renaming an account works', r.s === 200 && r.d.name === 'E2E child renamed');
  r = await api('fin', 'PUT', `/finance/chart-of-accounts/${C.id}`, {}); rep('An empty update -> 400', r.s === 400);

  // ---------- journal entries
  const je = (who, body) => api(who, 'POST', '/finance/journal-entries', body);
  r = await je('cash', { lines: [{ account_id: CASH, debit: 10 }, { account_id: REV, credit: 10 }] }); rep('Cashier cannot create journal entries (403)', r.s === 403);
  r = await je('sales', { lines: [{ account_id: CASH, debit: 10 }, { account_id: REV, credit: 10 }] }); rep('Sales Manager cannot create journal entries (403)', r.s === 403);
  r = await je('fin', { lines: [{ account_id: CASH, debit: 10 }] }); rep('A journal entry with one line -> 400', r.s === 400);
  r = await je('fin', { lines: [{ account_id: CASH, debit: 10 }, { account_id: REV, credit: 9 }] }); rep('An unbalanced journal entry -> 400 (never a 500, nothing saved)', r.s === 400, `[${r.s}] ${r.e}`);
  r = await je('fin', { lines: [{ account_id: CASH, debit: 10, credit: 10 }, { account_id: REV, credit: 0 }] }); rep('A line with both debit and credit -> 400', r.s === 400, `[${r.s}]`);
  r = await je('fin', { lines: [{ account_id: CASH, debit: -10 }, { account_id: REV, credit: -10 }] }); rep('Negative amounts -> 400', r.s === 400, `[${r.s}]`);
  const bal0 = await coaBalance(EXP);
  r = await je('fin', { description: 'E2E draft', status: 'draft', lines: [{ account_id: EXP, debit: 40 }, { account_id: CASH, credit: 40 }] }); const D = r.d || {};
  rep('A draft entry is saved but does not count in any balance', r.s === 201 && D.status === 'draft' && (await coaBalance(EXP)) === bal0, `[${r.s}] ${r.e}`);
  r = await api('fin', 'PUT', `/finance/journal-entries/${D.id}`, { description: 'E2E draft edited', lines: [{ account_id: EXP, debit: 45 }, { account_id: CASH, credit: 40 }] }); rep('Editing a draft into an unbalanced entry -> 400', r.s === 400);
  r = await api('fin', 'PUT', `/finance/journal-entries/${D.id}`, { description: 'E2E draft edited', lines: [{ account_id: EXP, debit: 45 }, { account_id: CASH, credit: 45 }] }); rep('Editing a balanced draft works', r.s === 200);
  r = await api('fin', 'POST', `/finance/journal-entries/${D.id}/post`); rep('Posting the draft makes it count (expense balance +45)', r.s === 200 && r.d.status === 'posted' && (await coaBalance(EXP)) === bal0 + 45);
  r = await api('fin', 'POST', `/finance/journal-entries/${D.id}/post`); rep('Posting twice -> 409 (not a 500)', r.s === 409, `[${r.s}]`);
  r = await api('fin', 'PUT', `/finance/journal-entries/${D.id}`, { lines: [{ account_id: EXP, debit: 1 }, { account_id: CASH, credit: 1 }] }); rep('A posted entry cannot be edited (409)', r.s === 409);
  r = await api('fin', 'DELETE', `/finance/journal-entries/${D.id}`); rep('A posted entry cannot be deleted (409)', r.s === 409);
  r = await je('fin', { status: 'draft', lines: [{ account_id: EXP, debit: 5 }, { account_id: CASH, credit: 5 }] }); const D2 = r.d || {};
  r = await api('fin', 'POST', `/finance/journal-entries/${D2.id}/reverse`, { reason: 'draft' }); rep('A draft cannot be reversed (409, not a 500)', r.s === 409, `[${r.s}]`);
  r = await api('fin', 'DELETE', `/finance/journal-entries/${D2.id}`); rep('A draft can be deleted outright', r.s === 200);
  r = await api('fin', 'POST', `/finance/journal-entries/${D.id}/reverse`, { reason: 'E2E correction' });
  rep('Reversing a posted entry posts an offsetting entry (expense balance back to start)', r.s === 200 && r.d.is_reversal === true && (await coaBalance(EXP)) === bal0, `[${r.s}] ${r.e}`);
  r = await api('fin', 'POST', `/finance/journal-entries/${D.id}/reverse`, { reason: 'again' }); rep('Reversing twice -> 409 (not a 500)', r.s === 409, `[${r.s}]`);
  r = await api('sales', 'GET', '/finance/journal-entries'); rep('Sales Manager can read the journal', r.s === 200);
  r = await api('cash', 'GET', '/finance/journal-entries'); rep('Cashier cannot read the journal (403)', r.s === 403);
  r = await api('fin', 'GET', `/finance/journal-entries/${D.id}`); rep('Journal entry detail includes its lines', r.s === 200 && JSON.stringify(r.d).includes('debit'));

  // ---------- cash entries + bank accounts
  const cash0 = await coaBalance(CASH);
  r = await api('fin', 'POST', '/finance/cash-receipts', { amount: 0, other_account_id: REV }); rep('Cash receipt of zero -> 400', r.s === 400);
  r = await api('fin', 'POST', '/finance/cash-receipts', { amount: 120, other_account_id: REV, description: 'E2E cash receipt' }); rep('Cash receipt: Dr Cash / Cr Revenue (+120 cash)', r.s === 201 && (await coaBalance(CASH)) === cash0 + 120, `[${r.s}] ${r.e}`);
  r = await api('fin', 'POST', '/finance/cash-payments', { amount: 20, other_account_id: EXP, description: 'E2E cash payment' }); rep('Cash payment: Dr Expense / Cr Cash (-20 cash)', r.s === 201 && (await coaBalance(CASH)) === cash0 + 100);
  r = await api('cash', 'POST', '/finance/cash-receipts', { amount: 5, other_account_id: REV }); rep('Cashier cannot post cash receipts (403)', r.s === 403);
  r = await api('fin', 'POST', '/finance/cash-receipts', { amount: 5, other_account_id: REV, bank_account_id: 99999999 }); rep('Unknown bank account -> 400', r.s === 400);
  r = await api('fin', 'POST', '/finance/bank-accounts', { name: `E2E Bank ${stamp}`, bank_name: 'Test Bank', account_number: '000123', opening_balance: 500 }); const BA = r.d || {};
  rep('Finance creates a bank account (with its own ledger account)', r.s === 201 && BA.coa_account_id > 0, `[${r.s}] ${r.e}`);
  await api('fin', 'POST', '/finance/cash-receipts', { amount: 200, other_account_id: REV, bank_account_id: BA.id });
  await api('fin', 'POST', '/finance/cash-payments', { amount: 50, other_account_id: EXP, bank_account_id: BA.id });
  r = await api('fin', 'GET', '/finance/bank-accounts'); const bk = (r.d || []).find((b) => b.id === BA.id);
  rep('Bank balance = opening 500 + 200 - 50 = 650', bk && Number(bk.current_balance) === 650, `balance=${bk && bk.current_balance}`);
  r = await api('cash', 'POST', '/finance/bank-accounts', { name: 'nope' }); rep('Cashier cannot create bank accounts (403)', r.s === 403);

  // ---------- expenses
  const cat = (await q('select id from expense_categories where coa_account_id is not null order by id limit 1'))[0];
  const cc = (await q('select id from cost_centers order by id limit 1'))[0];
  r = await api('cash', 'POST', '/finance/expenses', { category_id: cat.id, amount: 15, cost_center_id: cc.id }); rep('Cashier cannot record expenses (403)', r.s === 403);
  r = await api('fin', 'POST', '/finance/expenses', { category_id: cat.id, amount: 15 }); rep('An expense without a cost center -> 400', r.s === 400);
  r = await api('fin', 'POST', '/finance/expenses', { category_id: 99999999, amount: 15, cost_center_id: cc.id }); rep('Unknown expense category -> 404', r.s === 404);
  r = await api('fin', 'POST', '/finance/expenses', { category_id: cat.id, amount: -3, cost_center_id: cc.id }); rep('Negative expense -> 400', r.s === 400);
  r = await api('fin', 'POST', '/finance/expenses', { category_id: cat.id, amount: 15, cost_center_id: cc.id, description: 'E2E expense' }); const X = r.d || {};
  rep('Finance records an expense (posts to the ledger)', r.s === 201 && (await q(`select count(*)::int n from journal_entries where reference_type='expense' and reference_id=$1 and status='posted'`, [X.id]))[0].n === 1, `[${r.s}] ${r.e}`);
  r = await api('fin', 'POST', `/finance/expenses/${X.id}/reverse`, { reason: 'Entered twice' }); rep('Reversing the expense voids it', r.s === 200 && r.d.voided_at);
  r = await api('fin', 'POST', `/finance/expenses/${X.id}/reverse`, { reason: 'again' }); rep('Reversing an expense twice -> 409', r.s === 409);

  // ---------- fiscal year, budgets, closing
  const Y = 2200 + (stamp % 700);
  const fy = await api('fin', 'POST', '/finance/fiscal-years', { name: `TST-FY-${stamp}`, start_date: day(Y, 1, 1), end_date: day(Y, 12, 31) });
  rep('Finance creates a fiscal year', fy.s === 201 && fy.d.id > 0, `[${fy.s}] ${fy.e}`);
  r = await api('cash', 'POST', '/finance/fiscal-years', { name: 'x', start_date: day(Y, 1, 1), end_date: day(Y, 12, 31) }); rep('Cashier cannot create fiscal years (403)', r.s === 403);
  r = await api('fin', 'POST', '/finance/fiscal-years', { name: `TST-FY-${stamp}`, start_date: day(Y, 1, 1), end_date: day(Y, 12, 31) }); rep('Duplicate fiscal-year name is refused with a 4xx', r.s >= 400 && r.s < 500, `[${r.s}]`);
  r = await api('fin', 'POST', '/finance/budgets', { account_id: EXP, fiscal_year_id: fy.d.id, period_month: 6, budgeted_amount: 1000 }); rep('Finance sets a monthly budget', r.s === 201);
  r = await api('fin', 'POST', '/finance/budgets', { account_id: EXP, fiscal_year_id: fy.d.id, period_month: 6, budgeted_amount: 800 }); rep('Setting the same budget again updates it (no duplicate)', r.s === 201 && Number(r.d.budgeted_amount) === 800 && (await q('select count(*)::int n from budgets where account_id=$1 and fiscal_year_id=$2 and period_month=6', [EXP, fy.d.id]))[0].n === 1);
  r = await api('fin', 'POST', '/finance/budgets', { account_id: EXP, fiscal_year_id: fy.d.id, period_month: 13, budgeted_amount: 5 }); rep('Budget month 13 -> 400', r.s === 400, `[${r.s}]`);
  r = await api('cash', 'POST', '/finance/budgets', { account_id: EXP, fiscal_year_id: fy.d.id, period_month: 6, budgeted_amount: 1 }); rep('Cashier cannot set budgets (403)', r.s === 403);
  await je('fin', { entry_date: day(Y), description: 'E2E sale', lines: [{ account_id: CASH, debit: 100 }, { account_id: REV, credit: 100 }] });
  await je('fin', { entry_date: day(Y), description: 'E2E cost', lines: [{ account_id: EXP, debit: 30 }, { account_id: CASH, credit: 30 }] });
  r = await api('fin', 'GET', `/finance/budgets?fiscal_year_id=${fy.d.id}`); const bud = (r.d || [])[0];
  rep('Budget vs actual: actual 30 against budget 800', r.s === 200 && bud && Number(bud.actual_amount) === 30 && Number(bud.budgeted_amount) === 800, JSON.stringify(bud && [bud.actual_amount, bud.budgeted_amount]));

  // reports for that period (before closing)
  const rng = `from=${day(Y, 1, 1)}&to=${day(Y, 12, 31)}`;
  r = await api('fin', 'GET', `/reports/profit-loss?${rng}`); rep('Profit & Loss ties to the ledger: revenue 100, expenses 30, net income 70', r.s === 200 && r.d.total_revenue === 100 && r.d.total_expenses === 30 && r.d.net_income === 70, JSON.stringify(r.d && [r.d.total_revenue, r.d.total_expenses, r.d.net_income]));
  r = await api('fin', 'GET', `/reports/cash-flow?${rng}`); rep('Cash flow for the period: net change +70', r.s === 200 && Number(r.d.net_change) === 70 && Math.abs(Number(r.d.closing_balance) - (Number(r.d.opening_balance) + 70)) < 0.005, JSON.stringify(r.d && [r.d.opening_balance, r.d.net_change, r.d.closing_balance]));
  r = await api('fin', 'GET', `/reports/trial-balance?as_of=${day(Y, 12, 31)}`); rep('Trial balance is balanced (debits = credits)', r.s === 200 && r.d.is_balanced === true && Math.abs(r.d.total_debit - r.d.total_credit) < 0.01, `${r.d && r.d.total_debit}/${r.d && r.d.total_credit}`);
  r = await api('fin', 'GET', '/reports/balance-sheet'); rep('Balance sheet balances (assets = liabilities + equity)', r.s === 200 && r.d.is_balanced === true, JSON.stringify(r.d && [r.d.total_assets, r.d.total_liabilities, r.d.total_equity]));
  r = await api('fin', 'GET', `/reports/general-ledger?account_id=${REV}&${rng}`); rep('General ledger for revenue shows the 100 posting and a matching closing balance', r.s === 200 && Number(r.d.closing_balance) === 100 && r.d.lines.length >= 1, `[${r.s}] ${r.e || ''}`);
  r = await api('fin', 'GET', '/reports/accounts-payable'); rep('Accounts payable report is available to Finance', r.s === 200 && 'total_payable' in r.d);
  r = await api('cash', 'GET', '/reports/trial-balance'); rep('Cashier cannot read the trial balance (403)', r.s === 403);
  r = await api('sales', 'GET', '/reports/trial-balance'); rep('Sales Manager cannot read the trial balance (403)', r.s === 403);
  r = await api('sales', 'GET', '/reports/accounts-receivable'); rep('Sales Manager can read accounts receivable', r.s === 200);
  r = await api('sales', 'GET', '/reports/accounts-payable'); rep('Sales Manager cannot read accounts payable (403)', r.s === 403);
  r = await api('opm', 'GET', '/reports/profit-loss'); rep('Operation Manager cannot read the P&L (403)', r.s === 403);

  // year closing
  r = await api('cash', 'POST', `/finance/fiscal-years/${fy.d.id}/close`); rep('Cashier cannot close a fiscal year (403)', r.s === 403);
  const ret0 = await coaBalance(RET);
  r = await api('fin', 'POST', `/finance/fiscal-years/${fy.d.id}/close`);
  rep('Closing the year moves net income (70) into Retained Earnings and locks the year', r.s === 200 && r.d.status === 'closed' && (await coaBalance(RET)) === ret0 + 70, `[${r.s}] ${r.e} RE=${await coaBalance(RET)} was ${ret0}`);
  r = await api('fin', 'POST', `/finance/fiscal-years/${fy.d.id}/close`); rep('Closing twice -> 400', r.s === 400);
  r = await je('fin', { entry_date: day(Y, 8, 1), lines: [{ account_id: CASH, debit: 5 }, { account_id: REV, credit: 5 }] }); rep('Posting into a closed fiscal year is refused (409)', r.s === 409, `[${r.s}] ${r.e}`);
  r = await api('fin', 'POST', '/finance/cash-receipts', { amount: 5, other_account_id: REV, entry_date: day(Y, 8, 1) }); rep('Cash receipts into a closed year are refused too (409)', r.s === 409, `[${r.s}]`);
  r = await api('fin', 'GET', `/reports/profit-loss?${rng}`); rep('After closing, the year shows zero net income (revenue and expenses were closed out)', r.s === 200 && Math.abs(r.d.net_income) < 0.005, `net=${r.d && r.d.net_income}`);

  // ---------- integrity + audit
  r = await api('fin', 'GET', '/reports/trial-balance'); rep('Whole-book trial balance still balanced', r.d.is_balanced === true);
  const aud = await q(`select count(*)::int n from audit_logs where entity_type in ('chart_of_account','journal_entry','bank_account','budget','fiscal_year','expense') and user_id = $1`, [U.fin.id]);
  rep('Every finance write is in the audit trail', aud[0].n >= 20, `rows=${aud[0].n}`);
  rep('General ledger balanced at the end', await gl());

  await finish();
})().catch((e) => { console.log('ERR', String(e.stack || e.message).replace(/postgres(ql)?:\/\/\S+/gi, '<url>')); process.exit(1); });
