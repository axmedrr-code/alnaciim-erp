// Vehicle cost tracking (fuel/repairs/tires/oil/insurance/parking/license/driver_salary)
// and per-truck profitability. Trucks themselves live in trucks.routes.js (fleet
// CRUD) — this file only adds the cost/profitability layer on top, posting through
// the exact same accountingService every other expense-like flow uses.
const { Router } = require('express');
const { pool, withTransaction } = require('../config/db');
const { asyncHandler, ApiError } = require('../utils/asyncHandler');
const { requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const schemas = require('../validation/schemas');
const { postJournalEntry, getAccountByCode, reverseJournalEntry, resolveCostCenterId } = require('../services/accountingService');
const { logAudit } = require('../services/auditService');

const router = Router();

async function resolveVehicleExpenseAccount(client, category) {
  const { rows } = await client.query('SELECT coa_account_id FROM vehicle_expense_category_accounts WHERE category = $1', [category]);
  if (!rows[0]) throw new ApiError(400, `Vehicle expense category "${category}" is not mapped to a Chart of Accounts account`);
  return rows[0].coa_account_id;
}

router.get('/vehicle-expenses', asyncHandler(async (req, res) => {
  const { truck_id, category, from, to } = req.query;
  const conditions = ['ve.voided_at IS NULL'];
  const params = [];
  if (truck_id) { params.push(truck_id); conditions.push(`ve.truck_id = $${params.length}`); }
  if (category) { params.push(category); conditions.push(`ve.category = $${params.length}`); }
  if (from) { params.push(from); conditions.push(`ve.expense_date >= $${params.length}`); }
  if (to) { params.push(to); conditions.push(`ve.expense_date <= $${params.length}`); }
  const where = `WHERE ${conditions.join(' AND ')}`;
  const { rows } = await pool.query(
    `SELECT ve.*, t.plate_number, u.full_name AS recorded_by_name, cc.name AS cost_center_name
     FROM vehicle_expenses ve JOIN trucks t ON t.id = ve.truck_id JOIN users u ON u.id = ve.recorded_by
     LEFT JOIN cost_centers cc ON cc.id = ve.cost_center_id
     ${where} ORDER BY ve.expense_date DESC`,
    params
  );
  res.json({ data: rows, error: null });
}));

router.post('/vehicle-expenses', requireRole('Admin', 'Finance Officer', 'Sales Manager'), validate(schemas.vehicleExpenseCreate), asyncHandler(async (req, res) => {
  const { truck_id, category, amount, expense_date, odometer_km, description, payment_method, bank_account_id } = req.body;
  const method = payment_method || 'cash';

  const result = await withTransaction(async (client) => {
    const { rows: truckRows } = await client.query('SELECT * FROM trucks WHERE id = $1', [truck_id]);
    if (!truckRows[0]) throw new ApiError(404, 'Truck not found');

    const costCenterId = await resolveCostCenterId(client, req.body.cost_center_id, 'CC-DEL');
    const { rows } = await client.query(
      `INSERT INTO vehicle_expenses (truck_id, category, amount, expense_date, odometer_km, description, cost_center_id, payment_method, bank_account_id, recorded_by)
       VALUES ($1,$2,$3,COALESCE($4,CURRENT_DATE),$5,$6,$7,$8,$9,$10) RETURNING *`,
      [truck_id, category, amount, expense_date || null, odometer_km || null, description || null, costCenterId, method, bank_account_id || null, req.user.id]
    );
    const expense = rows[0];

    const expenseAcct = await resolveVehicleExpenseAccount(client, category);
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
      entryDate: expense.expense_date, description: `Vehicle expense - ${truckRows[0].plate_number} - ${category}`,
      source: 'system', referenceType: 'vehicle_expense', referenceId: expense.id, createdBy: req.user.id,
      lines: [
        { accountId: expenseAcct, debit: amount, credit: 0, costCenterId },
        { accountId: cashOrBankAcct, debit: 0, credit: amount, costCenterId }
      ]
    });

    await logAudit(client, { userId: req.user.id, action: 'CREATE', entityType: 'vehicle_expense', entityId: expense.id, newValue: expense });
    return expense;
  });

  res.status(201).json({ data: result, error: null });
}));

router.post('/vehicle-expenses/:id/reverse', requireRole('Admin', 'Finance Officer', 'Sales Manager'), validate(schemas.reverseRequest), asyncHandler(async (req, res) => {
  const { reason } = req.body;
  const result = await withTransaction(async (client) => {
    const { rows: expRows } = await client.query('SELECT * FROM vehicle_expenses WHERE id = $1 FOR UPDATE', [req.params.id]);
    const expense = expRows[0];
    if (!expense) throw new ApiError(404, 'Vehicle expense not found');
    if (expense.voided_at) throw new ApiError(409, 'This vehicle expense has already been reversed');

    const { rows: entryRows } = await client.query(
      `SELECT id FROM journal_entries WHERE reference_type = 'vehicle_expense' AND reference_id = $1 AND status = 'posted' ORDER BY id DESC LIMIT 1`,
      [expense.id]
    );
    if (!entryRows[0]) throw new ApiError(409, 'No posted journal entry found for this expense');

    await reverseJournalEntry(client, {
      entryId: entryRows[0].id, createdBy: req.user.id,
      description: `Reversal of vehicle expense #${expense.id}${reason ? ' - ' + reason : ''}`
    });

    const { rows: voided } = await client.query(
      `UPDATE vehicle_expenses SET voided_at = now(), voided_by = $1, void_reason = $2 WHERE id = $3 RETURNING *`,
      [req.user.id, reason || null, expense.id]
    );
    await logAudit(client, { userId: req.user.id, action: 'UPDATE', entityType: 'vehicle_expense', entityId: expense.id, oldValue: expense, newValue: voided[0] });
    return voided[0];
  });
  res.json({ data: result, error: null });
}));

// Revenue is derived, not stored: every sales order this truck delivered, joined through
// deliveries. Expenses are vehicle_expenses. Profit = revenue - expenses, with a
// per-category breakdown so the UI can render a cost bar chart.
router.get('/trucks/:id/profitability', asyncHandler(async (req, res) => {
  const { from, to } = req.query;
  const params = [req.params.id, from || '1900-01-01', to || '2999-12-31'];
  const { rows: truck } = await pool.query('SELECT * FROM trucks WHERE id = $1', [req.params.id]);
  if (!truck[0]) throw new ApiError(404, 'Truck not found');

  const { rows: revRows } = await pool.query(
    `SELECT COALESCE(SUM(so.total_amount), 0) AS revenue, COALESCE(SUM(so.delivery_fee), 0) AS delivery_fee_revenue, COUNT(*) AS delivery_count
     FROM deliveries d JOIN sales_orders so ON so.id = d.sales_order_id
     WHERE d.truck_id = $1 AND so.status NOT IN ('cancelled','reversed') AND d.dispatch_time::date BETWEEN $2 AND $3`,
    params
  );
  const { rows: expByCategory } = await pool.query(
    `SELECT category, COALESCE(SUM(amount), 0) AS total
     FROM vehicle_expenses WHERE truck_id = $1 AND voided_at IS NULL AND expense_date BETWEEN $2 AND $3
     GROUP BY category ORDER BY total DESC`,
    params
  );

  const revenue = Number(revRows[0].revenue);
  const expenses = expByCategory.reduce((s, r) => s + Number(r.total), 0);

  res.json({
    data: {
      truck: truck[0], revenue, delivery_fee_revenue: Number(revRows[0].delivery_fee_revenue),
      delivery_count: Number(revRows[0].delivery_count), expenses, expense_breakdown: expByCategory,
      profit: revenue - expenses
    },
    error: null
  });
}));

module.exports = router;
