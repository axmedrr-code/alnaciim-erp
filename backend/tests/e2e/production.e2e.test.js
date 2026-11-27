// Production E2E: machines, BOM, batch lifecycle, material consumption, wastage/variance, QC, independent output approval,
// reversals, downtime, and the stock/ledger integrity that results.
const { start } = require('./harness');

(async () => {
  const { api, q, pool, U, rep, finish, gl, stock } = await start('prod', [
    ['pm1', 'Production Manager'], ['pm2', 'Production Manager'], ['tech', 'Technician'], ['cash', 'Cashier'],
    ['opm', 'Operation Manager'], ['store', 'Storekeeper'], ['fin', 'Finance Officer']
  ]);
  const stamp = Date.now();
  const cat = (await q('select id from categories order by id limit 1'))[0].id;
  const mkWh = async (code, name, type) => (await q(`insert into warehouses (code, name, type) values ($1,$2,$3) on conflict (code) do update set is_active=true, type=$3 returning id`, [code, name, type]))[0].id;
  const RMW = await mkWh('TST-PROD-RM', 'E2E Raw Store', 'raw_material'), FGW = await mkWh('TST-PROD-FG', 'E2E Finished Store', 'finished_goods');
  const mkProd = async (sku, type) => (await q(`insert into products (sku, name, category_id, product_type, unit) values ($1,$2,$3,$4,'pcs') returning id`, [`${sku}-${stamp}`, `E2E ${sku} ${stamp}`, cat, type]))[0].id;
  const RM = await mkProd('PRM', 'raw_material'), FG = await mkProd('PFG', 'finished_good'), FG2 = await mkProd('PFG2', 'finished_good');
  await api('admin', 'POST', '/inventory/movements', { product_id: RM, warehouse_id: RMW, movement_type: 'IN', quantity: 1000, reference_type: 'purchase' });
  rep('Setup: 1000 raw units in the raw store', (await stock(RM, RMW)) === 1000);

  // ---------- machines
  let r = await api('tech', 'POST', '/production/machines', { code: `TST-M-${stamp}`, name: 'E2E Filler', type: 'FILLING_LINE' }); rep('Technician cannot create a machine (403)', r.s === 403);
  r = await api('pm1', 'POST', '/production/machines', { code: `TST-M-${stamp}`, name: 'E2E Filler', type: 'WIZARD' }); rep('Invalid machine type -> 400', r.s === 400);
  r = await api('pm1', 'POST', '/production/machines', { code: `TST-M-${stamp}`, name: 'E2E Filler', type: 'FILLING_LINE' });
  const M = r.d || {}; rep('Production Manager creates a machine', r.s === 201 && M.id > 0, `[${r.s}] ${r.e}`);
  r = await api('pm1', 'POST', '/production/machines', { code: `TST-M-${stamp}`, name: 'Duplicate', type: 'FILLING_LINE' }); rep('Duplicate machine code is refused', r.s >= 400 && r.s < 500, `[${r.s}]`);
  r = await api('cash', 'GET', '/production/machines'); rep('Cashier cannot read production machines (403)', r.s === 403);
  r = await api('opm', 'GET', '/production/machines'); rep('Operation Manager can read machines', r.s === 200);

  // ---------- BOM
  r = await api('cash', 'POST', '/production/bom', { product_id: FG, name: 'E2E BOM', items: [{ raw_material_product_id: RM, quantity_per_unit: 2 }] }); rep('Cashier cannot create a BOM (403)', r.s === 403);
  r = await api('pm1', 'POST', '/production/bom', { product_id: FG, name: 'E2E BOM', items: [] }); rep('BOM without lines -> 400', r.s === 400);
  r = await api('pm1', 'POST', '/production/bom', { product_id: FG, name: 'E2E BOM', items: [{ raw_material_product_id: RM, quantity_per_unit: 2 }] }); rep('BOM created: 2 raw units per finished unit', r.s === 201, `[${r.s}] ${r.e}`);

  // ---------- batch creation / lifecycle guards
  const mkBatch = (n, over = {}) => api('pm1', 'POST', '/production/batches', { batch_number: `TST-B${n}-${stamp}`, production_type: 'BOTTLING', product_id: FG, machine_id: M.id, planned_qty: 100, unit: 'pcs', destination_warehouse_id: FGW, ...over });
  r = await api('pm1', 'POST', '/production/batches', { production_type: 'BOTTLING', machine_id: M.id, unit: 'pcs' }); rep('Batch without a batch number -> 400', r.s === 400);
  r = await api('cash', 'POST', '/production/batches', { batch_number: 'X', production_type: 'BOTTLING', machine_id: M.id, unit: 'pcs' }); rep('Cashier cannot create a batch (403)', r.s === 403);
  r = await api('tech', 'POST', '/production/batches', { batch_number: 'X', production_type: 'BOTTLING', machine_id: M.id, unit: 'pcs' }); rep('Technician cannot create a batch (403)', r.s === 403);
  r = await mkBatch('A'); const A = r.d || {}; rep('Batch A created as planned', r.s === 201 && A.status === 'planned', `[${r.s}] ${r.e}`);
  const complete = (who, id, body) => api(who, 'PUT', `/production/batches/${id}/complete`, body);
  r = await complete('pm1', A.id, { actual_qty: 90, qc_status: 'passed', materials_warehouse_id: RMW }); rep('A planned batch cannot be completed before it is started (409)', r.s === 409);
  r = await api('pm1', 'PUT', `/production/batches/${A.id}/start`); rep('Start batch A -> in_progress', r.s === 200 && r.d.status === 'in_progress');
  r = await api('pm1', 'PUT', `/production/batches/${A.id}/start`); rep('Starting twice -> 409', r.s === 409);
  r = await api('pm1', 'PUT', `/production/batches/${A.id}`, { planned_qty: 120, notes: 'edited while in progress' }); rep('An in-progress batch can still be edited', r.s === 200 && Number(r.d.planned_qty) === 120);
  r = await complete('cash', A.id, { actual_qty: 90, qc_status: 'passed', materials_warehouse_id: RMW }); rep('Cashier cannot complete a batch (403)', r.s === 403);
  r = await complete('pm1', A.id, { actual_qty: 90, qc_status: 'passed' }); rep('BOM auto-consumption needs a materials warehouse (400)', r.s === 400);
  r = await complete('pm1', A.id, { actual_qty: 90, qc_status: 'maybe', materials_warehouse_id: RMW }); rep('QC result must be passed or failed (400)', r.s === 400);
  r = await complete('pm1', A.id, { actual_qty: -5, qc_status: 'passed', materials_warehouse_id: RMW }); rep('Negative actual quantity -> 400', r.s === 400);
  r = await complete('pm1', A.id, { actual_qty: 90, wastage_qty: 10, wastage_notes: 'Leaking caps', variance_notes: 'Short run', qc_status: 'passed', materials_warehouse_id: RMW });
  rep('Batch A completed: 90 good + 10 wasted', r.s === 200 && r.d.status === 'completed' && r.d.output_approval_status === 'pending', `[${r.s}] ${r.e}`);
  rep('Consumption follows the BOM incl. wastage: 2 x (90+10) = 200 raw used (1000 -> 800)', (await stock(RM, RMW)) === 800);
  rep('Finished goods are NOT in stock until output is approved', (await stock(FG, FGW)) === 0);
  const bm = await q('select quantity_used from production_batch_materials where batch_id=$1', [A.id]); rep('Material consumption is recorded against the batch', bm.length === 1 && Number(bm[0].quantity_used) === 200);
  r = await api('opm', 'GET', `/production/batches?status=completed`); const rowA = (r.d || []).find((b) => b.id === A.id);
  rep('Variance is reported: actual 90 vs planned 120 = -30 (-25%)', r.s === 200 && rowA && Number(rowA.production_variance) === -30 && Number(rowA.production_variance_pct) === -25, JSON.stringify(rowA && [rowA.production_variance, rowA.production_variance_pct]));
  r = await complete('pm1', A.id, { actual_qty: 90, qc_status: 'passed', materials_warehouse_id: RMW }); rep('Completing twice -> 409', r.s === 409);
  r = await api('pm1', 'DELETE', `/production/batches/${A.id}`); rep('A completed batch cannot be deleted (409)', r.s === 409);

  // ---------- independent output approval
  r = await api('pm1', 'POST', `/production/batches/${A.id}/output-decision`, { decision: 'approve', reason: 'Self approval' }); rep('The supervisor who completed the batch cannot approve its output (403)', r.s === 403);
  r = await api('tech', 'POST', `/production/batches/${A.id}/output-decision`, { decision: 'approve', reason: 'Technician approval' }); rep('Technician cannot approve output (403)', r.s === 403);
  r = await api('pm2', 'POST', `/production/batches/${A.id}/output-decision`, { decision: 'approve', reason: '' }); rep('Approval needs a reason (400)', r.s === 400);
  // read-only materials view used by the output-review panel
  r = await api('pm2', 'GET', `/production/batches/${A.id}/materials`);
  rep('The approver can see the materials the batch consumed (product, quantity, warehouse)', r.s === 200 && r.d.length > 0 && r.d.every((m) => m.product_name && Number(m.quantity_used) > 0 && m.warehouse_name), `[${r.s}] ${r.e}`);
  rep('Materials view is read-only for roles with production view (Cashier refused)', (await api('cash', 'GET', `/production/batches/${A.id}/materials`)).s === 403);
  rep('Materials of an unknown batch -> 404', (await api('pm2', 'GET', '/production/batches/99999999/materials')).s === 404);
  r = await api('pm2', 'GET', '/production/batches');
  const listedA = (r.d || []).find((b) => b.id === A.id);
  rep('The batch list names who completed it and the destination warehouse', !!listedA && listedA.completed_by_name === `E2E prod pm1` && !!listedA.destination_warehouse_name, listedA && `${listedA.completed_by_name} / ${listedA.destination_warehouse_name}`);
  r = await api('pm1', 'POST', `/production/batches/${A.id}/reverse`, { reason: 'too early' }); rep('A batch with pending output approval cannot be reversed (409)', r.s === 409);
  r = await api('pm2', 'POST', `/production/batches/${A.id}/output-decision`, { decision: 'approve', reason: 'QC sheet checked' });
  rep('A second manager approves -> 90 finished units enter stock', r.s === 200 && r.d.output_approval_status === 'approved' && (await stock(FG, FGW)) === 90, `[${r.s}] ${r.e}`);
  r = await api('pm2', 'POST', `/production/batches/${A.id}/output-decision`, { decision: 'approve', reason: 'again' }); rep('Deciding output twice -> 409 (stock not doubled)', r.s === 409 && (await stock(FG, FGW)) === 90);

  // ---------- failed QC
  r = await mkBatch('B'); const B = r.d; await api('pm1', 'PUT', `/production/batches/${B.id}/start`);
  r = await complete('pm1', B.id, { actual_qty: 50, qc_status: 'failed', materials_warehouse_id: RMW });
  rep('Failed-QC batch completes but needs no output approval and adds no finished stock', r.s === 200 && r.d.output_approval_status !== 'pending' && (await stock(FG, FGW)) === 90, `${r.d && r.d.output_approval_status}`);
  rep('...yet its raw materials were consumed (800 -> 700)', (await stock(RM, RMW)) === 700);
  r = await api('pm2', 'POST', `/production/batches/${B.id}/output-decision`, { decision: 'approve', reason: 'Trying to approve failed QC' }); rep('Failed-QC output can never be approved (409)', r.s === 409);
  r = await api('pm1', 'POST', `/production/batches/${B.id}/reverse`, { reason: 'Scrap, return materials' });
  rep('Reversing the failed batch returns the raw materials and removes no finished stock', r.s === 200 && r.d.status === 'reversed' && (await stock(RM, RMW)) === 800 && (await stock(FG, FGW)) === 90, `[${r.s}] ${r.e}`);
  r = await api('pm1', 'POST', `/production/batches/${B.id}/reverse`, { reason: 'again' }); rep('Reversing twice -> 409', r.s === 409);

  // ---------- rejected output
  r = await mkBatch('C'); const C = r.d; await api('pm1', 'PUT', `/production/batches/${C.id}/start`);
  await complete('pm1', C.id, { actual_qty: 40, qc_status: 'passed', materials_warehouse_id: RMW });
  r = await api('pm2', 'POST', `/production/batches/${C.id}/output-decision`, { decision: 'reject', reason: 'Label defects found at audit' });
  rep('Rejected output never enters stock (FG still 90)', r.s === 200 && r.d.output_approval_status === 'rejected' && (await stock(FG, FGW)) === 90);
  r = await api('pm1', 'POST', `/production/batches/${C.id}/reverse`, { reason: 'Rejected, return materials' });
  rep('Reversing a rejected batch returns materials but does not deduct finished goods (RM 800, FG 90)', r.s === 200 && (await stock(RM, RMW)) === 800 && (await stock(FG, FGW)) === 90, `[${r.s}] RM=${await stock(RM, RMW)} FG=${await stock(FG, FGW)}`);

  // ---------- insufficient materials rolls back
  r = await mkBatch('D'); const D = r.d; await api('pm1', 'PUT', `/production/batches/${D.id}/start`);
  r = await complete('pm1', D.id, { actual_qty: 5000, qc_status: 'passed', materials_warehouse_id: RMW });
  rep('Not enough raw material -> refused and fully rolled back', r.s === 400 && (await stock(RM, RMW)) === 800 && (await q('select status from production_batches where id=$1', [D.id]))[0].status === 'in_progress' && (await q('select count(*)::int n from production_batch_materials where batch_id=$1', [D.id]))[0].n === 0, `[${r.s}] ${r.e}`);
  r = await api('pm1', 'DELETE', `/production/batches/${D.id}`); rep('An in-progress batch can be deleted outright (nothing posted)', r.s === 200);

  // ---------- configuration guards
  r = await mkBatch('E', { product_id: FG2 }); const E = r.d; await api('pm1', 'PUT', `/production/batches/${E.id}/start`);
  r = await complete('pm1', E.id, { actual_qty: 10, qc_status: 'passed', materials_warehouse_id: RMW }); rep('Product with no BOM and no explicit materials cannot be completed (409)', r.s === 409, `[${r.s}] ${r.e}`);
  r = await complete('pm1', E.id, { actual_qty: 10, qc_status: 'passed', materials: [{ product_id: RM, quantity_used: 7, warehouse_id: RMW }] });
  rep('Explicit materials are accepted instead of a BOM (RM 800 -> 793)', r.s === 200 && (await stock(RM, RMW)) === 793, `[${r.s}] ${r.e}`);
  r = await mkBatch('F', { destination_warehouse_id: RMW }); const F = r.d; await api('pm1', 'PUT', `/production/batches/${F.id}/start`);
  r = await complete('pm1', F.id, { actual_qty: 10, qc_status: 'passed', materials_warehouse_id: RMW }); rep('Output must go to a finished-goods warehouse (400)', r.s === 400);
  r = await mkBatch('G', { product_id: null, destination_warehouse_id: null }); const Gb = r.d; await api('pm1', 'PUT', `/production/batches/${Gb.id}/start`);
  r = await complete('pm1', Gb.id, { actual_qty: 10, qc_status: 'passed', materials_warehouse_id: RMW }); rep('A batch with no output product/warehouse cannot be completed (400)', r.s === 400);

  // ---------- reverse an approved batch
  r = await api('pm1', 'POST', `/production/batches/${A.id}/reverse`, { reason: 'Customer recall' });
  rep('Reversing approved batch A removes 90 finished units and returns 200 raw (FG 0, RM 993)', r.s === 200 && (await stock(FG, FGW)) === 0 && (await stock(RM, RMW)) === 993, `[${r.s}] FG=${await stock(FG, FGW)} RM=${await stock(RM, RMW)}`);

  // ---------- downtime
  r = await api('tech', 'POST', `/production/machines/${M.id}/downtime`, { start_time: new Date().toISOString(), category: 'breakdown', reason: 'Bearing failure' }); const dt = r.d || {};
  rep('Technician logs a breakdown -> machine status breakdown', r.s === 201 && (await q('select status from machines where id=$1', [M.id]))[0].status === 'breakdown');
  r = await api('cash', 'POST', `/production/machines/${M.id}/downtime`, { start_time: new Date().toISOString(), category: 'breakdown' }); rep('Cashier cannot log downtime (403)', r.s === 403);
  r = await api('tech', 'POST', `/production/machines/${M.id}/downtime`, { start_time: new Date().toISOString(), category: 'gremlins' }); rep('Invalid downtime category -> 400', r.s === 400);
  r = await api('tech', 'PUT', `/production/downtime/${dt.id}/resolve`, {}); rep('Resolving the only open downtime restores the machine to operational', r.s === 200 && (await q('select status from machines where id=$1', [M.id]))[0].status === 'operational');
  r = await api('tech', 'PUT', `/production/downtime/${dt.id}/resolve`, {}); rep('Resolving twice -> 409', r.s === 409);
  r = await api('tech', 'POST', `/production/machines/${M.id}/usage-logs`, { log_date: '2026-11-20', shift: 'Morning', hours_used: 6.5, output_quantity: 300 }); rep('Technician records machine usage', r.s === 201, `[${r.s}] ${r.e}`);
  r = await api('tech', 'POST', `/production/machines/${M.id}/usage-logs`, { log_date: '2026-11-20', hours_used: -2 }); rep('Negative machine hours -> 400', r.s === 400);

  // ---------- reads
  r = await api('opm', 'GET', '/production/capacity-calendar?production_type=BOTTLING&from=2026-11-01&to=2026-11-30'); rep('Operation Manager can read the capacity calendar', r.s === 200, `[${r.s}] ${r.e}`);
  r = await api('cash', 'GET', '/production/capacity-calendar?production_type=BOTTLING&from=2026-11-01&to=2026-11-30'); rep('Cashier cannot read the capacity calendar (403)', r.s === 403);
  r = await api('fin', 'GET', '/production/batches'); rep('Finance cannot read production batches (403) unless in the view group', r.s === 200 || r.s === 403);

  // ---------- audit + integrity
  const aud = await q(`select count(*)::int n from audit_logs where entity_type='production_batch' and entity_id = any($1)`, [[A.id, B.id, C.id, E.id]]);
  rep('Production batch changes are in the audit trail', aud[0].n >= 12, `rows=${aud[0].n}`);
  for (const [label, pid] of [['raw material', RM], ['finished good', FG]]) {
    const sl = Number((await q('select coalesce(sum(quantity),0) n from stock_levels where product_id=$1', [pid]))[0].n);
    const sm = Number((await q('select coalesce(sum(signed_quantity),0) n from stock_movements where product_id=$1', [pid]))[0].n);
    rep(`Inventory integrity (${label}): stock_levels equals the signed movement ledger`, Math.abs(sl - sm) < 0.0005, `levels=${sl} ledger=${sm}`);
  }
  rep('No negative stock for the test items', Number((await q('select count(*)::int n from stock_levels where product_id = any($1) and quantity<0', [[RM, FG, FG2]]))[0].n) === 0);
  rep('General ledger still balanced', await gl());

  await finish();
})().catch((e) => { console.log('ERR', String(e.stack || e.message).replace(/postgres(ql)?:\/\/\S+/gi, '<url>')); process.exit(1); });
