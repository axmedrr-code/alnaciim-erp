const test = require('node:test');
const assert = require('node:assert/strict');
const { reverseJournalEntry } = require('../src/services/accountingService');

test('journal reversal locks the source entry before checking prior reversals', async () => {
  const calls = [];
  const client = {
    async query(sql, values) {
      calls.push({ sql, values });
      if (sql.includes('FROM journal_entries WHERE id = $1 FOR UPDATE')) {
        return { rows: [{ id: 10, entry_number: 'JE-000010', status: 'posted' }] };
      }
      if (sql.includes('WHERE reverses_entry_id = $1')) return { rows: [{ id: 11 }] };
      throw new Error(`Unexpected query: ${sql}`);
    }
  };

  await assert.rejects(
    reverseJournalEntry(client, { entryId: 10, createdBy: 2, description: 'correction' }),
    /has already been reversed/
  );
  assert.equal(calls.length, 2);
  assert.match(calls[0].sql, /FOR UPDATE/);
});
