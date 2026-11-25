// Quotations E2E: draft -> sent -> accepted/rejected -> converted into a sales order; edit/delete rules, validity dates,
// totals, role scoping, and proof that a quotation itself never touches the ledger.
const { start } = require('./harness');

(async () => {
  const { api, q, pool, U, rep, finish, gl } = await start('quo', [
    ['sales', 'Sales Manager'], ['sales2', 'Sales Manager'], ['fin', 'Finance Officer'], ['cash', 'Cashier'], ['coll', 'Collector'], ['drv', 'Driver'], ['opm', 'Operation Manager']
  ]);
  const stamp = Date.now();
  const cat = (await q(`select id from categories where name='Bulk Water'`))[0].id;
  const P = (await q(`select id from products where category_id=$1 order by id limit 1`, [cat]))[0].id;
  const CU = (await q(`insert into customers (code, name, type) values ($1,'E2E Quotation Customer','wholesale') returning id`, [`TST-Q-${stamp}`.slice(0, 30)]))[0].id;
  const jeCount = async () => Number((await q(`select count(*)::int n from journal_entries`))[0].n);
  const days = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  const mk = (who, body = {}) => api(who, 'POST', '/sales/quotations', { customer_id: CU, items: [{ product_id: P, quantity: 10, unit_price: 5 }], ...body });

  // ---------- create + validation + roles
  let r = await mk('cash'); rep('Cashier cannot create quotations (403)', r.s === 403);
  r = await mk('fin'); rep('Finance reads but cannot create quotations (403)', r.s === 403);
  r = await mk('coll'); rep('Collector cannot create quotations (403)', r.s === 403);
  r = await mk('sales', { items: [] }); rep('A quotation without items -> 400', r.s === 400);
  r = await mk('sales', { items: [{ product_id: P, quantity: 0, unit_price: 5 }] }); rep('Zero quantity -> 400', r.s === 400);
  r = await mk('sales', { items: [{ product_id: P, quantity: 1, unit_price: -5 }] }); rep('Negative price -> 400', r.s === 400);
  r = await mk('sales', { customer_id: 99999999 }); rep('Unknown customer -> 404', r.s === 404);
  const je0 = await jeCount();
  r = await mk('sales', { discount: 5, tax: 3, valid_until: days(10), notes: 'E2E quote', items: [{ product_id: P, quantity: 10, unit_price: 5, discount: 2 }, { product_id: P, quantity: 4, unit_price: 2.5 }] });
  const Q1 = r.d || {};
  rep('Sales Manager creates a quotation: number issued, totals computed server-side (48 + 10 - 5 + 3 = 56)', r.s === 201 && /^QUO-/.test(Q1.quote_number) && Number(Q1.subtotal) === 58 && Number(Q1.total_amount) === 56 && Q1.status === 'draft', `[${r.s}] ${r.e} ${Q1.subtotal}/${Q1.total_amount}`);
  rep('A quotation never posts to the ledger', (await jeCount()) === je0);
  r = await api('sales', 'GET', `/sales/quotations/${Q1.id}`); rep('Detail returns the items with product names', r.s === 200 && r.d.items.length === 2 && r.d.customer_name);
  r = await api('fin', 'GET', '/sales/quotations'); rep('Finance can read quotations', r.s === 200 && r.d.some((x) => x.id === Q1.id));
  r = await api('cash', 'GET', '/sales/quotations'); rep('Cashier cannot read quotations (403)', r.s === 403);
  r = await api('drv', 'GET', '/sales/quotations'); rep('Driver cannot read quotations (403)', r.s === 403);
  r = await api('sales', 'GET', `/sales/quotations?status=draft&customer_id=${CU}`); rep('Filters by status and customer', r.s === 200 && r.d.every((x) => x.status === 'draft' && x.customer_id === CU));
  r = await api('sales', 'GET', '/sales/quotations/99999999'); rep('Unknown quotation -> 404', r.s === 404);
  const numbers = new Set(); for (let i = 0; i < 6; i++) { const x = await mk('sales'); if (x.d) numbers.add(x.d.quote_number); }
  rep('Quote numbers are unique across several quick creations', numbers.size === 6, `${numbers.size} unique of 6`);

  // ---------- edit / delete rules
  r = await api('sales', 'PUT', `/sales/quotations/${Q1.id}`, { items: [{ product_id: P, quantity: 20, unit_price: 5 }], discount: 0, tax: 0 });
  rep('A draft is freely editable; totals recalculated (20 x 5 = 100)', r.s === 200 && Number(r.d.total_amount) === 100 && Number(r.d.subtotal) === 100, `[${r.s}] ${r.e}`);
  r = await api('cash', 'PUT', `/sales/quotations/${Q1.id}`, { notes: 'x' }); rep('Cashier cannot edit (403)', r.s === 403);
  r = await api('sales', 'PUT', `/sales/quotations/${Q1.id}`, { items: [{ product_id: P, quantity: 0, unit_price: 5 }] }); rep('Editing to an invalid line -> 400', r.s === 400);
  const Qd = (await mk('sales')).d;
  r = await api('sales', 'DELETE', `/sales/quotations/${Qd.id}`); rep('A draft can be deleted', r.s === 200 && (await q('select count(*)::int n from quotations where id=$1', [Qd.id]))[0].n === 0);
  r = await api('cash', 'DELETE', `/sales/quotations/${Q1.id}`); rep('Cashier cannot delete (403)', r.s === 403);

  // ---------- lifecycle
  r = await api('sales', 'PUT', `/sales/quotations/${Q1.id}/accept`); rep('A draft cannot be accepted before it is sent (400)', r.s === 400);
  r = await api('cash', 'PUT', `/sales/quotations/${Q1.id}/send`); rep('Cashier cannot send (403)', r.s === 403);
  r = await api('sales', 'PUT', `/sales/quotations/${Q1.id}/send`); rep('Send: draft -> sent', r.s === 200 && r.d.status === 'sent');
  r = await api('sales', 'PUT', `/sales/quotations/${Q1.id}/send`); rep('Sending twice -> 400', r.s === 400);
  r = await api('sales', 'PUT', `/sales/quotations/${Q1.id}`, { notes: 'late edit' }); rep('A sent quotation can no longer be edited (409)', r.s === 409);
  r = await api('sales', 'DELETE', `/sales/quotations/${Q1.id}`); rep('A sent quotation can no longer be deleted (409)', r.s === 409);
  r = await api('sales', 'PUT', `/sales/quotations/${Q1.id}/accept`); rep('Accept: sent -> accepted', r.s === 200 && r.d.status === 'accepted');
  r = await api('sales', 'PUT', `/sales/quotations/${Q1.id}/reject`); rep('An accepted quotation cannot be rejected afterwards (400)', r.s === 400);

  // ---------- convert
  const ar0 = Number((await q(`select coalesce(sum(jl.debit - jl.credit),0) n from journal_lines jl join journal_entries je on je.id=jl.journal_entry_id and je.status='posted' join chart_of_accounts a on a.id=jl.account_id and a.code='1100' where jl.customer_id=$1`, [CU]))[0].n);
  r = await api('cash', 'POST', `/sales/quotations/${Q1.id}/convert`, {}); rep('Cashier cannot convert (403)', r.s === 403);
  r = await api('sales', 'POST', `/sales/quotations/${Q1.id}/convert`, { sale_type: 'barter' }); rep('Unknown sale type -> 400', r.s === 400);
  r = await api('sales', 'POST', `/sales/quotations/${Q1.id}/convert`, { sale_type: 'credit' }); const conv = r.d || {};
  rep('Convert (credit): a pending sales order for the quoted total (100), quotation marked converted and linked', r.s === 201 && conv.order && Number(conv.order.total_amount) === 100 && conv.order.status === 'pending' && conv.quotation.status === 'converted' && conv.quotation.converted_sales_order_id === conv.order.id, `[${r.s}] ${r.e}`);
  rep('A credit conversion posts nothing until the order is approved (AR unchanged)', Number((await q(`select coalesce(sum(jl.debit - jl.credit),0) n from journal_lines jl join journal_entries je on je.id=jl.journal_entry_id and je.status='posted' join chart_of_accounts a on a.id=jl.account_id and a.code='1100' where jl.customer_id=$1`, [CU]))[0].n) === ar0);
  r = await api('sales', 'POST', `/sales/quotations/${Q1.id}/convert`, { sale_type: 'credit' }); rep('Converting twice -> 409 (no duplicate order)', r.s === 409 && (await q(`select count(*)::int n from sales_orders where notes like $1`, [`%${Q1.quote_number}%`]))[0].n === 1);
  r = await api('sales', 'PUT', `/sales/quotations/${Q1.id}/reject`); rep('A converted quotation cannot be rejected (400)', r.s === 400);

  // cash conversion + rejected/expired rules
  const Q2 = (await mk('sales', { items: [{ product_id: P, quantity: 3, unit_price: 10 }] })).d;
  const cashJe0 = await jeCount();
  r = await api('sales', 'POST', `/sales/quotations/${Q2.id}/convert`, { sale_type: 'cash' });
  rep('A draft can be converted straight to a CASH sale: paid, and the sale is posted to the ledger (+1 entry)', r.s === 201 && r.d.order.payment_status === 'paid' && (await jeCount()) === cashJe0 + 1, `[${r.s}] ${r.e}`);
  const Q3 = (await mk('sales')).d; await api('sales', 'PUT', `/sales/quotations/${Q3.id}/reject`);
  r = await api('sales', 'POST', `/sales/quotations/${Q3.id}/convert`, {}); rep('A rejected quotation cannot be converted (409)', r.s === 409);
  r = await api('sales', 'PUT', `/sales/quotations/${Q3.id}/accept`); rep('A rejected quotation cannot be accepted (400)', r.s === 400);
  const Q4 = (await mk('sales', { valid_until: days(-3) })).d;
  r = await api('sales', 'POST', `/sales/quotations/${Q4.id}/convert`, { sale_type: 'credit' }); rep('A quotation past its valid-until date cannot be converted (409)', r.s === 409, `[${r.s}] ${r.e}`);
  await api('sales', 'PUT', `/sales/quotations/${Q4.id}/send`);
  r = await api('sales', 'PUT', `/sales/quotations/${Q4.id}/accept`); rep('An expired quotation cannot be accepted (400/409)', r.s === 400 || r.s === 409, `[${r.s}]`);

  // ---------- visibility, audit, integrity
  r = await api('sales2', 'GET', `/sales/quotations/${Q1.id}`); rep('Another Sales Manager can read the quotation (shared sales workspace)', r.s === 200);
  r = await api('opm', 'GET', '/sales/quotations'); rep('Operation Manager has no access to quotations (403)', r.s === 403);
  const aud = await q(`select count(*)::int n from audit_logs where entity_type='quotation' and user_id=$1`, [U.sales.id]);
  rep('Quotation create/update/delete/convert are in the audit trail', aud[0].n >= 6, `rows=${aud[0].n}`);
  rep('General ledger balanced at the end', await gl());

  await finish();
})().catch((e) => { console.log('ERR', String(e.stack || e.message).replace(/postgres(ql)?:\/\/\S+/gi, '<url>')); process.exit(1); });
