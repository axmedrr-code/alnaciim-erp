// Supplier invoice control. Goods receipt already accrues inventory/AP, so
// invoice approval is a control step, not a second payable journal posting.
const { Router } = require('express');
const { pool, withTransaction } = require('../config/db');
const { asyncHandler, ApiError } = require('../utils/asyncHandler');
const { requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const schemas = require('../validation/schemas');
const { postJournalEntry, getAccountByCode } = require('../services/accountingService');
const { nextRef, audit, recordApproval } = require('../services/procurementService');
const { matchSupplierInvoice } = require('../services/supplierInvoiceMatcher');

const router = Router();
const FINANCE = ['Admin', 'Finance Officer'];
const VIEW = ['Admin', 'Finance Officer', 'Procurement Officer', 'Storekeeper', 'Inventory Manager', 'Operation Manager'];
const CENT = 0.01;
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

router.get('/dashboard', requireRole(...VIEW), asyncHandler(async (_req, res) => {
  const { rows } = await pool.query(
    "SELECT COUNT(*)::int AS total_invoices, COUNT(*) FILTER (WHERE status='registered')::int AS awaiting_match, " +
    "COUNT(*) FILTER (WHERE status='mismatch')::int AS mismatches, COUNT(*) FILTER (WHERE status='matched')::int AS awaiting_approval, " +
    "COUNT(*) FILTER (WHERE status IN ('approved','partially_paid'))::int AS payable_invoices, " +
    "COALESCE(SUM(total_amount) FILTER (WHERE status IN ('approved','partially_paid')),0) AS approved_amount, " +
    "COALESCE(SUM(si.total_amount-COALESCE(paid.amount,0)) FILTER (WHERE si.status IN ('approved','partially_paid')),0) AS outstanding_amount, " +
    "(SELECT COUNT(*)::int FROM supplier_payments WHERE status='pending' AND voided_at IS NULL) AS pending_payment_approvals " +
    "FROM supplier_invoices si LEFT JOIN LATERAL (SELECT SUM(sp.amount) AS amount FROM supplier_payments sp " +
    "WHERE sp.supplier_invoice_id=si.id AND sp.status='approved' AND sp.voided_at IS NULL) paid ON true"
  );
  res.json({ data: rows[0], error: null });
}));

router.get('/', requireRole(...VIEW), asyncHandler(async (_req, res) => {
  const { rows } = await pool.query(
    "SELECT si.*, s.name AS supplier_name, po.po_number, COALESCE(paid.amount,0) AS paid_amount, " +
    "GREATEST(0,si.total_amount-COALESCE(paid.amount,0)) AS balance FROM supplier_invoices si " +
    "JOIN suppliers s ON s.id=si.supplier_id JOIN purchase_orders po ON po.id=si.purchase_order_id " +
    "LEFT JOIN LATERAL (SELECT SUM(sp.amount) AS amount FROM supplier_payments sp " +
    "WHERE sp.supplier_invoice_id=si.id AND sp.status='approved' AND sp.voided_at IS NULL) paid ON true ORDER BY si.invoice_date DESC,si.id DESC LIMIT 1000"
  );
  res.json({ data: rows, error: null });
}));

router.get('/pending-payment-approvals', requireRole('Admin', 'Operation Manager'), asyncHandler(async (_req, res) => {
  const { rows } = await pool.query(
    "SELECT sp.id AS payment_id,sp.voucher_number,sp.amount,sp.payment_date,sp.method,sp.reference_number, " +
    "si.id AS invoice_id,si.internal_number,si.supplier_invoice_no,s.name AS supplier_name,u.full_name AS requested_by " +
    "FROM supplier_payments sp JOIN supplier_invoices si ON si.id=sp.supplier_invoice_id " +
    "JOIN suppliers s ON s.id=si.supplier_id JOIN users u ON u.id=sp.recorded_by " +
    "WHERE sp.status='pending' AND sp.voided_at IS NULL ORDER BY sp.created_at"
  );
  res.json({ data: rows, error: null });
}));

router.post('/', requireRole(...FINANCE), validate(schemas.supplierInvoiceCreate), asyncHandler(async (req, res) => {
  const b = req.body;
  const ids = b.lines.map((line) => line.purchase_item_id);
  if (new Set(ids).size !== ids.length) throw new ApiError(400, 'Each purchase order line may appear only once per invoice');
  for (const line of b.lines) {
    if (Math.abs(round2(line.quantity * line.unit_price) - round2(line.line_total)) > CENT)
      throw new ApiError(400, 'Invoice line total must equal quantity multiplied by unit price');
  }
  const lineTotal = round2(b.lines.reduce((sum, line) => sum + Number(line.line_total), 0));
  if (Math.abs(lineTotal - round2(b.subtotal)) > CENT || Math.abs(lineTotal - round2(b.total_amount)) > CENT)
    throw new ApiError(400, 'Invoice subtotal and total must equal the sum of invoice lines');
  let invoice;
  try { invoice = await withTransaction(async (client) => {
    const po = (await client.query('SELECT * FROM purchase_orders WHERE id=$1 FOR UPDATE', [b.purchase_order_id])).rows[0];
    if (!po) throw new ApiError(404, 'Purchase order not found');
    if (!['partially_received', 'received', 'invoiced', 'paid'].includes(po.status))
      throw new ApiError(409, 'Supplier invoices require goods received against the purchase order');
    for (const id of ids) {
      const item = (await client.query('SELECT id FROM purchase_items WHERE id=$1 AND purchase_order_id=$2', [id, po.id])).rows[0];
      if (!item) throw new ApiError(400, 'An invoice line does not belong to the selected purchase order');
    }
    const row = (await client.query(
      'INSERT INTO supplier_invoices (internal_number,supplier_id,purchase_order_id,supplier_invoice_no,invoice_date,due_date,subtotal,total_amount,notes,registered_by) ' +
      'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',
      [await nextRef(client, 'SINV'), po.supplier_id, po.id, b.supplier_invoice_no, b.invoice_date, b.due_date || null,
        b.subtotal, b.total_amount, b.notes || null, req.user.id]
    )).rows[0];
    for (const line of b.lines) await client.query(
      'INSERT INTO supplier_invoice_lines (supplier_invoice_id,purchase_item_id,quantity,unit_price,line_total) VALUES ($1,$2,$3,$4,$5)',
      [row.id, line.purchase_item_id, line.quantity, line.unit_price, line.line_total]
    );
    await audit(client, { entityType: 'supplier_invoice', entityId: row.id, action: 'register', user: req.user,
      newValue: { invoice: row.internal_number, supplier_invoice_no: row.supplier_invoice_no, purchase_order_id: po.id, total: b.total_amount } });
    return row;
  }); } catch (error) {
    if (error.code === '23505') throw new ApiError(409, 'This supplier invoice number is already registered for the supplier');
    throw error;
  }
  res.status(201).json({ data: invoice, error: null });
}));

router.put('/:id', requireRole(...FINANCE), validate(schemas.supplierInvoiceCreate), asyncHandler(async (req, res) => {
  const b = req.body;
  if (new Set(b.lines.map((line) => line.purchase_item_id)).size !== b.lines.length)
    throw new ApiError(400, 'Each purchase order line may appear only once per invoice');
  for (const line of b.lines) {
    if (Math.abs(round2(line.quantity * line.unit_price) - round2(line.line_total)) > CENT)
      throw new ApiError(400, 'Invoice line total must equal quantity multiplied by unit price');
  }
  const total = round2(b.lines.reduce((sum, line) => sum + Number(line.line_total), 0));
  if (Math.abs(total - round2(b.subtotal)) > CENT || Math.abs(total - round2(b.total_amount)) > CENT)
    throw new ApiError(400, 'Invoice subtotal and total must equal the sum of invoice lines');
  let updated;
  try { updated = await withTransaction(async (client) => {
    const invoice = (await client.query('SELECT * FROM supplier_invoices WHERE id=$1 FOR UPDATE', [Number(req.params.id)])).rows[0];
    if (!invoice) throw new ApiError(404, 'Supplier invoice not found');
    if (!['registered', 'mismatch'].includes(invoice.status)) throw new ApiError(409, 'Only an unmatched or mismatched invoice can be corrected');
    if (Number(b.purchase_order_id) !== Number(invoice.purchase_order_id)) throw new ApiError(400, 'A supplier invoice cannot be moved to another purchase order');
    await client.query('SELECT id FROM purchase_orders WHERE id=$1 FOR UPDATE', [invoice.purchase_order_id]);
    for (const line of b.lines) {
      const item = (await client.query('SELECT id FROM purchase_items WHERE id=$1 AND purchase_order_id=$2', [line.purchase_item_id, invoice.purchase_order_id])).rows[0];
      if (!item) throw new ApiError(400, 'An invoice line does not belong to this purchase order');
    }
    const row = (await client.query(
      "UPDATE supplier_invoices SET supplier_invoice_no=$1,invoice_date=$2,due_date=$3,subtotal=$4,total_amount=$5,notes=$6,status='registered',match_result=NULL,matched_by=NULL,matched_at=NULL WHERE id=$7 RETURNING *",
      [b.supplier_invoice_no, b.invoice_date, b.due_date || null, b.subtotal, b.total_amount, b.notes || null, invoice.id]
    )).rows[0];
    await client.query('DELETE FROM supplier_invoice_lines WHERE supplier_invoice_id=$1', [invoice.id]);
    for (const line of b.lines) await client.query(
      'INSERT INTO supplier_invoice_lines (supplier_invoice_id,purchase_item_id,quantity,unit_price,line_total) VALUES ($1,$2,$3,$4,$5)',
      [invoice.id, line.purchase_item_id, line.quantity, line.unit_price, line.line_total]
    );
    await audit(client, { entityType: 'supplier_invoice', entityId: invoice.id, action: 'correct_before_approval', user: req.user,
      oldValue: { supplier_invoice_no: invoice.supplier_invoice_no, status: invoice.status, total_amount: Number(invoice.total_amount) },
      newValue: { supplier_invoice_no: row.supplier_invoice_no, status: row.status, total_amount: Number(row.total_amount) } });
    return row;
  }); } catch (error) {
    if (error.code === '23505') throw new ApiError(409, 'This supplier invoice number is already registered for the supplier');
    throw error;
  }
  res.json({ data: updated, error: null });
}));

router.post('/:id/void', requireRole(...FINANCE), validate(schemas.reverseRequest), asyncHandler(async (req, res) => {
  const row = await withTransaction(async (client) => {
    const invoice = (await client.query('SELECT * FROM supplier_invoices WHERE id=$1 FOR UPDATE', [Number(req.params.id)])).rows[0];
    if (!invoice) throw new ApiError(404, 'Supplier invoice not found');
    if (!['registered', 'mismatch', 'matched'].includes(invoice.status)) throw new ApiError(409, 'An approved or paid invoice cannot be voided');
    const payments = Number((await client.query('SELECT COUNT(*)::int AS n FROM supplier_payments WHERE supplier_invoice_id=$1', [invoice.id])).rows[0].n);
    if (payments) throw new ApiError(409, 'An invoice with a payment voucher cannot be voided');
    const updated = (await client.query("UPDATE supplier_invoices SET status='voided',void_reason=$1 WHERE id=$2 RETURNING *", [req.body.reason, invoice.id])).rows[0];
    await audit(client, { entityType: 'supplier_invoice', entityId: invoice.id, action: 'void', user: req.user,
      oldValue: { status: invoice.status }, newValue: { status: 'voided', reason: req.body.reason } });
    return updated;
  });
  res.json({ data: row, error: null });
}));

router.get('/:id', requireRole(...VIEW), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const invoice = (await pool.query(
    'SELECT si.*,s.name AS supplier_name,po.po_number,u.full_name AS registered_by_name, ' +
    'COALESCE(paid.amount,0) AS paid_amount,GREATEST(0,si.total_amount-COALESCE(paid.amount,0)) AS balance ' +
    'FROM supplier_invoices si JOIN suppliers s ON s.id=si.supplier_id JOIN purchase_orders po ON po.id=si.purchase_order_id ' +
    'JOIN users u ON u.id=si.registered_by LEFT JOIN LATERAL (SELECT SUM(amount) AS amount FROM supplier_payments ' +
    "WHERE supplier_invoice_id=si.id AND status='approved' AND voided_at IS NULL) paid ON true WHERE si.id=$1", [id]
  )).rows[0];
  if (!invoice) throw new ApiError(404, 'Supplier invoice not found');
  invoice.lines = (await pool.query(
    'SELECT sil.*,p.name AS product_name,pi.quantity_ordered,pi.quantity_accepted,pi.unit_cost FROM supplier_invoice_lines sil ' +
    'JOIN purchase_items pi ON pi.id=sil.purchase_item_id JOIN products p ON p.id=pi.product_id ' +
    'WHERE sil.supplier_invoice_id=$1 ORDER BY sil.id', [id]
  )).rows;
  invoice.payments = (await pool.query(
    'SELECT sp.*,u.full_name AS recorded_by_name FROM supplier_payments sp JOIN users u ON u.id=sp.recorded_by ' +
    'WHERE sp.supplier_invoice_id=$1 ORDER BY sp.payment_date,sp.id', [id]
  )).rows;
  res.json({ data: invoice, error: null });
}));

router.post('/:id/match', requireRole(...FINANCE), asyncHandler(async (req, res) => {
  const matched = await withTransaction(async (client) => {
    const invoice = (await client.query('SELECT * FROM supplier_invoices WHERE id=$1 FOR UPDATE', [Number(req.params.id)])).rows[0];
    if (!invoice) throw new ApiError(404, 'Supplier invoice not found');
    if (!['registered', 'mismatch'].includes(invoice.status)) throw new ApiError(409, 'This invoice cannot be matched in its current status');
    const po = (await client.query('SELECT id FROM purchase_orders WHERE id=$1 FOR UPDATE', [invoice.purchase_order_id])).rows[0];
    if (!po) throw new ApiError(404, 'Purchase order not found');
    const lines = (await client.query(
      'SELECT sil.*,pi.quantity_accepted,pi.unit_cost,p.name AS product_name, ' +
      'COALESCE((SELECT SUM(other.quantity) FROM supplier_invoice_lines other JOIN supplier_invoices prior ON prior.id=other.supplier_invoice_id ' +
      'WHERE other.purchase_item_id=sil.purchase_item_id AND prior.purchase_order_id=$2 AND prior.id<>$1 ' +
      "AND prior.status IN ('matched','approved','partially_paid','paid')),0) AS previously_invoiced " +
      'FROM supplier_invoice_lines sil JOIN purchase_items pi ON pi.id=sil.purchase_item_id JOIN products p ON p.id=pi.product_id ' +
      'WHERE sil.supplier_invoice_id=$1 FOR UPDATE OF pi', [invoice.id, invoice.purchase_order_id]
    )).rows;
    const matchResult = { ...matchSupplierInvoice(invoice.total_amount, lines), checked_at: new Date().toISOString() };
    const status = matchResult.matched ? 'matched' : 'mismatch';
    const row = (await client.query(
      'UPDATE supplier_invoices SET status=$1,match_result=$2,matched_by=$3,matched_at=now() WHERE id=$4 RETURNING *',
      [status, JSON.stringify(matchResult), req.user.id, invoice.id]
    )).rows[0];
    await audit(client, { entityType: 'supplier_invoice', entityId: row.id, action: 'three_way_match', user: req.user,
      oldValue: { status: invoice.status }, newValue: { status, exceptions: matchResult.exceptions } });
    return row;
  });
  res.json({ data: matched, error: null });
}));

router.post('/:id/approve', requireRole(...FINANCE), asyncHandler(async (req, res) => {
  const invoice = await withTransaction(async (client) => {
    const row = (await client.query('SELECT * FROM supplier_invoices WHERE id=$1 FOR UPDATE', [Number(req.params.id)])).rows[0];
    if (!row) throw new ApiError(404, 'Supplier invoice not found');
    if (row.status !== 'matched') throw new ApiError(409, 'Only an invoice with a successful 3-way match can be approved');
    if (row.registered_by === req.user.id && req.user.role !== 'Admin') throw new ApiError(403, 'Invoice registrars cannot approve their own invoice');
    const updated = (await client.query("UPDATE supplier_invoices SET status='approved',approved_by=$1,approved_at=now() WHERE id=$2 RETURNING *", [req.user.id, row.id])).rows[0];
    await recordApproval(client, { entityType: 'supplier_invoice', entityId: row.id, step: 'invoice_approval', decision: 'approved',
      user: req.user, snapshot: { invoice: row.internal_number, supplier_invoice_no: row.supplier_invoice_no,
        purchase_order_id: row.purchase_order_id, total: Number(row.total_amount), match_result: row.match_result } });
    await audit(client, { entityType: 'supplier_invoice', entityId: row.id, action: 'approve', user: req.user,
      oldValue: { status: row.status }, newValue: { status: 'approved' } });
    return updated;
  });
  res.json({ data: invoice, error: null });
}));

router.post('/:id/payments', requireRole(...FINANCE), validate(schemas.supplierInvoicePaymentCreate), asyncHandler(async (req, res) => {
  const payment = await withTransaction(async (client) => {
    const invoice = (await client.query(
      'SELECT si.*,po.cost_center_id,po.project_id,po.po_number FROM supplier_invoices si JOIN purchase_orders po ON po.id=si.purchase_order_id ' +
      'WHERE si.id=$1 FOR UPDATE OF si,po', [Number(req.params.id)]
    )).rows[0];
    if (!invoice) throw new ApiError(404, 'Supplier invoice not found');
    if (!['approved', 'partially_paid'].includes(invoice.status)) throw new ApiError(409, 'Only an approved invoice may be paid');
    const paid = Number((await client.query(
      "SELECT COALESCE(SUM(amount),0) AS total FROM supplier_payments WHERE supplier_invoice_id=$1 AND status IN ('pending','approved') AND voided_at IS NULL", [invoice.id]
    )).rows[0].total);
    const poPayable = Number((await client.query(
      'SELECT COALESCE(SUM(quantity_accepted*unit_cost),0) AS total FROM purchase_items WHERE purchase_order_id=$1', [invoice.purchase_order_id]
    )).rows[0].total);
    const poPaid = Number((await client.query(
      "SELECT COALESCE(SUM(amount),0) AS total FROM supplier_payments WHERE purchase_order_id=$1 AND status IN ('legacy','pending','approved') AND voided_at IS NULL", [invoice.purchase_order_id]
    )).rows[0].total);
    const amount = Number(req.body.amount);
    if (amount > Number(invoice.total_amount)-paid+CENT) throw new ApiError(409, 'Payment exceeds this invoice balance');
    if (amount > poPayable-poPaid+CENT) throw new ApiError(409, 'Payment exceeds the payable accrued from accepted receipts');
    const voucher = await nextRef(client, 'PV');
    const row = (await client.query(
      "INSERT INTO supplier_payments (purchase_order_id,supplier_invoice_id,amount,payment_date,method,bank_account_id,reference_number,recorded_by,voucher_number,status) " +
      "VALUES ($1,$2,$3,COALESCE($4,CURRENT_DATE),$5,$6,$7,$8,$9,'pending') RETURNING *",
      [invoice.purchase_order_id, invoice.id, amount, req.body.payment_date || null, req.body.method,
        req.body.bank_account_id || null, req.body.reference_number || null, req.user.id, voucher]
    )).rows[0];
    await audit(client, { entityType: 'supplier_payment', entityId: row.id, action: 'request_payment', user: req.user,
      newValue: { voucher_number: voucher, invoice_id: invoice.id, amount, status: 'pending' } });
    return row;
  });
  res.status(201).json({ data: payment, error: null });
}));

router.post('/:id/payments/:paymentId/decision', requireRole('Admin', 'Operation Manager'),
  validate(schemas.supplierPaymentDecision), asyncHandler(async (req, res) => {
    const result = await withTransaction(async (client) => {
      const invoice = (await client.query(
        'SELECT si.*,po.cost_center_id,po.project_id,po.po_number FROM supplier_invoices si JOIN purchase_orders po ON po.id=si.purchase_order_id WHERE si.id=$1 FOR UPDATE OF si,po',
        [Number(req.params.id)]
      )).rows[0];
      if (!invoice) throw new ApiError(404, 'Supplier invoice not found');
      const payment = (await client.query(
        'SELECT * FROM supplier_payments WHERE id=$1 AND supplier_invoice_id=$2 FOR UPDATE',
        [Number(req.params.paymentId), invoice.id]
      )).rows[0];
      if (!payment) throw new ApiError(404, 'Payment request not found');
      if (payment.status !== 'pending') throw new ApiError(409, 'This payment request has already been decided');
      if (payment.recorded_by === req.user.id && req.user.role !== 'Admin')
        throw new ApiError(403, 'The payment requester cannot approve their own payment');
      const decision = req.body.decision;
      if (decision === 'reject') {
        const rejected = (await client.query(
          "UPDATE supplier_payments SET status='rejected',approved_by=$1,approved_at=now(),void_reason=$2 WHERE id=$3 RETURNING *",
          [req.user.id, req.body.comments || null, payment.id]
        )).rows[0];
        await recordApproval(client, { entityType: 'supplier_payment', entityId: payment.id, step: 'payment_approval',
          decision: 'rejected', user: req.user, comments: req.body.comments,
          snapshot: { voucher_number: payment.voucher_number, invoice_id: invoice.id, amount: Number(payment.amount) } });
        await audit(client, { entityType: 'supplier_payment', entityId: payment.id, action: 'reject_payment', user: req.user,
          oldValue: { status: 'pending' }, newValue: { status: 'rejected', reason: req.body.comments } });
        return rejected;
      }

      const previouslyPaid = Number((await client.query(
        "SELECT COALESCE(SUM(amount),0) AS amount FROM supplier_payments WHERE supplier_invoice_id=$1 AND status='approved' AND voided_at IS NULL",
        [invoice.id]
      )).rows[0].amount);
      if (previouslyPaid + Number(payment.amount) > Number(invoice.total_amount) + CENT)
        throw new ApiError(409, 'Approval would overpay this supplier invoice');
      const accrued = Number((await client.query(
        'SELECT COALESCE(SUM(quantity_accepted*unit_cost),0) AS amount FROM purchase_items WHERE purchase_order_id=$1',
        [invoice.purchase_order_id]
      )).rows[0].amount);
      const allPaid = Number((await client.query(
        "SELECT COALESCE(SUM(amount),0) AS amount FROM supplier_payments WHERE purchase_order_id=$1 AND status IN ('legacy','approved') AND voided_at IS NULL",
        [invoice.purchase_order_id]
      )).rows[0].amount);
      const allPending = Number((await client.query(
        "SELECT COALESCE(SUM(amount),0) AS amount FROM supplier_payments WHERE purchase_order_id=$1 AND status='pending' AND id<>$2 AND voided_at IS NULL",
        [invoice.purchase_order_id, payment.id]
      )).rows[0].amount);
      if (Number(payment.amount) > accrued - allPaid - allPending + CENT)
        throw new ApiError(409, 'Approval would exceed the accounts payable balance from accepted receipts');

      let cashAccountId;
      if (payment.method === 'cash') cashAccountId = (await getAccountByCode(client, '1000')).id;
      else if (payment.bank_account_id) {
        const bank = (await client.query('SELECT coa_account_id FROM bank_accounts WHERE id=$1', [payment.bank_account_id])).rows[0];
        if (!bank) throw new ApiError(400, 'Selected bank account was not found');
        cashAccountId = bank.coa_account_id;
      } else cashAccountId = (await getAccountByCode(client, '1010')).id;
      const apAccountId = (await getAccountByCode(client, '2000')).id;
      await postJournalEntry(client, {
        entryDate: payment.payment_date, description: 'Supplier voucher ' + payment.voucher_number + ' — ' + invoice.po_number,
        source: 'system', referenceType: 'supplier_payment', referenceId: payment.id, createdBy: req.user.id,
        lines: [
          { accountId: apAccountId, debit: Number(payment.amount), credit: 0, supplierId: invoice.supplier_id, costCenterId: invoice.cost_center_id, projectId: invoice.project_id },
          { accountId: cashAccountId, debit: 0, credit: Number(payment.amount), costCenterId: invoice.cost_center_id, projectId: invoice.project_id }
        ]
      });
      const approved = (await client.query(
        "UPDATE supplier_payments SET status='approved',approved_by=$1,approved_at=now() WHERE id=$2 RETURNING *",
        [req.user.id, payment.id]
      )).rows[0];
      const nextPaid = previouslyPaid + Number(payment.amount);
      const invoiceStatus = nextPaid + CENT >= Number(invoice.total_amount) ? 'paid' : 'partially_paid';
      await client.query('UPDATE supplier_invoices SET status=$1 WHERE id=$2', [invoiceStatus, invoice.id]);
      await recordApproval(client, { entityType: 'supplier_payment', entityId: payment.id, step: 'payment_approval',
        decision: 'approved', user: req.user, comments: req.body.comments,
        snapshot: { voucher_number: payment.voucher_number, invoice_id: invoice.id, amount: Number(payment.amount) } });
      await audit(client, { entityType: 'supplier_payment', entityId: payment.id, action: 'approve_payment', user: req.user,
        oldValue: { status: 'pending' }, newValue: { status: 'approved', invoice_status: invoiceStatus } });
      return approved;
    });
    res.json({ data: result, error: null });
  }));

module.exports = router;
