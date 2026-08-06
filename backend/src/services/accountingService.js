// Double-entry posting: every journal entry must balance (sum(debits) === sum(credits))
// before it is written. Callers pass the SAME transaction client used for the business
// event being recorded (a sale, a payment, a goods receipt, ...) so the ledger and the
// operational data commit or roll back together and never drift apart.

const EPSILON = 0.005; // half a cent, to tolerate floating-point rounding on NUMERIC->JS number round-trips

async function nextEntryNumber(client) {
  const { rows } = await client.query(
    `UPDATE je_sequences SET next_value = next_value + 1 RETURNING next_value - 1 AS issued_value`
  );
  return `JE-${String(rows[0].issued_value).padStart(6, '0')}`;
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
  if (providedId) return providedId;
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
    throw new Error(`Journal entry does not balance: debits ${totalDebit.toFixed(2)} vs credits ${totalCredit.toFixed(2)}`);
  }
  if (lines.length < 2) {
    throw new Error('A journal entry needs at least two lines');
  }

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
    if (debit > 0 && credit > 0) throw new Error('A journal line cannot have both a debit and a credit');
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
  const { rows: entryRows } = await client.query('SELECT * FROM journal_entries WHERE id = $1', [entryId]);
  const original = entryRows[0];
  if (!original) throw new Error(`Journal entry ${entryId} not found`);
  if (original.status !== 'posted') throw new Error('Only a posted journal entry can be reversed');

  const { rows: alreadyReversed } = await client.query('SELECT id FROM journal_entries WHERE reverses_entry_id = $1', [entryId]);
  if (alreadyReversed[0]) throw new Error(`${original.entry_number} has already been reversed`);

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
  await client.query('UPDATE journal_entries SET reverses_entry_id = $1, is_reversal = true WHERE id = $2', [entryId, reversal.id]);
  return reversal;
}

// Promotes a saved draft to posted — the moment it starts counting in every balance.
async function promoteToPosted(client, entryId) {
  const { rows } = await client.query(
    `UPDATE journal_entries SET status = 'posted' WHERE id = $1 AND status = 'draft' RETURNING *`,
    [entryId]
  );
  if (!rows[0]) throw new Error('Journal entry not found or not a draft');
  return rows[0];
}

module.exports = { postJournalEntry, getAccountByCode, reverseJournalEntry, promoteToPosted, resolveCostCenterId };
