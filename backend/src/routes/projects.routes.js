const { Router } = require('express');
const { pool, withTransaction } = require('../config/db');
const { asyncHandler, ApiError } = require('../utils/asyncHandler');
const { requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const schemas = require('../validation/schemas');
const { logAudit } = require('../services/auditService');

const router = Router();

router.get('/', asyncHandler(async (req, res) => {
  const { status, customer_id } = req.query;
  const conditions = [];
  const params = [];
  if (status) { params.push(status); conditions.push(`p.status = $${params.length}`); }
  if (customer_id) { params.push(customer_id); conditions.push(`p.customer_id = $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `SELECT p.*, c.name AS customer_name, cc.name AS cost_center_name, u.full_name AS created_by_name
     FROM projects p
     LEFT JOIN customers c ON c.id = p.customer_id
     LEFT JOIN cost_centers cc ON cc.id = p.cost_center_id
     JOIN users u ON u.id = p.created_by
     ${where} ORDER BY p.created_at DESC`,
    params
  );
  res.json({ data: rows, error: null });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT p.*, c.name AS customer_name, cc.name AS cost_center_name
     FROM projects p LEFT JOIN customers c ON c.id = p.customer_id LEFT JOIN cost_centers cc ON cc.id = p.cost_center_id
     WHERE p.id = $1`,
    [req.params.id]
  );
  if (!rows[0]) throw new ApiError(404, 'Project not found');
  res.json({ data: rows[0], error: null });
}));

router.post('/', requireRole('Admin', 'Sales Manager', 'Finance Officer'), validate(schemas.projectCreate), asyncHandler(async (req, res) => {
  const { code, name, customer_id, cost_center_id, start_date, end_date, budget_amount, notes } = req.body;
  const result = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO projects (code, name, customer_id, cost_center_id, start_date, end_date, budget_amount, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [code, name, customer_id || null, cost_center_id || null, start_date || null, end_date || null, budget_amount || 0, notes || null, req.user.id]
    );
    await logAudit(client, { userId: req.user.id, action: 'CREATE', entityType: 'project', entityId: rows[0].id, newValue: rows[0] });
    return rows[0];
  });
  res.status(201).json({ data: result, error: null });
}));

router.put('/:id', requireRole('Admin', 'Sales Manager', 'Finance Officer'), validate(schemas.projectUpdate), asyncHandler(async (req, res) => {
  const { name, customer_id, cost_center_id, start_date, end_date, budget_amount, status, notes } = req.body;
  const result = await withTransaction(async (client) => {
    const { rows: oldRows } = await client.query('SELECT * FROM projects WHERE id = $1', [req.params.id]);
    if (!oldRows[0]) throw new ApiError(404, 'Project not found');
    const { rows } = await client.query(
      `UPDATE projects SET name = COALESCE($1, name), customer_id = COALESCE($2, customer_id), cost_center_id = COALESCE($3, cost_center_id),
              start_date = COALESCE($4, start_date), end_date = COALESCE($5, end_date), budget_amount = COALESCE($6, budget_amount),
              status = COALESCE($7, status), notes = COALESCE($8, notes)
       WHERE id = $9 RETURNING *`,
      [name || null, customer_id || null, cost_center_id || null, start_date || null, end_date || null, budget_amount || null, status || null, notes || null, req.params.id]
    );
    await logAudit(client, { userId: req.user.id, action: 'UPDATE', entityType: 'project', entityId: rows[0].id, oldValue: oldRows[0], newValue: rows[0] });
    return rows[0];
  });
  res.json({ data: result, error: null });
}));

router.put('/:id/close', requireRole('Admin', 'Sales Manager', 'Finance Officer'), asyncHandler(async (req, res) => {
  const result = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `UPDATE projects SET status = 'completed' WHERE id = $1 RETURNING *`, [req.params.id]
    );
    if (!rows[0]) throw new ApiError(404, 'Project not found');
    await logAudit(client, { userId: req.user.id, action: 'UPDATE', entityType: 'project', entityId: rows[0].id, newValue: rows[0] });
    return rows[0];
  });
  res.json({ data: result, error: null });
}));

// Profitability: revenue from every sales order tagged to this project, expenses from
// every expense/purchase-order tagged to it, cross-checked against journal_lines.project_id
// the same dual-path way /reports/accounts-receivable already cross-checks AR — both
// numbers should always agree since they trace back to the same postings.
router.get('/:id/profitability', asyncHandler(async (req, res) => {
  const { from, to } = req.query;
  const params = [req.params.id, from || '1900-01-01', to || '2999-12-31'];
  const { rows: proj } = await pool.query('SELECT * FROM projects WHERE id = $1', [req.params.id]);
  if (!proj[0]) throw new ApiError(404, 'Project not found');

  const { rows: revRows } = await pool.query(
    `SELECT COALESCE(SUM(total_amount), 0) AS revenue, COUNT(*) AS order_count
     FROM sales_orders WHERE project_id = $1 AND status NOT IN ('cancelled','reversed') AND order_date BETWEEN $2 AND $3`,
    params
  );
  const { rows: expRows } = await pool.query(
    `SELECT COALESCE(SUM(amount), 0) AS expenses FROM expenses WHERE project_id = $1 AND voided_at IS NULL AND expense_date BETWEEN $2 AND $3`,
    params
  );
  const { rows: poRows } = await pool.query(
    `SELECT COALESCE(SUM(total_amount), 0) AS po_cost FROM purchase_orders WHERE project_id = $1 AND status NOT IN ('draft','cancelled','reversed') AND order_date BETWEEN $2 AND $3`,
    params
  );
  const { rows: glRows } = await pool.query(
    `SELECT a.account_type, COALESCE(SUM(jl.debit),0) AS debit, COALESCE(SUM(jl.credit),0) AS credit
     FROM journal_lines jl JOIN journal_entries je ON je.id = jl.journal_entry_id JOIN chart_of_accounts a ON a.id = jl.account_id
     WHERE jl.project_id = $1 AND je.status = 'posted' AND je.entry_date BETWEEN $2 AND $3
     GROUP BY a.account_type`,
    params
  );

  const revenue = Number(revRows[0].revenue);
  const expenses = Number(expRows[0].expenses) + Number(poRows[0].po_cost);
  const glRevenue = glRows.filter((r) => r.account_type === 'revenue').reduce((s, r) => s + Number(r.credit) - Number(r.debit), 0);
  const glExpense = glRows.filter((r) => r.account_type === 'expense').reduce((s, r) => s + Number(r.debit) - Number(r.credit), 0);

  res.json({
    data: {
      project: proj[0], revenue, expenses, profit: revenue - expenses, order_count: Number(revRows[0].order_count),
      gl_cross_check: { revenue: glRevenue, expenses: glExpense }
    },
    error: null
  });
}));

module.exports = router;
