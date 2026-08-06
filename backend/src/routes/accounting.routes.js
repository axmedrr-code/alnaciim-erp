const { Router } = require('express');
const { pool, withTransaction } = require('../config/db');
const { asyncHandler, ApiError } = require('../utils/asyncHandler');
const { requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const schemas = require('../validation/schemas');
const { postJournalEntry, getAccountByCode, reverseJournalEntry, promoteToPosted } = require('../services/accountingService');
const { logAudit } = require('../services/auditService');

const router = Router();

const FINANCE_ROLES = ['Admin', 'Finance Officer'];

// ---- Chart of Accounts ----
router.get('/chart-of-accounts', asyncHandler(async (req, res) => {
  // Only POSTED activity counts toward a balance — a LEFT JOIN with the status filter in
  // its ON clause would still leave jl.debit/jl.credit non-null for draft/void entries
  // (only the je.* columns get nulled), so the status filter must live in the subquery
  // that produces the rows being summed, not in the outer join condition.
  const { rows } = await pool.query(
    `SELECT a.*, p.name AS parent_name,
            COALESCE(SUM(jl.debit), 0) AS total_debit, COALESCE(SUM(jl.credit), 0) AS total_credit
     FROM chart_of_accounts a
     LEFT JOIN chart_of_accounts p ON p.id = a.parent_id
     LEFT JOIN (
       SELECT jl.account_id, jl.debit, jl.credit
       FROM journal_lines jl JOIN journal_entries je ON je.id = jl.journal_entry_id AND je.status = 'posted'
     ) jl ON jl.account_id = a.id
     GROUP BY a.id, p.name
     ORDER BY a.code`
  );
  const withBalance = rows.map((a) => {
    const debit = Number(a.total_debit);
    const credit = Number(a.total_credit);
    const balance = ['asset', 'expense'].includes(a.account_type) ? debit - credit : credit - debit;
    return { ...a, balance };
  });
  res.json({ data: withBalance, error: null });
}));

router.post('/chart-of-accounts', requireRole(...FINANCE_ROLES), validate(schemas.coaAccountCreate), asyncHandler(async (req, res) => {
  const { code, name, account_type, parent_id } = req.body;
  const { rows } = await pool.query(
    `INSERT INTO chart_of_accounts (code, name, account_type, parent_id) VALUES ($1,$2,$3,$4) RETURNING *`,
    [code, name, account_type, parent_id || null]
  );
  res.status(201).json({ data: rows[0], error: null });
}));

router.put('/chart-of-accounts/:id', requireRole(...FINANCE_ROLES), validate(schemas.coaAccountUpdate), asyncHandler(async (req, res) => {
  const fields = ['name', 'parent_id', 'is_active'];
  const updates = [];
  const params = [];
  for (const f of fields) {
    if (req.body[f] !== undefined) { params.push(req.body[f]); updates.push(`${f} = $${params.length}`); }
  }
  params.push(req.params.id);
  const { rows } = await pool.query(`UPDATE chart_of_accounts SET ${updates.join(', ')} WHERE id = $${params.length} RETURNING *`, params);
  if (!rows[0]) throw new ApiError(404, 'Account not found');
  res.json({ data: rows[0], error: null });
}));

// ---- Journal Entries (manual) ----
router.get('/journal-entries', asyncHandler(async (req, res) => {
  const { from, to, reference_type, reference_id, status } = req.query;
  const conditions = [];
  const params = [];
  if (from) { params.push(from); conditions.push(`je.entry_date >= $${params.length}`); }
  if (to) { params.push(to); conditions.push(`je.entry_date <= $${params.length}`); }
  if (reference_type) { params.push(reference_type); conditions.push(`je.reference_type = $${params.length}`); }
  if (reference_id) { params.push(reference_id); conditions.push(`je.reference_id = $${params.length}`); }
  if (status) { params.push(status); conditions.push(`je.status = $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `SELECT je.*, u.full_name AS created_by_name,
            (SELECT COALESCE(SUM(debit), 0) FROM journal_lines WHERE journal_entry_id = je.id) AS total,
            (SELECT entry_number FROM journal_entries r WHERE r.reverses_entry_id = je.id) AS reversed_by_entry_number
     FROM journal_entries je JOIN users u ON u.id = je.created_by
     ${where} ORDER BY je.entry_date DESC, je.id DESC`,
    params
  );
  res.json({ data: rows, error: null });
}));

router.get('/journal-entries/:id', asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT je.*, u.full_name AS created_by_name,
            (SELECT entry_number FROM journal_entries r WHERE r.reverses_entry_id = je.id) AS reversed_by_entry_number
     FROM journal_entries je JOIN users u ON u.id = je.created_by WHERE je.id = $1`,
    [req.params.id]
  );
  if (!rows[0]) throw new ApiError(404, 'Journal entry not found');
  const { rows: lines } = await pool.query(
    `SELECT jl.*, a.code AS account_code, a.name AS account_name, c.name AS customer_name, s.name AS supplier_name
     FROM journal_lines jl
     JOIN chart_of_accounts a ON a.id = jl.account_id
     LEFT JOIN customers c ON c.id = jl.customer_id
     LEFT JOIN suppliers s ON s.id = jl.supplier_id
     WHERE jl.journal_entry_id = $1 ORDER BY jl.id`,
    [req.params.id]
  );
  res.json({ data: { ...rows[0], lines }, error: null });
}));

router.post('/journal-entries', requireRole(...FINANCE_ROLES), validate(schemas.journalEntryCreate), asyncHandler(async (req, res) => {
  const { entry_date, description, status, lines } = req.body;
  const result = await withTransaction(async (client) => {
    const entry = await postJournalEntry(client, {
      entryDate: entry_date, description, source: 'manual', referenceType: 'manual', createdBy: req.user.id, status,
      lines: lines.map((l) => ({ accountId: l.account_id, debit: l.debit || 0, credit: l.credit || 0, description: l.description, customerId: l.customer_id, supplierId: l.supplier_id }))
    });
    await logAudit(client, { userId: req.user.id, action: 'CREATE', entityType: 'journal_entry', entityId: entry.id, newValue: entry });
    return entry;
  });
  res.status(201).json({ data: result, error: null });
}));

// A draft hasn't affected any balance yet, so it's freely editable — full replace of lines.
router.put('/journal-entries/:id', requireRole(...FINANCE_ROLES), validate(schemas.journalEntryUpdate), asyncHandler(async (req, res) => {
  const { entry_date, description, lines } = req.body;
  const result = await withTransaction(async (client) => {
    const { rows: entryRows } = await client.query('SELECT * FROM journal_entries WHERE id = $1 FOR UPDATE', [req.params.id]);
    const entry = entryRows[0];
    if (!entry) throw new ApiError(404, 'Journal entry not found');
    if (entry.status !== 'draft') throw new ApiError(409, 'Only a draft journal entry can be edited. Use Reverse to correct a posted one.');

    const totalDebit = lines.reduce((s, l) => s + Number(l.debit || 0), 0);
    const totalCredit = lines.reduce((s, l) => s + Number(l.credit || 0), 0);
    if (Math.abs(totalDebit - totalCredit) > 0.005) {
      throw new ApiError(400, `Journal entry does not balance: debits ${totalDebit.toFixed(2)} vs credits ${totalCredit.toFixed(2)}`);
    }

    await client.query('DELETE FROM journal_lines WHERE journal_entry_id = $1', [entry.id]);
    for (const l of lines) {
      const debit = Number(l.debit || 0);
      const credit = Number(l.credit || 0);
      if (debit === 0 && credit === 0) continue;
      await client.query(
        `INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, description, customer_id, supplier_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [entry.id, l.account_id, debit, credit, l.description || null, l.customer_id || null, l.supplier_id || null]
      );
    }
    const { rows: updated } = await client.query(
      `UPDATE journal_entries SET entry_date = COALESCE($1, entry_date), description = COALESCE($2, description) WHERE id = $3 RETURNING *`,
      [entry_date || null, description || null, entry.id]
    );
    await logAudit(client, { userId: req.user.id, action: 'UPDATE', entityType: 'journal_entry', entityId: entry.id, oldValue: entry, newValue: updated[0] });
    return updated[0];
  });
  res.json({ data: result, error: null });
}));

// Draft-only hard delete.
router.delete('/journal-entries/:id', requireRole(...FINANCE_ROLES), asyncHandler(async (req, res) => {
  const result = await withTransaction(async (client) => {
    const { rows: entryRows } = await client.query('SELECT * FROM journal_entries WHERE id = $1 FOR UPDATE', [req.params.id]);
    const entry = entryRows[0];
    if (!entry) throw new ApiError(404, 'Journal entry not found');
    if (entry.status !== 'draft') throw new ApiError(409, 'Only a draft journal entry can be deleted outright. Use Reverse for a posted one.');
    await client.query('DELETE FROM journal_lines WHERE journal_entry_id = $1', [entry.id]);
    await client.query('DELETE FROM journal_entries WHERE id = $1', [entry.id]);
    await logAudit(client, { userId: req.user.id, action: 'DELETE', entityType: 'journal_entry', entityId: entry.id, oldValue: entry });
    return { id: entry.id };
  });
  res.json({ data: result, error: null });
}));

// Promotes a draft to posted — the moment it starts counting in every balance.
router.post('/journal-entries/:id/post', requireRole(...FINANCE_ROLES), asyncHandler(async (req, res) => {
  const result = await withTransaction(async (client) => {
    const entry = await promoteToPosted(client, req.params.id);
    await logAudit(client, { userId: req.user.id, action: 'UPDATE', entityType: 'journal_entry', entityId: entry.id, newValue: entry });
    return entry;
  });
  res.json({ data: result, error: null });
}));

router.post('/journal-entries/:id/reverse', requireRole(...FINANCE_ROLES), validate(schemas.reverseRequest), asyncHandler(async (req, res) => {
  const { reason } = req.body;
  const result = await withTransaction(async (client) => {
    const reversal = await reverseJournalEntry(client, { entryId: req.params.id, createdBy: req.user.id, description: reason });
    await logAudit(client, { userId: req.user.id, action: 'CREATE', entityType: 'journal_entry', entityId: reversal.id, newValue: reversal });
    return reversal;
  });
  res.json({ data: result, error: null });
}));

// ---- Cash Receipt / Cash Payment (quick two-account postings) ----
router.post('/cash-receipts', requireRole(...FINANCE_ROLES), validate(schemas.cashEntryCreate), asyncHandler(async (req, res) => {
  const { entry_date, description, amount, other_account_id, bank_account_id, customer_id, supplier_id } = req.body;
  const result = await withTransaction(async (client) => {
    const cashOrBankAcct = await resolveCashOrBankAccount(client, bank_account_id);
    const entry = await postJournalEntry(client, {
      entryDate: entry_date, description: description || 'Cash receipt', source: 'manual', referenceType: 'cash_receipt', createdBy: req.user.id,
      lines: [
        { accountId: cashOrBankAcct, debit: amount, credit: 0, customerId: customer_id, supplierId: supplier_id },
        { accountId: other_account_id, debit: 0, credit: amount, customerId: customer_id, supplierId: supplier_id }
      ]
    });
    return entry;
  });
  res.status(201).json({ data: result, error: null });
}));

router.post('/cash-payments', requireRole(...FINANCE_ROLES), validate(schemas.cashEntryCreate), asyncHandler(async (req, res) => {
  const { entry_date, description, amount, other_account_id, bank_account_id, customer_id, supplier_id } = req.body;
  const result = await withTransaction(async (client) => {
    const cashOrBankAcct = await resolveCashOrBankAccount(client, bank_account_id);
    const entry = await postJournalEntry(client, {
      entryDate: entry_date, description: description || 'Cash payment', source: 'manual', referenceType: 'cash_payment', createdBy: req.user.id,
      lines: [
        { accountId: other_account_id, debit: amount, credit: 0, customerId: customer_id, supplierId: supplier_id },
        { accountId: cashOrBankAcct, debit: 0, credit: amount, customerId: customer_id, supplierId: supplier_id }
      ]
    });
    return entry;
  });
  res.status(201).json({ data: result, error: null });
}));

async function resolveCashOrBankAccount(client, bankAccountId) {
  if (bankAccountId) {
    const { rows } = await client.query('SELECT coa_account_id FROM bank_accounts WHERE id = $1', [bankAccountId]);
    if (!rows[0]) throw new ApiError(400, 'Bank account not found');
    return rows[0].coa_account_id;
  }
  const cash = await getAccountByCode(client, '1000');
  return cash.id;
}

// ---- Bank Accounts ----
router.get('/bank-accounts', asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT b.*, a.code AS account_code,
            b.opening_balance + COALESCE((
              SELECT SUM(jl.debit - jl.credit) FROM journal_lines jl
              JOIN journal_entries je ON je.id = jl.journal_entry_id AND je.status = 'posted'
              WHERE jl.account_id = b.coa_account_id
            ), 0) AS current_balance
     FROM bank_accounts b JOIN chart_of_accounts a ON a.id = b.coa_account_id ORDER BY b.name`
  );
  res.json({ data: rows, error: null });
}));

router.post('/bank-accounts', requireRole(...FINANCE_ROLES), validate(schemas.bankAccountCreate), asyncHandler(async (req, res) => {
  const { name, bank_name, account_number, opening_balance } = req.body;
  const result = await withTransaction(async (client) => {
    const { rows: coaRows } = await client.query(
      `INSERT INTO chart_of_accounts (code, name, account_type) VALUES ($1,$2,'asset') RETURNING *`,
      [`10${String(Date.now()).slice(-4)}`, `Bank - ${name}`]
    );
    const { rows } = await client.query(
      `INSERT INTO bank_accounts (name, bank_name, account_number, coa_account_id, opening_balance) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [name, bank_name || null, account_number || null, coaRows[0].id, opening_balance || 0]
    );
    return rows[0];
  });
  res.status(201).json({ data: result, error: null });
}));

// ---- Budgets ----
router.get('/budgets', asyncHandler(async (req, res) => {
  const { fiscal_year_id } = req.query;
  const conditions = [];
  const params = [];
  if (fiscal_year_id) { params.push(fiscal_year_id); conditions.push(`b.fiscal_year_id = $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `SELECT b.*, a.code AS account_code, a.name AS account_name, fy.name AS fiscal_year_name,
            COALESCE((
              SELECT SUM(CASE WHEN a.account_type = 'expense' THEN jl.debit - jl.credit ELSE jl.credit - jl.debit END)
              FROM journal_lines jl JOIN journal_entries je ON je.id = jl.journal_entry_id
              WHERE jl.account_id = b.account_id AND je.status = 'posted'
                AND extract(month FROM je.entry_date) = b.period_month
                AND extract(year FROM je.entry_date) = extract(year FROM fy.start_date)
            ), 0) AS actual_amount
     FROM budgets b
     JOIN chart_of_accounts a ON a.id = b.account_id
     JOIN fiscal_years fy ON fy.id = b.fiscal_year_id
     ${where} ORDER BY b.period_month, a.code`,
    params
  );
  res.json({ data: rows, error: null });
}));

router.post('/budgets', requireRole(...FINANCE_ROLES), validate(schemas.budgetCreate), asyncHandler(async (req, res) => {
  const { account_id, fiscal_year_id, period_month, budgeted_amount } = req.body;
  const { rows } = await pool.query(
    `INSERT INTO budgets (account_id, fiscal_year_id, period_month, budgeted_amount) VALUES ($1,$2,$3,$4)
     ON CONFLICT (account_id, fiscal_year_id, period_month) DO UPDATE SET budgeted_amount = EXCLUDED.budgeted_amount
     RETURNING *`,
    [account_id, fiscal_year_id, period_month, budgeted_amount]
  );
  res.status(201).json({ data: rows[0], error: null });
}));

// ---- Fiscal Years / Year Closing ----
router.get('/fiscal-years', asyncHandler(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM fiscal_years ORDER BY start_date DESC');
  res.json({ data: rows, error: null });
}));

router.post('/fiscal-years', requireRole(...FINANCE_ROLES), validate(schemas.fiscalYearCreate), asyncHandler(async (req, res) => {
  const { name, start_date, end_date } = req.body;
  const { rows } = await pool.query(
    `INSERT INTO fiscal_years (name, start_date, end_date) VALUES ($1,$2,$3) RETURNING *`,
    [name, start_date, end_date]
  );
  res.status(201).json({ data: rows[0], error: null });
}));

// Closing: sums every revenue/expense account's activity within the fiscal year into
// Retained Earnings via one closing journal entry, then locks the year. Mirrors the
// standard manual "closing entries" step from the predecessor paper/desktop ledger.
router.post('/fiscal-years/:id/close', requireRole('Admin', 'Finance Officer'), asyncHandler(async (req, res) => {
  const result = await withTransaction(async (client) => {
    const { rows: fyRows } = await client.query('SELECT * FROM fiscal_years WHERE id = $1 FOR UPDATE', [req.params.id]);
    const fy = fyRows[0];
    if (!fy) throw new ApiError(404, 'Fiscal year not found');
    if (fy.status === 'closed') throw new ApiError(400, 'Fiscal year is already closed');

    const { rows: activity } = await client.query(
      `SELECT a.id AS account_id, a.account_type, COALESCE(SUM(jl.debit), 0) AS debit, COALESCE(SUM(jl.credit), 0) AS credit
       FROM chart_of_accounts a
       JOIN journal_lines jl ON jl.account_id = a.id
       JOIN journal_entries je ON je.id = jl.journal_entry_id
       WHERE a.account_type IN ('revenue', 'expense') AND je.status = 'posted' AND je.entry_date BETWEEN $1 AND $2
       GROUP BY a.id, a.account_type
       HAVING COALESCE(SUM(jl.debit), 0) != COALESCE(SUM(jl.credit), 0)`,
      [fy.start_date, fy.end_date]
    );

    if (activity.length > 0) {
      const retained = await getAccountByCode(client, '3900');
      const lines = activity.map((a) => {
        const netDebit = Number(a.debit) - Number(a.credit); // positive for expenses (normal debit), negative for revenue (normal credit)
        return a.account_type === 'expense'
          ? { accountId: a.account_id, debit: 0, credit: netDebit }
          : { accountId: a.account_id, debit: -netDebit, credit: 0 };
      });
      const netIncome = activity
        .filter((a) => a.account_type === 'revenue')
        .reduce((s, a) => s + (Number(a.credit) - Number(a.debit)), 0)
        - activity
          .filter((a) => a.account_type === 'expense')
          .reduce((s, a) => s + (Number(a.debit) - Number(a.credit)), 0);

      if (netIncome > 0) lines.push({ accountId: retained.id, debit: 0, credit: netIncome });
      else if (netIncome < 0) lines.push({ accountId: retained.id, debit: -netIncome, credit: 0 });

      await postJournalEntry(client, {
        entryDate: fy.end_date, description: `Year-end closing entry - ${fy.name}`, source: 'system', referenceType: 'closing', referenceId: fy.id, createdBy: req.user.id,
        lines
      });
    }

    const { rows: closed } = await client.query(
      `UPDATE fiscal_years SET status = 'closed', closed_by = $1, closed_at = now() WHERE id = $2 RETURNING *`,
      [req.user.id, req.params.id]
    );
    await logAudit(client, { userId: req.user.id, action: 'UPDATE', entityType: 'fiscal_year', entityId: fy.id, oldValue: fy, newValue: closed[0] });
    return closed[0];
  });

  res.json({ data: result, error: null });
}));

module.exports = router;
