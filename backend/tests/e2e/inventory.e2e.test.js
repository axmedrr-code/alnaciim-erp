// Inventory & Warehouse E2E: movements, warehouse scoping, transfers, stock counts with independent approval, ledger integrity.
const { start } = require('./harness');

(async () => {
  const { api, q, pool, U, rep, finish, gl, stock } = await start('inv', [
    ['invmgr', 'Inventory Manager'], ['store1', 'Storekeeper'], ['store2', 'Storekeeper'], ['store0', 'Storekeeper'],
    ['opm', 'Operation Manager'], ['cash', 'Cashier'], ['fin', 'Finance Officer']
  ]);
  const stamp = Date.now();
  const cat = (await q('select id from categories order by id limit 1'))[0].id;
  const mkWh = async (code, name) => (await q(`insert into warehouses (code, name, type) values ($1,$2,'general') on conflict (code) do update set is_active=true returning id`, [code, name]))[0].id;
  const W1 = await mkWh('TST-INV-W1', 'E2E Inventory W1'), W2 = await mkWh('TST-INV-W2', 'E2E Inventory W2');
  const P = (await q(`insert into products (sku, name, category_id, product_type, unit) values ($1,$2,$3,'raw_material','pcs') returning id`, [`TST-INV-${stamp}`, `E2E Inventory item ${stamp}`, cat]))[0].id;
  await pool.query('update users set assigned_warehouse_id=$1 where id=$2', [W1, U.store1.id]);
  await pool.query('update users set assigned_warehouse_id=$1 where id=$2', [W2, U.store2.id]);
  await pool.query('update users set assigned_warehouse_id=NULL where id=$1', [U.store0.id]);

  // ---------- movements + warehouse scoping
  let r = await api('store1', 'POST', '/inventory/movements', { product_id: P, warehouse_id: W1, movement_type: 'IN', quantity: 100, reference_type: 'adjustment' });
  rep('Storekeeper receives stock in THEIR assigned warehouse', r.s === 201 && (await stock(P, W1)) === 100, `[${r.s}] ${r.e}`);
  r = await api('store1', 'POST', '/inventory/movements', { product_id: P, warehouse_id: W2, movement_type: 'IN', quantity: 5 }); rep('Storekeeper cannot post into another warehouse (403)', r.s === 403);
  r = await api('store0', 'POST', '/inventory/movements', { product_id: P, warehouse_id: W1, movement_type: 'IN', quantity: 5 }); rep('Storekeeper with no assigned warehouse is refused (403)', r.s === 403);
  r = await api('cash', 'POST', '/inventory/movements', { product_id: P, warehouse_id: W1, movement_type: 'IN', quantity: 5 }); rep('Cashier cannot post stock movements (403)', r.s === 403);
  r = await api('fin', 'POST', '/inventory/movements', { product_id: P, warehouse_id: W1, movement_type: 'IN', quantity: 5 }); rep('Finance can read but not post stock (403)', r.s === 403);
  r = await api('store1', 'POST', '/inventory/movements', { product_id: P, warehouse_id: W1, movement_type: 'IN', quantity: 0 }); rep('Zero quantity -> 400', r.s === 400);
  r = await api('store1', 'POST', '/inventory/movements', { product_id: P, warehouse_id: W1, movement_type: 'IN', quantity: -4 }); rep('Negative quantity -> 400', r.s === 400);
  r = await api('store1', 'POST', '/inventory/movements', { product_id: P, warehouse_id: W1, movement_type: 'OUT', quantity: 1000 }); rep('Issuing more than on hand is refused (400) and changes nothing', r.s === 400 && (await stock(P, W1)) === 100);
  r = await api('store1', 'POST', '/inventory/movements', { product_id: P, warehouse_id: W1, movement_type: 'OUT', quantity: 20, reference_type: 'adjustment' }); rep('Issue 20 (OUT) -> 80 on hand', r.s === 201 && (await stock(P, W1)) === 80);
  r = await api('store1', 'POST', '/inventory/movements', { product_id: P, warehouse_id: W1, movement_type: 'SIDEWAYS', quantity: 1 }); rep('Unknown movement type -> 400', r.s === 400);

  // ---------- transfers
  r = await api('store1', 'POST', '/inventory/transfer', { product_id: P, from_warehouse_id: W1, to_warehouse_id: W2, quantity: 10 }); rep('Storekeeper cannot do an inter-warehouse transfer (403)', r.s === 403);
  r = await api('invmgr', 'POST', '/inventory/transfer', { product_id: P, from_warehouse_id: W1, to_warehouse_id: W1, quantity: 10 }); rep('Transfer to the same warehouse -> 400', r.s === 400);
  r = await api('invmgr', 'POST', '/inventory/transfer', { product_id: P, from_warehouse_id: W1, to_warehouse_id: W2, quantity: 500 }); rep('Transfer of more than on hand -> 400, nothing moves', r.s === 400 && (await stock(P, W1)) === 80 && (await stock(P, W2)) === 0);
  r = await api('invmgr', 'POST', '/inventory/transfer', { product_id: P, from_warehouse_id: W1, to_warehouse_id: W2, quantity: 30 }); rep('Inventory Manager transfers 30 W1 -> W2 (50 / 30)', r.s === 201 && (await stock(P, W1)) === 50 && (await stock(P, W2)) === 30, `[${r.s}] ${r.e}`);
  const tr = await q(`select movement_type, related_warehouse_id from stock_movements where product_id=$1 and reference_type='transfer' order by id`, [P]);
  rep('Transfer leaves a paired OUT/IN ledger pair that points at the other warehouse', tr.length === 2 && tr[0].movement_type === 'TRANSFER_OUT' && tr[1].movement_type === 'TRANSFER_IN' && tr[0].related_warehouse_id === W2 && tr[1].related_warehouse_id === W1);

  // ---------- stock counts
  r = await api('store1', 'POST', '/inventory/stock-counts', { product_id: P, warehouse_id: W2, counted_quantity: 1, reason: 'cycle count' }); rep('Storekeeper cannot count another warehouse (403)', r.s === 403);
  r = await api('store1', 'POST', '/inventory/stock-counts', { product_id: P, warehouse_id: W1, counted_quantity: 45, reason: 'x' }); rep('Reason shorter than 3 characters -> 400', r.s === 400);
  r = await api('store1', 'POST', '/inventory/stock-counts', { product_id: P, warehouse_id: W1, counted_quantity: -1, reason: 'cycle count' }); rep('Negative count -> 400', r.s === 400);
  r = await api('opm', 'POST', '/inventory/stock-counts', { product_id: P, warehouse_id: W1, counted_quantity: 45, reason: 'cycle count' }); rep('Operation Manager oversees but cannot create counts (403)', r.s === 403);
  r = await api('store1', 'POST', '/inventory/stock-counts', { product_id: P, warehouse_id: W1, counted_quantity: 45, reason: 'Cycle count shows breakage' });
  const c1 = r.d || {};
  rep('Storekeeper submits a count: system 50, counted 45, variance -5, number SC-...', r.s === 201 && Number(c1.system_quantity) === 50 && Number(c1.variance) === -5 && /^SC-\d{4}-\d{6}$/.test(c1.count_number || ''), `[${r.s}] ${r.e}`);
  rep('Submitting a count does NOT change stock by itself', (await stock(P, W1)) === 50);
  r = await api('store1', 'POST', '/inventory/stock-counts', { product_id: P, warehouse_id: W1, counted_quantity: 44, reason: 'Second try' }); rep('Second pending count for the same product/warehouse -> 409', r.s === 409);
  r = await api('store1', 'POST', `/inventory/stock-counts/${c1.id}/decision`, { decision: 'approve', reason: 'self approval' }); rep('Storekeeper cannot approve counts (403)', r.s === 403);
  r = await api('cash', 'POST', `/inventory/stock-counts/${c1.id}/decision`, { decision: 'approve', reason: 'cashier approval' }); rep('Cashier cannot approve counts (403)', r.s === 403);
  r = await api('invmgr', 'POST', `/inventory/stock-counts/${c1.id}/decision`, { decision: 'approve', reason: 'ab' }); rep('Decision reason shorter than 3 characters -> 400', r.s === 400);
  r = await api('invmgr', 'POST', `/inventory/stock-counts/${c1.id}/decision`, { decision: 'approve', reason: 'Verified by recount' });
  rep('Inventory Manager approves -> stock adjusted to 45', r.s === 200 && r.d.status === 'approved' && (await stock(P, W1)) === 45, `[${r.s}] ${r.e}`);
  const adj = (await q(`select movement_type, quantity, signed_quantity from stock_movements where product_id=$1 and movement_type='ADJUSTMENT'`, [P]))[0];
  rep('The ADJUSTMENT ledger row records its direction (signed_quantity = -5)', adj && Number(adj.quantity) === 5 && Number(adj.signed_quantity) === -5, JSON.stringify(adj));
  r = await api('invmgr', 'POST', `/inventory/stock-counts/${c1.id}/decision`, { decision: 'approve', reason: 'second time' }); rep('Deciding a count twice -> 409', r.s === 409);

  // own-count rule + rejection + stale count
  r = await api('invmgr', 'POST', '/inventory/stock-counts', { product_id: P, warehouse_id: W2, counted_quantity: 28, reason: 'Manager spot count' });
  const c2 = r.d || {};
  r = await api('invmgr', 'POST', `/inventory/stock-counts/${c2.id}/decision`, { decision: 'approve', reason: 'approving my own count' }); rep('A counter cannot approve their own count (403)', r.s === 403);
  r = await api('admin', 'POST', `/inventory/stock-counts/${c2.id}/decision`, { decision: 'reject', reason: 'Recount required' });
  rep('Admin rejects it -> status rejected, stock untouched (30)', r.s === 200 && r.d.status === 'rejected' && (await stock(P, W2)) === 30);
  r = await api('store2', 'POST', '/inventory/stock-counts', { product_id: P, warehouse_id: W2, counted_quantity: 29, reason: 'Recount in W2' });
  const c3 = r.d || {};
  await api('invmgr', 'POST', '/inventory/movements', { product_id: P, warehouse_id: W2, movement_type: 'IN', quantity: 5 });
  r = await api('invmgr', 'POST', `/inventory/stock-counts/${c3.id}/decision`, { decision: 'approve', reason: 'Approve stale count' });
  rep('A count that is stale (stock moved after it was taken) cannot be approved (409)', r.s === 409 && (await stock(P, W2)) === 35, `[${r.s}] ${r.e}`);
  await api('invmgr', 'POST', `/inventory/stock-counts/${c3.id}/decision`, { decision: 'reject', reason: 'Stale, recount' });

  // zero-variance count posts no adjustment
  r = await api('store1', 'POST', '/inventory/stock-counts', { product_id: P, warehouse_id: W1, counted_quantity: 45, reason: 'Confirm balance' });
  const c4 = r.d || {};
  const before = Number((await q(`select count(*)::int n from stock_movements where product_id=$1 and movement_type='ADJUSTMENT'`, [P]))[0].n);
  r = await api('invmgr', 'POST', `/inventory/stock-counts/${c4.id}/decision`, { decision: 'approve', reason: 'Balance confirmed' });
  rep('Zero-variance count approves without posting an adjustment', r.s === 200 && Number((await q(`select count(*)::int n from stock_movements where product_id=$1 and movement_type='ADJUSTMENT'`, [P]))[0].n) === before);

  // positive variance
  r = await api('store1', 'POST', '/inventory/stock-counts', { product_id: P, warehouse_id: W1, counted_quantity: 50, reason: 'Found extra stock' });
  const c5 = r.d || {};
  r = await api('invmgr', 'POST', `/inventory/stock-counts/${c5.id}/decision`, { decision: 'approve', reason: 'Extra pallet found' });
  rep('Positive variance (+5) increases stock to 50 with signed_quantity +5', r.s === 200 && (await stock(P, W1)) === 50 && Number((await q(`select signed_quantity from stock_movements where product_id=$1 and movement_type='ADJUSTMENT' order by id desc limit 1`, [P]))[0].signed_quantity) === 5);

  // ---------- visibility
  r = await api('store1', 'GET', '/inventory/stock-counts'); rep('Storekeeper only sees counts for their own warehouse', r.s === 200 && r.d.every((c) => c.warehouse_id === W1) && r.d.length >= 3);
  r = await api('store0', 'GET', '/inventory/stock-counts'); rep('Storekeeper without a warehouse sees nothing', r.s === 200 && r.d.length === 0);
  r = await api('opm', 'GET', '/inventory/stock-counts'); rep('Operation Manager sees all counts', r.s === 200 && r.d.some((c) => c.warehouse_id === W1) && r.d.some((c) => c.warehouse_id === W2));
  r = await api('cash', 'GET', '/inventory/stock-counts'); rep('Cashier cannot list counts (403)', r.s === 403);
  r = await api('fin', 'GET', '/inventory/stock-levels'); rep('Finance can read stock levels', r.s === 200);
  r = await api('cash', 'GET', '/inventory/stock-levels'); rep('Cashier cannot read stock levels (403)', r.s === 403);
  r = await api('opm', 'GET', '/inventory/movements'); rep('Operation Manager can read the movement ledger', r.s === 200);

  // ---------- integrity
  const sl = Number((await q('select coalesce(sum(quantity),0) n from stock_levels where product_id=$1', [P]))[0].n);
  const sm = Number((await q('select coalesce(sum(signed_quantity),0) n from stock_movements where product_id=$1', [P]))[0].n);
  rep('Inventory integrity: stock_levels equals the sum of the signed movement ledger', Math.abs(sl - sm) < 0.0005, `levels=${sl} ledger=${sm}`);
  rep('No negative stock level exists for the item', Number((await q('select count(*)::int n from stock_levels where product_id=$1 and quantity<0', [P]))[0].n) === 0);
  const aud = await q(`select action from audit_logs where entity_type='inventory_stock_count' and entity_id = any($1)`, [[c1.id, c2.id, c3.id, c4.id, c5.id]]);
  rep('Every stock count and decision is in the audit trail (5 creates + 5 decisions)', aud.length >= 9, `rows=${aud.length}`);
  rep('General ledger still balanced', await gl());

  await finish();
})().catch((e) => { console.log('ERR', String(e.stack || e.message).replace(/postgres(ql)?:\/\/\S+/gi, '<url>')); process.exit(1); });
