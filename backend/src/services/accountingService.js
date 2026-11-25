// Double-entry posting: every journal entry must balance (sum(debits) === sum(credits))
// before it is written. Callers pass the SAME transaction client used for the business
// event being recorded (a sale, a payment, a goods receipt, ...) so the ledger and the
// operational data commit or roll back together and never drift apart.

const { ApiError } = require('../utils/asyncHandler');

const EPSILON = 0.005; // half a cent, to tolerate floating-point rounding on NUMERIC->JS number round-trips

async function nextEntryNumber(client) {
  const { rows } = await client.query(
    `UPDATE je_sequences SET next_value = next_value + 1 RETURNING next_value - 1 AS issued_value`
  );
  return `JE-${String(rows[0].issued_value).padStart(6, '0')}`;
}

// A closed fiscal year is locked: nothing may be posted into it (corrections go into the current period).
async function assertPeriodOpen(client, entryDate) {
  const { rows } = await client.query(
    `SELECT name FROM fiscal_years WHERE status = 'closed' AND COALESCE($1::date, CURRENT_DATE) BETWEEN start_date AND end_date LIMIT 1`, [entryDate || null]);
  if (rows[0]) throw new ApiError(409, `Fiscal year ${rows[0].name} is closed: nothing can be posted into it`);
}

async function getAccountByCode(client, code) {
  const { rows } = await client.query('SELECT * FROM chart_of_accounts WHERE code = $1', [code]);
  if (!rows[0]) throw new Error(`Chart of accounts: missing required system account "${code}"`);
  return rows[0];
}

// Every posted transaction must belong to a company/branch. Today exactly one of
// each exists (see migrations/009_org_structure.sql), so callers that don't know/care
// about multi-company get a sensible default instead of a null dimension.
let cachedDefaultOrg = null;
async function defaultCompanyBranch(client) {
  if (cachedDefaultOrg) return cachedDefaultOrg;
  const { rows: companyRows } = await client.query('SELECT id FROM companies ORDER BY id LIMIT 1');
  const companyId = companyRows[0]?.id || null;
  const { rows: branchRows } = await client.query('SELECT id FROM branches WHERE company_id = $1 ORDER BY id LIMIT 1', [companyId]);
  cachedDefaultOrg = { companyId, branchId: branchRows[0]?.id || null };
  return cachedDefaultOrg;
}

// Resolves the cost center a transaction should be tagged with: whatever the caller
// explicitly picked, else the department's default cost center by code (e.g. every
// sale defaults to CC-SALES unless the user picks something else).
async function resolveCostCenterId(client, providedId, fallbackCode) {
  if (providedId) {
    const cc = (await client.query('SELECT is_active FROM cost_centers WHERE id = $1', [providedId])).rows[0];
    if (cc && cc.is_active === false) throw new ApiError(409, 'This cost center has been deactivated and cannot receive new postings');
    return providedId;
  }
  if (!fallbackCode) return null;
  const { rows } = await client.query('SELECT id FROM cost_centers WHERE code = $1', [fallbackCode]);
  return rows[0]?.id || null;
}

// lines: [{ accountId, debit, credit, description, customerId, supplierId, costCenterId, projectId, companyId, branchId }]
// status: 'posted' (default — affects balances immediately) or 'draft' (saved, but
// excluded from every report/balance until explicitly posted via promoteToPosted()).
async function postJournalEntry(client, { entryDate, description, source, referenceType, referenceId, createdBy, lines, status }) {
  const totalDebit = lines.reduce((s, l) => s + Number(l.debit || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + Number(l.credit || 0), 0);
  if (Math.abs(totalDebit - totalCredit) > EPSILON) {
    throw new ApiError(400, `Journal entry does not balance: debits ${totalDebit.toFixed(2)} vs credits ${totalCredit.toFixed(2)}`);
  }
  if (lines.length < 2) {
    throw new ApiError(400, 'A journal entry needs at least two lines');
  }

  await assertPeriodOpen(client, entryDate);
  const entryNumber = await nextEntryNumber(client);
  const { rows: entryRows } = await client.query(
    `INSERT INTO journal_entries (entry_number, entry_date, description, source, reference_type, reference_id, created_by, status)
     VALUES ($1, COALESCE($2, CURRENT_DATE), $3, $4, $5, $6, $7, $8) RETURNING *`,
    [entryNumber, entryDate || null, description || null, source || 'manual', referenceType || null, referenceId || null, createdBy, status || 'posted']
  );
  const entry = entryRows[0];

  const defaultOrg = await defaultCompanyBranch(client);

  for (const line of lines) {
    const debit = Number(line.debit || 0);
    const credit = Number(line.credit || 0);
    if (debit < 0 || credit < 0) throw new ApiError(400, 'Journal line amounts cannot be negative');
    if (debit > 0 && credit > 0) throw new ApiError(400, 'A journal line cannot have both a debit and a credit');
    if (debit === 0 && credit === 0) continue; // skip zero-amount legs (e.g. a $0 delivery fee)
    await client.query(
      `INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, description, customer_id, supplier_id, cost_center_id, project_id, company_id, branch_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        entry.id, line.accountId, debit, credit, line.description || null, line.customerId || null, line.supplierId || null,
        line.costCenterId || null, line.projectId || null,
        line.companyId || defaultOrg.companyId, line.branchId || defaultOrg.branchId
      ]
    );
  }

  return entry;
}

// Reverses a POSTED journal entry by posting a brand-new entry with every line's
// debit/credit flipped — the original is never touched or deleted, so the full
// history (including the "why" a correction happened) stays in the GL forever.
// Used by every module's "Reverse" action (invoice, payment, purchase, expense,
// and manual journal entries all share this one mechanism).
async function reverseJournalEntry(client, { entryId, createdBy, description }) {
  // Serialize reversals of the same posted entry. The database also has a partial
  // unique index on reverses_entry_id as a last line of defense for alternate writers.
  const { rows: entryRows } = await client.query('SELECT * FROM journal_entries WHERE id = $1 FOR UPDATE', [entryId]);
  const original = entryRows[0];
  if (!original) throw new ApiError(404, `Journal entry ${entryId} not found`);
  if (original.status !== 'posted') throw new ApiError(409, 'Only a posted journal entry can be reversed');

  const { rows: alreadyReversed } = await client.query('SELECT id FROM journal_entries WHERE reverses_entry_id = $1', [entryId]);
  if (alreadyReversed[0]) throw new ApiError(409, `${original.entry_number} has already been reversed`);

  const { rows: lines } = await client.query('SELECT * FROM journal_lines WHERE journal_entry_id = $1', [entryId]);
  const flippedLines = lines.map((l) => ({
    accountId: l.account_id, debit: Number(l.credit), credit: Number(l.debit),
    description: l.description, customerId: l.customer_id, supplierId: l.supplier_id,
    costCenterId: l.cost_center_id, projectId: l.project_id, companyId: l.company_id, branchId: l.branch_id
  }));

  const reversal = await postJournalEntry(client, {
    entryDate: null, description: description || `Reversal of ${original.entry_number}`,
    source: 'system', referenceType: original.reference_type, referenceId: original.reference_id,
    createdBy, lines: flippedLines
  });
  const { rows: marked } = await client.query('UPDATE journal_entries SET reverses_entry_id = $1, is_reversal = true WHERE id = $2 RETURNING *', [entryId, reversal.id]);
  return marked[0] || reversal;
}

// Promotes a saved draft to posted — the moment it starts counting in every balance.
async function promoteToPosted(client, entryId) {
  const draft = (await client.query(`SELECT entry_date FROM journal_entries WHERE id = $1 AND status = 'draft' FOR UPDATE`, [entryId])).rows[0];
  if (!draft) throw new ApiError(409, 'Journal entry not found or not a draft');
  await assertPeriodOpen(client, draft.entry_date);
  const { rows } = await client.query(
    `UPDATE journal_entries SET status = 'posted' WHERE id = $1 AND status = 'draft' RETURNING *`,
    [entryId]
  );
  if (!rows[0]) throw new ApiError(409, 'Journal entry not found or not a draft');
  return rows[0];
}

module.exports = { postJournalEntry, getAccountByCode, reverseJournalEntry, promoteToPosted, resolveCostCenterId };
