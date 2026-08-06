import { useState } from 'react';
import {
  LayoutDashboard, Receipt, BookOpen, Wallet, CreditCard, Landmark,
  Users, Building2, Calculator, BarChart3, TrendingUp, Plus, X, CheckCircle2, AlertCircle
} from 'lucide-react';
import { useApi } from '../../components/useApi';
import Table from '../../components/Table';
import GroupedTabs from '../../components/GroupedTabs';
import DateFilterBar, { defaultDateRange, ComparisonNote } from '../../components/DateFilterBar';
import client from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { BILLING_GROUP, DepartmentProvider } from './BillingCollectionsTab';

function money(v) { return `$${Number(v || 0).toFixed(2)}`; }

// ---- Dashboard ----
function FinanceDashboardTab() {
  const { rows: pl } = useApi('/reports/profit-loss');
  const { rows: bs } = useApi('/reports/balance-sheet');
  const { rows: ar } = useApi('/reports/accounts-receivable');
  const { rows: ap } = useApi('/reports/accounts-payable');

  if (!pl || !bs || !ar || !ap) return <p className="muted">Loading…</p>;
  return (
    <div>
      <div className="kpi-grid">
        <div className="kpi-card"><div className="kpi-card__label">Total Revenue</div><div className="kpi-card__value">{money(pl.total_revenue)}</div></div>
        <div className="kpi-card"><div className="kpi-card__label">Total Expenses</div><div className="kpi-card__value">{money(pl.total_expenses)}</div></div>
        <div className="kpi-card"><div className="kpi-card__label">Net Income</div><div className="kpi-card__value" style={{ color: pl.net_income >= 0 ? '#16a34a' : '#dc2626' }}>{money(pl.net_income)}</div></div>
        <div className="kpi-card"><div className="kpi-card__label">Total Assets</div><div className="kpi-card__value">{money(bs.total_assets)}</div></div>
        <div className="kpi-card"><div className="kpi-card__label">Accounts Receivable</div><div className="kpi-card__value">{money(ar.total_receivable)}</div></div>
        <div className="kpi-card"><div className="kpi-card__label">Accounts Payable</div><div className="kpi-card__value">{money(ap.total_payable)}</div></div>
      </div>
      <div className="card">
        <h3>Balance Sheet Check</h3>
        <p>Assets {money(bs.total_assets)} = Liabilities {money(bs.total_liabilities)} + Equity {money(bs.total_equity)} —{' '}
          <strong style={{ color: bs.is_balanced ? '#16a34a' : '#dc2626' }}>{bs.is_balanced ? 'Balanced' : 'OUT OF BALANCE'}</strong>
        </p>
      </div>
    </div>
  );
}

// ---- Chart of Accounts ----
function ChartOfAccountsTab() {
  const { user } = useAuth();
  const canEdit = ['Admin', 'Finance Officer'].includes(user?.role);
  const { rows, reload } = useApi('/finance/chart-of-accounts');
  const [form, setForm] = useState({ code: '', name: '', account_type: 'asset' });
  const [showForm, setShowForm] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    await client.post('/finance/chart-of-accounts', form);
    setForm({ code: '', name: '', account_type: 'asset' });
    setShowForm(false);
    reload();
  }

  return (
    <div>
      <div className="toolbar">
        {canEdit && <button className="btn" onClick={() => setShowForm((s) => !s)}>{showForm ? 'Cancel' : '+ New Account'}</button>}
      </div>
      {showForm && (
        <form className="stacked-form card" onSubmit={handleSubmit}>
          <label>Code<input required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></label>
          <label>Name<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label>Type
            <select value={form.account_type} onChange={(e) => setForm({ ...form, account_type: e.target.value })}>
              <option value="asset">Asset</option>
              <option value="liability">Liability</option>
              <option value="equity">Equity</option>
              <option value="revenue">Revenue</option>
              <option value="expense">Expense</option>
            </select>
          </label>
          <div><button className="btn" type="submit">Save</button></div>
        </form>
      )}
      <div className="card">
        <Table
          columns={[
            { key: 'code', header: 'Code' },
            { key: 'name', header: 'Name' },
            { key: 'account_type', header: 'Type', render: (r) => <span className="badge">{r.account_type}</span> },
            { key: 'balance', header: 'Balance', render: (r) => money(r.balance) },
            { key: 'is_active', header: 'Status', render: (r) => <span className={`badge badge--${r.is_active ? 'ok' : 'low'}`}>{r.is_active ? 'Active' : 'Inactive'}</span> }
          ]}
          rows={rows}
          searchable searchPlaceholder="Search accounts…" sortable
        />
      </div>
    </div>
  );
}

// ---- Journal Entries ----
const EMPTY_LINES = [{ account_id: '', debit: '', credit: '' }, { account_id: '', debit: '', credit: '' }];

function JournalEntriesTab() {
  const { user } = useAuth();
  const canEdit = ['Admin', 'Finance Officer'].includes(user?.role);
  const [dateRange, setDateRange] = useState(defaultDateRange());
  const { rows, reload } = useApi(`/finance/journal-entries?from=${dateRange.from}&to=${dateRange.to}`, [dateRange.from, dateRange.to]);
  const { rows: accounts } = useApi('/finance/chart-of-accounts');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [description, setDescription] = useState('');
  const [entryDate, setEntryDate] = useState('');
  const [status, setStatus] = useState('posted');
  const [lines, setLines] = useState(EMPTY_LINES);
  const [expanded, setExpanded] = useState(null);
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  function updateLine(i, field, value) {
    const next = [...lines];
    next[i] = { ...next[i], [field]: value };
    setLines(next);
  }

  function resetForm() {
    setDescription(''); setEntryDate(''); setStatus('posted'); setLines(EMPTY_LINES);
    setShowForm(false); setEditingId(null); setError(null);
  }

  async function startEdit(id) {
    const res = await client.get(`/finance/journal-entries/${id}`);
    const entry = res.data.data;
    setDescription(entry.description || '');
    setEntryDate(String(entry.entry_date).slice(0, 10));
    setLines(entry.lines.map((l) => ({ account_id: String(l.account_id), debit: Number(l.debit) || '', credit: Number(l.credit) || '' })));
    setEditingId(id);
    setError(null);
    setShowForm(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    const payload = {
      description, entry_date: entryDate || undefined,
      lines: lines.filter((l) => l.account_id).map((l) => ({ account_id: Number(l.account_id), debit: Number(l.debit) || 0, credit: Number(l.credit) || 0 }))
    };
    try {
      if (editingId) {
        await client.put(`/finance/journal-entries/${editingId}`, payload);
      } else {
        await client.post('/finance/journal-entries', { ...payload, status });
      }
      resetForm();
      setSuccess(editingId ? 'Journal entry updated.' : 'Journal entry saved.');
      reload();
      setTimeout(() => setSuccess(null), 4000);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save journal entry');
    }
  }

  async function postDraft(id) { await client.post(`/finance/journal-entries/${id}/post`); reload(); }
  async function deleteDraft(id) {
    if (!window.confirm('Delete this draft journal entry?')) return;
    await client.delete(`/finance/journal-entries/${id}`);
    reload();
  }
  async function reverseEntry(id, entryNumber) {
    const reason = window.prompt(`Reverse ${entryNumber}? This posts an offsetting counter-entry. Reason (optional):`);
    if (reason === null) return;
    try {
      await client.post(`/finance/journal-entries/${id}/reverse`, { reason: reason || undefined });
      reload();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to reverse entry');
    }
  }

  async function toggleExpand(id) {
    if (expanded === id) { setExpanded(null); return; }
    const res = await client.get(`/finance/journal-entries/${id}`);
    setDetail(res.data.data);
    setExpanded(id);
  }

  const totalDebit = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);

  const isBalanced = totalDebit === totalCredit && totalDebit > 0;

  return (
    <div>
      {success && <div className="success-box"><CheckCircle2 size={15} /> {success}</div>}
      <div className="toolbar">
        {canEdit && <button className="btn" onClick={() => (showForm ? resetForm() : setShowForm(true))}>{showForm ? <><X size={15} /> Cancel</> : <><Plus size={15} /> New Journal Entry</>}</button>}
        <DateFilterBar
          value={dateRange} onChange={setDateRange} title="Journal Entries"
          columns={[
            { key: 'entry_number', header: 'Entry #' }, { key: 'entry_date', header: 'Date' }, { key: 'description', header: 'Description' },
            { key: 'reference_type', header: 'Source' }, { key: 'status', header: 'Status' }, { key: 'total', header: 'Amount', render: (r) => money(r.total) }
          ]}
          rows={rows}
        />
      </div>
      {showForm && (
        <form className="form-modern" onSubmit={handleSubmit}>
          <h3 className="form-modern__title">{editingId ? 'Edit Journal Entry' : 'New Journal Entry'}</h3>
          <p className="form-modern__subtitle">{editingId ? 'This entry is still a draft, so its lines can be freely rewritten.' : 'Record a manual double-entry posting to the General Ledger.'}</p>

          {error && <div className="error-box"><AlertCircle size={15} /> {error}</div>}

          <div className="form-section">
            <div className="form-section__title">Entry Details</div>
            <div className="form-grid">
              <div className="form-field span-2">
                <label>Description</label>
                <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What is this entry for?" />
              </div>
              <div className="form-field">
                <label>Date</label>
                <input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
              </div>
              {!editingId && (
                <div className="form-field">
                  <label>Save as</label>
                  <select value={status} onChange={(e) => setStatus(e.target.value)}>
                    <option value="posted">Posted (affects balances immediately)</option>
                    <option value="draft">Draft (saved, not yet posted)</option>
                  </select>
                </div>
              )}
            </div>
          </div>

          <div className="form-section">
            <div className="form-section__title">Journal Lines</div>
            {lines.map((l, i) => (
              <div key={i} style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
                <select value={l.account_id} onChange={(e) => updateLine(i, 'account_id', e.target.value)} style={{ flex: 2 }}>
                  <option value="">Account…</option>
                  {accounts?.map((a) => <option key={a.id} value={a.id}>{a.code} - {a.name}</option>)}
                </select>
                <input placeholder="Debit" type="number" step="0.01" value={l.debit} onChange={(e) => updateLine(i, 'debit', e.target.value)} style={{ flex: 1 }} />
                <input placeholder="Credit" type="number" step="0.01" value={l.credit} onChange={(e) => updateLine(i, 'credit', e.target.value)} style={{ flex: 1 }} />
              </div>
            ))}
            <button type="button" className="secondary" onClick={() => setLines([...lines, { account_id: '', debit: '', credit: '' }])}><Plus size={13} /> Add Line</button>
            <p style={{ marginTop: 14, marginBottom: 0, fontSize: 13, fontWeight: 600, color: isBalanced ? 'var(--success)' : 'var(--text-muted)' }}>
              Debits {money(totalDebit)} / Credits {money(totalCredit)} {isBalanced ? '✓ Balanced' : ''}
            </p>
          </div>

          <div className="form-actions">
            <button className="btn" type="submit" disabled={totalDebit !== totalCredit || totalDebit === 0}>
              <CheckCircle2 size={15} /> {editingId ? 'Save Changes' : 'Save Entry'}
            </button>
            <button type="button" className="secondary" onClick={resetForm}>Cancel</button>
          </div>
        </form>
      )}
      <div className="card">
        <Table
          columns={[
            { key: 'entry_number', header: 'Entry #', render: (r) => <a href="#" onClick={(e) => { e.preventDefault(); toggleExpand(r.id); }}>{r.entry_number}</a> },
            { key: 'entry_date', header: 'Date', render: (r) => String(r.entry_date).slice(0, 10) },
            { key: 'description', header: 'Description' },
            { key: 'reference_type', header: 'Source', render: (r) => <span className="badge">{r.reference_type || r.source}</span> },
            { key: 'status', header: 'Status', render: (r) => <span className={`badge badge--${r.status === 'posted' ? 'ok' : r.status === 'draft' ? 'pending' : 'low'}`}>{r.reversed_by_entry_number ? 'reversed' : r.status}</span> },
            { key: 'total', header: 'Amount', render: (r) => money(r.total) },
            { key: 'created_by_name', header: 'By' },
            canEdit && {
              key: 'actions', header: '', render: (r) => (
                <div style={{ display: 'flex', gap: 6 }}>
                  {r.status === 'draft' && <>
                    <button className="btn secondary" onClick={() => startEdit(r.id)}>Edit</button>
                    <button className="btn secondary" onClick={() => postDraft(r.id)}>Post</button>
                    <button className="btn secondary" onClick={() => deleteDraft(r.id)}>Delete</button>
                  </>}
                  {r.status === 'posted' && !r.reversed_by_entry_number && !r.is_reversal && (
                    <button className="btn secondary" onClick={() => reverseEntry(r.id, r.entry_number)}>Reverse</button>
                  )}
                </div>
              )
            }
          ].filter(Boolean)}
          rows={rows}
          searchable searchPlaceholder="Search entries…" sortable pageSize={10}
        />
      </div>
      {expanded && detail && (
        <div className="card">
          <h3>{detail.entry_number} — {detail.description}</h3>
          <Table
            columns={[
              { key: 'account_code', header: 'Account', render: (r) => `${r.account_code} - ${r.account_name}` },
              { key: 'debit', header: 'Debit', render: (r) => Number(r.debit) > 0 ? money(r.debit) : '' },
              { key: 'credit', header: 'Credit', render: (r) => Number(r.credit) > 0 ? money(r.credit) : '' },
              { key: 'customer_name', header: 'Customer/Supplier', render: (r) => r.customer_name || r.supplier_name || '—' }
            ]}
            rows={detail.lines}
          />
        </div>
      )}
    </div>
  );
}

// ---- Cash Receipt / Cash Payment (shared shape) ----
function CashEntryForm({ endpoint, cashLabel }) {
  const { rows: accounts } = useApi('/finance/chart-of-accounts');
  const { rows: bankAccounts } = useApi('/finance/bank-accounts');
  const { rows: entries, reload } = useApi(`/finance/journal-entries?reference_type=${endpoint === 'cash-receipts' ? 'cash_receipt' : 'cash_payment'}`);
  const [form, setForm] = useState({ amount: '', other_account_id: '', bank_account_id: '', description: '', entry_date: '' });

  async function handleSubmit(e) {
    e.preventDefault();
    await client.post(`/finance/${endpoint}`, {
      amount: Number(form.amount), other_account_id: Number(form.other_account_id),
      bank_account_id: form.bank_account_id || undefined, description: form.description || undefined,
      entry_date: form.entry_date || undefined
    });
    setForm({ amount: '', other_account_id: '', bank_account_id: '', description: '', entry_date: '' });
    reload();
  }

  return (
    <div>
      <form className="stacked-form card" onSubmit={handleSubmit}>
        <label>Amount<input required type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></label>
        <label>{cashLabel}
          <select value={form.bank_account_id} onChange={(e) => setForm({ ...form, bank_account_id: e.target.value })}>
            <option value="">Cash on Hand</option>
            {bankAccounts?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </label>
        <label>Other Account
          <select required value={form.other_account_id} onChange={(e) => setForm({ ...form, other_account_id: e.target.value })}>
            <option value="">Select…</option>
            {accounts?.filter((a) => !['1000', '1010'].includes(a.code)).map((a) => <option key={a.id} value={a.id}>{a.code} - {a.name}</option>)}
          </select>
        </label>
        <label>Description<input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
        <label>Date<input type="date" value={form.entry_date} onChange={(e) => setForm({ ...form, entry_date: e.target.value })} /></label>
        <div><button className="btn" type="submit">Record</button></div>
      </form>
      <div className="card">
        <Table
          columns={[
            { key: 'entry_number', header: 'Entry #' },
            { key: 'entry_date', header: 'Date', render: (r) => String(r.entry_date).slice(0, 10) },
            { key: 'description', header: 'Description' },
            { key: 'total', header: 'Amount', render: (r) => money(r.total) }
          ]}
          rows={entries}
          emptyText="No entries recorded yet."
        />
      </div>
    </div>
  );
}
function CashReceiptTab() { return <CashEntryForm endpoint="cash-receipts" cashLabel="Deposit Into" />; }
function CashPaymentTab() { return <CashEntryForm endpoint="cash-payments" cashLabel="Pay From" />; }

// ---- Bank Accounts ----
function BankAccountsTab() {
  const { user } = useAuth();
  const canEdit = ['Admin', 'Finance Officer'].includes(user?.role);
  const { rows, reload } = useApi('/finance/bank-accounts');
  const [form, setForm] = useState({ name: '', bank_name: '', account_number: '', opening_balance: '' });
  const [showForm, setShowForm] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    await client.post('/finance/bank-accounts', { ...form, opening_balance: Number(form.opening_balance) || 0 });
    setForm({ name: '', bank_name: '', account_number: '', opening_balance: '' });
    setShowForm(false);
    reload();
  }

  return (
    <div>
      <div className="toolbar">
        {canEdit && <button className="btn" onClick={() => setShowForm((s) => !s)}>{showForm ? 'Cancel' : '+ New Bank Account'}</button>}
      </div>
      {showForm && (
        <form className="stacked-form card" onSubmit={handleSubmit}>
          <label>Name<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label>Bank<input value={form.bank_name} onChange={(e) => setForm({ ...form, bank_name: e.target.value })} /></label>
          <label>Account Number<input value={form.account_number} onChange={(e) => setForm({ ...form, account_number: e.target.value })} /></label>
          <label>Opening Balance<input type="number" step="0.01" value={form.opening_balance} onChange={(e) => setForm({ ...form, opening_balance: e.target.value })} /></label>
          <div><button className="btn" type="submit">Save</button></div>
        </form>
      )}
      <div className="card">
        <Table
          columns={[
            { key: 'name', header: 'Name' },
            { key: 'bank_name', header: 'Bank' },
            { key: 'account_number', header: 'Account #' },
            { key: 'current_balance', header: 'Current Balance', render: (r) => money(r.current_balance) }
          ]}
          rows={rows}
        />
      </div>
    </div>
  );
}

// ---- Accounts Receivable / Accounts Payable ----
function AccountsReceivableTab() {
  const { rows } = useApi('/reports/accounts-receivable');
  if (!rows) return <p className="muted">Loading…</p>;
  return (
    <div>
      <div className="kpi-grid">
        <div className="kpi-card"><div className="kpi-card__label">Total Receivable</div><div className="kpi-card__value">{money(rows.total_receivable)}</div></div>
      </div>
      <div className="card">
        <Table
          columns={[
            { key: 'hno', header: 'HNO' },
            { key: 'name', header: 'Customer' },
            { key: 'balance', header: 'Balance', render: (r) => money(r.balance) }
          ]}
          rows={rows.customers}
          emptyText="No outstanding receivables."
        />
      </div>
    </div>
  );
}

function AccountsPayableTab() {
  const { rows } = useApi('/reports/accounts-payable');
  if (!rows) return <p className="muted">Loading…</p>;
  return (
    <div>
      <div className="kpi-grid">
        <div className="kpi-card"><div className="kpi-card__label">Total Payable</div><div className="kpi-card__value">{money(rows.total_payable)}</div></div>
      </div>
      <div className="card">
        <Table
          columns={[
            { key: 'code', header: 'Code' },
            { key: 'name', header: 'Supplier' },
            { key: 'balance', header: 'Balance', render: (r) => money(r.balance) }
          ]}
          rows={rows.suppliers}
          emptyText="No outstanding payables."
        />
      </div>
    </div>
  );
}

// ---- General Ledger ----
function GeneralLedgerTab() {
  const { rows: accounts } = useApi('/finance/chart-of-accounts');
  const [accountId, setAccountId] = useState('');
  const [dateRange, setDateRange] = useState(defaultDateRange());
  const { rows: gl } = useApi(
    accountId ? `/reports/general-ledger?account_id=${accountId}&from=${dateRange.from}&to=${dateRange.to}` : null,
    [accountId, dateRange.from, dateRange.to]
  );
  const glColumns = [
    { key: 'entry_date', header: 'Date', render: (r) => String(r.entry_date).slice(0, 10) },
    { key: 'entry_number', header: 'Entry #' },
    { key: 'description', header: 'Description' },
    { key: 'debit', header: 'Debit', render: (r) => Number(r.debit) > 0 ? money(r.debit) : '' },
    { key: 'credit', header: 'Credit', render: (r) => Number(r.credit) > 0 ? money(r.credit) : '' },
    { key: 'running_balance', header: 'Balance', render: (r) => money(r.running_balance) }
  ];

  return (
    <div>
      <div className="toolbar">
        <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          <option value="">Select an account…</option>
          {accounts?.map((a) => <option key={a.id} value={a.id}>{a.code} - {a.name}</option>)}
        </select>
        <DateFilterBar value={dateRange} onChange={setDateRange} columns={accountId ? glColumns : null} rows={gl?.lines} title="General Ledger" />
      </div>
      {gl && (
        <div className="card">
          <h3>{gl.account.code} - {gl.account.name}</h3>
          <Table columns={glColumns} rows={gl.lines} emptyText="No activity on this account yet." />
          <p><strong>Closing Balance: {money(gl.closing_balance)}</strong></p>
        </div>
      )}
    </div>
  );
}

// ---- Trial Balance ----
function TrialBalanceTab() {
  const [dateRange, setDateRange] = useState(defaultDateRange());
  const { rows } = useApi(`/reports/trial-balance?as_of=${dateRange.to}`, [dateRange.to]);
  const columns = [
    { key: 'code', header: 'Code' },
    { key: 'name', header: 'Account' },
    { key: 'account_type', header: 'Type' },
    { key: 'debit_balance', header: 'Debit', render: (r) => r.debit_balance > 0 ? money(r.debit_balance) : '' },
    { key: 'credit_balance', header: 'Credit', render: (r) => r.credit_balance > 0 ? money(r.credit_balance) : '' }
  ];
  if (!rows) return <p className="muted">Loading…</p>;
  return (
    <div>
      <div className="toolbar"><DateFilterBar value={dateRange} onChange={setDateRange} columns={columns} rows={rows.accounts} title="Trial Balance" /></div>
      <p className="muted">As of {dateRange.to} — pick any period above, the balance shown is always "as of" its end date.</p>
      <div className="card">
        <Table columns={columns} rows={rows.accounts} />
        <p><strong>Totals: Debit {money(rows.total_debit)} / Credit {money(rows.total_credit)} — {rows.is_balanced ? '✓ Balanced' : '⚠ OUT OF BALANCE'}</strong></p>
      </div>
    </div>
  );
}

// ---- Profit & Loss ----
function ProfitLossTab() {
  const [dateRange, setDateRange] = useState(defaultDateRange());
  const { rows } = useApi(`/reports/profit-loss?from=${dateRange.from}&to=${dateRange.to}`, [dateRange.from, dateRange.to]);
  const { rows: compareRows } = useApi(
    dateRange.compare ? `/reports/profit-loss?from=${dateRange.compare.from}&to=${dateRange.compare.to}` : null,
    [dateRange.compare?.from, dateRange.compare?.to]
  );
  if (!rows) return <p className="muted">Loading…</p>;
  return (
    <div>
      <div className="toolbar"><DateFilterBar value={dateRange} onChange={setDateRange} columns={[{ key: 'name', header: 'Account' }, { key: 'amount', header: 'Amount', render: (r) => money(r.amount) }]} rows={[...rows.revenue, ...rows.expenses]} title="Profit and Loss" /></div>
      <div className="card">
        <h3>Revenue</h3>
        <Table columns={[{ key: 'name', header: 'Account' }, { key: 'amount', header: 'Amount', render: (r) => money(r.amount) }]} rows={rows.revenue} />
        <p><strong>Total Revenue: {money(rows.total_revenue)}</strong></p>
      </div>
      <div className="card">
        <h3>Expenses</h3>
        <Table columns={[{ key: 'name', header: 'Account' }, { key: 'amount', header: 'Amount', render: (r) => money(r.amount) }]} rows={rows.expenses} />
        <p><strong>Total Expenses: {money(rows.total_expenses)}</strong></p>
      </div>
      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-card__label">Net Income</div>
          <div className="kpi-card__value" style={{ color: rows.net_income >= 0 ? '#16a34a' : '#dc2626' }}>{money(rows.net_income)}</div>
          {dateRange.compare && <ComparisonNote current={rows.net_income} previous={compareRows?.net_income} />}
        </div>
      </div>
    </div>
  );
}

// ---- Balance Sheet ----
function BalanceSheetTab() {
  const [dateRange, setDateRange] = useState(defaultDateRange());
  const { rows } = useApi(`/reports/balance-sheet?as_of=${dateRange.to}`, [dateRange.to]);
  if (!rows) return <p className="muted">Loading…</p>;
  return (
    <div>
      <div className="toolbar"><DateFilterBar value={dateRange} onChange={setDateRange} columns={[{ key: 'name', header: 'Account' }, { key: 'balance', header: 'Balance', render: (r) => money(r.balance) }]} rows={rows.assets} title="Balance Sheet" /></div>
      <p className="muted">As of {dateRange.to}.</p>
      <div className="card">
        <h3>Assets</h3>
        <Table columns={[{ key: 'name', header: 'Account' }, { key: 'balance', header: 'Balance', render: (r) => money(r.balance) }]} rows={rows.assets} />
        <p><strong>Total Assets: {money(rows.total_assets)}</strong></p>
      </div>
      <div className="card">
        <h3>Liabilities</h3>
        <Table columns={[{ key: 'name', header: 'Account' }, { key: 'balance', header: 'Balance', render: (r) => money(r.balance) }]} rows={rows.liabilities} emptyText="No liabilities." />
        <p><strong>Total Liabilities: {money(rows.total_liabilities)}</strong></p>
      </div>
      <div className="card">
        <h3>Equity</h3>
        <Table columns={[{ key: 'name', header: 'Account' }, { key: 'balance', header: 'Balance', render: (r) => money(r.balance) }]} rows={[...rows.equity, { id: 'cye', name: 'Current Year Earnings', balance: rows.current_year_earnings }]} />
        <p><strong>Total Equity: {money(rows.total_equity)}</strong></p>
      </div>
      <p><strong style={{ color: rows.is_balanced ? '#16a34a' : '#dc2626' }}>{rows.is_balanced ? '✓ Balanced' : '⚠ OUT OF BALANCE'}</strong></p>
    </div>
  );
}

// ---- Cash Flow ----
function CashFlowTab() {
  const [dateRange, setDateRange] = useState(defaultDateRange());
  const { rows } = useApi(`/reports/cash-flow?from=${dateRange.from}&to=${dateRange.to}`, [dateRange.from, dateRange.to]);
  const { rows: compareRows } = useApi(
    dateRange.compare ? `/reports/cash-flow?from=${dateRange.compare.from}&to=${dateRange.compare.to}` : null,
    [dateRange.compare?.from, dateRange.compare?.to]
  );
  const columns = [
    { key: 'reference_type', header: 'Activity' },
    { key: 'entry_count', header: 'Entries' },
    { key: 'net_change', header: 'Net Cash Movement', render: (r) => money(r.net_change) }
  ];
  if (!rows) return <p className="muted">Loading…</p>;
  return (
    <div>
      <div className="toolbar"><DateFilterBar value={dateRange} onChange={setDateRange} columns={columns} rows={rows.by_activity} title="Cash Flow" /></div>
      <div className="kpi-grid">
        <div className="kpi-card"><div className="kpi-card__label">Opening Balance</div><div className="kpi-card__value">{money(rows.opening_balance)}</div></div>
        <div className="kpi-card">
          <div className="kpi-card__label">Net Change</div>
          <div className="kpi-card__value">{money(rows.net_change)}</div>
          {dateRange.compare && <ComparisonNote current={rows.net_change} previous={compareRows?.net_change} />}
        </div>
        <div className="kpi-card"><div className="kpi-card__label">Closing Balance</div><div className="kpi-card__value">{money(rows.closing_balance)}</div></div>
      </div>
      <div className="card">
        <Table columns={columns} rows={rows.by_activity} />
      </div>
    </div>
  );
}

// ---- Budget ----
function BudgetTab() {
  const { user } = useAuth();
  const canEdit = ['Admin', 'Finance Officer'].includes(user?.role);
  const { rows: fiscalYears } = useApi('/finance/fiscal-years');
  const { rows: accounts } = useApi('/finance/chart-of-accounts');
  const currentFy = fiscalYears?.[0];
  const { rows, reload } = useApi(currentFy ? `/finance/budgets?fiscal_year_id=${currentFy.id}` : null, [currentFy?.id]);
  const [form, setForm] = useState({ account_id: '', period_month: '1', budgeted_amount: '' });

  async function handleSubmit(e) {
    e.preventDefault();
    await client.post('/finance/budgets', { ...form, account_id: Number(form.account_id), period_month: Number(form.period_month), budgeted_amount: Number(form.budgeted_amount), fiscal_year_id: currentFy.id });
    setForm({ account_id: '', period_month: '1', budgeted_amount: '' });
    reload();
  }

  return (
    <div>
      {currentFy && <p className="muted">Fiscal Year: {currentFy.name}</p>}
      {canEdit && currentFy && (
        <form className="stacked-form card" onSubmit={handleSubmit}>
          <label>Account
            <select required value={form.account_id} onChange={(e) => setForm({ ...form, account_id: e.target.value })}>
              <option value="">Select…</option>
              {accounts?.filter((a) => ['revenue', 'expense'].includes(a.account_type)).map((a) => <option key={a.id} value={a.id}>{a.code} - {a.name}</option>)}
            </select>
          </label>
          <label>Month
            <select value={form.period_month} onChange={(e) => setForm({ ...form, period_month: e.target.value })}>
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
          <label>Budgeted Amount<input required type="number" step="0.01" value={form.budgeted_amount} onChange={(e) => setForm({ ...form, budgeted_amount: e.target.value })} /></label>
          <div><button className="btn" type="submit">Save Budget</button></div>
        </form>
      )}
      <div className="card">
        <Table
          columns={[
            { key: 'period_month', header: 'Month' },
            { key: 'account_name', header: 'Account', render: (r) => `${r.account_code} - ${r.account_name}` },
            { key: 'budgeted_amount', header: 'Budgeted', render: (r) => money(r.budgeted_amount) },
            { key: 'actual_amount', header: 'Actual', render: (r) => money(r.actual_amount) },
            { key: 'variance', header: 'Variance', render: (r) => money(r.budgeted_amount - r.actual_amount) }
          ]}
          rows={rows}
          emptyText="No budgets set for this fiscal year yet."
        />
      </div>
    </div>
  );
}

// ---- Financial Year Closing ----
function YearClosingTab() {
  const { user } = useAuth();
  const canClose = ['Admin', 'Finance Officer'].includes(user?.role);
  const { rows, reload } = useApi('/finance/fiscal-years');

  async function handleClose(id) {
    if (!window.confirm('Close this fiscal year? This posts a closing journal entry and locks the period.')) return;
    await client.post(`/finance/fiscal-years/${id}/close`);
    reload();
  }

  return (
    <div className="card">
      <Table
        columns={[
          { key: 'name', header: 'Fiscal Year' },
          { key: 'start_date', header: 'Start', render: (r) => String(r.start_date).slice(0, 10) },
          { key: 'end_date', header: 'End', render: (r) => String(r.end_date).slice(0, 10) },
          { key: 'status', header: 'Status', render: (r) => <span className={`badge badge--${r.status === 'open' ? 'ok' : 'low'}`}>{r.status}</span> },
          {
            key: 'actions', header: '', render: (r) => (
              canClose && r.status === 'open' ? <button className="btn btn--secondary" onClick={() => handleClose(r.id)}>Close Year</button> : null
            )
          }
        ]}
        rows={rows}
      />
    </div>
  );
}

// ---- Legacy tabs kept as-is ----
function ExpensesTab() {
  const { user } = useAuth();
  const canEdit = ['Admin', 'Finance Officer'].includes(user?.role);
  const { rows, reload } = useApi('/finance/expenses');
  const { rows: categories } = useApi('/finance/expense-categories');
  const { rows: bankAccounts } = useApi('/finance/bank-accounts');
  const [form, setForm] = useState({ category_id: '', amount: '', description: '', payment_method: 'cash', bank_account_id: '' });
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    try {
      await client.post('/finance/expenses', { ...form, category_id: Number(form.category_id), amount: Number(form.amount), bank_account_id: form.bank_account_id || undefined });
      setForm({ category_id: '', amount: '', description: '', payment_method: 'cash', bank_account_id: '' });
      setShowForm(false);
      setSuccess('Expense recorded.');
      reload();
      setTimeout(() => setSuccess(null), 4000);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to record expense');
    }
  }

  async function reverseExpense(id) {
    const reason = window.prompt('Reverse this expense? This posts an offsetting ledger entry. Reason (optional):');
    if (reason === null) return;
    try {
      await client.post(`/finance/expenses/${id}/reverse`, { reason: reason || undefined });
      reload();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to reverse expense');
    }
  }

  return (
    <div>
      {success && <div className="success-box"><CheckCircle2 size={15} /> {success}</div>}
      <div className="toolbar">
        {canEdit && <button className="btn" onClick={() => setShowForm((s) => !s)}>{showForm ? <><X size={15} /> Cancel</> : <><Plus size={15} /> New Expense</>}</button>}
      </div>
      {showForm && (
        <form className="form-modern" onSubmit={handleSubmit}>
          <h3 className="form-modern__title">New Expense</h3>
          <p className="form-modern__subtitle">Posts immediately to the ledger against the category's mapped expense account.</p>
          {error && <div className="error-box"><AlertCircle size={15} /> {error}</div>}

          <div className="form-section">
            <div className="form-section__title">Expense Details</div>
            <div className="form-grid">
              <div className="form-field">
                <label>Category</label>
                <select required value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })}>
                  <option value="">Select…</option>
                  {categories?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="form-field">
                <label>Amount</label>
                <input required type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
              </div>
              <div className="form-field span-2">
                <label>Description</label>
                <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </div>
            </div>
          </div>

          <div className="form-section">
            <div className="form-section__title">Payment</div>
            <div className="form-grid">
              <div className="form-field">
                <label>Payment Method</label>
                <select value={form.payment_method} onChange={(e) => setForm({ ...form, payment_method: e.target.value })}>
                  <option value="cash">Cash</option>
                  <option value="bank_transfer">Bank Transfer</option>
                  <option value="cheque">Cheque</option>
                </select>
              </div>
              {form.payment_method !== 'cash' && (
                <div className="form-field">
                  <label>Bank Account</label>
                  <select value={form.bank_account_id} onChange={(e) => setForm({ ...form, bank_account_id: e.target.value })}>
                    <option value="">Default</option>
                    {bankAccounts?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
              )}
            </div>
          </div>

          <div className="form-actions">
            <button className="btn" type="submit"><CheckCircle2 size={15} /> Save Expense</button>
            <button type="button" className="secondary" onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </form>
      )}
      <div className="card">
        <Table
          columns={[
            { key: 'expense_date', header: 'Date', render: (r) => String(r.expense_date).slice(0, 10) },
            { key: 'category_name', header: 'Category' },
            { key: 'amount', header: 'Amount', render: (r) => money(r.amount) },
            { key: 'payment_method', header: 'Method' },
            { key: 'description', header: 'Description' },
            { key: 'recorded_by_name', header: 'Recorded By' },
            { key: 'voided_at', header: 'Status', render: (r) => r.voided_at ? <span className="badge badge--low">Reversed</span> : <span className="badge badge--ok">Active</span> },
            canEdit && { key: 'actions', header: '', render: (r) => !r.voided_at && <button className="btn secondary" onClick={() => reverseExpense(r.id)}>Reverse</button> }
          ].filter(Boolean)}
          rows={rows}
          searchable searchPlaceholder="Search expenses…" sortable pageSize={10}
        />
      </div>
    </div>
  );
}

function ProfitabilityTab() {
  const { rows } = useApi('/finance/profitability');
  const { rows: summary } = useApi('/finance/revenue-summary');

  return (
    <div>
      {summary && (
        <div className="kpi-grid">
          <div className="kpi-card"><div className="kpi-card__label">Revenue</div><div className="kpi-card__value">{money(summary.revenue)}</div></div>
          <div className="kpi-card"><div className="kpi-card__label">Cost</div><div className="kpi-card__value">{money(summary.cost)}</div></div>
          <div className="kpi-card"><div className="kpi-card__label">Profit</div><div className="kpi-card__value">{money(summary.profit)}</div></div>
        </div>
      )}
      <div className="card">
        <Table
          columns={[
            { key: 'name', header: 'Product' },
            { key: 'units_sold', header: 'Units Sold' },
            { key: 'revenue', header: 'Revenue', render: (r) => money(r.revenue) },
            { key: 'material_cost', header: 'Material Cost', render: (r) => money(r.material_cost) },
            { key: 'gross_margin', header: 'Gross Margin', render: (r) => money(r.gross_margin) }
          ]}
          rows={rows}
        />
      </div>
    </div>
  );
}

const GROUPS = [
  {
    key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard,
    items: [{ key: 'dashboard', label: 'Dashboard', Component: FinanceDashboardTab }]
  },
  BILLING_GROUP,
  {
    key: 'transactions', label: 'Transactions', icon: Receipt,
    items: [
      { key: 'journal', label: 'Journal Entries', icon: BookOpen, Component: JournalEntriesTab },
      { key: 'cash-receipt', label: 'Cash Receipt', icon: Wallet, Component: CashReceiptTab },
      { key: 'cash-payment', label: 'Cash Payment', icon: CreditCard, Component: CashPaymentTab }
    ]
  },
  {
    key: 'accounts', label: 'Accounts', icon: Landmark,
    items: [
      { key: 'coa', label: 'Chart of Accounts', icon: BookOpen, Component: ChartOfAccountsTab },
      { key: 'bank-accounts', label: 'Bank Accounts', icon: Landmark, Component: BankAccountsTab },
      { key: 'ar', label: 'Accounts Receivable', icon: Users, Component: AccountsReceivableTab },
      { key: 'ap', label: 'Accounts Payable', icon: Building2, Component: AccountsPayableTab }
    ]
  },
  {
    key: 'accounting', label: 'Accounting', icon: Calculator,
    items: [
      { key: 'gl', label: 'General Ledger', icon: BookOpen, Component: GeneralLedgerTab },
      { key: 'trial-balance', label: 'Trial Balance', icon: Calculator, Component: TrialBalanceTab }
    ]
  },
  {
    key: 'reports', label: 'Reports', icon: BarChart3,
    items: [
      { key: 'pl', label: 'Profit & Loss', icon: TrendingUp, Component: ProfitLossTab },
      { key: 'balance-sheet', label: 'Balance Sheet', icon: Landmark, Component: BalanceSheetTab },
      { key: 'cash-flow', label: 'Cash Flow', icon: Wallet, Component: CashFlowTab },
      { key: 'budget', label: 'Budget', icon: Calculator, Component: BudgetTab },
      { key: 'year-closing', label: 'Year Closing', icon: Receipt, Component: YearClosingTab },
      { key: 'expenses', label: 'Expenses', icon: Receipt, Component: ExpensesTab },
      { key: 'profitability', label: 'Profitability', icon: TrendingUp, Component: ProfitabilityTab }
    ]
  }
];

export default function FinancePage() {
  return (
    <div>
      <div className="page-header">
        <h1><Landmark size={22} color="var(--primary)" /> Finance</h1>
      </div>
      <DepartmentProvider>
        <GroupedTabs groups={GROUPS} />
      </DepartmentProvider>
    </div>
  );
}
