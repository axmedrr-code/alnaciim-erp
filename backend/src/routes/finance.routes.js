const { Router } = require('express');
const { pool, withTransaction } = require('../config/db');
const { asyncHandler, ApiError } = require('../utils/asyncHandler');
const { requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const schemas = require('../validation/schemas');
const { postJournalEntry, getAccountByCode, reverseJournalEntry } = require('../services/accountingService');
const { logAudit } = require('../services/auditService');

const router = Router();

router.get('/expense-categories', asyncHandler(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM expense_categories ORDER BY name');
  res.json({ data: rows, error: null });
}));

router.get('/expenses', asyncHandler(async (req, res) => {
  const { category_id, from, to } = req.query;
  const conditions = [];
  const params = [];
  if (category_id) { params.push(category_id); conditions.push(`e.category_id = $${params.length}`); }
  if (from) { params.push(from); conditions.push(`e.expense_date >= $${params.length}`); }
  if (to) { params.push(to); conditions.push(`e.expense_date <= $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `SELECT e.*, ec.name AS category_name, ec.type AS category_type, u.full_name AS recorded_by_name
     FROM expenses e JOIN expense_categories ec ON ec.id = e.category_id JOIN users u ON u.id = e.recorded_by
     ${where} ORDER BY e.expense_date DESC`,
    params
  );
  res.json({ data: rows, error: null });
}));

router.post('/expenses', requireRole('Admin', 'Finance Officer'), validate(schemas.expenseCreate), asyncHandler(async (req, res) => {
  const { category_id, amount, expense_date, description, related_reference_type, related_reference_id, payment_method, bank_account_id, cost_center_id, project_id } = req.body;
  const method = payment_method || 'cash';

  const result = await withTransaction(async (client) => {
    const { rows: catRows } = await client.query('SELECT * FROM expense_categories WHERE id = $1', [category_id]);
    if (!catRows[0]) throw new ApiError(404, 'Expense category not found');
    if (!catRows[0].coa_account_id) throw new ApiError(400, `Expense category "${catRows[0].name}" is not mapped to a Chart of Accounts account`);

    const { rows } = await client.query(
      `INSERT INTO expenses (category_id, amount, expense_date, description, related_reference_type, related_reference_id, recorded_by, payment_method, bank_account_id, cost_center_id, project_id)
       VALUES ($1,$2,COALESCE($3, CURRENT_DATE),$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [category_id, amount, expense_date || null, description || null, related_reference_type || null, related_reference_id || null, req.user.id, method, bank_account_id || null, cost_center_id, project_id || null]
    );
    const expense = rows[0];

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
      entryDate: expense.expense_date, description: `Expense - ${description || catRows[0].name}`,
      source: 'system', referenceType: 'expense', referenceId: expense.id, createdBy: req.user.id,
      lines: [
        { accountId: catRows[0].coa_account_id, debit: amount, credit: 0, costCenterId: expense.cost_center_id, projectId: expense.project_id },
        { accountId: cashOrBankAcct, debit: 0, credit: amount, costCenterId: expense.cost_center_id, projectId: expense.project_id }
      ]
    });

    await logAudit(client, { userId: req.user.id, action: 'CREATE', entityType: 'expense', entityId: expense.id, newValue: expense });
    return expense;
  });

  res.status(201).json({ data: result, error: null });
}));

// Expenses post to the ledger the moment they're recorded (the cash/bank leaves at that
// instant), so there's no draft window — the only way to correct one is to reverse it.
router.post('/expenses/:id/reverse', requireRole('Admin', 'Finance Officer'), validate(schemas.reverseRequest), asyncHandler(async (req, res) => {
  const { reason } = req.body;

  const result = await withTransaction(async (client) => {
    const { rows: expenseRows } = await client.query('SELECT * FROM expenses WHERE id = $1 FOR UPDATE', [req.params.id]);
    const expense = expenseRows[0];
    if (!expense) throw new ApiError(404, 'Expense not found');
    if (expense.voided_at) throw new ApiError(409, 'This expense has already been reversed');

    const { rows: entryRows } = await client.query(
      `SELECT id FROM journal_entries WHERE reference_type = 'expense' AND reference_id = $1 AND status = 'posted' ORDER BY id DESC LIMIT 1`,
      [expense.id]
    );
    if (!entryRows[0]) throw new ApiError(409, 'No posted journal entry found for this expense');

    await reverseJournalEntry(client, {
      entryId: entryRows[0].id, createdBy: req.user.id,
      description: `Reversal of expense #${expense.id}${reason ? ' - ' + reason : ''}`
    });

    const { rows: voided } = await client.query(
      `UPDATE expenses SET voided_at = now(), voided_by = $1, void_reason = $2 WHERE id = $3 RETURNING *`,
      [req.user.id, reason || null, expense.id]
    );
    await logAudit(client, { userId: req.user.id, action: 'UPDATE', entityType: 'expense', entityId: expense.id, oldValue: expense, newValue: voided[0] });
    return voided[0];
  });

  res.json({ data: result, error: null });
}));

router.get('/revenue-summary', asyncHandler(async (req, res) => {
  const { from, to } = req.query;
  const params = [from || '1900-01-01', to || '2999-12-31'];
  const { rows: revenueRows } = await pool.query(
    `SELECT COALESCE(SUM(amount), 0) AS revenue FROM payments WHERE voided_at IS NULL AND payment_date BETWEEN $1 AND $2`,
    params
  );
  const { rows: expenseRows } = await pool.query(
    `SELECT COALESCE(SUM(amount), 0) AS cost FROM expenses WHERE voided_at IS NULL AND expense_date BETWEEN $1 AND $2`,
    params
  );
  const revenue = Number(revenueRows[0].revenue);
  const cost = Number(expenseRows[0].cost);
  res.json({ data: { revenue, cost, profit: revenue - cost }, error: null });
}));

// Note: uses products.unit_cost as a current-cost approximation. For exact
// historical margins, snapshot unit_cost onto sales_order_items at order time.
router.get('/profitability', asyncHandler(async (req, res) => {
  const { product_id, from, to } = req.query;
  const conditions = ['so.status != \'cancelled\''];
  const params = [];
  if (product_id) { params.push(product_id); conditions.push(`soi.product_id = $${params.length}`); }
  if (from) { params.push(from); conditions.push(`so.order_date >= $${params.length}`); }
  if (to) { params.push(to); conditions.push(`so.order_date <= $${params.length}`); }
  const where = `WHERE ${conditions.join(' AND ')}`;

  const { rows } = await pool.query(
    `SELECT p.id AS product_id, p.sku, p.name,
            SUM(soi.quantity) AS units_sold,
            SUM(soi.subtotal) AS revenue,
            SUM(soi.quantity * p.unit_cost) AS material_cost,
            SUM(soi.subtotal) - SUM(soi.quantity * p.unit_cost) AS gross_margin
     FROM sales_order_items soi
     JOIN sales_orders so ON so.id = soi.sales_order_id
     JOIN products p ON p.id = soi.product_id
     ${where}
     GROUP BY p.id, p.sku, p.name
     ORDER BY gross_margin DESC`,
    params
  );
  res.json({ data: rows, error: null });
}));

module.exports = router;
