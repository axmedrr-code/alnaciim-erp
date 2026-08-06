import { useState } from 'react';
import client from '../api/client';

// Bulk Customer Import — QuickBooks-Desktop style: one upload imports every
// valid row immediately. HNO is the permanent drum number: a new HNO creates
// a customer, an HNO that already exists updates that customer's Name/Phone/
// Guarantor/Status (never the HNO itself) — so a "duplicate" HNO is just an
// update, not an error. Only a blank HNO or blank Name is skipped; those rows
// never block the rows around them and are listed in the downloadable Error
// Report so the operator can fix only those and re-import.
//
// Reason labels shown to the office staff on the completion screen — plain
// language only, no raw error strings from the database ever surface here.
const REASON_LABELS = {
  'Missing HNO': 'Missing HNO',
  'Empty customer name': 'Missing Customer Name',
  'Database error': 'Other Errors'
};
function reasonLabel(reason) {
  return REASON_LABELS[reason] || 'Other Errors';
}

export default function BulkImport() {
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  function downloadTemplate() {
    client.get('/imports/customers/template', { responseType: 'blob' }).then((res) => {
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url; a.download = 'customer-import-template.xlsx'; a.click();
      URL.revokeObjectURL(url);
    });
  }

  async function runImport() {
    if (!file) return;
    setError(null); setResult(null); setBusy(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const { data } = await client.post('/imports/customers/import', form, { headers: { 'Content-Type': 'multipart/form-data' } });
      setResult(data.data);
      setFile(null);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to import file');
    } finally {
      setBusy(false);
    }
  }

  async function downloadErrorReport() {
    if (!result?.errors?.length) return;
    const res = await client.post('/imports/customers/error-report', { errors: result.errors }, { responseType: 'blob' });
    const url = URL.createObjectURL(res.data);
    const a = document.createElement('a');
    a.href = url; a.download = 'customer-import-errors.xlsx'; a.click();
    URL.revokeObjectURL(url);
  }

  function reset() {
    setResult(null); setFile(null); setError(null);
  }

  // Completion screen — the operator's plain-language summary, shown instead
  // of the upload form once an import finishes.
  if (result) {
    const reasonCounts = new Map();
    for (const e of result.errors) {
      const label = reasonLabel(e.reason);
      reasonCounts.set(label, (reasonCounts.get(label) || 0) + 1);
    }
    // Always show the three expected reasons even at zero, so staff can see
    // nothing was silently missed — plus anything else that came up.
    for (const label of ['Missing HNO', 'Missing Customer Name', 'Other Errors']) {
      if (!reasonCounts.has(label)) reasonCounts.set(label, 0);
    }
    const orderedReasons = ['Missing HNO', 'Missing Customer Name', 'Other Errors',
      ...[...reasonCounts.keys()].filter((k) => !['Missing HNO', 'Missing Customer Name', 'Other Errors'].includes(k))];

    return (
      <div className="card import-done">
        <div className="import-done__banner">✔ Customer Import Completed Successfully</div>

        <div className="import-done__card">
          <div className="import-done__title">Customer Import Summary</div>
          <div className="import-done__rule" />

          <div className="import-done__row">
            <span>Total Records</span>
            <strong>{result.total.toLocaleString()}</strong>
          </div>
          <div className="import-done__row">
            <span>New Customers</span>
            <strong className="import-done__value--success">{result.imported.toLocaleString()}</strong>
          </div>
          <div className="import-done__row">
            <span>Updated Customers</span>
            <strong className="import-done__value--success">{result.updated.toLocaleString()}</strong>
          </div>
          <div className="import-done__row">
            <span>Skipped Records</span>
            <strong className={result.skipped ? 'import-done__value--warning' : 'import-done__value--success'}>{result.skipped.toLocaleString()}</strong>
          </div>

          {result.skipped > 0 && (
            <div className="import-done__reasons">
              <div className="import-done__reasons-title">Reasons</div>
              {orderedReasons.map((label) => (
                <div className="import-done__reason-row" key={label}>
                  <span>{label}</span>
                  <strong className={label === 'Other Errors' && reasonCounts.get(label) > 0 ? 'import-done__value--danger' : 'import-done__value--warning'}>
                    {reasonCounts.get(label).toLocaleString()}
                  </strong>
                </div>
              ))}
            </div>
          )}

          <div className="import-done__rule" />
        </div>

        <div className="import-done__actions">
          {result.errors.length > 0 && (
            <button className="btn secondary" onClick={downloadErrorReport}>Download Error Report (.xlsx)</button>
          )}
          <button className="btn secondary" onClick={reset}>Import Another File</button>
          <button className="btn" onClick={reset}>Done</button>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card__header">
        <h3>Bulk Customer Import</h3>
        <button className="btn secondary" onClick={downloadTemplate}>Download Template</button>
      </div>

      {error && <div className="error">{error}</div>}

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 16 }}>
        <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => setFile(e.target.files[0] || null)} />
        <button className="btn" disabled={!file || busy} onClick={runImport}>{busy ? 'Importing…' : 'Import'}</button>
      </div>
    </div>
  );
}
