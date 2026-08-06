// HNO numbering — a single reusable running-number generator, one continuous
// series per document type (customer / invoice / transaction / qaade),
// matching how the predecessor desktop system issued account, invoice, and
// receipt numbers. The UPDATE ... RETURNING is atomic, so concurrent callers
// never receive the same number even without explicit row locking.
async function nextHno(client, sequenceType) {
  const { rows } = await client.query(
    `UPDATE hno_sequences SET next_value = next_value + 1
     WHERE sequence_type = $1
     RETURNING prefix, padding, next_value - 1 AS issued_value`,
    [sequenceType]
  );
  if (!rows[0]) throw new Error(`Unknown HNO sequence type: ${sequenceType}`);
  const { prefix, padding, issued_value: issuedValue } = rows[0];
  return `${prefix}${String(issuedValue).padStart(padding, '0')}`;
}

module.exports = { nextHno };
