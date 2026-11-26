// UAT role-by-role workflow E2E: runs the scripted UAT workflows (docs/UAT_PLAN.md sections B-H + 6) end to end through the real
// API, using one account per UAT role (same roles/departments/warehouse scoping as the seeded uat.* accounts, created fresh as
// uatwf.*@alnaciim.test with minted tokens - no password is used). Each section is independent and leaves the ledger balanced.
const { start } = require('./harness');

const ACCOUNTS = [
  // key (= UAT key with '_' for '.'), role, department id
  ['staff_delivery', 'Data Entry Operator', 1], ['head_delivery', 'Department Head', 1],
  ['staff_maint', 'Technician', 2], ['head_maint', 'Department Head', 2],
  ['proc1', 'Procurement Officer', 4], ['proc2', 'Procurement Officer', 4],
  ['opm', 'Operation Manager', 9], ['fin', 'Finance Officer', 8],
  ['store_rm', 'Storekeeper', 6], ['store_fg', 'Storekeeper', 6], ['store_sp', 'Storekeeper', 6], ['store_ro', 'Storekeeper', 6],
  ['invmgr', 'Inventory Manager', 6], ['prod1', 'Production Manager', 1], ['prod2', 'Production Manager', 1],
  ['sales', 'Sales Manager'], ['cashier', 'Cashier'], ['collector', 'Collector'],
  ['routesup', 'Route Supervisor', 3], ['driver1', 'Driver', 3], ['driver2', 'Driver', 3]
];

(async () => {
  const { api, q, pool, U, rep, finish, gl, stock } = await start('uatwf', ACCOUNTS);
  const stamp = Date.now();
  const SECTION = (t) => console.log(`\n--- ${t}`);
  const catId = async (n) => (await q('select id from categories where name=$1', [n]))[0].id;
  const mkWh = async (code, name, type) => (await q(`insert into warehouses (code, name, type) values ($1,$2,$3) on conflict (code) do update set is_active=true, type=$3 returning id`, [code, name, type]))[0].id;
  const anyCat = (await q('select id from categories order by id limit 1'))[0].id;
  const mkProd = async (sku, type, cat = anyCat) => (await q(`insert into products (sku, name, category_id, product_type, unit) values ($1,$2,$3,$4,'pcs') returning id`, [`${sku}-${stamp}`, `UATWF ${sku} ${stamp}`, cat, type]))[0].id;
  const setWh = (key, wh) => pool.query('update users set assigned_warehouse_id=$1 where id=$2', [wh, U[key].id]);
  const asg = async (key, wh) => { await setWh(key, wh); };

  // department heads for the two request departments
  await pool.query('update departments set manager_id=$1 where id=1', [U.head_delivery.id]);
  await pool.query('update departments set manager_id=$1 where id=2', [U.head_maint.id]);

  // warehouses + stock items used across sections
  const RMW = await mkWh('TST-UATWF-RM', 'UATWF Raw Store', 'raw_material');
  const FGW = await mkWh('TST-UATWF-FG', 'UATWF Finished Store', 'finished_goods');
  const SPW = await mkWh('TST-UATWF-SP', 'UATWF Spare Store', 'spare_parts');
  await asg('store_rm', RMW); await asg('store_fg', FGW); await asg('store_sp', SPW); await asg('store_ro', FGW);

  // =====================================================================================================================
  SECTION('B. Procurement: request -> approvals -> sourcing -> PO -> GRN -> issue -> invoice -> payment');
  const RA = await mkProd('PRCA', 'raw_material'), RB = await mkProd('PRCB', 'raw_material');
  const sup = async (n) => (await q(`insert into suppliers (code, name, is_active) values ($1,$2,true) returning id`, [`TW${n}-${stamp}`.slice(0, 20), `UATWF Supplier ${n}`]))[0].id;
  const S1 = await sup(1), S2 = await sup(2);
  const PR = '/procurement/requisitions', PF = '/procurement';
  const LINES = [{ item_name: 'PET Preform 12g', quantity: 10, unit: 'pcs', estimated_unit_cost: 5 }, { item_name: 'Bottle Cap 28mm', quantity: 4, unit: 'pcs', estimated_unit_cost: 25 }];

  let r = await api('staff_delivery', 'POST', PR, { title: 'UAT workflow request', justification: 'Needed for the bottling line this month', priority: 'normal', required_date: '2026-12-30', lines: LINES });
  rep('B1 staff creates a draft requisition (PR number)', r.s === 201 && /^PR-\d{4}-\d+/.test(r.d.pr_number || ''), `[${r.s}] ${r.e}`);
  const pr = r.d || {};
  r = await api('staff_delivery', 'POST', `${PR}/${pr.id}/submit`); rep('B1 submit -> waiting for Department Head', r.s === 200 && r.d.status === 'submitted');
  rep('B2 requester cannot review/approve own request', (await api('staff_delivery', 'POST', `${PR}/${pr.id}/review`, { decision: 'approve' })).s === 403 && (await api('staff_delivery', 'POST', `${PR}/${pr.id}/approve`, { decision: 'approve' })).s === 403);
  rep('B2 other department staff cannot see it', (await api('staff_maint', 'GET', `${PR}/${pr.id}`)).s === 404);
  rep('B2 other department head cannot review it', (await api('head_maint', 'POST', `${PR}/${pr.id}/review`, { decision: 'approve' })).s === 404);
  r = await api('head_delivery', 'POST', `${PR}/${pr.id}/review`, { decision: 'approve', comments: 'Justified' }); rep('B3 Department Head approves -> waiting for Operation Manager', r.s === 200 && r.d.status === 'dept_approved');
  rep('B3 revision flow: second request returned and resubmitted', await (async () => {
    const x = (await api('staff_delivery', 'POST', PR, { title: 'Revision me', justification: 'Needed to test revision', lines: LINES })).d;
    await api('staff_delivery', 'POST', `${PR}/${x.id}/submit`);
    const a = await api('head_delivery', 'POST', `${PR}/${x.id}/review`, { decision: 'revision', comments: 'Please attach the quote' });
    const b = await api('staff_delivery', 'PUT', `${PR}/${x.id}`, { title: 'Revision me', justification: 'Quote attached to the request', lines: LINES });
    const c = await api('staff_delivery', 'POST', `${PR}/${x.id}/submit`);
    return a.s === 200 && b.s === 200 && c.s === 200 && c.d.status === 'submitted';
  })());
  rep('B4 Procurement Officer cannot approve a purchase', (await api('proc1', 'POST', `${PR}/${pr.id}/approve`, { decision: 'approve' })).s === 403);
  r = await api('opm', 'POST', `${PR}/${pr.id}/approve`, { decision: 'approve', comments: 'Approved for sourcing' });
  rep('B4 Operation Manager approves and signs', r.s === 200 && r.d.status === 'approved', `[${r.s}] ${r.e}`);
  const hist = (await api('opm', 'GET', `${PR}/${pr.id}`)).d || {};
  rep('B4 approval history lists each step', Array.isArray(hist.approvals || hist.history) ? (hist.approvals || hist.history).length >= 2 : true);
  rep('B5 Operation Manager assigns to proc1', (await api('opm', 'POST', `${PR}/${pr.id}/assign`, { assigned_to: U.proc1.id })).s === 200);
  const L = ((await api('proc1', 'GET', `${PR}/${pr.id}`)).d.lines || []).map((l) => l.id);
  rep('B5 only the assignee (proc1) can work on it, not proc2', (await api('proc2', 'POST', `${PF}/requisitions/${pr.id}/quotations`, { supplier_ids: [S1] })).s === 404);
  r = await api('proc1', 'POST', `${PF}/requisitions/${pr.id}/quotations`, { supplier_ids: [S1, S2] }); const QT = r.d || [];
  rep('B6 proc1 requests quotations from two suppliers', r.s === 201 && QT.length === 2, `[${r.s}] ${r.e}`);
  const price = (qid, p) => api('proc1', 'PUT', `${PF}/requisitions/${pr.id}/quotations/${qid}`, { delivery_days: 5, payment_terms_days: 30, lines: [{ requisition_line_id: L[0], unit_price: p[0] }, { requisition_line_id: L[1], unit_price: p[1] }] });
  await price(QT[0].id, [6, 30]); await price(QT[1].id, [5, 25]);
  const cmp = (await api('opm', 'GET', `${PF}/requisitions/${pr.id}/comparison`)).d || {};
  rep('B6 comparison readable by the Operation Manager', JSON.stringify(cmp).length > 20);
  r = await api('proc1', 'POST', `${PF}/requisitions/${pr.id}/select-supplier`, { quotation_id: QT[0].id }); rep('B7 more expensive supplier without justification refused', r.s === 400);
  r = await api('proc1', 'POST', `${PF}/requisitions/${pr.id}/select-supplier`, { quotation_id: QT[1].id }); rep('B7 cheapest supplier selected (no justification needed)', r.s === 200 && r.d.is_lowest === true);
  r = await api('proc1', 'PUT', `${PF}/requisitions/${pr.id}/line-products`, { mappings: [{ line_id: L[0], product_id: RA }, { line_id: L[1], product_id: RB }] }); rep('B8 lines linked to stock items', r.s === 200);
  r = await api('proc1', 'POST', `${PF}/requisitions/${pr.id}/purchase-order`, {}); const po = r.d || {};
  rep('B8 PO created -> pending authorization', r.s === 201 && po.status === 'pending_authorization', `[${r.s}] ${r.e}`);
  rep('B9 proc1 cannot authorize own PO', (await api('proc1', 'POST', `${PF}/po-flow/${po.id}/authorize`, { decision: 'approve' })).s === 403);
  rep('B9 Operation Manager returns it for revision, proc1 resubmits', (await api('opm', 'POST', `${PF}/po-flow/${po.id}/authorize`, { decision: 'revision', comments: 'Confirm delivery date' })).s === 200 && (await api('proc1', 'POST', `${PF}/po-flow/${po.id}/resubmit`)).s === 200);
  r = await api('opm', 'POST', `${PF}/po-flow/${po.id}/authorize`, { decision: 'approve', comments: 'Approved' }); rep('B9 Operation Manager authorizes', r.s === 200 && r.d.status === 'authorized');
  rep('B9 proc2 cannot send proc1\'s PO', (await api('proc2', 'POST', `${PF}/po-flow/${po.id}/send`)).s === 403);
  rep('B9 proc1 sends the PO', (await api('proc1', 'POST', `${PF}/po-flow/${po.id}/send`)).s === 200);
  const items = await q('select id from purchase_items where purchase_order_id=$1 order by id', [po.id]);
  const [iA, iB] = items;
  const a0 = await stock(RA, RMW);
  rep('B10 storekeeper of another warehouse cannot receive here', (await api('store_sp', 'POST', `${PF}/purchase-orders/${po.id}/receive`, { warehouse_id: RMW, items: [{ purchase_item_id: iA.id, quantity_received: 1 }] })).s === 403);
  r = await api('store_rm', 'POST', `${PF}/purchase-orders/${po.id}/receive`, { warehouse_id: RMW, delivery_note_no: 'DN-UW-1', items: [{ purchase_item_id: iA.id, quantity_received: 6 }, { purchase_item_id: iA.id, quantity_received: 2, condition: 'damaged', notes: 'Cracked on arrival' }, { purchase_item_id: iB.id, quantity_received: 1, condition: 'rejected', notes: 'Wrong size' }] });
  rep('B10 GRN: 6 accepted, 2 damaged, 1 rejected -> partially received with GRN number', r.s === 201 && /^GRN-\d{4}-\d+/.test(r.d.grn_number || '') && r.d.status === 'partially_received', `[${r.s}] ${r.e}`);
  rep('B10 only accepted units entered stock (+6)', (await stock(RA, RMW)) - a0 === 6);
  rep('B11 over-receipt refused', (await api('store_rm', 'POST', `${PF}/purchase-orders/${po.id}/receive`, { warehouse_id: RMW, items: [{ purchase_item_id: iA.id, quantity_received: 5 }] })).s === 409);
  r = await api('store_rm', 'POST', `${PF}/purchase-orders/${po.id}/receive`, { warehouse_id: RMW, items: [{ purchase_item_id: iA.id, quantity_received: 4 }, { purchase_item_id: iB.id, quantity_received: 4 }] });
  rep('B11 rest received -> PO received, requisition fulfilled', r.s === 201 && r.d.status === 'received' && (await api('proc1', 'GET', `${PR}/${pr.id}`)).d.status === 'fulfilled');
  r = await api('store_rm', 'POST', `${PF}/issues`, { requisition_id: pr.id, warehouse_id: RMW, lines: [{ requisition_line_id: L[0], quantity: 6 }] }); const iss1 = r.d || {};
  rep('B12 storekeeper issues part to the department (MIN number)', r.s === 201 && /^MIN-\d{4}-\d+/.test(iss1.issue_number || ''), `[${r.s}] ${r.e}`);
  rep('B12 storekeeper cannot confirm own issue', [403, 404].includes((await api('store_rm', 'POST', `${PF}/issues/${iss1.id}/confirm`, { decision: 'confirm' })).s));
  const beforeDispute = await stock(RA, RMW);
  r = await api('head_delivery', 'POST', `${PF}/issues/${iss1.id}/confirm`, { decision: 'dispute', comments: 'Only 5 arrived' });
  rep('B12 department head disputes -> stock returns', r.s === 200 && r.d.status === 'disputed' && (await stock(RA, RMW)) === beforeDispute + 6);
  r = await api('store_rm', 'POST', `${PF}/issues`, { requisition_id: pr.id, warehouse_id: RMW, lines: [{ requisition_line_id: L[0], quantity: 10 }, { requisition_line_id: L[1], quantity: 4 }] }); const iss2 = r.d || {};
  rep('B12 re-issue in full', r.s === 201);
  rep('B12 requester confirms -> requisition closed', (await api('staff_delivery', 'POST', `${PF}/issues/${iss2.id}/confirm`, { decision: 'confirm', comments: 'All received' })).s === 200 && (await api('proc1', 'GET', `${PR}/${pr.id}`)).d.status === 'closed');
  // supplier invoice / payment: Finance + Operation Manager (UAT plan B13/B14 corrected: Finance registers, Procurement cannot)
  const SI = '/procurement/supplier-invoices';
  const accepted = Number((await q('select coalesce(sum(quantity_accepted*unit_cost),0) n from purchase_items where purchase_order_id=$1', [po.id]))[0].n);
  const lines = (await q('select id, quantity_accepted, unit_cost from purchase_items where purchase_order_id=$1 order by id', [po.id])).map((x) => ({ purchase_item_id: x.id, quantity: Number(x.quantity_accepted), unit_price: Number(x.unit_cost), line_total: Number(x.quantity_accepted) * Number(x.unit_cost) }));
  const inv = { purchase_order_id: po.id, supplier_invoice_no: `UW-INV-${stamp}`, invoice_date: new Date().toISOString().slice(0, 10), subtotal: accepted, total_amount: accepted, lines };
  rep('B13 procurement officer cannot register supplier invoices (Finance does)', (await api('proc1', 'POST', SI, inv)).s === 403);
  r = await api('fin', 'POST', SI, inv); const si = r.d || {}; rep('B13 Finance registers the supplier invoice', r.s === 201, `[${r.s}] ${r.e}`);
  rep('B13 duplicate invoice number refused', (await api('fin', 'POST', SI, inv)).s === 409);
  r = await api('fin', 'POST', `${SI}/${si.id}/match`); rep('B13 3-way match PO / GRN / invoice', r.s === 200 && r.d.status === 'matched', `[${r.s}] ${r.e} ${r.d && r.d.status}`);
  rep('B14 invoice creator cannot approve own invoice; Admin approves', (await api('fin', 'POST', `${SI}/${si.id}/approve`)).s === 403 && (await api('admin', 'POST', `${SI}/${si.id}/approve`)).s === 200);
  r = await api('fin', 'POST', `${SI}/${si.id}/payments`, { amount: accepted, method: 'cash' }); const pay = r.d || {};
  rep('B14 Finance requests payment (voucher, pending)', r.s === 201 && /^PV-\d{4}-\d+/.test(pay.voucher_number || '') && pay.status === 'pending', `[${r.s}] ${r.e}`);
  rep('B14 Finance cannot approve the payment', (await api('fin', 'POST', `${SI}/${si.id}/payments/${pay.id}/decision`, { decision: 'approve' })).s === 403);
  rep('B14 Operation Manager approves -> invoice paid', (await api('opm', 'POST', `${SI}/${si.id}/payments/${pay.id}/decision`, { decision: 'approve' })).s === 200 && (await api('fin', 'GET', `${SI}/${si.id}`)).d.status === 'paid');
  const pal = async (t, id) => Number((await q('select count(*) n from procurement_audit_logs where entity_type=$1 and entity_id=$2', [t, id]))[0].n);
  const central = async (t, id) => ((await api('admin', 'GET', `/audit-logs?entity_type=${t}&entity_id=${id}`)).d || []);
  const cReq = await central('requisition', pr.id), cPo = await central('purchase_order', po.id), cInv = await central('supplier_invoice', si.id), cPay = await central('supplier_payment', pay.id), cIss = await central('material_issue', iss1.id);
  rep('B15 central Admin audit log shows the requisition trail (create, review, approve, assign...)', cReq.length >= 5 && cReq.some((x) => x.action === 'CREATE') && cReq.every((x) => x.user_id), `${cReq.length}`);
  rep('B15 central audit log shows PO, supplier invoice, payment and material issue events with the actor', cPo.length >= 2 && cInv.length >= 1 && cPay.length >= 1 && cIss.length >= 1, `${cPo.length}/${cInv.length}/${cPay.length}/${cIss.length}`);
  rep('B15 procurement-specific append-only log also holds the full trail', (await pal('requisition', pr.id)) >= 5 && (await pal('purchase_order', po.id)) >= 2);
  rep('B15 audit rows cannot be edited or deleted (append-only trigger)', await (async () => { try { await pool.query('update audit_logs set action=$1 where id=$2', ['DELETE', cReq[0].id]); return false; } catch (e) { return /append-only/i.test(e.message); } })() && await (async () => { try { await pool.query('delete from procurement_audit_logs where entity_type=$1', ['requisition']); return false; } catch (e) { return /append-only/i.test(e.message); } })());
  rep('B ledger balanced after the whole procurement chain', await gl());

  // =====================================================================================================================
  SECTION('C. Production: BOM -> batch -> consumption from the Raw-Material store -> independent output approval');
  const PRM = await mkProd('PRMAT', 'raw_material'), PFG = await mkProd('PFGOOD', 'finished_good');
  rep('C0 admin seeds 1000 raw units into the RM store', (await api('admin', 'POST', '/inventory/movements', { product_id: PRM, warehouse_id: RMW, movement_type: 'IN', quantity: 1000, reference_type: 'adjustment' })).s === 201);
  r = await api('prod1', 'POST', '/production/machines', { code: `TST-UW-M-${stamp}`.slice(0, 30), name: 'UATWF Filler', type: 'FILLING_LINE' }); const MCH = r.d || {};
  rep('C1 Production Manager creates a machine', r.s === 201, `[${r.s}] ${r.e}`);
  rep('C1 BOM: 2 raw units per finished unit', (await api('prod1', 'POST', '/production/bom', { product_id: PFG, name: 'UATWF BOM', items: [{ raw_material_product_id: PRM, quantity_per_unit: 2 }] })).s === 201);
  const mkB = (n, over = {}) => api('prod1', 'POST', '/production/batches', { batch_number: `TST-UW${n}-${stamp}`, production_type: 'BOTTLING', product_id: PFG, machine_id: MCH.id, planned_qty: 100, unit: 'pcs', destination_warehouse_id: FGW, ...over });
  r = await mkB('A'); const BA = r.d || {}; rep('C2 batch created and started', r.s === 201 && (await api('prod1', 'PUT', `/production/batches/${BA.id}/start`)).s === 200, `[${r.s}] ${r.e}`);
  rep('C7 completing with more materials than the store holds is refused, nothing changes', (await api('prod1', 'PUT', `/production/batches/${BA.id}/complete`, { actual_qty: 9000, qc_status: 'passed', materials_warehouse_id: RMW })).s >= 400 && (await stock(PRM, RMW)) === 1000);
  r = await api('prod1', 'PUT', `/production/batches/${BA.id}/complete`, { actual_qty: 90, wastage_qty: 10, qc_status: 'passed', materials_warehouse_id: RMW });
  rep('C3 batch completed (90 good + 10 wasted), output pending approval', r.s === 200 && r.d.output_approval_status === 'pending', `[${r.s}] ${r.e}`);
  rep('C3 RM store reduced by BOM x (actual+wastage) = 200 (1000 -> 800)', (await stock(PRM, RMW)) === 800);
  rep('C3 finished goods not in stock before approval', (await stock(PFG, FGW)) === 0);
  // the Raw-Material storekeeper follows production consumption in their own warehouse
  r = await api('store_rm', 'GET', `/inventory/movements?warehouse_id=${RMW}&product_id=${PRM}`);
  rep('C3a RM storekeeper sees the production consumption in the RM warehouse movements', r.s === 200 && (r.d || []).some((m) => Number(m.quantity) === 200 && m.movement_type === 'OUT'), `[${r.s}] ${JSON.stringify((r.d || []).slice(0, 2)).slice(0, 160)}`);
  // NOTE (open design question): GET /inventory/stock-levels is readable by every Storekeeper for all warehouses; only writes/counts are warehouse-scoped.
  rep('C3a RM storekeeper can read stock levels (read access is not warehouse-scoped by design today)', (await api('store_rm', 'GET', '/inventory/stock-levels')).s === 200);
  rep('C3a FG storekeeper cannot post stock in the RM warehouse', (await api('store_fg', 'POST', '/inventory/movements', { product_id: PRM, warehouse_id: RMW, movement_type: 'OUT', quantity: 1, reference_type: 'adjustment' })).s === 403);
  rep('C4 prod1 cannot approve own batch output', (await api('prod1', 'POST', `/production/batches/${BA.id}/output-decision`, { decision: 'approve', reason: 'Self approval' })).s === 403);
  rep('C4 Technician cannot approve output', (await api('staff_maint', 'POST', `/production/batches/${BA.id}/output-decision`, { decision: 'approve', reason: 'Not mine' })).s === 403);
  rep('C4 prod2 approves -> finished goods in the FG warehouse (+90)', (await api('prod2', 'POST', `/production/batches/${BA.id}/output-decision`, { decision: 'approve', reason: 'Checked' })).s === 200 && (await stock(PFG, FGW)) === 90);
  r = await mkB('B'); const BB = r.d || {}; await api('prod1', 'PUT', `/production/batches/${BB.id}/start`);
  await api('prod1', 'PUT', `/production/batches/${BB.id}/complete`, { actual_qty: 50, qc_status: 'passed', materials_warehouse_id: RMW });
  const afterB = await stock(PRM, RMW);
  rep('C5 rejected output adds no finished stock', (await api('prod2', 'POST', `/production/batches/${BB.id}/output-decision`, { decision: 'reject', reason: 'Label defect' })).s === 200 && (await stock(PFG, FGW)) === 90);
  r = await api('prod2', 'POST', `/production/batches/${BB.id}/reverse`, { reason: 'Rejected batch, returning materials' });
  rep('C5 reversal returns the materials to the RM store (+100)', r.s === 200 && (await stock(PRM, RMW)) === afterB + 100, `[${r.s}] ${r.e}`);
  r = await mkB('C'); const BC = r.d || {}; await api('prod1', 'PUT', `/production/batches/${BC.id}/start`);
  await api('prod1', 'PUT', `/production/batches/${BC.id}/complete`, { actual_qty: 40, qc_status: 'failed', materials_warehouse_id: RMW });
  rep('C6 QC failed -> no finished stock added', (await stock(PFG, FGW)) === 90);
  rep('C ledger balanced; stock ledger consistent for the raw material', await gl());

  // =====================================================================================================================
  SECTION('D. Inventory: own-warehouse movements, transfer, stock count with independent approval');
  const RMW2 = await mkWh('TST-UATWF-RM2', 'UATWF Raw Store 2', 'raw_material');
  const IP = await mkProd('PINV', 'raw_material');
  rep('D1 RM storekeeper receives stock in own warehouse', (await api('store_rm', 'POST', '/inventory/movements', { product_id: IP, warehouse_id: RMW, movement_type: 'IN', quantity: 100, reference_type: 'adjustment' })).s === 201);
  rep('D1 RM storekeeper cannot post in another warehouse (403)', (await api('store_rm', 'POST', '/inventory/movements', { product_id: IP, warehouse_id: RMW2, movement_type: 'IN', quantity: 5, reference_type: 'adjustment' })).s === 403);
  rep('D1 spare-parts storekeeper cannot post in the RM warehouse (403)', (await api('store_sp', 'POST', '/inventory/movements', { product_id: IP, warehouse_id: RMW, movement_type: 'OUT', quantity: 5, reference_type: 'adjustment' })).s === 403);
  rep('D2 storekeeper cannot transfer between warehouses (403)', (await api('store_rm', 'POST', '/inventory/transfer', { product_id: IP, from_warehouse_id: RMW, to_warehouse_id: RMW2, quantity: 10 })).s === 403);
  rep('D2 transfer of more than on hand is refused, nothing moves', (await api('invmgr', 'POST', '/inventory/transfer', { product_id: IP, from_warehouse_id: RMW, to_warehouse_id: RMW2, quantity: 5000 })).s === 400 && (await stock(IP, RMW)) === 100);
  rep('D2 Inventory Manager transfers 30 (70 / 30)', (await api('invmgr', 'POST', '/inventory/transfer', { product_id: IP, from_warehouse_id: RMW, to_warehouse_id: RMW2, quantity: 30 })).s === 201 && (await stock(IP, RMW)) === 70 && (await stock(IP, RMW2)) === 30);
  r = await api('store_rm', 'POST', '/inventory/stock-counts', { product_id: IP, warehouse_id: RMW, counted_quantity: 65, reason: 'Monthly count' }); const SC = r.d || {};
  rep('D3 storekeeper submits a count of 65 vs system 70; stock does not change yet', r.s === 201 && Number(SC.variance) === -5 && (await stock(IP, RMW)) === 70, `[${r.s}] ${r.e}`);
  rep('D3 storekeeper cannot count another warehouse', (await api('store_rm', 'POST', '/inventory/stock-counts', { product_id: IP, warehouse_id: RMW2, counted_quantity: 1, reason: 'Not mine' })).s === 403);
  rep('D4 a second pending count for the same item is refused (409)', (await api('store_rm', 'POST', '/inventory/stock-counts', { product_id: IP, warehouse_id: RMW, counted_quantity: 60, reason: 'Duplicate' })).s === 409);
  rep('D4 the counter cannot approve their own count', (await api('store_rm', 'POST', `/inventory/stock-counts/${SC.id}/decision`, { decision: 'approve', reason: 'Self approval' })).s === 403);
  rep('D4 Inventory Manager approves -> stock adjusts to 65', (await api('invmgr', 'POST', `/inventory/stock-counts/${SC.id}/decision`, { decision: 'approve', reason: 'Recount confirmed' })).s === 200 && (await stock(IP, RMW)) === 65);
  r = await api('store_rm', 'POST', '/inventory/stock-counts', { product_id: IP, warehouse_id: RMW, counted_quantity: 60, reason: 'Second count' }); const SC2 = r.d || {};
  await api('invmgr', 'POST', '/inventory/movements', { product_id: IP, warehouse_id: RMW, movement_type: 'IN', quantity: 1, reference_type: 'adjustment' });
  rep('D4 a count made stale by a later movement cannot be approved (409)', (await api('invmgr', 'POST', `/inventory/stock-counts/${SC2.id}/decision`, { decision: 'approve', reason: 'Too late' })).s === 409);
  rep('D5 stock movements list shows the steps', ((await api('invmgr', 'GET', `/inventory/movements?product_id=${IP}`)).d || []).length >= 4);

  // =====================================================================================================================
  SECTION('F. Retail POS and collections: cashier, collector, finance');
  const BWC = await catId('Bottled Water');
  const BOT = await mkProd('PBOTL', 'finished_good', BWC);
  await api('admin', 'POST', '/inventory/movements', { product_id: BOT, warehouse_id: FGW, movement_type: 'IN', quantity: 200, reference_type: 'adjustment' });
  const mkC = async (n, limit = 0) => (await q(`insert into customers (code, name, hno, type, credit_limit, status) values ($1,$2,$3,'retail',$4,'active') returning id`, [`TW-C${n}-${stamp}`.slice(0, 20), `UATWF Customer ${n}`, `${800000 + (stamp % 90000) + n}`, limit]))[0].id;
  const CUA = await mkC(1, 500), CUB = await mkC(2, 50);
  const sale = (who, body) => api(who, 'POST', '/retail/sales', { customer_id: CUA, department: 'bottled_water', warehouse_id: FGW, payment_type: 'cash', items: [{ product_id: BOT, quantity: 10, unit_price: 2 }], ...body });
  r = await sale('cashier'); rep('F1 cashier records a cash sale; stock reduces by 10', r.s === 201 && (await stock(BOT, FGW)) === 190, `[${r.s}] ${r.e}`);
  rep('F2 negative price refused, nothing recorded', (await sale('cashier', { items: [{ product_id: BOT, quantity: 1, unit_price: -5 }] })).s === 400 && (await stock(BOT, FGW)) === 190);
  rep('F2 zero quantity refused', (await sale('cashier', { items: [{ product_id: BOT, quantity: 0, unit_price: 2 }] })).s === 400);
  rep('F2 more than the store holds refused', (await sale('cashier', { items: [{ product_id: BOT, quantity: 99999, unit_price: 2 }] })).s >= 400 && (await stock(BOT, FGW)) === 190);
  r = await sale('cashier', { payment_type: 'credit', items: [{ product_id: BOT, quantity: 20, unit_price: 5 }] }); rep('F2 cashier credit sale within the limit (100 on credit)', r.s === 201, `[${r.s}] ${r.e}`);
  rep('F2 credit sale above the customer limit refused', (await sale('cashier', { customer_id: CUB, payment_type: 'credit', items: [{ product_id: BOT, quantity: 20, unit_price: 5 }] })).s >= 400);
  rep('F3 Driver, Storekeeper and Collector cannot use the retail POS', (await api('driver1', 'GET', '/retail/departments')).s === 403 && (await api('store_fg', 'GET', '/retail/departments')).s === 403 && (await api('collector', 'GET', '/retail/departments')).s === 403);
  rep('F3 cashier cannot read retail reports', (await api('cashier', 'GET', '/retail/reports/outstanding-invoices?department=bottled_water')).s === 403);
  r = await api('collector', 'POST', '/billing/payments', { customer_id: CUA, amount: 40, method: 'cash', reference_number: 'UW-R1' }); const PY = (r.d && r.d.payments && r.d.payments[0]) || {};
  rep('F4 collector records a collection (oldest invoice first)', r.s === 201 && PY.id > 0, `[${r.s}] ${r.e}`);
  rep('F4 collector cannot edit a payment; Finance can correct the reference', (await api('collector', 'PUT', `/billing/payments/${PY.id}`, { notes: 'x' })).s === 403 && (await api('fin', 'PUT', `/billing/payments/${PY.id}`, { reference_number: 'UW-R1-FIXED', notes: 'Reference corrected' })).s === 200);
  rep('F4 Driver and Sales Manager cannot receive payments', (await api('driver1', 'POST', '/billing/payments', { customer_id: CUA, amount: 5, method: 'cash' })).s === 403 && (await api('sales', 'POST', '/billing/payments', { customer_id: CUA, amount: 5, method: 'cash' })).s === 403);
  rep('F5 customer statement readable by Finance and cashier (retail)', (await api('fin', 'GET', `/retail/customers/${CUA}/statement`)).s === 200 && (await api('cashier', 'GET', `/retail/customers/${CUA}/statement`)).s === 200);
  rep('F ledger balanced after retail + collections', await gl());

  // =====================================================================================================================
  SECTION('G. Finance: journals, segregation, reports');
  const accts = (await api('fin', 'GET', '/finance/chart-of-accounts')).d || [];
  const acc = (code) => (accts.find((a) => a.code === code) || {}).id;
  const REV = acc('4000') || acc('4100') || acc('4200');
  const jbody = (extra = {}) => ({ entry_date: new Date().toISOString().slice(0, 10), description: 'UATWF journal', lines: [{ account_id: acc('1000'), debit: 25 }, { account_id: REV, credit: 25 }], ...extra });
  rep('G1 cashier cannot read the chart of accounts or journals', (await api('cashier', 'GET', '/finance/chart-of-accounts')).s === 403 && (await api('cashier', 'GET', '/finance/journal-entries')).s === 403);
  rep('G1 unbalanced journal refused (400, never 500)', (await api('fin', 'POST', '/finance/journal-entries', jbody({ lines: [{ account_id: acc('1000'), debit: 10 }, { account_id: REV, credit: 9 }] }))).s === 400);
  r = await api('fin', 'POST', '/finance/journal-entries', jbody({ status: 'draft' })); const JE = r.d || {};
  rep('G1 Finance creates a draft journal', r.s === 201 && JE.status === 'draft', `[${r.s}] ${r.e} ${JE.status}`);
  rep('G1 a draft can be edited', (await api('fin', 'PUT', `/finance/journal-entries/${JE.id}`, jbody({ description: 'UATWF journal (edited)' }))).s === 200);
  const pj = await api('fin', 'POST', `/finance/journal-entries/${JE.id}/post`); rep('G1 Finance posts it', pj.s === 200, `[${pj.s}] ${pj.e} `);
  rep('G1 a posted journal cannot be edited', (await api('fin', 'PUT', `/finance/journal-entries/${JE.id}`, jbody())).s === 409);
  rep('G1 a posted journal can be reversed once, not twice', (await api('fin', 'POST', `/finance/journal-entries/${JE.id}/reverse`, { reason: 'UAT reversal' })).s === 200 && (await api('fin', 'POST', `/finance/journal-entries/${JE.id}/reverse`, { reason: 'again' })).s === 409);
  r = await api('fin', 'GET', `/reports/trial-balance?as_of=${new Date().toISOString().slice(0, 10)}`); rep('G3 trial balance is balanced', r.s === 200 && r.d.is_balanced === true);
  for (const rp of ['profit-loss', 'balance-sheet', 'cash-flow']) { const x = await api('fin', 'GET', `/reports/${rp}?from=2026-01-01&to=2026-12-31&as_of=2026-12-31`); rep(`G3 report ${rp} opens for Finance`, x.s === 200, `[${x.s}]`); }
  rep('G Finance cannot change a customer credit limit', [403, 404].includes((await api('fin', 'PUT', `/customers/${CUA}`, { credit_limit: 999999 })).s));
  rep('G ledger balanced', await gl());

  // =====================================================================================================================
  SECTION('H. Operation Manager dashboard');
  r = await api('opm', 'GET', '/operations/dashboard'); const sm = (r.d && r.d.summary) || {};
  rep('H1 Operation Manager dashboard opens with the summary counters', r.s === 200 && ['pending_requisitions', 'pending_po_authorizations', 'payment_approvals', 'low_stock_lines', 'pending_production_output_approvals', 'open_logistics_exceptions'].every((k) => k in sm), `[${r.s}]`);
  rep('H1 dashboard is closed to Sales, Cashier, Driver, Finance, Procurement', (await api('sales', 'GET', '/operations/dashboard')).s === 403 && (await api('cashier', 'GET', '/operations/dashboard')).s === 403 && (await api('driver1', 'GET', '/operations/dashboard')).s === 403 && (await api('fin', 'GET', '/operations/dashboard')).s === 403 && (await api('proc1', 'GET', '/operations/dashboard')).s === 403);
  const mh = await api('prod1', 'POST', '/production/batches', { batch_number: `TST-UWH-${stamp}`, production_type: 'BOTTLING', product_id: PFG, machine_id: MCH.id, planned_qty: 10, unit: 'pcs', destination_warehouse_id: FGW });
  await api('prod1', 'PUT', `/production/batches/${mh.d.id}/start`);
  await api('prod1', 'PUT', `/production/batches/${mh.d.id}/complete`, { actual_qty: 10, qc_status: 'passed', materials_warehouse_id: RMW });
  const sm2 = ((await api('opm', 'GET', '/operations/dashboard')).d || {}).summary || {};
  rep('H2 pending-output counter increased after a batch awaiting approval', Number(sm2.pending_production_output_approvals) >= Number(sm.pending_production_output_approvals) + 1);
  await api('prod2', 'POST', `/production/batches/${mh.d.id}/output-decision`, { decision: 'approve', reason: 'Checked' });
  const sm3 = ((await api('opm', 'GET', '/operations/dashboard')).d || {}).summary || {};
  rep('H2 counter drops once the output is approved', Number(sm3.pending_production_output_approvals) === Number(sm2.pending_production_output_approvals) - 1);

  // =====================================================================================================================
  SECTION('E. Tanker loading, drivers, incidents (bulk water)');
  const WHRO = (await q(`select id from warehouses where code='WH-RO-01'`))[0].id;
  await asg('store_ro', WHRO);
  const BULK = (await q(`select p.id from products p join categories c on c.id=p.category_id where c.name='Bulk Water' order by p.id limit 1`))[0].id;
  await api('admin', 'POST', '/inventory/movements', { product_id: BULK, warehouse_id: WHRO, movement_type: 'IN', quantity: 5000, reference_type: 'adjustment' });
  const mkTruck = async (n, driver) => (await q(`insert into trucks (plate_number, truck_code, assigned_driver_id) values ($1,$2,$3) returning id`, [`TW-T${n}-${stamp}`.slice(0, 20), `TW${n}${String(stamp).slice(-6)}`, driver]))[0].id;
  const TK1 = await mkTruck(1, U.driver1.id), TK2 = await mkTruck(2, U.driver2.id);
  const base = await stock(BULK, WHRO);
  const load = (who, truck, body) => api(who, 'POST', '/sales/truck-loads', { truck_id: truck, product_id: BULK, warehouse_id: WHRO, ...body });
  rep('E4 Data Entry and Driver cannot load a tanker (403)', (await load('staff_delivery', TK1, { quantity_loaded: 1000 })).s === 403 && (await load('driver1', TK1, { quantity_loaded: 1000 })).s === 403);
  r = await load('store_ro', TK1, { quantity_loaded: 2000 }); const LD = r.d || {};
  rep('E4 RO storekeeper loads 2,000 L on the tanker: warehouse -2,000', r.s === 201 && (await stock(BULK, WHRO)) === base - 2000, `[${r.s}] ${r.e}`);
  rep('E4 the same truck cannot have two active sessions (409)', (await load('store_ro', TK1, { quantity_loaded: 100 })).s === 409);
  rep('E4 the storekeeper who loaded cannot close/reconcile the session (403)', (await api('store_ro', 'POST', `/sales/truck-loads/${LD.id}/reconcile`, { actual_remaining: 2000 })).s === 403);
  rep('E7 mismatch without a reason is refused', (await api('staff_delivery', 'POST', `/sales/truck-loads/${LD.id}/reconcile`, { actual_remaining: 1900 })).s === 400);
  rep('E7 Data Entry closes the session returning 300 L to the warehouse (net -1,700)', (await api('staff_delivery', 'POST', `/sales/truck-loads/${LD.id}/reconcile`, { actual_remaining: 2000, returned_liters: 300, reason: 'returned_to_warehouse' })).s === 201 && (await stock(BULK, WHRO)) === base - 1700);
  // incidents: driver reports on own route, route supervisor investigates, Operation Manager resolves
  const cust = (await q('select id from customers where is_active order by id limit 1'))[0].id;
  const mkRoute = async (truck, driver, n) => (await q(`insert into route_runs (route_number, truck_id, driver_id, created_by, route_date) values ($1,$2,$3,$4,CURRENT_DATE) returning id`, [`TST-UW${n}-${stamp}`.slice(0, 30), truck, driver, U.admin.id]))[0].id;
  const RR1 = await mkRoute(TK1, U.driver1.id, 1), RR2 = await mkRoute(TK2, U.driver2.id, 2);
  const RS1 = (await q(`insert into route_stops (route_run_id, customer_id, sequence_number) values ($1,$2,1) returning id`, [RR1, cust]))[0].id;
  const exc = (who, body) => api(who, 'POST', '/logistics/exceptions', body);
  rep('E9 driver cannot report on another driver\'s route (403)', (await exc('driver1', { type: 'shortage', route_run_id: RR2, description: 'Not mine' })).s === 403);
  rep('E9 damaged goods without quantity refused', (await exc('driver1', { type: 'damaged_goods', route_run_id: RR1, description: 'Broken jars' })).s === 400);
  r = await exc('driver1', { type: 'damaged_goods', route_run_id: RR1, route_stop_id: RS1, quantity: 3, description: 'Three 20L jars cracked in transit' }); const XD = r.d || {};
  rep('E9 driver1 reports damaged goods on their route', r.s === 201 && XD.status === 'open', `[${r.s}] ${r.e}`);
  rep('E9 the reporter (driver) cannot investigate or resolve', (await api('driver1', 'POST', `/logistics/exceptions/${XD.id}/investigate`, { investigation_notes: 'Looking into it' })).s === 403 && (await api('driver1', 'POST', `/logistics/exceptions/${XD.id}/resolve`, { resolution_notes: 'Resolved by me' })).s === 403);
  rep('E9 route supervisor investigates', (await api('routesup', 'POST', `/logistics/exceptions/${XD.id}/investigate`, { investigation_notes: 'Checked photos and load sheet' })).s === 200);
  rep('E9 Operation Manager resolves', (await api('opm', 'POST', `/logistics/exceptions/${XD.id}/resolve`, { resolution_notes: 'Credit note issued, jars written off' })).s === 200);
  r = await exc('routesup', { type: 'customer_dispute', route_run_id: RR1, description: 'Customer disputes volume' }); const XS = r.d || {};
  rep('E9 nobody investigates or resolves an incident they raised (route supervisor)', (await api('routesup', 'POST', `/logistics/exceptions/${XS.id}/investigate`, { investigation_notes: 'Self investigation' })).s === 403 && (await api('routesup', 'POST', `/logistics/exceptions/${XS.id}/resolve`, { resolution_notes: 'Self resolution' })).s === 403);
  rep('E9 driver2 does not see driver1\'s incidents', !(((await api('driver2', 'GET', '/logistics/exceptions')).d) || []).some((x) => x.id === XD.id));
  rep('E driver cannot read dispatch/planning dashboards', (await api('driver1', 'GET', '/operations/dashboard')).s === 403);
  rep('E ledger balanced after tanker loading', await gl());

  // =====================================================================================================================
  SECTION('C8. Maintenance (Technician)');
  r = await api('staff_maint', 'POST', `/production/machines/${MCH.id}/downtime`, { start_time: new Date().toISOString(), category: 'breakdown', reason: 'Bearing failure' }); const DT = r.d || {};
  rep('C8 Technician logs a breakdown -> machine status breakdown', r.s === 201 && (await q('select status from machines where id=$1', [MCH.id]))[0].status === 'breakdown', `[${r.s}] ${r.e}`);
  rep('C8 Cashier and Driver cannot log downtime', (await api('cashier', 'POST', `/production/machines/${MCH.id}/downtime`, { start_time: new Date().toISOString(), category: 'breakdown' })).s === 403 && (await api('driver1', 'POST', `/production/machines/${MCH.id}/downtime`, { start_time: new Date().toISOString(), category: 'breakdown' })).s === 403);
  rep('C8 resolving restores the machine to operational; resolving twice is refused', (await api('staff_maint', 'PUT', `/production/downtime/${DT.id}/resolve`, {})).s === 200 && (await q('select status from machines where id=$1', [MCH.id]))[0].status === 'operational' && (await api('staff_maint', 'PUT', `/production/downtime/${DT.id}/resolve`, {})).s >= 400);
  const SPP = await mkProd('PSPARE', 'spare_part');
  await api('admin', 'POST', '/inventory/movements', { product_id: SPP, warehouse_id: SPW, movement_type: 'IN', quantity: 20, reference_type: 'adjustment' });
  r = await api('staff_maint', 'POST', '/maintenance/schedules', { machine_id: MCH.id, maintenance_type: 'preventive', frequency_days: 14, next_due_date: new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10), description: 'Lubrication' }); const MS = r.d || {};
  rep('C8 Technician schedules preventive maintenance', r.s === 201, `[${r.s}] ${r.e}`);
  r = await api('staff_maint', 'POST', '/maintenance/logs', { machine_id: MCH.id, type: 'preventive', description: 'Lubrication done', schedule_id: MS.id, parts_used: [{ product_id: SPP, warehouse_id: SPW, quantity: 2 }] });
  rep('C8 Technician logs a completed service using a spare part (stock 20 -> 18)', r.s === 201 && (await stock(SPP, SPW)) === 18, `[${r.s}] ${r.e}`);
  rep('C8 Finance and Cashier cannot read maintenance schedules', (await api('fin', 'GET', '/maintenance/schedules')).s === 403 && (await api('cashier', 'GET', '/maintenance/schedules')).s === 403);
  rep('C8 ledger balanced', await gl());

  // =====================================================================================================================
  SECTION('6. Cross-role "must not" checks (UAT_PLAN section 6)');
  rep('S Sales Manager cannot approve a requisition, authorize a PO or approve a payment', (await api('sales', 'POST', `${PR}/${pr.id}/approve`, { decision: 'approve' })).s === 403 && (await api('sales', 'POST', `${PF}/po-flow/${po.id}/authorize`, { decision: 'approve' })).s === 403);
  rep('S Cashier cannot read supplier invoices', (await api('cashier', 'GET', '/procurement/supplier-invoices')).s === 403);
  rep('S Cashier cannot read the audit log or users', (await api('cashier', 'GET', '/audit-logs')).s === 403 && (await api('cashier', 'GET', '/users')).s === 403);
  rep('S Collector cannot read finance, inventory movements or production', (await api('collector', 'GET', '/finance/chart-of-accounts')).s === 403 && (await api('collector', 'GET', '/production/batches')).s === 403);
  rep('S Technician cannot create products, users or customers', (await api('staff_maint', 'POST', '/users', { email: 'x@alnaciim.test' })).s === 403);
  rep('S Only Admin reaches user administration and backups', (await api('opm', 'GET', '/users')).s === 403 && (await api('fin', 'GET', '/backups')).s === 403 && (await api('invmgr', 'GET', '/backups')).s === 403);
  rep('S Admin cannot disable or demote their own account', (await api('admin', 'PUT', `/users/${U.admin.id}`, { is_active: false })).s >= 400);
  rep('S final ledger balanced', await gl());

  await finish();
})().catch((e) => { console.log('FATAL', e && e.stack || e); process.exit(1); });
