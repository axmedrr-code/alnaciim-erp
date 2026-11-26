// Warehouse-type separation E2E: raw materials, finished goods and spare parts must stay in their own kind of warehouse.
// A 'general' warehouse is unrestricted. Covers manual movements, transfers, goods receipts (GRN), material issues and production.
const { start } = require('./harness');

(async () => {
  const { api, q, pool, U, rep, finish, gl, stock } = await start('wsep', [
    ['invmgr', 'Inventory Manager'], ['store', 'Storekeeper'], ['proc', 'Procurement Officer', 4], ['ops', 'Operation Manager', 9],
    ['pm', 'Production Manager'], ['req', 'Data Entry Operator', 1], ['head', 'Department Head', 1]
  ]);
  const stamp = Date.now();
  const cat = (await q('select id from categories order by id limit 1'))[0].id;
  const mkWh = async (code, name, type) => (await q(`insert into warehouses (code, name, type) values ($1,$2,$3) on conflict (code) do update set is_active=true, type=$3 returning id`, [code, name, type]))[0].id;
  const mkProd = async (sku, type) => (await q(`insert into products (sku, name, category_id, product_type, unit) values ($1,$2,$3,$4,'pcs') returning id`, [`${sku}-${stamp}`, `WSEP ${sku} ${stamp}`, cat, type]))[0].id;
  const RMW = await mkWh('TST-WSEP-RM', 'WSEP Raw', 'raw_material'), FGW = await mkWh('TST-WSEP-FG', 'WSEP Finished', 'finished_goods'), SPW = await mkWh('TST-WSEP-SP', 'WSEP Spare', 'spare_parts'), GEN = await mkWh('TST-WSEP-GEN', 'WSEP General', 'general');
  const RM = await mkProd('WRM', 'raw_material'), FG = await mkProd('WFG', 'finished_good'), SP = await mkProd('WSP', 'spare_part');
  const mv = (who, wh, p, qty = 5, type = 'IN') => api(who, 'POST', '/inventory/movements', { product_id: p, warehouse_id: wh, movement_type: type, quantity: qty, reference_type: 'adjustment' });

  // ---------- correct placements are accepted
  rep('Raw material -> raw-material warehouse accepted', (await mv('invmgr', RMW, RM, 50)).s === 201);
  rep('Finished good -> finished-goods warehouse accepted', (await mv('invmgr', FGW, FG, 50)).s === 201);
  rep('Spare part -> spare-parts warehouse accepted', (await mv('invmgr', SPW, SP, 50)).s === 201);
  rep('Any item -> general warehouse accepted (unrestricted)', (await mv('invmgr', GEN, RM, 5)).s === 201 && (await mv('invmgr', GEN, FG, 5)).s === 201);

  // ---------- wrong placements are refused, nothing moves
  const refused = async (label, who, wh, p) => { const before = await stock(p, wh); const r = await mv(who, wh, p); rep(label, r.s === 400 && (await stock(p, wh)) === before, `[${r.s}] ${r.e}`); };
  await refused('Raw material into the finished-goods warehouse refused (400)', 'invmgr', FGW, RM);
  await refused('Raw material into the spare-parts warehouse refused (400)', 'invmgr', SPW, RM);
  await refused('Finished good into the raw-material warehouse refused (400)', 'invmgr', RMW, FG);
  await refused('Spare part into the raw-material warehouse refused (400)', 'invmgr', RMW, SP);
  await refused('Admin cannot bypass it either', 'admin', FGW, SP);

  // ---------- transfers
  let r = await api('invmgr', 'POST', '/inventory/transfer', { product_id: RM, from_warehouse_id: RMW, to_warehouse_id: FGW, quantity: 5 });
  rep('Transfer of a raw material into a finished-goods warehouse refused (400)', r.s === 400 && (await stock(RM, RMW)) === 50, `[${r.s}] ${r.e}`);
  const RMW2 = await mkWh('TST-WSEP-RM2', 'WSEP Raw 2', 'raw_material');
  rep('Transfer between two raw-material warehouses accepted', (await api('invmgr', 'POST', '/inventory/transfer', { product_id: RM, from_warehouse_id: RMW, to_warehouse_id: RMW2, quantity: 5 })).s === 201);
  rep('Transfer to/from a general warehouse accepted', (await api('invmgr', 'POST', '/inventory/transfer', { product_id: RM, from_warehouse_id: RMW, to_warehouse_id: GEN, quantity: 1 })).s === 201);

  // ---------- goods receipt (GRN) into the wrong kind of warehouse
  const sup = (await q(`insert into suppliers (code, name, is_active) values ($1,$2,true) returning id`, [`TW-${String(stamp).slice(-8)}`, 'WSEP Supplier']))[0].id;
  const po = (await api('proc', 'POST', '/procurement/purchase-orders', { supplier_id: sup, items: [{ product_id: RM, quantity_ordered: 10, unit_cost: 2 }] })).d || {};
  await api('ops', 'POST', `/procurement/po-flow/${po.id}/authorize`, { decision: 'approve' }); await api('proc', 'POST', `/procurement/po-flow/${po.id}/send`);
  const item = (await q('select id from purchase_items where purchase_order_id=$1', [po.id]))[0];
  r = await api('proc', 'POST', `/procurement/purchase-orders/${po.id}/receive`, { warehouse_id: FGW, items: [{ purchase_item_id: item.id, quantity_received: 10 }] });
  rep('GRN of a raw material into a finished-goods warehouse refused (400); PO still open', r.s === 400 && (await stock(RM, FGW)) === 0 && ['sent', 'authorized'].includes((await q('select status from purchase_orders where id=$1', [po.id]))[0].status), `[${r.s}] ${r.e}`);
  r = await api('proc', 'POST', `/procurement/purchase-orders/${po.id}/receive`, { warehouse_id: RMW, items: [{ purchase_item_id: item.id, quantity_received: 10 }] });
  rep('GRN into the raw-material warehouse accepted', r.s === 201, `[${r.s}] ${r.e}`);

  // ---------- production policy: consume only from raw-material warehouses, output only to finished-goods warehouses
  const mch = (await api('pm', 'POST', '/production/machines', { code: `TST-WS-M-${stamp}`.slice(0, 30), name: 'WSEP Filler', type: 'FILLING_LINE' })).d || {};
  await api('pm', 'POST', '/production/bom', { product_id: FG, name: 'WSEP BOM', items: [{ raw_material_product_id: RM, quantity_per_unit: 1 }] });
  const mkB = (n, dest) => api('pm', 'POST', '/production/batches', { batch_number: `TST-WS${n}-${stamp}`, production_type: 'BOTTLING', product_id: FG, machine_id: mch.id, planned_qty: 10, unit: 'pcs', destination_warehouse_id: dest });
  const bw = await mkB('A', RMW);
  let wrongDest = bw.s;
  if (bw.s < 400) {
    await api('pm', 'PUT', `/production/batches/${bw.d.id}/start`);
    const c = await api('pm', 'PUT', `/production/batches/${bw.d.id}/complete`, { actual_qty: 5, qc_status: 'passed', materials_warehouse_id: RMW });
    wrongDest = c.s >= 400 ? c.s : (await api('admin', 'POST', `/production/batches/${bw.d.id}/output-decision`, { decision: 'approve', reason: 'Checking destination policy' })).s;
  }
  rep('Production output to a non-finished-goods destination is refused at creation or approval', wrongDest >= 400, `${wrongDest}`);
  const bb = await mkB('B', FGW); await api('pm', 'PUT', `/production/batches/${bb.d.id}/start`);
  const before = await stock(RM, FGW);
  r = await api('pm', 'PUT', `/production/batches/${bb.d.id}/complete`, { actual_qty: 5, qc_status: 'passed', materials_warehouse_id: FGW });
  rep('Production cannot consume raw materials from a finished-goods warehouse (400)', r.s === 400 && (await stock(RM, FGW)) === before, `[${r.s}] ${r.e}`);
  rep('Production can consume from the raw-material warehouse', (await api('pm', 'PUT', `/production/batches/${bb.d.id}/complete`, { actual_qty: 5, qc_status: 'passed', materials_warehouse_id: RMW })).s === 200);

  // ---------- storekeepers: scoped to own warehouse and, with it, to its kind of stock
  await pool.query('update users set assigned_warehouse_id=$1 where id=$2', [RMW, U.store.id]);
  rep('RM storekeeper cannot post in the finished-goods warehouse (403)', (await mv('store', FGW, FG)).s === 403);
  rep('RM storekeeper cannot put finished goods into his own raw-material warehouse (400)', (await mv('store', RMW, FG)).s === 400);
  rep('ledger balanced', await gl());
  await finish();
})().catch((e) => { console.log('FATAL', e && e.stack || e); process.exit(1); });
