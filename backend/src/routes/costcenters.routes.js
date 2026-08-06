const { Router } = require('express');
const { pool, withTransaction } = require('../config/db');
const { asyncHandler, ApiError } = require('../utils/asyncHandler');
const { requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const schemas = require('../validation/schemas');
const { logAudit } = require('../services/auditService');

const router = Router();

router.get('/', asyncHandler(async (req, res) => {
  const { is_active } = req.query;
  const conditions = [];
  const params = [];
  if (is_active !== undefined) { params.push(is_active === 'true'); conditions.push(`is_active = $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await pool.query(`SELECT * FROM cost_centers ${where} ORDER BY code`, params);
  res.json({ data: rows, error: null });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM cost_centers WHERE id = $1', [req.params.id]);
  if (!rows[0]) throw new ApiError(404, 'Cost center not found');
  res.json({ data: rows[0], error: null });
}));

router.post('/', requireRole('Admin', 'Finance Officer'), validate(schemas.costCenterCreate), asyncHandler(async (req, res) => {
  const { code, name, type } = req.body;
  const result = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO cost_centers (code, name, type) VALUES ($1,$2,$3) RETURNING *`,
      [code, name, type]
    );
    await logAudit(client, { userId: req.user.id, action: 'CREATE', entityType: 'cost_center', entityId: rows[0].id, newValue: rows[0] });
    return rows[0];
  });
  res.status(201).json({ data: result, error: null });
}));

router.put('/:id', requireRole('Admin', 'Finance Officer'), validate(schemas.costCenterUpdate), asyncHandler(async (req, res) => {
  const { name, is_active } = req.body;
  const result = await withTransaction(async (client) => {
    const { rows: oldRows } = await client.query('SELECT * FROM cost_centers WHERE id = $1', [req.params.id]);
    if (!oldRows[0]) throw new ApiError(404, 'Cost center not found');
    const { rows } = await client.query(
      `UPDATE cost_centers SET name = COALESCE($1, name), is_active = COALESCE($2, is_active) WHERE id = $3 RETURNING *`,
      [name || null, is_active !== undefined ? is_active : null, req.params.id]
    );
    await logAudit(client, { userId: req.user.id, action: 'UPDATE', entityType: 'cost_center', entityId: rows[0].id, oldValue: oldRows[0], newValue: rows[0] });
    return rows[0];
  });
  res.json({ data: result, error: null });
}));

// Cost centers are a reference dimension used by many historical postings — never
// hard-deleted, only soft-deactivated (same governance policy as every other entity).
router.put('/:id/deactivate', requireRole('Admin', 'Finance Officer'), asyncHandler(async (req, res) => {
  const result = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `UPDATE cost_centers SET is_active = false WHERE id = $1 RETURNING *`, [req.params.id]
    );
    if (!rows[0]) throw new ApiError(404, 'Cost center not found');
    await logAudit(client, { userId: req.user.id, action: 'UPDATE', entityType: 'cost_center', entityId: rows[0].id, newValue: rows[0] });
    return rows[0];
  });
  res.json({ data: result, error: null });
}));

// Department cost report: rolls up every posted journal line tagged to this cost
// center, grouped by account type, for the given period — the core "department cost"
// requirement, computed straight from the GL (the same source of truth every other
// financial report in this app already uses).
router.get('/:id/report', asyncHandler(async (req, res) => {
  const { from, to } = req.query;
  const params = [req.params.id, from || '1900-01-01', to || '2999-12-31'];
  const { rows: cc } = await pool.query('SELECT * FROM cost_centers WHERE id = $1', [req.params.id]);
  if (!cc[0]) throw new ApiError(404, 'Cost center not found');

  const { rows } = await pool.query(
    `SELECT a.account_type, a.code, a.name,
            COALESCE(SUM(jl.debit), 0) AS total_debit, COALESCE(SUM(jl.credit), 0) AS total_credit
     FROM journal_lines jl
     JOIN journal_entries je ON je.id = jl.journal_entry_id
     JOIN chart_of_accounts a ON a.id = jl.account_id
     WHERE jl.cost_center_id = $1 AND je.status = 'posted' AND je.entry_date BETWEEN $2 AND $3
     GROUP BY a.account_type, a.code, a.name
     ORDER BY a.account_type, a.code`,
    params
  );

  const totalExpense = rows.filter((r) => r.account_type === 'expense').reduce((s, r) => s + Number(r.total_debit) - Number(r.total_credit), 0);
  const totalRevenue = rows.filter((r) => r.account_type === 'revenue').reduce((s, r) => s + Number(r.total_credit) - Number(r.total_debit), 0);

  res.json({ data: { cost_center: cc[0], accounts: rows, total_expense: totalExpense, total_revenue: totalRevenue, net: totalRevenue - totalExpense }, error: null });
}));

module.exports = router;
