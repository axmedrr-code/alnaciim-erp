const { Router } = require('express');
const { pool, withTransaction } = require('../config/db');
const { asyncHandler, ApiError } = require('../utils/asyncHandler');
const { requireRole } = require('../middleware/auth');
const { PERM } = require('../middleware/permissions');
const { postStockMovement } = require('../utils/stockLedger');
const { validate } = require('../middleware/validate');
const schemas = require('../validation/schemas');
const { logAudit } = require('../services/auditService');
const { postJournalEntry, getAccountByCode, reverseJournalEntry, resolveCostCenterId } = require('../services/accountingService');
const { outputApprovalState, outputWasPosted } = require('../services/productionOutputPolicy');
const { canResolveDowntime, shouldRestoreMachineOperational } = require('../services/productionDowntimePolicy');

const router = Router();

// ---- Machines ----
router.get('/machines', requireRole(...PERM.PRODUCTION_VIEW), asyncHandler(async (req, res) => {
  const { type, status } = req.query;
  const conditions = [];
  const params = [];
  if (type) { params.push(type); conditions.push(`type = $${params.length}`); }
  if (status) { params.push(status); conditions.push(`status = $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await pool.query(`SELECT * FROM machines ${where} ORDER BY name`, params);
  res.json({ data: rows, error: null });
}));

router.post('/machines', requireRole('Admin', 'Production Manager'), validate(schemas.machineCreate), asyncHandler(async (req, res) => {
  const { code, name, type, warehouse_id, purchase_date, specifications } = req.body;
  const result = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO machines (code, name, type, warehouse_id, purchase_date, specifications)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [code, name, type, warehouse_id || null, purchase_date || null, specifications || null]
    );
    await logAudit(client, { userId: req.user.id, action: 'CREATE', entityType: 'machine', entityId: rows[0].id, newValue: rows[0] });
    return rows[0];
  });
  res.status(201).json({ data: result, error: null });
}));

router.post('/machines/:id/usage-logs', requireRole('Admin', 'Production Manager', 'Technician'), validate(schemas.usageLogCreate), asyncHandler(async (req, res) => {
  const { log_date, shift, hours_used, output_quantity, output_unit, notes } = req.body;
  const result = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO machine_usage_logs (machine_id, log_date, shift, hours_used, output_quantity, output_unit, operator_id, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [req.params.id, log_date, shift || null, hours_used, output_quantity || null, output_unit || null, req.user.id, notes || null]
    );
    await logAudit(client, { userId: req.user.id, action: 'CREATE', entityType: 'machine_usage_log', entityId: rows[0].id, newValue: rows[0] });
    return rows[0];
  });
  res.status(201).json({ data: result, error: null });
}));

router.post('/machines/:id/downtime', requireRole('Admin', 'Production Manager', 'Technician'), validate(schemas.downtimeCreate), asyncHandler(async (req, res) => {
  const { start_time, category, reason } = req.body;
  const result = await withTransaction(async (client) => {
    const machine = (await client.query('SELECT * FROM machines WHERE id = $1 FOR UPDATE', [req.params.id])).rows[0];
    if (!machine) throw new ApiError(404, 'Machine not found');
    if (machine.status === 'retired') throw new ApiError(409, 'A retired machine cannot be marked down');
    const { rows } = await client.query(
      `INSERT INTO downtime_logs (machine_id, start_time, category, reason, reported_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [req.params.id, start_time, category, reason || null, req.user.id]
    );
    const updatedMachine = (await client.query(`UPDATE machines SET status = 'breakdown' WHERE id = $1 AND status != 'breakdown' RETURNING *`, [req.params.id])).rows[0];
    await logAudit(client, { userId: req.user.id, action: 'CREATE', entityType: 'machine_downtime', entityId: rows[0].id, newValue: rows[0] });
    if (updatedMachine) await logAudit(client, { userId: req.user.id, action: 'UPDATE', entityType: 'machine', entityId: machine.id, oldValue: machine, newValue: updatedMachine });
    return rows[0];
  });
  res.status(201).json({ data: result, error: null });
}));

router.put('/downtime/:id/resolve', requireRole('Admin', 'Production Manager', 'Technician'), validate(schemas.downtimeResolve), asyncHandler(async (req, res) => {
  const { end_time } = req.body;
  const result = await withTransaction(async (client) => {
    const downtime = (await client.query('SELECT * FROM downtime_logs WHERE id = $1 FOR UPDATE', [req.params.id])).rows[0];
    if (!downtime) throw new ApiError(404, 'Downtime log not found');
    if (!canResolveDowntime(downtime)) throw new ApiError(409, 'This downtime log has already been resolved');
    const machine = (await client.query('SELECT * FROM machines WHERE id = $1 FOR UPDATE', [downtime.machine_id])).rows[0];
    const resolved = (await client.query(
      `UPDATE downtime_logs SET end_time = $1, resolved_by = $2 WHERE id = $3 RETURNING *`,
      [end_time || new Date(), req.user.id, downtime.id]
    )).rows[0];
    const otherOpen = Number((await client.query(
      'SELECT COUNT(*) AS count FROM downtime_logs WHERE machine_id = $1 AND end_time IS NULL AND id <> $2',
      [downtime.machine_id, downtime.id]
    )).rows[0].count);
    let updatedMachine = null;
    if (machine && shouldRestoreMachineOperational(machine.status, otherOpen)) {
      updatedMachine = (await client.query(`UPDATE machines SET status = 'operational' WHERE id = $1 RETURNING *`, [machine.id])).rows[0];
    }
    await logAudit(client, { userId: req.user.id, action: 'UPDATE', entityType: 'machine_downtime', entityId: downtime.id, oldValue: downtime, newValue: resolved });
    if (updatedMachine) await logAudit(client, { userId: req.user.id, action: 'UPDATE', entityType: 'machine', entityId: machine.id, oldValue: machine, newValue: updatedMachine });
    return resolved;
  });
  res.json({ data: result, error: null });
}));

// ---- Machine Costing ----
async function resolveMachineCostAccount(client, category) {
  const { rows } = await client.query('SELECT coa_account_id FROM machine_cost_category_accounts WHERE category = $1', [category]);
  if (!rows[0]) throw new ApiError(400, `Machine cost category "${category}" is not mapped to a Chart of Accounts account`);
  return rows[0].coa_account_id;
}

router.get('/machines/:id/costs', requireRole(...PERM.PRODUCTION_COST), asyncHandler(async (req, res) => {
  const { from, to } = req.query;
  const conditions = ['mc.machine_id = $1', 'mc.voided_at IS NULL'];
  const params = [req.params.id];
  if (from) { params.push(from); conditions.push(`mc.cost_date >= $${params.length}`); }
  if (to) { params.push(to); conditions.push(`mc.cost_date <= $${params.length}`); }
  const { rows } = await pool.query(
    `SELECT mc.*, u.full_name AS recorded_by_name, cc.name AS cost_center_name
     FROM machine_costs mc JOIN users u ON u.id = mc.recorded_by LEFT JOIN cost_centers cc ON cc.id = mc.cost_center_id
     WHERE ${conditions.join(' AND ')} ORDER BY mc.cost_date DESC`,
    params
  );
  res.json({ data: rows, error: null });
}));

router.post('/machines/:id/costs', requireRole('Admin', 'Production Manager', 'Technician'), validate(schemas.machineCostCreate), asyncHandler(async (req, res) => {
  const { category, amount, cost_date, description, payment_method, bank_account_id } = req.body;
  const method = payment_method || 'cash';

  const result = await withTransaction(async (client) => {
    const { rows: machineRows } = await client.query('SELECT * FROM machines WHERE id = $1', [req.params.id]);
    if (!machineRows[0]) throw new ApiError(404, 'Machine not found');

    const costCenterId = await resolveCostCenterId(client, req.body.cost_center_id, 'CC-PROD');
    const { rows } = await client.query(
      `INSERT INTO machine_costs (machine_id, category, amount, cost_date, description, cost_center_id, payment_method, bank_account_id, recorded_by)
       VALUES ($1,$2,$3,COALESCE($4,CURRENT_DATE),$5,$6,$7,$8,$9) RETURNING *`,
      [req.params.id, category, amount, cost_date || null, description || null, costCenterId, method, bank_account_id || null, req.user.id]
    );
    const cost = rows[0];

    const expenseAcct = await resolveMachineCostAccount(client, category);
    let cashOrBankAcct;
    if (method === 'cash') {
      cashOrBankAcct = (await getAccountByCode(client, '1000')).id;
    } else if (bank_account_id) {
      const { rows: bankRows } = await client.query('SELECT coa_account_id FROM bank_accounts WHERE id = $1', [bank_account_id]);
      cashOrBankAcct = bankRows[0] ? bankRows[0].coa_account_id : (await getAccountByCode(client, '1010')).id;
    } else {
      cashOrBankAcct = (await getAccountByCode(client, '1010')).id;
    }

    await postJournalEntry(client, {
      entryDate: cost.cost_date, description: `Machine cost - ${machineRows[0].name} - ${category}`,
      source: 'system', referenceType: 'machine_cost', referenceId: cost.id, createdBy: req.user.id,
      lines: [
        { accountId: expenseAcct, debit: amount, credit: 0, costCenterId },
        { accountId: cashOrBankAcct, debit: 0, credit: amount, costCenterId }
      ]
    });

    await logAudit(client, { userId: req.user.id, action: 'CREATE', entityType: 'machine_cost', entityId: cost.id, newValue: cost });
    return cost;
  });

  res.status(201).json({ data: result, error: null });
}));

router.post('/machine-costs/:id/reverse', requireRole('Admin', 'Production Manager'), validate(schemas.reverseRequest), asyncHandler(async (req, res) => {
  const { reason } = req.body;
  const result = await withTransaction(async (client) => {
    const { rows: costRows } = await client.query('SELECT * FROM machine_costs WHERE id = $1 FOR UPDATE', [req.params.id]);
    const cost = costRows[0];
    if (!cost) throw new ApiError(404, 'Machine cost not found');
    if (cost.voided_at) throw new ApiError(409, 'This machine cost has already been reversed');

    const { rows: entryRows } = await client.query(
      `SELECT id FROM journal_entries WHERE reference_type = 'machine_cost' AND reference_id = $1 AND status = 'posted' ORDER BY id DESC LIMIT 1`,
      [cost.id]
    );
    if (!entryRows[0]) throw new ApiError(409, 'No posted journal entry found for this cost');

    await reverseJournalEntry(client, {
      entryId: entryRows[0].id, createdBy: req.user.id,
      description: `Reversal of machine cost #${cost.id}${reason ? ' - ' + reason : ''}`
    });

    const { rows: voided } = await client.query(
      `UPDATE machine_costs SET voided_at = now(), voided_by = $1, void_reason = $2 WHERE id = $3 RETURNING *`,
      [req.user.id, reason || null, cost.id]
    );
    await logAudit(client, { userId: req.user.id, action: 'UPDATE', entityType: 'machine_cost', entityId: cost.id, oldValue: cost, newValue: voided[0] });
    return voided[0];
  });
  res.json({ data: result, error: null });
}));

// Revenue is a proportional attribution, flagged the same way other approximations in
// this app are (see finance.routes.js /profitability comment on unit_cost): every batch
// this machine ran attributes revenue by (batch actual_qty / total qty of that product
// sold in the period), since a machine doesn't sell directly. Expenses = machine_costs +
// the existing flat maintenance_logs.cost for this machine (already tracked, never
// GL-posted — read here as-is, same as elsewhere in the app).
router.get('/machines/:id/profitability', requireRole(...PERM.PRODUCTION_COST), asyncHandler(async (req, res) => {
  const { from, to } = req.query;
  const params = [req.params.id, from || '1900-01-01', to || '2999-12-31'];
  const { rows: machine } = await pool.query('SELECT * FROM machines WHERE id = $1', [req.params.id]);
  if (!machine[0]) throw new ApiError(404, 'Machine not found');

  const { rows: revenueRows } = await pool.query(
    `SELECT COALESCE(SUM(
       (pb.actual_qty / NULLIF(product_totals.total_actual, 0)) * product_sales.revenue
     ), 0) AS revenue
     FROM production_batches pb
     JOIN (
       SELECT product_id, SUM(actual_qty) AS total_actual FROM production_batches
       WHERE status = 'completed' AND start_time::date BETWEEN $2 AND $3 GROUP BY product_id
     ) product_totals ON product_totals.product_id = pb.product_id
     JOIN (
       SELECT soi.product_id, SUM(soi.subtotal) AS revenue
       FROM sales_order_items soi JOIN sales_orders so ON so.id = soi.sales_order_id
       WHERE so.status NOT IN ('cancelled','reversed') AND so.order_date BETWEEN $2 AND $3
       GROUP BY soi.product_id
     ) product_sales ON product_sales.product_id = pb.product_id
     WHERE pb.machine_id = $1 AND pb.status = 'completed' AND pb.start_time::date BETWEEN $2 AND $3`,
    params
  );
  const { rows: costRows } = await pool.query(
    `SELECT COALESCE(SUM(amount), 0) AS total FROM machine_costs WHERE machine_id = $1 AND voided_at IS NULL AND cost_date BETWEEN $2 AND $3`,
    params
  );
  const { rows: maintRows } = await pool.query(
    `SELECT COALESCE(SUM(cost), 0) AS total FROM maintenance_logs WHERE machine_id = $1 AND log_date BETWEEN $2 AND $3`,
    params
  );

  const revenue = Number(revenueRows[0].revenue);
  const expenses = Number(costRows[0].total) + Number(maintRows[0].total);

  res.json({
    data: {
      machine: machine[0], revenue, machine_costs: Number(costRows[0].total), maintenance_costs: Number(maintRows[0].total),
      expenses, profit: revenue - expenses
    },
    error: null
  });
}));

// ---- Production batches ----
router.get('/batches', requireRole(...PERM.PRODUCTION_VIEW), asyncHandler(async (req, res) => {
  const { date, production_type, status } = req.query;
  const conditions = [];
  const params = [];
  if (date) { params.push(date); conditions.push(`pb.start_time::date = $${params.length}`); }
  if (production_type) { params.push(production_type); conditions.push(`pb.production_type = $${params.length}`); }
  if (status) { params.push(status); conditions.push(`pb.status = $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows } = await pool.query(
    `SELECT pb.*, (pb.actual_qty - pb.planned_qty) AS production_variance,
            CASE WHEN pb.planned_qty > 0 AND pb.actual_qty IS NOT NULL THEN ((pb.actual_qty - pb.planned_qty) / pb.planned_qty) * 100 ELSE NULL END AS production_variance_pct,
            m.name AS machine_name, p.name AS product_name, u.full_name AS supervisor_name,
            cu.full_name AS completed_by_name, dw.name AS destination_warehouse_name
     FROM production_batches pb
     JOIN machines m ON m.id = pb.machine_id
     LEFT JOIN products p ON p.id = pb.product_id
     JOIN users u ON u.id = pb.supervisor_id
     LEFT JOIN users cu ON cu.id = pb.completed_by
     LEFT JOIN warehouses dw ON dw.id = pb.destination_warehouse_id
     ${where}
     ORDER BY pb.start_time DESC NULLS LAST`,
    params
  );
  res.json({ data: rows, error: null });
}));

// Raw materials a batch actually consumed (read-only), so the output approver sees what went in before deciding.
router.get('/batches/:id/materials', requireRole(...PERM.PRODUCTION_VIEW), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new ApiError(404, 'Batch not found');
  const batch = (await pool.query('SELECT id FROM production_batches WHERE id = $1', [id])).rows[0];
  if (!batch) throw new ApiError(404, 'Batch not found');
  const { rows } = await pool.query(
    `SELECT pbm.product_id, p.name AS product_name, p.unit, pbm.quantity_used, w.name AS warehouse_name
     FROM production_batch_materials pbm JOIN products p ON p.id = pbm.product_id LEFT JOIN warehouses w ON w.id = pbm.warehouse_id
     WHERE pbm.batch_id = $1 ORDER BY p.name`, [id]);
  res.json({ data: rows, error: null });
}));

router.post('/batches', requireRole('Admin', 'Production Manager'), validate(schemas.batchCreate), asyncHandler(async (req, res) => {
  const { batch_number, production_type, product_id, machine_id, planned_qty, unit, shift, start_time, destination_warehouse_id, notes } = req.body;
  const result = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO production_batches
         (batch_number, production_type, product_id, machine_id, planned_qty, unit, shift, start_time, supervisor_id, destination_warehouse_id, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [batch_number, production_type, product_id || null, machine_id, planned_qty || 0, unit, shift || null, start_time || null, req.user.id, destination_warehouse_id || null, notes || null]
    );
    await logAudit(client, { userId: req.user.id, action: 'CREATE', entityType: 'production_batch', entityId: rows[0].id, newValue: rows[0] });
    return rows[0];
  });
  res.status(201).json({ data: result, error: null });
}));

// Nothing posts to the stock ledger until a batch is completed, so 'planned'/'in_progress'
// is a genuine draft window — freely editable.
router.put('/batches/:id', requireRole('Admin', 'Production Manager'), validate(schemas.batchUpdate), asyncHandler(async (req, res) => {
  const fields = ['product_id', 'machine_id', 'planned_qty', 'unit', 'shift', 'start_time', 'destination_warehouse_id', 'notes'];
  const updates = [];
  const params = [];
  for (const f of fields) {
    if (req.body[f] !== undefined) { params.push(req.body[f]); updates.push(`${f} = $${params.length}`); }
  }
  if (!updates.length) throw new ApiError(400, 'No fields to update');
  params.push(req.params.id);

  const result = await withTransaction(async (client) => {
    const { rows: before } = await client.query('SELECT * FROM production_batches WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!before[0]) throw new ApiError(404, 'Batch not found');
    if (!['planned', 'in_progress'].includes(before[0].status)) {
      throw new ApiError(409, 'Only a planned/in-progress batch can be edited. Use Reverse Adjustment to correct a completed one.');
    }
    const { rows } = await client.query(`UPDATE production_batches SET ${updates.join(', ')} WHERE id = $${params.length} RETURNING *`, params);
    await logAudit(client, { userId: req.user.id, action: 'UPDATE', entityType: 'production_batch', entityId: rows[0].id, oldValue: before[0], newValue: rows[0] });
    return rows[0];
  });
  res.json({ data: result, error: null });
}));

// Draft-only hard delete — nothing has posted to inventory before completion.
router.delete('/batches/:id', requireRole('Admin', 'Production Manager'), asyncHandler(async (req, res) => {
  const result = await withTransaction(async (client) => {
    const { rows: batchRows } = await client.query('SELECT * FROM production_batches WHERE id = $1 FOR UPDATE', [req.params.id]);
    const batch = batchRows[0];
    if (!batch) throw new ApiError(404, 'Batch not found');
    if (!['planned', 'in_progress'].includes(batch.status)) {
      throw new ApiError(409, 'Only a planned/in-progress batch can be deleted outright. Use Reverse Adjustment for a completed one.');
    }
    await client.query('DELETE FROM production_batches WHERE id = $1', [batch.id]);
    await logAudit(client, { userId: req.user.id, action: 'DELETE', entityType: 'production_batch', entityId: batch.id, oldValue: batch });
    return { id: batch.id };
  });
  res.json({ data: result, error: null });
}));

router.put('/batches/:id/start', requireRole('Admin', 'Production Manager'), asyncHandler(async (req, res) => {
  const result = await withTransaction(async (client) => {
    const batch = (await client.query('SELECT * FROM production_batches WHERE id = $1 FOR UPDATE', [req.params.id])).rows[0];
    if (!batch) throw new ApiError(404, 'Batch not found');
    if (batch.status !== 'planned') throw new ApiError(409, 'Only a planned batch can be started');
    const started = (await client.query(
      `UPDATE production_batches SET status = 'in_progress', start_time = COALESCE(start_time, now()) WHERE id = $1 RETURNING *`,
      [batch.id]
    )).rows[0];
    await logAudit(client, { userId: req.user.id, action: 'UPDATE', entityType: 'production_batch', entityId: batch.id, oldValue: batch, newValue: started });
    return started;
  });
  res.json({ data: result, error: null });
}));

// Completing a batch: records material consumption (OUT) and finished-goods output (IN)
// in a single transaction against the stock ledger. If `materials` isn't given explicitly,
// consumption is auto-calculated from the product's bill of materials (quantity_per_unit ×
// (actual_qty + wastage_qty), since wasted units still consumed raw material).
router.put('/batches/:id/complete', requireRole('Admin', 'Production Manager'), validate(schemas.batchComplete), asyncHandler(async (req, res) => {
  const { actual_qty, wastage_qty, wastage_notes, variance_notes, materials, materials_warehouse_id, qc_status } = req.body;

  const result = await withTransaction(async (client) => {
    const { rows: batchRows } = await client.query('SELECT * FROM production_batches WHERE id = $1 FOR UPDATE', [req.params.id]);
    const batch = batchRows[0];
    if (!batch) throw new ApiError(404, 'Batch not found');
    if (batch.status !== 'in_progress') throw new ApiError(409, 'Only an in-progress batch can be completed');

    // RO Water production is the only source of Finished Water Warehouse
    // stock — a batch that can't actually receipt anywhere would complete
    // with the truck-loading side none the wiser, so this is caught here
    // rather than silently allowed.
    if (!batch.product_id || !batch.destination_warehouse_id)
      throw new ApiError(400, 'Every production batch needs an Output Product and Finished Goods Warehouse before completion.');
    if (batch.product_id) {
      const output = (await client.query("SELECT id FROM products WHERE id=$1 AND product_type='finished_good' AND is_active=true", [batch.product_id])).rows[0];
      const destination = (await client.query("SELECT id FROM warehouses WHERE id=$1 AND type='finished_goods' AND is_active=true", [batch.destination_warehouse_id])).rows[0];
      if (!output || !destination) throw new ApiError(400, 'Production output must use an active finished-good product and active finished-goods warehouse');
    }

    let resolvedMaterials = materials;
    if (!resolvedMaterials && batch.product_id) {
      const { rows: bomRows } = await client.query(
        `SELECT bi.raw_material_product_id, bi.quantity_per_unit
         FROM bill_of_materials bom JOIN bom_items bi ON bi.bom_id = bom.id
         WHERE bom.product_id = $1 AND bom.is_active = true`,
        [batch.product_id]
      );
      if (bomRows.length) {
        if (!materials_warehouse_id) throw new ApiError(400, 'materials_warehouse_id is required to auto-consume from this product\'s bill of materials');
        const totalUnits = Number(actual_qty) + Number(wastage_qty || 0);
        resolvedMaterials = bomRows.map((bi) => ({
          product_id: bi.raw_material_product_id,
          quantity_used: Number(bi.quantity_per_unit) * totalUnits,
          warehouse_id: materials_warehouse_id
        }));
      }
    }

    if (!resolvedMaterials?.length) {
      throw new ApiError(409, 'No production materials are configured for this batch. Add an active bill of materials or submit material consumption before completion.');
    }

    for (const m of resolvedMaterials) {
      const rawMaterial = (await client.query("SELECT id FROM products WHERE id=$1 AND product_type='raw_material' AND is_active=true", [m.product_id])).rows[0];
      const materialsWarehouse = (await client.query("SELECT id FROM warehouses WHERE id=$1 AND type='raw_material' AND is_active=true", [m.warehouse_id])).rows[0];
      if (!rawMaterial || !materialsWarehouse) throw new ApiError(400, 'Production consumption must reference active raw-material products and raw-material warehouses');
      await client.query(
        `INSERT INTO production_batch_materials (batch_id, product_id, quantity_used, warehouse_id) VALUES ($1,$2,$3,$4)`,
        [batch.id, m.product_id, m.quantity_used, m.warehouse_id]
      );
      await postStockMovement(client, {
        productId: m.product_id, warehouseId: m.warehouse_id, movementType: 'OUT', quantity: m.quantity_used,
        referenceType: 'production', referenceId: batch.id, performedBy: req.user.id,
        notes: `Consumed in ${batch.batch_number}`
      });
    }

    const { rows: updated } = await client.query(
      `UPDATE production_batches SET status = 'completed', actual_qty = $1, wastage_qty = $2, wastage_notes = $3, variance_notes = $4,
       qc_status = $5, end_time = now(), output_approval_status = $6, completed_by = $7 WHERE id = $8 RETURNING *`,
      [actual_qty, wastage_qty || 0, wastage_notes || null, variance_notes || null, qc_status,
        outputApprovalState({ productId: batch.product_id, destinationWarehouseId: batch.destination_warehouse_id, qcStatus: qc_status, actualQty: actual_qty }), req.user.id, batch.id]
    );
    await logAudit(client, { userId: req.user.id, action: 'UPDATE', entityType: 'production_batch', entityId: batch.id,
      oldValue: batch, newValue: updated[0] });
    return updated[0];
  });

  res.json({ data: result, error: null });
}));

router.post('/batches/:id/output-decision', requireRole('Admin', 'Production Manager'),
  validate(schemas.productionOutputDecision), asyncHandler(async (req, res) => {
    const result = await withTransaction(async (client) => {
      const batch = (await client.query('SELECT * FROM production_batches WHERE id=$1 FOR UPDATE', [req.params.id])).rows[0];
      if (!batch) throw new ApiError(404, 'Batch not found');
      if (batch.status !== 'completed' || batch.output_approval_status !== 'pending')
        throw new ApiError(409, 'Only a completed QC-passed batch awaiting output approval can be decided');
      if ((batch.completed_by || batch.supervisor_id) === req.user.id && req.user.role !== 'Admin')
        throw new ApiError(403, 'The batch supervisor cannot approve their own production output');
      if (req.body.decision === 'reject') {
        const rejected = (await client.query(
          `UPDATE production_batches SET output_approval_status='rejected',output_approved_by=$1,output_approved_at=now(),output_decision_reason=$2
           WHERE id=$3 RETURNING *`, [req.user.id, req.body.reason, batch.id]
        )).rows[0];
        await logAudit(client, { userId: req.user.id, action: 'UPDATE', entityType: 'production_batch', entityId: batch.id,
          oldValue: { output_approval_status: 'pending' }, newValue: { output_approval_status: 'rejected', reason: req.body.reason } });
        return rejected;
      }
      if (!batch.product_id || !batch.destination_warehouse_id || batch.qc_status !== 'passed' || Number(batch.actual_qty) <= 0)
        throw new ApiError(409, 'Only positive-quantity QC-passed output assigned to a warehouse can be approved');
      await postStockMovement(client, { productId: batch.product_id, warehouseId: batch.destination_warehouse_id,
        movementType: 'IN', quantity: Number(batch.actual_qty), referenceType: 'production', referenceId: batch.id,
        performedBy: req.user.id, notes: `Approved output of ${batch.batch_number}` });
      const approved = (await client.query(
        `UPDATE production_batches SET output_approval_status='approved',output_approved_by=$1,output_approved_at=now(),output_decision_reason=$2
         WHERE id=$3 RETURNING *`, [req.user.id, req.body.reason, batch.id]
      )).rows[0];
      await logAudit(client, { userId: req.user.id, action: 'UPDATE', entityType: 'production_batch', entityId: batch.id,
        oldValue: { output_approval_status: 'pending' }, newValue: { output_approval_status: 'approved',
          approved_by: req.user.id, product_id: batch.product_id, destination_warehouse_id: batch.destination_warehouse_id,
          quantity: Number(batch.actual_qty), reason: req.body.reason } });
      return approved;
    });
    res.json({ data: result, error: null });
  }));

// Reverse Adjustment: undoes a completed batch's physical stock effects — returns
// consumed raw materials (IN) and removes the finished-goods output (OUT) — then flags
// the batch 'reversed'. No ledger entries exist for production, so this is purely a
// stock-ledger correction (unlike the other modules' journal-entry reversals).
router.post('/batches/:id/reverse', requireRole('Admin', 'Production Manager'), validate(schemas.reverseRequest), asyncHandler(async (req, res) => {
  const { reason } = req.body;

  const result = await withTransaction(async (client) => {
    const { rows: batchRows } = await client.query('SELECT * FROM production_batches WHERE id = $1 FOR UPDATE', [req.params.id]);
    const batch = batchRows[0];
    if (!batch) throw new ApiError(404, 'Batch not found');
    if (batch.status !== 'completed') throw new ApiError(409, 'Only a completed batch can be reverse-adjusted');
    if (batch.output_approval_status === 'pending') throw new ApiError(409, 'Decide the pending output approval before reversing this batch');

    const { rows: materials } = await client.query('SELECT * FROM production_batch_materials WHERE batch_id = $1', [batch.id]);
    for (const m of materials) {
      await postStockMovement(client, {
        productId: m.product_id, warehouseId: m.warehouse_id, movementType: 'IN', quantity: Number(m.quantity_used),
        referenceType: 'adjustment', referenceId: batch.id, performedBy: req.user.id,
        notes: `Reversal of consumption in ${batch.batch_number}${reason ? ' - ' + reason : ''}`
      });
    }

    // A 'failed'-QC batch never posted a stock receipt in the first place
    // (see /complete above) — nothing to reverse here, or this would
    // deduct stock that was never actually added.
    if (outputWasPosted(batch)) {
      await postStockMovement(client, {
        productId: batch.product_id, warehouseId: batch.destination_warehouse_id, movementType: 'OUT', quantity: Number(batch.actual_qty),
        referenceType: 'adjustment', referenceId: batch.id, performedBy: req.user.id,
        notes: `Reversal of output from ${batch.batch_number}${reason ? ' - ' + reason : ''}`
      });
    }

    const { rows: updated } = await client.query(
      `UPDATE production_batches SET status = 'reversed', reversed_at = now() WHERE id = $1 RETURNING *`,
      [batch.id]
    );
    await logAudit(client, { userId: req.user.id, action: 'UPDATE', entityType: 'production_batch', entityId: batch.id, oldValue: batch, newValue: updated[0] });
    return updated[0];
  });

  res.json({ data: result, error: null });
}));

// ---- Bill of materials ----
router.get('/bom', requireRole(...PERM.PRODUCTION_VIEW), asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT bom.*, p.name AS product_name, p.sku
     FROM bill_of_materials bom JOIN products p ON p.id = bom.product_id
     ORDER BY p.name`
  );
  res.json({ data: rows, error: null });
}));

router.get('/bom/:id', requireRole(...PERM.PRODUCTION_VIEW), asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT bom.*, p.name AS product_name FROM bill_of_materials bom JOIN products p ON p.id = bom.product_id WHERE bom.id = $1`,
    [req.params.id]
  );
  if (!rows[0]) throw new ApiError(404, 'Bill of materials not found');
  const { rows: items } = await pool.query(
    `SELECT bi.*, p.name AS raw_material_name, p.unit FROM bom_items bi JOIN products p ON p.id = bi.raw_material_product_id WHERE bom_id = $1`,
    [req.params.id]
  );
  res.json({ data: { ...rows[0], items }, error: null });
}));

router.post('/bom', requireRole('Admin', 'Production Manager'), validate(schemas.bomCreate), asyncHandler(async (req, res) => {
  const { product_id, name, items } = req.body;

  const result = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO bill_of_materials (product_id, name) VALUES ($1,$2) RETURNING *`,
      [product_id, name]
    );
    const bom = rows[0];
    for (const item of items) {
      await client.query(
        `INSERT INTO bom_items (bom_id, raw_material_product_id, quantity_per_unit) VALUES ($1,$2,$3)`,
        [bom.id, item.raw_material_product_id, item.quantity_per_unit]
      );
    }
    await logAudit(client, { userId: req.user.id, action: 'CREATE', entityType: 'bill_of_materials', entityId: bom.id,
      newValue: { ...bom, items } });
    return bom;
  });

  res.status(201).json({ data: result, error: null });
}));

// ---------------------------------------------------------------------
// Capacity Calendar — a day-by-day utilization view per production line,
// built entirely from production_batches/machines/downtime_logs/machine_costs
// (no new tables). "Capacity" here is deliberately Planned Qty vs Actual Qty
// — the two numbers this app already tracks per batch — never a fabricated
// per-machine rated-capacity figure that doesn't exist in this schema.
// ---------------------------------------------------------------------
const DEPARTMENT_MACHINE_TYPES = {
  RO_WATER: ['RO_PLANT'],
  BOTTLING: ['FILLING_LINE', 'PACKAGING'],
  ICE: ['ICE_MACHINE']
};
function machineTypesFor(productionType) {
  const types = DEPARTMENT_MACHINE_TYPES[productionType];
  if (!types) throw new ApiError(400, 'production_type must be RO_WATER, BOTTLING, or ICE');
  return types;
}

router.get('/capacity-calendar', requireRole(...PERM.PRODUCTION_VIEW), asyncHandler(async (req, res) => {
  const { production_type, from, to } = req.query;
  const machineTypes = machineTypesFor(production_type);
  if (!from || !to) throw new ApiError(400, 'from and to are required (YYYY-MM-DD)');

  const [daysResult, machineResult, downtimeResult, wasteResult, activeMachinesResult] = await Promise.all([
    pool.query(
      `SELECT pb.start_time::date AS day,
              COALESCE(SUM(pb.planned_qty), 0) AS planned_qty,
              COALESCE(SUM(pb.actual_qty), 0) AS actual_qty,
              COALESCE(SUM(pb.wastage_qty), 0) AS wastage_qty,
              COUNT(*) AS order_count,
              COUNT(*) FILTER (WHERE pb.status = 'in_progress') AS running_count,
              COUNT(*) FILTER (WHERE pb.status = 'completed') AS completed_count,
              COALESCE(json_agg(DISTINCT jsonb_build_object('id', m.id, 'name', m.name)) FILTER (WHERE m.id IS NOT NULL), '[]') AS machines_used
       FROM production_batches pb JOIN machines m ON m.id = pb.machine_id
       WHERE pb.production_type = $1 AND pb.start_time::date BETWEEN $2 AND $3 AND pb.status != 'cancelled'
       GROUP BY pb.start_time::date
       ORDER BY pb.start_time::date`,
      [production_type, from, to]
    ),
    pool.query(
      `SELECT m.id AS machine_id, m.name AS machine_name,
              COALESCE(SUM(pb.planned_qty), 0) AS planned_qty,
              COALESCE(SUM(pb.actual_qty), 0) AS actual_qty
       FROM machines m
       LEFT JOIN production_batches pb ON pb.machine_id = m.id AND pb.production_type = $1
         AND pb.start_time::date BETWEEN $2 AND $3 AND pb.status != 'cancelled'
       WHERE m.type = ANY($4)
       GROUP BY m.id, m.name ORDER BY m.name`,
      [production_type, from, to, machineTypes]
    ),
    pool.query(
      `SELECT dl.category, COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(dl.end_time, now()) - dl.start_time)) / 3600), 0) AS hours
       FROM downtime_logs dl JOIN machines m ON m.id = dl.machine_id
       WHERE m.type = ANY($1) AND dl.start_time::date BETWEEN $2 AND $3
       GROUP BY dl.category`,
      [machineTypes, from, to]
    ),
    pool.query(
      `SELECT p.id AS product_id, p.name AS product_name, COALESCE(SUM(pb.wastage_qty), 0) AS wastage_qty
       FROM production_batches pb JOIN products p ON p.id = pb.product_id
       WHERE pb.production_type = $1 AND pb.start_time::date BETWEEN $2 AND $3 AND pb.wastage_qty > 0
       GROUP BY p.id, p.name ORDER BY wastage_qty DESC LIMIT 10`,
      [production_type, from, to]
    ),
    pool.query(`SELECT COUNT(*) AS n FROM machines WHERE type = ANY($1) AND status = 'operational'`, [machineTypes])
  ]);

  const days = daysResult.rows.map((r) => {
    const planned = Number(r.planned_qty);
    const actual = Number(r.actual_qty);
    return {
      date: r.day, planned_qty: planned, actual_qty: actual, wastage_qty: Number(r.wastage_qty),
      utilization_pct: planned > 0 ? (actual / planned) * 100 : 0,
      order_count: Number(r.order_count), running_count: Number(r.running_count), completed_count: Number(r.completed_count),
      machines_used: r.machines_used
    };
  });

  const totalPlanned = days.reduce((s, d) => s + d.planned_qty, 0);
  const totalActual = days.reduce((s, d) => s + d.actual_qty, 0);
  const totalWastage = days.reduce((s, d) => s + d.wastage_qty, 0);
  const totalCompleted = days.reduce((s, d) => s + d.completed_count, 0);
  const totalDowntimeHours = downtimeResult.rows.reduce((s, r) => s + Number(r.hours), 0);

  res.json({
    data: {
      days,
      summary: {
        planned_capacity: totalPlanned,
        actual_production: totalActual,
        utilization_pct: totalPlanned > 0 ? (totalActual / totalPlanned) * 100 : 0,
        // Efficiency/waste read the SAME actual+wastage total from the opposite
        // side — a real yield rate from what this schema tracks, not a second
        // invented "capacity" figure.
        efficiency_pct: (totalActual + totalWastage) > 0 ? (totalActual / (totalActual + totalWastage)) * 100 : 0,
        waste_pct: (totalActual + totalWastage) > 0 ? (totalWastage / (totalActual + totalWastage)) * 100 : 0,
        machine_downtime_hours: totalDowntimeHours,
        active_machines: Number(activeMachinesResult.rows[0].n),
        completed_orders: totalCompleted
      },
      machine_utilization: machineResult.rows.map((r) => ({
        machine_id: r.machine_id, machine_name: r.machine_name,
        planned_qty: Number(r.planned_qty), actual_qty: Number(r.actual_qty),
        utilization_pct: Number(r.planned_qty) > 0 ? (Number(r.actual_qty) / Number(r.planned_qty)) * 100 : 0
      })),
      downtime_by_category: downtimeResult.rows.map((r) => ({ category: r.category, hours: Number(r.hours) })),
      waste_by_product: wasteResult.rows.map((r) => ({ product_id: r.product_id, product_name: r.product_name, wastage_qty: Number(r.wastage_qty) }))
    },
    error: null
  });
}));

router.get('/capacity-calendar/day', requireRole(...PERM.PRODUCTION_VIEW), asyncHandler(async (req, res) => {
  const { production_type, date } = req.query;
  machineTypesFor(production_type);
  if (!date) throw new ApiError(400, 'date is required (YYYY-MM-DD)');

  const { rows } = await pool.query(
    `SELECT pb.id, pb.batch_number, p.name AS product_name, pb.planned_qty, pb.actual_qty, pb.unit,
            m.name AS machine_name, u.full_name AS operator_name, pb.start_time, pb.end_time, pb.status,
            pb.wastage_qty, pb.qc_status,
            -- Same proportional-attribution pattern as GET /machines/:id/profitability:
            -- this batch's share of its machine's SAME-DAY costs, by output share.
            -- Null (not zero) when there's nothing to attribute against, rather than
            -- fabricating a cost that was never actually recorded against this batch.
            (
              CASE WHEN COALESCE(machine_day_totals.total_actual, 0) > 0
                THEN (pb.actual_qty / machine_day_totals.total_actual) * COALESCE(machine_day_costs.total_cost, 0)
                ELSE NULL END
            ) AS estimated_cost
     FROM production_batches pb
     JOIN machines m ON m.id = pb.machine_id
     LEFT JOIN products p ON p.id = pb.product_id
     JOIN users u ON u.id = pb.supervisor_id
     LEFT JOIN (
       SELECT machine_id, SUM(actual_qty) AS total_actual FROM production_batches
       WHERE start_time::date = $2 AND status != 'cancelled' GROUP BY machine_id
     ) machine_day_totals ON machine_day_totals.machine_id = pb.machine_id
     LEFT JOIN (
       SELECT machine_id, SUM(amount) AS total_cost FROM machine_costs
       WHERE cost_date = $2 AND voided_at IS NULL GROUP BY machine_id
     ) machine_day_costs ON machine_day_costs.machine_id = pb.machine_id
     WHERE pb.production_type = $1 AND pb.start_time::date = $2 AND pb.status != 'cancelled'
     ORDER BY pb.start_time`,
    [production_type, date]
  );

  res.json({
    data: {
      date,
      orders: rows.map((r) => ({ ...r, estimated_cost: r.estimated_cost !== null ? Number(r.estimated_cost) : null }))
    },
    error: null
  });
}));

module.exports = router;
