import { useState, createContext, useContext } from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import {
  ShoppingCart, ListOrdered, Wallet, FileText, BarChart3, Building2,
  Plus, Trash2, CheckCircle2, AlertCircle, Printer, X
} from 'lucide-react';
import { useApi } from '../../components/useApi';
import Table from '../../components/Table';
import client from '../../api/client';
import { useAuth } from '../../context/AuthContext';

function money(v) { return `$${Number(v || 0).toFixed(2)}`; }

const RECORD_SALE_ROLES = ['Admin', 'Sales Manager', 'Cashier'];
const PAY_BADGE = { unpaid: 'low', partial: 'pending', paid: 'ok' };

// ---------------------------------------------------------------------
// Department scope — Bottled Water or Ice, never Bulk Water (Bulk Water
// stays on Route Operations / the pos/ app, untouched). One selector at the
// top of this whole module, shared via context so it survives switching
// between Sales Screen / Sales List / Receive Payment / Statement / Reports.
// ---------------------------------------------------------------------
const RETAIL_DEPARTMENTS = [
  { key: 'bottled_water', label: 'Bottled Water' },
  { key: 'ice', label: 'Ice' }
];
const RetailDeptContext = createContext(['bottled_water', () => {}]);
function useRetailDept() { return useContext(RetailDeptContext); }

async function openInvoice(orderId) {
  const res = await client.get(`/sales/orders/${orderId}/invoice`, { responseType: 'blob' });
  const url = URL.createObjectURL(res.data);
  window.open(url, '_blank');
}

// ---------------------------------------------------------------------
// 1/2/3. Sales Screen — cash settles and prints immediately; credit posts
// the invoice straight to Accounts Receivable. No dispatch step either way.
// ---------------------------------------------------------------------
function SalesScreenTab() {
  const { user } = useAuth();
  const canSell = RECORD_SALE_ROLES.includes(user?.role);
  const [department] = useRetailDept();
  const { rows: customers } = useApi('/customers');
  const { rows: products } = useApi(`/retail/products?department=${department}`, [department]);
  const { rows: warehouses } = useApi('/warehouses');

  const [customerId, setCustomerId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [items, setItems] = useState([{ product_id: '', quantity: '', unit_price: '', discount: '' }]);
  const [orderDiscount, setOrderDiscount] = useState('');
  const [tax, setTax] = useState('');
  const [paymentType, setPaymentType] = useState('cash');
  const [cashMethod, setCashMethod] = useState('cash');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [lastSale, setLastSale] = useState(null);

  function updateItem(i, field, value) {
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, [field]: value } : it)));
  }
  function removeItem(i) { setItems((prev) => prev.filter((_, idx) => idx !== i)); }

  const subtotal = items.reduce((sum, it) => sum + (Number(it.quantity) || 0) * (Number(it.unit_price) || 0) - (Number(it.discount) || 0), 0);
  const total = subtotal - (Number(orderDiscount) || 0) + (Number(tax) || 0);

  function resetForCustomer() {
    setItems([{ product_id: '', quantity: '', unit_price: '', discount: '' }]);
    setOrderDiscount(''); setTax('');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    if (!customerId) { setError('Select a customer.'); return; }
    if (!warehouseId) { setError('Select a warehouse.'); return; }
    if (!items.every((it) => it.product_id && it.quantity && it.unit_price)) { setError('Every line needs a product, quantity, and unit price.'); return; }
    setBusy(true);
    try {
      const { data } = await client.post('/retail/sales', {
        customer_id: Number(customerId), department, warehouse_id: Number(warehouseId),
        items: items.map((it) => ({ product_id: Number(it.product_id), quantity: Number(it.quantity), unit_price: Number(it.unit_price), discount: Number(it.discount) || 0 })),
        discount: Number(orderDiscount) || 0, tax: Number(tax) || 0,
        payment_type: paymentType, cash_payment_method: paymentType === 'cash' ? cashMethod : undefined
      });
      setLastSale(data.data);
      resetForCustomer();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to record sale');
    } finally {
      setBusy(false);
    }
  }

  if (!canSell) return <p className="muted">Your role does not have permission to record sales.</p>;

  return (
    <div>
      <form className="form-modern" onSubmit={handleSubmit} style={{ boxShadow: 'none', padding: 0 }}>
        {error && <div className="error-box"><AlertCircle size={15} /> {error}</div>}

        <div className="form-section">
          <div className="form-section__title">Customer &amp; Warehouse</div>
          <div className="form-grid">
            <div className="form-field span-2">
              <label>Customer</label>
              <select required value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                <option value="">Select…</option>
                {customers?.map((c) => <option key={c.id} value={c.id}>{c.name}{c.hno ? ` — ${c.hno}` : ''}</option>)}
              </select>
            </div>
            <div className="form-field">
              <label>Warehouse</label>
              <select required value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
                <option value="">Select…</option>
                {warehouses?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
          </div>
        </div>

        <div className="form-section">
          <div className="form-section__title">Items</div>
          {items.map((it, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, marginBottom: 10, alignItems: 'center' }}>
              <select required value={it.product_id} onChange={(e) => updateItem(i, 'product_id', e.target.value)} style={{ flex: 2 }}>
                <option value="">Product…</option>
                {products?.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.unit})</option>)}
              </select>
              <input required type="number" step="0.01" placeholder="Qty" value={it.quantity} onChange={(e) => updateItem(i, 'quantity', e.target.value)} style={{ flex: 1 }} />
              <input required type="number" step="0.01" placeholder="Unit price" value={it.unit_price} onChange={(e) => updateItem(i, 'unit_price', e.target.value)} style={{ flex: 1 }} />
              <input type="number" step="0.01" placeholder="Discount" value={it.discount} onChange={(e) => updateItem(i, 'discount', e.target.value)} style={{ flex: 1 }} />
              {items.length > 1 && <button type="button" className="btn-icon" onClick={() => removeItem(i)}><Trash2 size={14} /></button>}
            </div>
          ))}
          <button type="button" className="secondary" onClick={() => setItems((p) => [...p, { product_id: '', quantity: '', unit_price: '', discount: '' }])}><Plus size={13} /> Add Line</button>
        </div>

        <div className="form-section">
          <div className="form-section__title">Totals &amp; Payment</div>
          <div className="form-grid">
            <div className="form-field"><label>Discount</label><input type="number" step="0.01" value={orderDiscount} onChange={(e) => setOrderDiscount(e.target.value)} /></div>
            <div className="form-field"><label>Tax (optional)</label><input type="number" step="0.01" value={tax} onChange={(e) => setTax(e.target.value)} /></div>
            <div className="form-field">
              <label>Payment Type</label>
              <div style={{ display: 'flex', gap: 14, alignItems: 'center', height: 38 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontWeight: 400, fontSize: 12.5 }}>
                  <input type="radio" name="payment_type" checked={paymentType === 'cash'} onChange={() => setPaymentType('cash')} /> Cash Sale
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontWeight: 400, fontSize: 12.5 }}>
                  <input type="radio" name="payment_type" checked={paymentType === 'credit'} onChange={() => setPaymentType('credit')} /> Credit Sale
                </label>
              </div>
            </div>
            {paymentType === 'cash' && (
              <div className="form-field">
                <label>Cash Method</label>
                <select value={cashMethod} onChange={(e) => setCashMethod(e.target.value)}>
                  <option value="cash">Cash</option>
                  <option value="bank_transfer">Bank</option>
                  <option value="mobile_money">Mobile Money</option>
                </select>
              </div>
            )}
          </div>
          <div style={{ marginTop: 14, textAlign: 'right', fontSize: 14 }}>
            <span style={{ color: 'var(--text-muted)' }}>Subtotal: {money(subtotal)}</span>
            <strong style={{ marginLeft: 14, fontSize: 18 }}>Total: {money(total)}</strong>
          </div>
        </div>

        <div className="form-actions">
          <button className="btn" type="submit" disabled={busy}>{busy ? 'Saving…' : paymentType === 'cash' ? 'Complete Cash Sale' : 'Record Credit Sale'}</button>
        </div>
      </form>

      {lastSale && (
        <div className="success-box" style={{ justifyContent: 'space-between' }}>
          <span><CheckCircle2 size={15} /> {lastSale.sale_type === 'cash' ? 'Cash Invoice' : 'Customer Invoice'} {lastSale.invoice_hno} saved — {money(lastSale.total_amount)} ({lastSale.payment_status}).</span>
          <button type="button" className="secondary" onClick={() => openInvoice(lastSale.id)}><Printer size={13} /> Print Receipt</button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// 6. Sales List
// ---------------------------------------------------------------------
function SalesListTab() {
  const [department] = useRetailDept();
  const [status, setStatus] = useState('');
  const [saleType, setSaleType] = useState('');
  const qs = new URLSearchParams({ department });
  if (status) qs.set('status', status);
  const { rows } = useApi(`/retail/sales?${qs.toString()}`, [department, status]);
  const filtered = saleType ? rows?.filter((r) => r.sale_type === saleType) : rows;

  return (
    <div>
      <div className="toolbar">
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All Statuses</option>
          <option value="approved">Approved</option>
          <option value="reversed">Reversed</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <select value={saleType} onChange={(e) => setSaleType(e.target.value)}>
          <option value="">Cash &amp; Credit</option>
          <option value="cash">Cash Only</option>
          <option value="credit">Credit Only</option>
        </select>
      </div>
      <div className="card">
        <Table
          columns={[
            { key: 'invoice_hno', header: 'Invoice No', render: (r) => r.invoice_hno || r.order_number },
            { key: 'order_date', header: 'Date' },
            { key: 'customer_name', header: 'Customer' },
            { key: 'department', header: 'Department', render: (r) => r.department || '—' },
            { key: 'products', header: 'Products', render: (r) => r.products || '—' },
            { key: 'total_amount', header: 'Total', render: (r) => money(r.total_amount) },
            { key: 'amount_paid', header: 'Paid', render: (r) => money(r.amount_paid) },
            { key: 'balance', header: 'Balance', render: (r) => <strong style={{ color: Number(r.balance) > 0 ? 'var(--danger)' : undefined }}>{money(r.balance)}</strong> },
            { key: 'payment_status', header: 'Status', render: (r) => <span className={`badge badge--${PAY_BADGE[r.payment_status]}`}>{r.payment_status}</span> },
            { key: 'actions', header: '', render: (r) => <button className="btn secondary" onClick={() => openInvoice(r.id)}>PDF</button> }
          ]}
          rows={filtered}
          searchable sortable pageSize={20}
          emptyText="No sales recorded yet."
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// 4. Receive Customer Payment — reuses Billing & Collections' own search +
// FIFO payment endpoints (already department-aware), scoped here to never
// touch Bulk Water.
// ---------------------------------------------------------------------
function ReceivePaymentTab() {
  const { user } = useAuth();
  const canReceive = RECORD_SALE_ROLES.includes(user?.role) || user?.role === 'Finance Officer';
  const [department] = useRetailDept();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [customer, setCustomer] = useState(null);
  const [payDept, setPayDept] = useState('');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('cash');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [lastPayment, setLastPayment] = useState(null);

  async function search(e) {
    e.preventDefault();
    if (!query.trim()) return;
    const { data } = await client.get(`/billing/customers/search?q=${encodeURIComponent(query.trim())}`);
    // This module never collects against Bulk Water — only show retail balances.
    const retailOnly = data.data.map((c) => ({
      ...c, department_balances: c.department_balances.filter((d) => RETAIL_DEPARTMENTS.some((r) => r.key === d.key))
    }));
    setResults(retailOnly);
    setCustomer(null);
  }

  function pickCustomer(c) {
    setCustomer(c);
    setResults(null);
    setError(null);
    if (c.department_balances.some((d) => d.key === department)) setPayDept(department);
    else setPayDept(c.department_balances.length === 1 ? c.department_balances[0].key : '');
  }

  async function savePayment(e) {
    e.preventDefault();
    setError(null);
    if (!customer) return;
    if (customer.department_balances.length > 1 && !payDept) { setError('This customer owes in both Bottled Water and Ice — choose which one this payment applies to.'); return; }
    const amt = Number(amount);
    if (!(amt > 0)) { setError('Enter an amount greater than zero.'); return; }
    setBusy(true);
    try {
      const { data } = await client.post('/billing/payments', {
        customer_id: customer.id, amount: amt, method, reference_number: referenceNumber || undefined, department: payDept
      });
      setLastPayment({ customer, amount: amt, payments: data.data.payments });
      setAmount(''); setReferenceNumber('');
      const { data: refreshed } = await client.get(`/billing/customers/search?q=${encodeURIComponent(customer.hno)}`);
      const updated = refreshed.data[0];
      const retailBalances = updated.department_balances.filter((d) => RETAIL_DEPARTMENTS.some((r) => r.key === d.key));
      setCustomer({ ...updated, department_balances: retailBalances });
      setPayDept(retailBalances.length === 1 ? retailBalances[0].key : '');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save payment');
    } finally {
      setBusy(false);
    }
  }

  if (!canReceive) return <p className="muted">Your role does not have permission to receive payments.</p>;

  return (
    <div>
      <form className="toolbar" onSubmit={search}>
        <input placeholder="Search by invoice number, customer, or phone…" value={query} onChange={(e) => setQuery(e.target.value)} style={{ minWidth: 280 }} />
        <button className="btn" type="submit">Search</button>
      </form>

      {results && (
        <div className="card">
          <Table
            columns={[
              { key: 'hno', header: 'HNO' },
              { key: 'name', header: 'Customer' },
              { key: 'phone', header: 'Phone' },
              { key: 'balance', header: 'Retail Balance', render: (r) => money(r.department_balances.reduce((s, d) => s + d.balance, 0)) },
              { key: 'actions', header: '', render: (r) => <button className="btn secondary" disabled={!r.department_balances.length} onClick={() => pickCustomer(r)}>Select</button> }
            ]}
            rows={results}
            emptyText="No customers found."
          />
        </div>
      )}

      {customer && (
        <div className="card">
          <h3>{customer.name} <span className="muted" style={{ fontSize: 13 }}>({customer.hno})</span></h3>
          <form className="form-modern" onSubmit={savePayment} style={{ boxShadow: 'none', padding: 0 }}>
            {error && <div className="error-box">{error}</div>}
            <div className="form-grid">
              {customer.department_balances.length > 1 ? (
                <div className="form-field">
                  <label>Department (owes in both)</label>
                  <select required value={payDept} onChange={(e) => setPayDept(e.target.value)}>
                    <option value="">Select…</option>
                    {customer.department_balances.map((d) => <option key={d.key} value={d.key}>{d.label} — {money(d.balance)}</option>)}
                  </select>
                </div>
              ) : (
                <div className="form-field"><label>Outstanding Balance</label><span style={{ color: 'var(--danger)', fontWeight: 600 }}>{money(customer.department_balances[0]?.balance || 0)}</span></div>
              )}
              <div className="form-field"><label>Amount</label><input required type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
              <div className="form-field">
                <label>Method</label>
                <select value={method} onChange={(e) => setMethod(e.target.value)}>
                  <option value="cash">Cash</option>
                  <option value="bank_transfer">Bank</option>
                  <option value="mobile_money">Mobile Money</option>
                </select>
              </div>
              <div className="form-field"><label>Reference Number</label><input value={referenceNumber} onChange={(e) => setReferenceNumber(e.target.value)} /></div>
            </div>
            <div className="form-actions">
              <button className="btn" type="submit" disabled={busy || !customer.department_balances.length}>{busy ? 'Saving…' : 'Save Payment'}</button>
            </div>
          </form>
        </div>
      )}

      {lastPayment && (
        <div className="success-box"><CheckCircle2 size={15} /> Payment saved — receipt {lastPayment.payments.map((p) => p.transaction_hno).join(', ')}.</div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// 5. Customer Statement
// ---------------------------------------------------------------------
function CustomerStatementTab() {
  const [department] = useRetailDept();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [selected, setSelected] = useState(null);
  const { rows: profile } = useApi(selected ? `/retail/customers/${selected.id}/profile?department=${department}` : null, [selected, department]);
  const { rows: statement } = useApi(selected ? `/customers/${selected.id}/statement` : null, [selected]);

  async function search(e) {
    e.preventDefault();
    if (!query.trim()) return;
    const { data } = await client.get(`/billing/customers/search?q=${encodeURIComponent(query.trim())}`);
    setResults(data.data);
  }

  return (
    <div>
      <form className="toolbar" onSubmit={search}>
        <input placeholder="Search by HNO, name, or phone…" value={query} onChange={(e) => setQuery(e.target.value)} style={{ minWidth: 260 }} />
        <button className="btn" type="submit">Search</button>
      </form>

      {results && !selected && (
        <div className="card">
          <Table
            columns={[
              { key: 'hno', header: 'HNO' }, { key: 'name', header: 'Customer' }, { key: 'phone', header: 'Phone' },
              { key: 'actions', header: '', render: (r) => <button className="btn secondary" onClick={() => { setSelected(r); setResults(null); }}>View</button> }
            ]}
            rows={results}
            emptyText="No customers found."
          />
        </div>
      )}

      {selected && profile && (
        <div>
          <div className="card__header">
            <h3>{selected.name} <span className="muted" style={{ fontSize: 13 }}>({selected.hno})</span></h3>
            <button className="btn-icon" onClick={() => { setSelected(null); setQuery(''); }}><X size={16} /></button>
          </div>
          <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
            <div className="kpi-card"><div className="kpi-card__label">Outstanding Balance</div><div className="kpi-card__value" style={{ color: profile.outstanding_balance > 0 ? 'var(--danger)' : 'var(--success)' }}>{money(profile.outstanding_balance)}</div></div>
            <div className="kpi-card"><div className="kpi-card__label">Last Purchase</div><div className="kpi-card__value" style={{ fontSize: 16 }}>{profile.last_purchase_date ? String(profile.last_purchase_date).slice(0, 10) : '—'}</div></div>
            <div className="kpi-card"><div className="kpi-card__label">Purchases on Record</div><div className="kpi-card__value">{profile.purchase_history.length}</div></div>
          </div>

          <div className="card">
            <h3>Sales History</h3>
            <Table
              columns={[
                { key: 'order_date', header: 'Date' },
                { key: 'invoice_hno', header: 'Invoice' },
                { key: 'products', header: 'Products' },
                { key: 'sale_type', header: 'Type', render: (r) => <span className={`badge badge--${r.sale_type === 'cash' ? 'ok' : 'info'}`}>{r.sale_type}</span> },
                { key: 'total_amount', header: 'Total', render: (r) => money(r.total_amount) },
                { key: 'payment_status', header: 'Status', render: (r) => <span className={`badge badge--${PAY_BADGE[r.payment_status]}`}>{r.payment_status}</span> }
              ]}
              rows={profile.purchase_history}
              emptyText="No purchases yet."
            />
          </div>

          {statement && (
            <div className="card">
              <h3>Full Account Statement</h3>
              <Table
                columns={[
                  { key: 'entry_date', header: 'Date' },
                  { key: 'entry_type', header: 'Type' },
                  { key: 'reference', header: 'Reference' },
                  { key: 'amount', header: 'Amount', render: (r) => money(r.amount) },
                  { key: 'running_balance', header: 'Running Balance', render: (r) => money(r.running_balance) }
                ]}
                rows={statement.statement}
                emptyText="No activity on this account yet."
              />
              <p><strong>Closing Balance: {money(statement.closing_balance)}</strong></p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// 8. Reports
// ---------------------------------------------------------------------
const REPORTS = [
  { key: 'cash-sales', label: 'Cash Sales' },
  { key: 'credit-sales', label: 'Credit Sales' },
  { key: 'outstanding-invoices', label: 'Outstanding Invoices' },
  { key: 'paid-invoices', label: 'Paid Invoices' },
  { key: 'daily-sales', label: 'Daily Sales' },
  { key: 'monthly-sales', label: 'Monthly Sales' },
  { key: 'top-customers', label: 'Top Customers' },
  { key: 'top-products', label: 'Top Selling Products' }
];

function InvoiceReportTable({ rows }) {
  return (
    <Table
      columns={[
        { key: 'invoice_hno', header: 'Invoice' },
        { key: 'order_date', header: 'Date' },
        { key: 'customer_name', header: 'Customer' },
        { key: 'total_amount', header: 'Total', render: (r) => money(r.total_amount) },
        ...(rows?.[0]?.balance !== undefined ? [{ key: 'balance', header: 'Balance', render: (r) => money(r.balance) }] : [])
      ]}
      rows={rows}
      sortable pageSize={15}
      emptyText="No invoices for this period."
    />
  );
}

// One useApi call per report, remounted (via `key`) every time the report or
// department changes — so a report never renders with the PREVIOUS report's
// data shape still in state (an array's-worth of rows read as a chart's
// {rows,total} object, or vice versa) during the one render between clicking
// a new report and its fetch resolving.
function ReportBody({ reportKey, department }) {
  const isChart = ['daily-sales', 'monthly-sales'].includes(reportKey);
  const isList = ['top-customers', 'top-products'].includes(reportKey);
  const { rows: data } = useApi(`/retail/reports/${reportKey}?department=${department}`);
  const invoiceRows = !isChart && !isList ? data?.rows : null;

  if (!data) return <p className="muted">Loading…</p>;

  if (isChart) {
    return (
      <ResponsiveContainer width="100%" height={280}>
        <BarChart
          data={data.map((r) => ({
            label: reportKey === 'daily-sales' ? String(r.day).slice(5, 10) : new Date(r.month).toLocaleDateString(undefined, { month: 'short', year: '2-digit' }),
            Sales: Number(r.total)
          }))}
          margin={{ top: 5, right: 10, left: 0, bottom: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} width={55} />
          <Tooltip formatter={(v) => money(v)} />
          <Bar dataKey="Sales" fill="#0F5E75" />
        </BarChart>
      </ResponsiveContainer>
    );
  }
  if (reportKey === 'top-customers') {
    return (
      <Table
        columns={[
          { key: 'name', header: 'Customer' },
          { key: 'invoice_count', header: 'Invoices' },
          { key: 'total', header: 'Total Sales', render: (r) => money(r.total) }
        ]}
        rows={data}
        emptyText="No sales recorded yet."
      />
    );
  }
  if (reportKey === 'top-products') {
    return (
      <Table
        columns={[
          { key: 'name', header: 'Product' },
          { key: 'units_sold', header: 'Units Sold', render: (r) => Number(r.units_sold).toLocaleString() },
          { key: 'revenue', header: 'Revenue', render: (r) => money(r.revenue) }
        ]}
        rows={data}
        emptyText="No sales recorded yet."
      />
    );
  }
  return (
    <>
      {data.total !== undefined && <p style={{ marginBottom: 12 }}><strong>Total: {money(data.total)}</strong></p>}
      <InvoiceReportTable rows={invoiceRows} />
    </>
  );
}

function ReportsTab() {
  const [department] = useRetailDept();
  const [reportKey, setReportKey] = useState(REPORTS[0].key);

  return (
    <div>
      <div className="toolbar" style={{ flexWrap: 'wrap' }}>
        {REPORTS.map((r) => (
          <button key={r.key} className={r.key === reportKey ? 'btn' : 'secondary'} onClick={() => setReportKey(r.key)}>{r.label}</button>
        ))}
      </div>

      <div className="card">
        <h3>{REPORTS.find((r) => r.key === reportKey).label}</h3>
        <ReportBody key={`${reportKey}-${department}`} reportKey={reportKey} department={department} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Page shell — one Department filter (Bottled Water / Ice only), one row
// of sub-tabs, matching the pattern Billing & Collections already uses.
// ---------------------------------------------------------------------
const RETAIL_TABS = [
  { key: 'sales-screen', label: 'Sales Screen', icon: ShoppingCart, Component: SalesScreenTab },
  { key: 'sales-list', label: 'Sales List', icon: ListOrdered, Component: SalesListTab },
  { key: 'receive-payment', label: 'Receive Payment', icon: Wallet, Component: ReceivePaymentTab },
  { key: 'statement', label: 'Customer Statement', icon: FileText, Component: CustomerStatementTab },
  { key: 'reports', label: 'Reports', icon: BarChart3, Component: ReportsTab }
];

export default function RetailSalesTab() {
  const [department, setDepartment] = useState('bottled_water');
  const [activeKey, setActiveKey] = useState(RETAIL_TABS[0].key);
  const active = RETAIL_TABS.find((t) => t.key === activeKey) || RETAIL_TABS[0];
  const Active = active.Component;

  return (
    <RetailDeptContext.Provider value={[department, setDepartment]}>
      <div>
        <p className="muted" style={{ marginTop: -6, marginBottom: 14 }}>
          Invoice-based sales for Bottled Water and Ice — Bulk Water (Tankers) continues through Route Operations.
        </p>
        <div className="toolbar" style={{ marginBottom: 14 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 600 }}>
            <Building2 size={14} color="var(--primary)" /> Department
          </label>
          <select value={department} onChange={(e) => setDepartment(e.target.value)} style={{ minWidth: 180 }}>
            {RETAIL_DEPARTMENTS.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
          </select>
        </div>

        <div className="grouped-nav__subtabs" style={{ marginBottom: 18 }}>
          {RETAIL_TABS.map((t) => {
            const Icon = t.icon;
            return (
              <button key={t.key} className={`grouped-nav__subtab ${t.key === active.key ? 'active' : ''}`} onClick={() => setActiveKey(t.key)}>
                {Icon && <Icon size={14} />} {t.label}
              </button>
            );
          })}
        </div>

        <Active />
      </div>
    </RetailDeptContext.Provider>
  );
}
