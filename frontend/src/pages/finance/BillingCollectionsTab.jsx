import { useState, createContext, useContext } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend
} from 'recharts';
import {
  LayoutDashboard, Users, Wallet, History, Award, PieChart, AlertTriangle,
  Phone, MessageCircle, CalendarClock, HandCoins, X, CheckCircle2, Building2, SlidersHorizontal, ChevronDown
} from 'lucide-react';
import { useApi } from '../../components/useApi';
import Table from '../../components/Table';
import client from '../../api/client';
import { useAuth } from '../../context/AuthContext';

function money(v) { return `$${Number(v || 0).toFixed(2)}`; }
function shortDate(d) { return new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); }
function daysLabel(n) { return n == null ? '—' : n === 0 ? 'Today' : `${n}d ago`; }

const RECEIVE_PAYMENT_ROLES = ['Admin', 'Finance Officer', 'Collector'];
const EDIT_PAYMENT_ROLES = ['Admin', 'Finance Officer'];
const FULL_REPORT_ROLES = ['Admin', 'Finance Officer'];

// ---------------------------------------------------------------------
// Department scope — one dropdown, shared by every tab in this module via
// context (so it survives switching sub-tabs), that narrows every KPI,
// chart, and report down to a single line of business. Mirrors the
// `DEPARTMENTS` list in backend/src/routes/billing.routes.js; adding a
// future department is a one-line addition to both lists, nothing else
// in this file needs to change.
// ---------------------------------------------------------------------
const DEPARTMENT_OPTIONS = [
  { key: 'all', label: 'All' },
  { key: 'bulk_water', label: 'Bulk Water' },
  { key: 'bottled_water', label: 'Bottled Water' },
  { key: 'ice', label: 'Ice' }
];
const DepartmentContext = createContext(['all', () => {}]);
export function DepartmentProvider({ children }) {
  const [department, setDepartment] = useState('all');
  return <DepartmentContext.Provider value={[department, setDepartment]}>{children}</DepartmentContext.Provider>;
}
function useDepartment() { return useContext(DepartmentContext); }

function withDept(url, department, extraParams) {
  const qs = new URLSearchParams(extraParams || '');
  if (department && department !== 'all') qs.set('department', department);
  const qsStr = qs.toString();
  return qsStr ? `${url}${url.includes('?') ? '&' : '?'}${qsStr}` : url;
}

// ---------------------------------------------------------------------
// 1. Collection Dashboard
// ---------------------------------------------------------------------
export function CollectionDashboardTab() {
  const [department] = useDepartment();
  const { rows: d } = useApi(withDept('/billing/dashboard', department), [department]);
  const { rows: alerts } = useApi(withDept('/billing/alerts', department), [department]);
  if (!d) return <p className="muted">Loading…</p>;

  const dailyData = (d.daily_collections || []).map((r) => ({ day: shortDate(r.day), Collected: Number(r.total) }));
  const monthlyData = (d.monthly_collections || []).map((r) => ({ month: new Date(r.month).toLocaleDateString(undefined, { month: 'short', year: '2-digit' }), Collected: Number(r.total) }));
  const collectorData = (d.top_collectors || []).map((r) => ({ name: r.collector_name, Collected: Number(r.total) }));

  return (
    <div>
      <div className="kpi-grid">
        <div className="kpi-card"><div className="kpi-card__label">Total Outstanding Receivables</div><div className="kpi-card__value" style={{ color: 'var(--danger)' }}>{money(d.total_outstanding)}</div></div>
        <div className="kpi-card"><div className="kpi-card__label">Cash Collected Today</div><div className="kpi-card__value">{money(d.cash_collected_today)}</div></div>
        <div className="kpi-card"><div className="kpi-card__label">Cash Collected This Month</div><div className="kpi-card__value">{money(d.cash_collected_month)}</div></div>
        <div className="kpi-card"><div className="kpi-card__label">Credit Sales This Month</div><div className="kpi-card__value">{money(d.credit_collected_month)}</div></div>
        <div className="kpi-card"><div className="kpi-card__label">Customers With Balance</div><div className="kpi-card__value">{d.customers_with_balance}</div></div>
        <div className="kpi-card"><div className="kpi-card__label">Collection Rate</div><div className="kpi-card__value">{d.collection_rate_pct.toFixed(1)}%</div></div>
        <div className="kpi-card"><div className="kpi-card__label">Avg Collection Days</div><div className="kpi-card__value">{Number(d.avg_collection_days).toFixed(1)}</div></div>
        <div className="kpi-card"><div className="kpi-card__label">Overdue Customers (30d+)</div><div className="kpi-card__value" style={{ color: d.overdue_customers > 0 ? 'var(--danger)' : undefined }}>{d.overdue_customers}</div></div>
      </div>

      <div className="card">
        <h3>Daily Collections — Last 14 Days</h3>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={dailyData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="day" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} width={50} />
            <Tooltip />
            <Bar dataKey="Collected" fill="#0F5E75" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="card">
        <h3>Monthly Collections — Last 12 Months</h3>
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={monthlyData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="month" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} width={50} />
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Line type="monotone" dataKey="Collected" stroke="#14B8A6" strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="card">
        <h3>Top Collectors — This Month</h3>
        {collectorData.length ? (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={collectorData} layout="vertical" margin={{ top: 5, right: 20, left: 20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis type="number" tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={120} />
              <Tooltip />
              <Bar dataKey="Collected" fill="#0b4a5c" />
            </BarChart>
          </ResponsiveContainer>
        ) : <p className="muted">No collections recorded this month yet.</p>}
      </div>

      {alerts && (
        <div className="card">
          <h3><AlertTriangle size={16} style={{ verticalAlign: -3 }} /> Alerts</h3>
          <div className="form-grid">
            <AlertList title="Overdue 30+ Days" rows={alerts.overdue_30_days} valueKey="balance" />
            <AlertList title="No Payment in 60 Days" rows={alerts.no_payment_60_days} />
            <AlertList title="No Water Delivery (30+ Days)" rows={alerts.no_water_delivery} />
            <AlertList title="Large Outstanding Balances ($500+)" rows={alerts.large_balances} valueKey="balance" />
          </div>
        </div>
      )}
    </div>
  );
}

function AlertList({ title, rows, valueKey }) {
  return (
    <div className="form-field">
      <label>{title} ({rows?.length || 0})</label>
      {!rows?.length ? <p className="muted" style={{ fontSize: 12.5 }}>None.</p> : (
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5 }}>
          {rows.slice(0, 8).map((r) => (
            <li key={r.id}>{r.name} ({r.hno}){valueKey && r[valueKey] != null ? ` — ${money(r[valueKey])}` : ''}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// 2. Customer Receivables
// ---------------------------------------------------------------------
export function CustomerReceivablesTab() {
  const [department] = useDepartment();
  const [search, setSearch] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [area, setArea] = useState('');
  const [collectorId, setCollectorId] = useState('');
  const [driverId, setDriverId] = useState('');
  const [outstandingOnly, setOutstandingOnly] = useState(false);
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [noWaterDays, setNoWaterDays] = useState('');
  const [profileId, setProfileId] = useState(null);

  const { rows: collectors } = useApi('/billing/collectors');
  const { rows: drivers } = useApi('/billing/drivers');

  const qs = new URLSearchParams();
  if (search) qs.set('search', search);
  if (area) qs.set('area', area);
  if (collectorId) qs.set('collector_id', collectorId);
  if (driverId) qs.set('driver_id', driverId);
  if (outstandingOnly) qs.set('outstanding_only', 'true');
  if (overdueOnly) qs.set('overdue_only', 'true');
  if (noWaterDays) qs.set('no_water_days', noWaterDays);
  const { rows } = useApi(withDept('/billing/receivables', department, qs), [search, area, collectorId, driverId, outstandingOnly, overdueOnly, noWaterDays, department]);

  return (
    <div>
      <div className="toolbar" style={{ flexWrap: 'wrap' }}>
        <input placeholder="Search HNO, name, or phone…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ minWidth: 220 }} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 13 }}>
          <input type="checkbox" checked={outstandingOnly} onChange={(e) => setOutstandingOnly(e.target.checked)} /> Outstanding Only
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 13 }}>
          <input type="checkbox" checked={overdueOnly} onChange={(e) => setOverdueOnly(e.target.checked)} /> Overdue Only
        </label>
        <button type="button" className="secondary" onClick={() => setShowAdvanced((v) => !v)}>
          <SlidersHorizontal size={13} /> Advanced Filters <ChevronDown size={13} style={{ transform: showAdvanced ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
        </button>
      </div>

      {showAdvanced && (
        <div className="toolbar" style={{ flexWrap: 'wrap', background: 'var(--bg)', borderRadius: 'var(--radius)', padding: 10 }}>
          <input placeholder="Area" value={area} onChange={(e) => setArea(e.target.value)} style={{ width: 120 }} />
          <select value={collectorId} onChange={(e) => setCollectorId(e.target.value)}>
            <option value="">All Collectors</option>
            {collectors?.map((c) => <option key={c.id} value={c.id}>{c.full_name}</option>)}
          </select>
          <select value={driverId} onChange={(e) => setDriverId(e.target.value)}>
            <option value="">All Drivers</option>
            {drivers?.map((d) => <option key={d.id} value={d.id}>{d.full_name}</option>)}
          </select>
          <input type="number" placeholder="No water for X days" value={noWaterDays} onChange={(e) => setNoWaterDays(e.target.value)} style={{ width: 160 }} />
        </div>
      )}

      <div className="card">
        <Table
          columns={[
            { key: 'hno', header: 'HNO' },
            { key: 'name', header: 'Customer', render: (r) => <a href="#" onClick={(e) => { e.preventDefault(); setProfileId(r.id); }}>{r.name}</a> },
            { key: 'phone', header: 'Phone' },
            { key: 'area', header: 'Area', render: (r) => r.area || '—' },
            { key: 'collector_name', header: 'Collector', render: (r) => r.collector_name || '—' },
            { key: 'driver_name', header: 'Driver', render: (r) => r.driver_name || '—' },
            { key: 'current_balance', header: 'Current Balance', render: (r) => <strong style={{ color: Number(r.current_balance) > 0 ? 'var(--danger)' : undefined }}>{money(r.current_balance)}</strong> },
            { key: 'credit_limit', header: 'Credit Limit', render: (r) => money(r.credit_limit) },
            { key: 'last_delivery_date', header: 'Last Delivery', render: (r) => r.last_delivery_date ? String(r.last_delivery_date).slice(0, 10) : '—' },
            { key: 'last_payment_date', header: 'Last Payment', render: (r) => r.last_payment_date ? String(r.last_payment_date).slice(0, 10) : '—' },
            { key: 'days_since_last_payment', header: 'Days Since Payment', render: (r) => daysLabel(r.days_since_last_payment) },
            { key: 'days_since_last_delivery', header: 'Days Since Delivery', render: (r) => daysLabel(r.days_since_last_delivery) },
            { key: 'status', header: 'Status', render: (r) => <span className={`badge badge--${r.status === 'active' ? 'ok' : 'low'}`}>{r.status}</span> }
          ]}
          rows={rows}
          sortable pageSize={15}
          emptyText="No customers match these filters."
        />
      </div>

      {profileId && <CustomerProfileDrawer customerId={profileId} onClose={() => setProfileId(null)} />}
    </div>
  );
}

// ---------------------------------------------------------------------
// 8 & 9. Customer Profile + Follow-Up (drill-down drawer, reused from Receivables)
// ---------------------------------------------------------------------
function CustomerProfileDrawer({ customerId, onClose }) {
  const [department] = useDepartment();
  const { rows: profile, reload } = useApi(withDept(`/billing/customers/${customerId}/profile`, department), [department]);
  const { rows: followUps, reload: reloadFollowUps } = useApi(`/billing/customers/${customerId}/follow-ups`);
  const [followType, setFollowType] = useState('');
  const [followNotes, setFollowNotes] = useState('');
  const [promiseAmount, setPromiseAmount] = useState('');
  const [promiseDate, setPromiseDate] = useState('');
  const [nextFollowup, setNextFollowup] = useState('');
  const [error, setError] = useState(null);

  async function logFollowUp(actionType) {
    setError(null);
    try {
      await client.post(`/billing/customers/${customerId}/follow-ups`, {
        action_type: actionType, notes: followNotes || undefined,
        promise_amount: actionType === 'promise_to_pay' && promiseAmount ? Number(promiseAmount) : undefined,
        promise_date: actionType === 'promise_to_pay' && promiseDate ? promiseDate : undefined,
        next_followup_date: nextFollowup || undefined
      });
      setFollowType(''); setFollowNotes(''); setPromiseAmount(''); setPromiseDate(''); setNextFollowup('');
      reloadFollowUps();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to log follow-up');
    }
  }

  function callHref(phone) { return `tel:${phone}`; }
  function smsHref(phone) { return `sms:${phone}`; }
  function whatsappHref(phone, name, balance) {
    const digits = (phone || '').replace(/[^\d]/g, '');
    const msg = `Hello ${name}, this is a reminder from Alnaciim Water regarding your outstanding balance of $${Number(balance).toFixed(2)}.`;
    return `https://wa.me/${digits}?text=${encodeURIComponent(msg)}`;
  }

  if (!profile) return null;
  const c = profile.customer;

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', display: 'flex', justifyContent: 'flex-end', zIndex: 1000 }}>
      <div className="card" style={{ width: 560, maxWidth: '100%', height: '100%', overflowY: 'auto', borderRadius: 0, margin: 0 }}>
        <div className="card__header">
          <h3>{c.name} <span className="muted" style={{ fontSize: 13 }}>({c.hno})</span></h3>
          <button className="btn-icon" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
          <div className="kpi-card">
            <div className="kpi-card__label">Outstanding Balance</div>
            <div className="kpi-card__value" style={{ color: profile.outstanding_balance > 0 ? 'var(--danger)' : 'var(--success)' }}>{money(profile.outstanding_balance)}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-card__label">Payment Status</div>
            <div className="kpi-card__value" style={{ fontSize: 16 }}>
              <span className={`badge badge--${profile.payment_status === 'clear' ? 'ok' : profile.payment_status === 'over_limit' ? 'low' : 'pending'}`}>{profile.payment_status.replace('_', ' ')}</span>
            </div>
          </div>
        </div>

        <div className="form-grid" style={{ marginBottom: 16 }}>
          <div className="form-field"><label>Phone</label><span>{c.phone || '—'}</span></div>
          <div className="form-field"><label>Guarantor</label><span>{c.guarantor_name || '—'} {c.guarantor_phone ? `(${c.guarantor_phone})` : ''}</span></div>
          <div className="form-field"><label>Credit Limit</label><span>{money(c.credit_limit)}</span></div>
          <div className="form-field"><label>Collector</label><span>{c.collector_name || '—'}</span></div>
          <div className="form-field"><label>Last Water Delivery</label><span>{profile.last_delivery_date ? String(profile.last_delivery_date).slice(0, 10) : '—'}</span></div>
          <div className="form-field"><label>Days Since Delivery</label><span>{daysLabel(profile.days_since_last_delivery)}</span></div>
        </div>

        <div className="form-section">
          <div className="form-section__title">Follow-Up Actions</div>
          {error && <div className="error-box">{error}</div>}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
            <a className="btn secondary" href={callHref(c.phone)} onClick={() => logFollowUp('call')}><Phone size={13} /> Call</a>
            <a className="btn secondary" href={smsHref(c.phone)} onClick={() => logFollowUp('sms')}><MessageCircle size={13} /> SMS</a>
            <a className="btn secondary" target="_blank" rel="noreferrer" href={whatsappHref(c.phone, c.name, profile.outstanding_balance)} onClick={() => logFollowUp('whatsapp')}><MessageCircle size={13} /> WhatsApp</a>
            <button className="btn secondary" onClick={() => setFollowType(followType === 'visit' ? '' : 'visit')}><CalendarClock size={13} /> Schedule Visit</button>
            <button className="btn secondary" onClick={() => setFollowType(followType === 'promise_to_pay' ? '' : 'promise_to_pay')}><HandCoins size={13} /> Promise To Pay</button>
          </div>
          {(followType === 'visit' || followType === 'promise_to_pay') && (
            <div className="form-grid" style={{ marginBottom: 10 }}>
              {followType === 'promise_to_pay' && (
                <>
                  <div className="form-field"><label>Promised Amount</label><input type="number" step="0.01" value={promiseAmount} onChange={(e) => setPromiseAmount(e.target.value)} /></div>
                  <div className="form-field"><label>Promised Date</label><input type="date" value={promiseDate} onChange={(e) => setPromiseDate(e.target.value)} /></div>
                </>
              )}
              <div className="form-field"><label>Next Follow-up Date</label><input type="date" value={nextFollowup} onChange={(e) => setNextFollowup(e.target.value)} /></div>
              <div className="form-field span-2"><label>Notes</label><input value={followNotes} onChange={(e) => setFollowNotes(e.target.value)} /></div>
              <div><button className="btn" type="button" onClick={() => logFollowUp(followType)}>Save {followType === 'visit' ? 'Visit' : 'Promise'}</button></div>
            </div>
          )}
          <Table
            columns={[
              { key: 'created_at', header: 'Date', render: (r) => new Date(r.created_at).toLocaleString() },
              { key: 'action_type', header: 'Action', render: (r) => <span className="badge">{r.action_type.replace(/_/g, ' ')}</span> },
              { key: 'notes', header: 'Notes', render: (r) => r.notes || '—' },
              { key: 'next_followup_date', header: 'Next Follow-up', render: (r) => r.next_followup_date || '—' },
              { key: 'created_by_name', header: 'By' }
            ]}
            rows={followUps}
            emptyText="No follow-ups logged yet."
          />
        </div>

        <div className="form-section">
          <div className="form-section__title">Payment History</div>
          <Table
            columns={[
              { key: 'payment_date', header: 'Date' },
              { key: 'receipt_number', header: 'Receipt #' },
              { key: 'amount', header: 'Amount', render: (r) => money(r.amount) },
              { key: 'method', header: 'Method' },
              { key: 'collector_name', header: 'Collector' }
            ]}
            rows={profile.payment_history}
            emptyText="No payments recorded yet."
          />
        </div>

        <div className="form-section">
          <div className="form-section__title">Water Delivery History</div>
          <Table
            columns={[
              { key: 'order_date', header: 'Date' },
              { key: 'liters', header: 'Liters', render: (r) => Number(r.liters).toLocaleString() },
              { key: 'total_amount', header: 'Amount', render: (r) => money(r.total_amount) },
              { key: 'status', header: 'Status' }
            ]}
            rows={profile.delivery_history}
            emptyText="No deliveries recorded yet."
          />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// 3. Receive Payment
// ---------------------------------------------------------------------
export function ReceivePaymentTab() {
  const { user } = useAuth();
  const canReceive = RECEIVE_PAYMENT_ROLES.includes(user?.role);
  const [department] = useDepartment();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [customer, setCustomer] = useState(null);
  const [payDept, setPayDept] = useState('');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('cash');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [paymentDate, setPaymentDate] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [lastReceipt, setLastReceipt] = useState(null);

  async function search(e) {
    e.preventDefault();
    if (!query.trim()) return;
    const { data } = await client.get(withDept('/billing/customers/search', department, `q=${encodeURIComponent(query.trim())}`));
    setResults(data.data);
    setCustomer(null);
  }

  function pickCustomer(c) {
    setCustomer(c);
    setResults(null);
    setError(null);
    // The dashboard's own department filter picks the answer when it's
    // already scoped to one department the customer actually owes in;
    // otherwise default to the one department that has a balance, or force
    // the collector to choose when there's more than one.
    if (department !== 'all' && c.department_balances?.some((d) => d.key === department)) setPayDept(department);
    else setPayDept(c.department_balances?.length === 1 ? c.department_balances[0].key : '');
  }

  async function savePayment(e) {
    e.preventDefault();
    setError(null);
    if (!customer) { setError('Search for and select a customer first.'); return; }
    if (customer.department_balances?.length > 1 && !payDept) { setError('This customer has balances in multiple departments — choose which one this payment applies to.'); return; }
    const amt = Number(amount);
    if (!(amt > 0)) { setError('Enter an amount greater than zero.'); return; }
    setBusy(true);
    try {
      const { data } = await client.post('/billing/payments', {
        customer_id: customer.id, amount: amt, method, reference_number: referenceNumber || undefined,
        payment_date: paymentDate || undefined, notes: notes || undefined, department: payDept || undefined
      });
      setLastReceipt({ customer, amount: amt, method, payments: data.data.payments, unapplied: data.data.unapplied });
      setAmount(''); setReferenceNumber(''); setNotes('');
      const { data: refreshed } = await client.get(withDept('/billing/customers/search', department, `q=${encodeURIComponent(customer.hno)}`));
      const updated = refreshed.data[0] || null;
      setCustomer(updated);
      setPayDept(updated?.department_balances?.length === 1 ? updated.department_balances[0].key : '');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save payment');
    } finally {
      setBusy(false);
    }
  }

  function printReceipt() {
    if (!lastReceipt) return;
    const win = window.open('', '_blank');
    const rows = lastReceipt.payments.map((p) => `<tr><td>${p.transaction_hno}</td><td>$${Number(p.amount).toFixed(2)}</td></tr>`).join('');
    win.document.write(`
      <title>Payment Receipt</title>
      <style>body{font-family:sans-serif;padding:24px;font-size:14px;} table{width:100%;border-collapse:collapse;margin-top:12px;} td{padding:5px 0;border-bottom:1px solid #eee;}</style>
      <h2>Alnaciim Water Company</h2>
      <p>Customer: ${lastReceipt.customer.name} (HNO ${lastReceipt.customer.hno})</p>
      <p>Amount Received: $${lastReceipt.amount.toFixed(2)} (${lastReceipt.method})</p>
      <table><thead><tr><td><strong>Receipt #</strong></td><td><strong>Applied</strong></td></tr></thead><tbody>${rows}</tbody></table>
      ${lastReceipt.unapplied > 0 ? `<p>Unapplied (no outstanding balance left): $${lastReceipt.unapplied.toFixed(2)}</p>` : ''}
    `);
    win.document.close();
    win.print();
  }

  if (!canReceive) return <p className="muted">Your role does not have permission to receive payments.</p>;

  return (
    <div>
      <form className="toolbar" onSubmit={search}>
        <input placeholder="Search by HNO, phone, or name…" value={query} onChange={(e) => setQuery(e.target.value)} style={{ minWidth: 260 }} />
        <button className="btn" type="submit">Search</button>
      </form>

      {results && (
        <div className="card">
          <Table
            columns={[
              { key: 'hno', header: 'HNO' },
              { key: 'name', header: 'Customer' },
              { key: 'phone', header: 'Phone' },
              { key: 'outstanding_balance', header: 'Balance', render: (r) => money(r.outstanding_balance) },
              { key: 'actions', header: '', render: (r) => <button className="btn secondary" onClick={() => pickCustomer(r)}>Select</button> }
            ]}
            rows={results}
            emptyText="No customers found."
          />
        </div>
      )}

      {customer && (
        <div className="card">
          <h3>{customer.name} <span className="muted" style={{ fontSize: 13 }}>({customer.hno})</span></h3>
          <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
            <div className="kpi-card"><div className="kpi-card__label">Outstanding Balance</div><div className="kpi-card__value" style={{ color: 'var(--danger)' }}>{money(customer.outstanding_balance)}</div></div>
            <div className="kpi-card"><div className="kpi-card__label">Last Delivery</div><div className="kpi-card__value" style={{ fontSize: 16 }}>{customer.last_delivery_date ? String(customer.last_delivery_date).slice(0, 10) : '—'}</div></div>
            <div className="kpi-card"><div className="kpi-card__label">Last Payment</div><div className="kpi-card__value" style={{ fontSize: 16 }}>{customer.last_payment_date ? String(customer.last_payment_date).slice(0, 10) : '—'}</div></div>
          </div>

          <form className="form-modern" onSubmit={savePayment} style={{ boxShadow: 'none', padding: 0 }}>
            {error && <div className="error-box">{error}</div>}
            <div className="form-grid">
              {customer.department_balances?.length > 1 && (
                <div className="form-field">
                  <label>Department (multiple balances found)</label>
                  <select required value={payDept} onChange={(e) => setPayDept(e.target.value)}>
                    <option value="">Select a department…</option>
                    {customer.department_balances.map((d) => (
                      <option key={d.key} value={d.key}>{d.label} — {money(d.balance)}</option>
                    ))}
                  </select>
                </div>
              )}
              {customer.department_balances?.length === 1 && (
                <div className="form-field"><label>Department</label><span>{customer.department_balances[0].label}</span></div>
              )}
              <div className="form-field"><label>Amount</label><input required type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
              <div className="form-field">
                <label>Payment Method</label>
                <select value={method} onChange={(e) => setMethod(e.target.value)}>
                  <option value="cash">Cash</option>
                  <option value="bank_transfer">Bank</option>
                  <option value="mobile_money">Mobile Money</option>
                  <option value="cheque">Cheque</option>
                </select>
              </div>
              <div className="form-field"><label>Reference Number</label><input value={referenceNumber} onChange={(e) => setReferenceNumber(e.target.value)} /></div>
              <div className="form-field"><label>Payment Date</label><input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} /></div>
              <div className="form-field span-2"><label>Notes</label><input value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
            </div>
            <div className="form-actions">
              <button className="btn" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save Payment'}</button>
              {lastReceipt && <button type="button" className="secondary" onClick={printReceipt}>Print Receipt</button>}
            </div>
          </form>
        </div>
      )}

      {lastReceipt && (
        <div className="success-box"><CheckCircle2 size={15} /> Payment saved — receipt {lastReceipt.payments.map((p) => p.transaction_hno).join(', ')}.</div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// 4. Payment History
// ---------------------------------------------------------------------
export function PaymentHistoryTab() {
  const [department] = useDepartment();
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [customerQuery, setCustomerQuery] = useState('');
  const [method, setMethod] = useState('');
  const qs = new URLSearchParams();
  if (dateFrom) qs.set('date_from', dateFrom);
  if (dateTo) qs.set('date_to', dateTo);
  if (method) qs.set('method', method);
  const { rows } = useApi(withDept('/billing/payments', department, qs), [dateFrom, dateTo, method, department]);

  const filtered = rows?.filter((r) => !customerQuery || r.customer_name.toLowerCase().includes(customerQuery.toLowerCase()) || (r.hno || '').includes(customerQuery));

  return (
    <div>
      <div className="toolbar" style={{ flexWrap: 'wrap' }}>
        <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        <input placeholder="Customer name or HNO…" value={customerQuery} onChange={(e) => setCustomerQuery(e.target.value)} />
        <select value={method} onChange={(e) => setMethod(e.target.value)}>
          <option value="">All Methods</option>
          <option value="cash">Cash</option>
          <option value="bank_transfer">Bank</option>
          <option value="mobile_money">Mobile Money</option>
          <option value="cheque">Cheque</option>
        </select>
      </div>
      <div className="card">
        <Table
          columns={[
            { key: 'payment_date', header: 'Date' },
            { key: 'receipt_number', header: 'Receipt No' },
            { key: 'customer_name', header: 'Customer', render: (r) => `${r.customer_name} (${r.hno})` },
            { key: 'department', header: 'Department', render: (r) => r.department || '—' },
            { key: 'collector_name', header: 'Collector' },
            { key: 'amount', header: 'Amount', render: (r) => money(r.amount) },
            { key: 'method', header: 'Method' },
            { key: 'reference_number', header: 'Reference', render: (r) => r.reference_number || '—' },
            { key: 'notes', header: 'Notes', render: (r) => r.notes || '—' }
          ]}
          rows={filtered}
          sortable pageSize={20}
          emptyText="No payments found."
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// 5. Employee Collection Performance
// ---------------------------------------------------------------------
export function EmployeePerformanceTab() {
  const [department] = useDepartment();
  const { rows } = useApi(withDept('/billing/employee-performance', department), [department]);
  return (
    <div>
      <div className="card">
        <Table
          columns={[
            { key: 'employee_name', header: 'Employee' },
            { key: 'customers_assigned', header: 'Assigned' },
            { key: 'customers_paid_this_month', header: 'Paid This Month' },
            { key: 'customers_outstanding', header: 'Outstanding' },
            { key: 'cash_collected_today', header: 'Cash Today', render: (r) => money(r.cash_collected_today) },
            { key: 'cash_collected_month', header: 'Cash This Month', render: (r) => money(r.cash_collected_month) },
            { key: 'outstanding_balance', header: 'Outstanding Balance', render: (r) => money(r.outstanding_balance) },
            { key: 'collection_rate_pct', header: 'Collection Rate', render: (r) => `${r.collection_rate_pct}%` },
            { key: 'avg_collection_days', header: 'Avg Collection Days', render: (r) => Number(r.avg_collection_days).toFixed(1) }
          ]}
          rows={rows}
          sortable pageSize={15}
          emptyText="No collectors with assigned customers yet."
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// 6. Aging Report
// ---------------------------------------------------------------------
export function AgingReportTab() {
  const [department] = useDepartment();
  const { rows: d } = useApi(withDept('/billing/aging', department), [department]);
  const buckets = [
    { key: 'current', label: 'Current' },
    { key: 'days_1_30', label: '1–30 Days' },
    { key: 'days_31_60', label: '31–60 Days' },
    { key: 'days_61_90', label: '61–90 Days' },
    { key: 'over_90', label: 'Over 90 Days' }
  ];
  if (!d) return <p className="muted">Loading…</p>;
  return (
    <div>
      <div className="kpi-grid">
        {buckets.map((b) => (
          <div className="kpi-card" key={b.key}>
            <div className="kpi-card__label">{b.label}</div>
            <div className="kpi-card__value">{money(d.buckets[b.key])}</div>
            <div className="kpi-card__sub">{d.percentages[b.key].toFixed(1)}%</div>
          </div>
        ))}
      </div>
      <div className="card">
        <h3>Total Outstanding: {money(d.total)}</h3>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={buckets.map((b) => ({ name: b.label, Amount: d.buckets[b.key] }))} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} width={60} />
            <Tooltip />
            <Bar dataKey="Amount" fill="#dc2626" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// 12. Reports — an index over the reports this module already produces
// live elsewhere (Daily/Monthly Collection = Dashboard's charts, Collector
// Performance = Employee Performance, Outstanding Balance = Receivables,
// Cash Receipt = Payment History, Aging Analysis = Aging Report), plus
// Customer Statement, which reuses the existing per-customer statement.
// ---------------------------------------------------------------------
export function BillingReportsTab() {
  const { user } = useAuth();
  const [hno, setHno] = useState('');
  const [statement, setStatement] = useState(null);
  const [error, setError] = useState(null);
  const canViewAll = FULL_REPORT_ROLES.includes(user?.role);

  async function loadStatement(e) {
    e.preventDefault();
    setError(null);
    setStatement(null);
    try {
      const { data: found } = await client.get(`/billing/customers/search?q=${encodeURIComponent(hno)}`);
      const cust = found.data[0];
      if (!cust) { setError('No customer found with that HNO, name, or phone.'); return; }
      const { data } = await client.get(`/customers/${cust.id}/statement`);
      setStatement({ customer: cust, ...data.data });
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load statement');
    }
  }

  return (
    <div>
      <div className="card">
        <h3>Available Reports</h3>
        <p className="muted">Daily &amp; Monthly Collection Report and Aging Analysis are on the Collection Dashboard and Aging Report tabs. Collector Performance Report is the Employee Performance tab. Outstanding Balance Report is Customer Receivables. Cash Receipt Report is Payment History.{!canViewAll && ' Your role sees the reports above only — full report access is limited to Admin/Finance.'}</p>
      </div>

      <div className="card">
        <h3>Customer Statement</h3>
        <form className="toolbar" onSubmit={loadStatement}>
          <input placeholder="HNO, phone, or name…" value={hno} onChange={(e) => setHno(e.target.value)} />
          <button className="btn" type="submit">Load Statement</button>
        </form>
        {error && <div className="error-box">{error}</div>}
        {statement && (
          <div>
            <h4>{statement.customer.name} ({statement.customer.hno})</h4>
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
    </div>
  );
}

// ---------------------------------------------------------------------
// The module's page shell — one Department filter at the top (never
// duplicated per tab), and a single row of sub-tabs below it. Kept as a
// self-contained page (rather than another level of GroupedTabs groups)
// specifically so the department filter can live in exactly one place
// and stay visible no matter which sub-tab is open.
// ---------------------------------------------------------------------
const BILLING_TABS = [
  { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, Component: CollectionDashboardTab },
  { key: 'receivables', label: 'Customer Receivables', icon: Users, Component: CustomerReceivablesTab },
  { key: 'receive-payment', label: 'Receive Payment', icon: Wallet, Component: ReceivePaymentTab },
  { key: 'payment-history', label: 'Payment History', icon: History, Component: PaymentHistoryTab },
  { key: 'aging', label: 'Aging Report', icon: PieChart, Component: AgingReportTab },
  { key: 'employee-performance', label: 'Employee Performance', icon: Award, Component: EmployeePerformanceTab },
  { key: 'reports', label: 'Reports', icon: History, Component: BillingReportsTab }
];

function BillingCollectionsPage() {
  const [department, setDepartment] = useDepartment();
  const [activeKey, setActiveKey] = useState(BILLING_TABS[0].key);
  const active = BILLING_TABS.find((t) => t.key === activeKey) || BILLING_TABS[0];
  const Active = active.Component;

  return (
    <div>
      <div className="toolbar" style={{ marginBottom: 14 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 600 }}>
          <Building2 size={14} color="var(--primary)" /> Department
        </label>
        <select value={department} onChange={(e) => setDepartment(e.target.value)} style={{ minWidth: 200 }}>
          {DEPARTMENT_OPTIONS.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
        </select>
      </div>

      <div className="grouped-nav__subtabs" style={{ marginBottom: 18 }}>
        {BILLING_TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              className={`grouped-nav__subtab ${t.key === active.key ? 'active' : ''}`}
              onClick={() => setActiveKey(t.key)}
            >
              {Icon && <Icon size={14} />}
              {t.label}
            </button>
          );
        })}
      </div>

      <Active />
    </div>
  );
}

export const BILLING_GROUP = {
  key: 'billing', label: 'Billing & Collections', icon: Wallet,
  items: [
    { key: 'billing', label: 'Billing & Collections', icon: Wallet, Component: BillingCollectionsPage }
  ]
};
