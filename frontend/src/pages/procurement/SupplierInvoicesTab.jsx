import { useState } from 'react';
import { useApi } from '../../components/useApi';
import Table from '../../components/Table';
import client from '../../api/client';
import { useAuth } from '../../context/AuthContext';

const money = (n) => '$' + Number(n || 0).toFixed(2);
const today = () => new Date().toISOString().slice(0, 10);

export default function SupplierInvoicesTab() {
  const { user } = useAuth();
  const canFinance = ['Admin', 'Finance Officer'].includes(user?.role);
  const canApprovePayments = ['Admin', 'Operation Manager'].includes(user?.role);
  const [refresh, setRefresh] = useState(0);
  const { rows: invoices } = useApi('/procurement/supplier-invoices', [refresh]);
  const { rows: summary } = useApi('/procurement/supplier-invoices/dashboard', [refresh]);
  const { rows: orders } = useApi('/procurement/purchase-orders', [refresh]);
  const { rows: pendingPayments } = useApi(
    canApprovePayments ? '/procurement/supplier-invoices/pending-payment-approvals' : null,
    [refresh, canApprovePayments]
  );
  const [po, setPo] = useState(null);
  const [poDetail, setPoDetail] = useState(null);
  const [lines, setLines] = useState({});
  const [invoiceNo, setInvoiceNo] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(today());
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState('cash');
  const [reference, setReference] = useState('');

  async function selectOrder(id) {
    setPo(id);
    setPoDetail(null);
    setLines({});
    if (!id) return;
    try {
      const res = await client.get('/procurement/purchase-orders/' + id);
      const detail = res.data.data;
      setPoDetail(detail);
      const initial = {};
      for (const item of detail.items || []) {
        if (Number(item.quantity_accepted) > 0) {
          initial[item.id] = { quantity: String(item.quantity_accepted), unit_price: String(item.unit_cost) };
        }
      }
      setLines(initial);
    } catch (e) { setError(e.response?.data?.error || e.message); }
  }

  const invoiceLines = (poDetail?.items || []).filter((item) => lines[item.id]?.quantity)
    .map((item) => ({
      purchase_item_id: item.id,
      quantity: Number(lines[item.id].quantity),
      unit_price: Number(lines[item.id].unit_price),
      line_total: Math.round(Number(lines[item.id].quantity) * Number(lines[item.id].unit_price) * 100) / 100,
      product_name: item.product_name
    }));
  const total = invoiceLines.reduce((sum, line) => sum + line.line_total, 0);

  async function registerInvoice(e) {
    e.preventDefault(); setError('');
    if (!poDetail || !invoiceNo.trim() || !invoiceLines.length) { setError('Select a received PO, enter the supplier invoice number, and add at least one received line.'); return; }
    setBusy(true);
    try {
      const payload = {
        purchase_order_id: Number(po), supplier_invoice_no: invoiceNo.trim(),
        invoice_date: invoiceDate, due_date: dueDate || null,
        subtotal: total, total_amount: total, notes: notes || null,
        lines: invoiceLines.map(({ purchase_item_id, quantity, unit_price, line_total }) => ({ purchase_item_id, quantity, unit_price, line_total }))
      };
      if (editingId) await client.put('/procurement/supplier-invoices/' + editingId, payload);
      else await client.post('/procurement/supplier-invoices', payload);
      setInvoiceNo(''); setDueDate(''); setNotes(''); setPo(null); setPoDetail(null); setLines({}); setEditingId(null);
      setRefresh((v) => v + 1);
    } catch (e2) { setError(e2.response?.data?.error || e2.message); }
    finally { setBusy(false); }
  }

  async function action(path, body) {
    setError('');
    try {
      const res = await client.post('/procurement/supplier-invoices/' + selected.id + path, body || {});
      if (path === '/payments') {
        const payment = res.data.data;
        window.alert('Payment recorded. Voucher ' + payment.voucher_number);
        setPayAmount(''); setReference('');
      }
      setRefresh((v) => v + 1);
      const detail = await client.get('/procurement/supplier-invoices/' + selected.id);
      setSelected(detail.data.data);
    } catch (e) { setError(e.response?.data?.error || e.message); }
  }

  async function decidePayment(row, decision) {
    const comments = decision === 'reject' ? window.prompt('Reason for rejecting this payment:') : '';
    if (decision === 'reject' && !comments?.trim()) return;
    setError('');
    try {
      await client.post('/procurement/supplier-invoices/' + row.invoice_id + '/payments/' + row.payment_id + '/decision', {
        decision, comments: comments || null
      });
      setRefresh((v) => v + 1);
      if (selected?.id === row.invoice_id) {
        setSelected((await client.get('/procurement/supplier-invoices/' + row.invoice_id)).data.data);
      }
    } catch (e) { setError(e.response?.data?.error || e.message); }
  }

  async function openDetail(row) {
    setError('');
    try { setSelected((await client.get('/procurement/supplier-invoices/' + row.id)).data.data); }
    catch (e) { setError(e.response?.data?.error || e.message); }
  }

  async function correctInvoice() {
    if (!selected || !['registered', 'mismatch'].includes(selected.status)) return;
    setError('');
    try {
      const order = (await client.get('/procurement/purchase-orders/' + selected.purchase_order_id)).data.data;
      const initial = {};
      for (const line of selected.lines || []) initial[line.purchase_item_id] = {
        quantity: String(line.quantity), unit_price: String(line.unit_price)
      };
      setPo(selected.purchase_order_id); setPoDetail(order); setLines(initial);
      setInvoiceNo(selected.supplier_invoice_no); setInvoiceDate(String(selected.invoice_date).slice(0, 10));
      setDueDate(selected.due_date ? String(selected.due_date).slice(0, 10) : '');
      setNotes(selected.notes || ''); setEditingId(selected.id); setSelected(null);
    } catch (e) { setError(e.response?.data?.error || e.message); }
  }

  async function voidInvoice() {
    const reason = window.prompt('Reason for voiding this supplier invoice:');
    if (!reason?.trim() || !selected) return;
    try {
      await client.post('/procurement/supplier-invoices/' + selected.id + '/void', { reason: reason.trim() });
      setSelected(null); setRefresh((v) => v + 1);
    } catch (e) { setError(e.response?.data?.error || e.message); }
  }

  function printVoucher(payment) {
    const safe = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    const win = window.open('', '_blank', 'width=700,height=650');
    if (!win) { setError('Allow pop-ups to print the voucher.'); return; }
    win.document.write('<!doctype html><html><head><title>Payment Voucher</title><style>body{font:15px Arial;padding:40px;color:#173642}h1{color:#0b4a5c}.box{border:1px solid #ccd8dc;padding:18px;margin-top:18px}.row{padding:7px 0;border-bottom:1px solid #eee}</style></head><body><h1>Al-Naciim Water Company</h1><h2>Supplier Payment Voucher</h2><div class="box">' +
      '<div class="row"><b>Voucher:</b> ' + safe(payment.voucher_number) + '</div>' +
      '<div class="row"><b>Supplier invoice:</b> ' + safe(selected?.supplier_invoice_no) + '</div>' +
      '<div class="row"><b>Purchase Order:</b> ' + safe(selected?.po_number) + '</div>' +
      '<div class="row"><b>Date:</b> ' + safe(payment.payment_date) + '</div>' +
      '<div class="row"><b>Method:</b> ' + safe(payment.method) + '</div>' +
      '<div class="row"><b>Reference:</b> ' + safe(payment.reference_number || '—') + '</div>' +
      '<div class="row"><b>Amount:</b> ' + safe(money(payment.amount)) + '</div>' +
      '<p>Recorded by: ' + safe(user?.fullName || user?.full_name || '—') + '</p><br/><p>Authorized signature: ____________________</p></div><script>window.onload=()=>window.print()</script></body></html>');
    win.document.close();
  }

  const columns = [
    { key: 'internal_number', header: 'Invoice' },
    { key: 'supplier_invoice_no', header: 'Supplier Invoice' },
    { key: 'supplier_name', header: 'Supplier' },
    { key: 'po_number', header: 'PO' },
    { key: 'invoice_date', header: 'Date' },
    { key: 'total_amount', header: 'Total', render: (r) => money(r.total_amount) },
    { key: 'balance', header: 'Balance', render: (r) => money(r.balance) },
    { key: 'status', header: 'Status' },
    { key: 'open', header: '', render: (r) => <button className="btn secondary" onClick={() => openDetail(r)}>View</button> }
  ];

  return (
    <div>
      <div className="kpi-grid" style={{ marginBottom: 14 }}>
        {[['Invoices', summary?.total_invoices], ['Awaiting Match', summary?.awaiting_match], ['Mismatches', summary?.mismatches], ['Invoice Approval', summary?.awaiting_approval], ['Payment Approval', summary?.pending_payment_approvals], ['Outstanding', money(summary?.outstanding_amount)]].map(([label, value]) =>
          <div className="kpi-card" key={label}><span>{label}</span><strong>{value ?? '—'}</strong></div>
        )}
      </div>

      {canApprovePayments && (pendingPayments || []).length > 0 && <section className="card" style={{ marginBottom: 14 }}>
        <h3>Supplier Payments Awaiting Your Approval</h3>
        <Table columns={[
          { key: 'voucher_number', header: 'Voucher' },
          { key: 'supplier_name', header: 'Supplier' },
          { key: 'supplier_invoice_no', header: 'Supplier Invoice' },
          { key: 'amount', header: 'Amount', render: (r) => money(r.amount) },
          { key: 'method', header: 'Method' },
          { key: 'requested_by', header: 'Requested By' },
          { key: 'actions', header: '', render: (r) => <span>
            <button className="btn" onClick={() => decidePayment(r, 'approve')}>Approve</button>{' '}
            <button className="btn secondary" onClick={() => decidePayment(r, 'reject')}>Reject</button>
          </span> }
        ]} rows={pendingPayments || []} emptyText="No supplier payments need approval." />
      </section>}

      {canFinance && <form className="card" onSubmit={registerInvoice} style={{ marginBottom: 14 }}>
        <h3>{editingId ? 'Correct Supplier Invoice' : 'Register Supplier Invoice'}</h3>
        <div className="form-grid">
          <div className="form-field"><label>Received Purchase Order</label>
            <select value={po || ''} onChange={(e) => selectOrder(e.target.value)} required>
              <option value="">Select PO…</option>
              {(orders || []).filter((o) => ['partially_received', 'received', 'invoiced', 'paid'].includes(o.status))
                .map((o) => <option key={o.id} value={o.id}>{o.po_number} · {o.supplier_name} · {o.status}</option>)}
            </select>
          </div>
          <div className="form-field"><label>Supplier Invoice Number</label><input required value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} /></div>
          <div className="form-field"><label>Invoice Date</label><input type="date" required value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} /></div>
          <div className="form-field"><label>Due Date</label><input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></div>
        </div>
        {poDetail?.items?.filter((item) => Number(item.quantity_accepted) > 0).map((item) =>
          <div key={item.id} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 8, alignItems: 'center', margin: '8px 0' }}>
            <span>{item.product_name} · accepted {Number(item.quantity_accepted)}</span>
            <input aria-label={'Invoice quantity ' + item.product_name} type="number" min="0" max={item.quantity_accepted} step="0.001"
              value={lines[item.id]?.quantity || ''} onChange={(e) => setLines((v) => ({ ...v, [item.id]: { ...v[item.id], quantity: e.target.value } }))} />
            <input aria-label={'Invoice unit price ' + item.product_name} type="number" min="0" step="0.01"
              value={lines[item.id]?.unit_price || ''} onChange={(e) => setLines((v) => ({ ...v, [item.id]: { ...v[item.id], unit_price: e.target.value } }))} />
            <span>{money((Number(lines[item.id]?.quantity) || 0) * (Number(lines[item.id]?.unit_price) || 0))}</span>
          </div>
        )}
        <div className="form-field"><label>Notes</label><input value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
        <strong>Invoice total: {money(total)}</strong>
        <p className="muted">Invoice lines are matched to PO prices and accepted GRN quantities. Tax/other charges are not configured in the current ledger.</p>
        <button className="btn" disabled={busy || !poDetail}>{busy ? 'Saving…' : editingId ? 'Save Correction' : 'Register Invoice'}</button>
        {editingId && <button type="button" className="btn secondary" onClick={() => { setEditingId(null); setPo(null); setPoDetail(null); setLines({}); }}>Cancel Correction</button>}
      </form>}

      {error && <div className="alert alert--error" role="alert">{error}</div>}
      <Table columns={columns} rows={invoices || []} searchable searchPlaceholder="Search invoice, supplier, or PO…" sortable pageSize={12} emptyText="No supplier invoices registered." />

      {selected && <div className="modal-backdrop" onClick={() => setSelected(null)}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <div className="page-header"><h2>{selected.internal_number} · {selected.supplier_name}</h2><button className="btn secondary" onClick={() => setSelected(null)}>Close</button></div>
          <p>Supplier invoice {selected.supplier_invoice_no} · PO {selected.po_number} · {selected.status} · Balance {money(selected.balance)}</p>
          <Table columns={[
            { key: 'product_name', header: 'Product' },
            { key: 'quantity', header: 'Invoice Qty' },
            { key: 'quantity_accepted', header: 'Accepted Qty' },
            { key: 'unit_price', header: 'Invoice Price', render: (r) => money(r.unit_price) },
            { key: 'unit_cost', header: 'PO Price', render: (r) => money(r.unit_cost) },
            { key: 'line_total', header: 'Line Total', render: (r) => money(r.line_total) }
          ]} rows={selected.lines || []} />
          {selected.match_result && <pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(selected.match_result, null, 2)}</pre>}
          {canFinance && ['registered', 'mismatch'].includes(selected.status) && <>
            <button className="btn secondary" onClick={correctInvoice}>Correct Invoice</button>{' '}
            <button className="btn secondary" onClick={voidInvoice}>Void Invoice</button>{' '}
          </>}
          {canFinance && ['registered', 'mismatch'].includes(selected.status) && <button className="btn" onClick={() => action('/match')}>Run 3-way Match</button>}
          {canFinance && selected.status === 'matched' && <button className="btn" onClick={() => action('/approve')}>Approve Invoice</button>}
          {canFinance && ['approved', 'partially_paid'].includes(selected.status) && <form onSubmit={(e) => { e.preventDefault(); action('/payments', { amount: Number(payAmount), method: payMethod, reference_number: reference || null }); }}>
            <h3>Pay Approved Invoice</h3>
            <div className="form-grid">
              <div className="form-field"><label>Amount (balance {money(selected.balance)})</label><input type="number" min="0.01" max={selected.balance} step="0.01" required value={payAmount} onChange={(e) => setPayAmount(e.target.value)} /></div>
              <div className="form-field"><label>Payment Method</label><select value={payMethod} onChange={(e) => setPayMethod(e.target.value)}><option value="cash">Cash</option><option value="bank_transfer">Bank</option><option value="cheque">Cheque</option></select></div>
              <div className="form-field"><label>Reference</label><input value={reference} onChange={(e) => setReference(e.target.value)} /></div>
            </div>
            <button className="btn">Record Payment</button>
          </form>}
          <h3>Payment Vouchers</h3>
          <Table columns={[
            { key: 'voucher_number', header: 'Voucher' }, { key: 'payment_date', header: 'Date' },
            { key: 'amount', header: 'Amount', render: (r) => money(r.amount) }, { key: 'method', header: 'Method' },
            { key: 'reference_number', header: 'Reference' }, { key: 'status', header: 'Status' },
            { key: 'actions', header: '', render: (r) => <span>
              {r.status === 'approved' && <button className="btn secondary" onClick={() => printVoucher(r)}>Print Voucher</button>}
              {canApprovePayments && r.status === 'pending' && <><button className="btn" onClick={() => decidePayment({ invoice_id: selected.id, payment_id: r.id }, 'approve')}>Approve</button>{' '}
                <button className="btn secondary" onClick={() => decidePayment({ invoice_id: selected.id, payment_id: r.id }, 'reject')}>Reject</button></>}
            </span> }
          ]} rows={selected.payments || []} emptyText="No payments recorded." />
        </div>
      </div>}
    </div>
  );
}
