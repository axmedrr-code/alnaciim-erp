const { Router } = require('express');
const { pool, withTransaction } = require('../config/db');
const { asyncHandler, ApiError } = require('../utils/asyncHandler');
const { requireRole } = require('../middleware/auth');
const { postStockMovement } = require('../utils/stockLedger');
const { streamInvoicePdf } = require('../utils/invoicePdf');
const { validate } = require('../middleware/validate');
const schemas = require('../validation/schemas');
const { nextHno } = require('../services/hnoService');
const { logAudit } = require('../services/auditService');
const { postJournalEntry, getAccountByCode, reverseJournalEntry, resolveCostCenterId } = require('../services/accountingService');

async function resolveCashOrBankAccount(client, method, bankAccountId) {
  if (method === 'cash') return (await getAccountByCode(client, '1000')).id;
  if (bankAccountId) {
    const { rows } = await client.query('SELECT coa_account_id FROM bank_accounts WHERE id = $1', [bankAccountId]);
    if (rows[0]) return rows[0].coa_account_id;
  }
  return (await getAccountByCode(client, '1010')).id; // default bank account
}

const router = Router();

function generateOrderNumber() {
  const y = new Date().getFullYear();
  return `SO-${y}-${Math.floor(100000 + Math.random() * 900000)}`;
}

async function getOrderWithItems(id) {
  const { rows } = await pool.query(
    `SELECT so.*, c.name AS customer_name, c.address AS customer_address, c.city AS customer_city,
            c.phone AS customer_phone, c.credit_limit AS customer_credit_limit
     FROM sales_orders so JOIN customers c ON c.id = so.customer_id WHERE so.id = $1`,
    [id]
  );
  if (!rows[0]) return null;
  const order = rows[0];

  const { rows: items } = await pool.query(
    `SELECT soi.*, p.name AS product_name, p.sku, p.unit FROM sales_order_items soi JOIN products p ON p.id = soi.product_id WHERE sales_order_id = $1`,
    [id]
  );

  // Outstanding balance across ALL of this customer's orders (not just this invoice) —
  // gives the reader the full bulk-water credit picture, not just this one delivery.
  const { rows: outstandingRows } = await pool.query(
    `SELECT COALESCE(SUM(order_balance), 0) AS balance FROM (
       SELECT so.total_amount - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.sales_order_id = so.id AND p.voided_at IS NULL), 0) AS order_balance
       FROM sales_orders so WHERE so.customer_id = $1 AND so.status NOT IN ('cancelled','reversed')
     ) per_order`,
    [order.customer_id]
  );
  const { rows: paidRows } = await pool.query(
    `SELECT COALESCE(SUM(amount), 0) AS paid FROM payments WHERE sales_order_id = $1 AND voided_at IS NULL`,
    [id]
  );

  const { rows: payments } = await pool.query(
    `SELECT p.*, u.full_name AS recorded_by_name FROM payments p LEFT JOIN users u ON u.id = p.recorded_by
     WHERE p.sales_order_id = $1 ORDER BY p.id DESC`,
    [id]
  );

  return {
    ...order,
    items,
    payments,
    customer_outstanding_balance: outstandingRows[0].balance,
    amount_paid: paidRows[0].paid
  };
}

router.get('/orders', asyncHandler(async (req, res) => {
  const { status, customer_id, from, to } = req.query;
  const conditions = [];
  const params = [];
  if (status) { params.push(status); conditions.push(`so.status = $${params.length}`); }
  if (customer_id) { params.push(customer_id); conditions.push(`so.customer_id = $${params.length}`); }
  if (from) { params.push(from); conditions.push(`so.order_date >= $${params.length}`); }
  if (to) { params.push(to); conditions.push(`so.order_date <= $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows } = await pool.query(
    `SELECT so.*, c.name AS customer_name, u.full_name AS sales_rep_name
     FROM sales_orders so
     JOIN customers c ON c.id = so.customer_id
     LEFT JOIN users u ON u.id = so.sales_rep_id
     ${where} ORDER BY so.created_at DESC`,
    params
  );
  res.json({ data: rows, error: null });
}));

router.get('/orders/:id', asyncHandler(async (req, res) => {
  const order = await getOrderWithItems(req.params.id);
  if (!order) throw new ApiError(404, 'Sales order not found');
  res.json({ data: order, error: null });
}));

router.get('/orders/:id/invoice', asyncHandler(async (req, res) => {
  const order = await getOrderWithItems(req.params.id);
  if (!order) throw new ApiError(404, 'Sales order not found');
  streamInvoicePdf(res, order);
}));

// Shared by POST /orders and POST /quotations/:id/convert — a sales order is created
// exactly the same way regardless of whether it started life as a quotation, so this is
// the one place that logic lives. Cash sales settle immediately (a payment is posted in
// the same transaction, invoice opens already paid); credit sales add straight to the
// customer's open/debtor balance, subject to their credit limit (Admin can override).
async function createSalesOrderFromItems(client, {
  customerId, deliveryDate, items, discount, tax, deliveryFee, notes,
  saleType, cashPaymentMethod, costCenterIdInput, projectId, actorId, actorRole,
  customerTankId, priority
}) {
  const { rows: customerRows } = await client.query('SELECT * FROM customers WHERE id = $1', [customerId]);
  const customer = customerRows[0];
  if (!customer) throw new ApiError(404, 'Customer not found');

  const subtotal = items.reduce((sum, it) => sum + it.quantity * it.unit_price - (it.discount || 0), 0);
  const totalAmount = subtotal - (discount || 0) + (tax || 0) + (deliveryFee || 0);

  if (saleType === 'credit' && Number(customer.credit_limit) > 0 && actorRole !== 'Admin') {
    const { rows: balanceRows } = await client.query(
      `SELECT COALESCE(SUM(order_balance), 0) AS balance FROM (
         SELECT so.total_amount - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.sales_order_id = so.id AND p.voided_at IS NULL), 0) AS order_balance
         FROM sales_orders so WHERE so.customer_id = $1 AND so.status NOT IN ('cancelled','reversed')
       ) per_order`,
      [customerId]
    );
    const currentBalance = Number(balanceRows[0].balance);
    if (currentBalance + totalAmount > Number(customer.credit_limit)) {
      throw new ApiError(400, `This credit sale would put ${customer.name} at $${(currentBalance + totalAmount).toFixed(2)}, over their $${Number(customer.credit_limit).toFixed(2)} credit limit`);
    }
  }

  // Every sale belongs to a cost center — defaults to Sales unless the caller
  // (a project-billed order, say) picks a different one.
  const costCenterId = await resolveCostCenterId(client, costCenterIdInput, 'CC-SALES');

  const invoiceHno = await nextHno(client, 'invoice');
  const { rows: orderRows } = await client.query(
    `INSERT INTO sales_orders (order_number, invoice_hno, customer_id, qaade_id, sale_type, delivery_date, sales_rep_id, subtotal, discount, tax, delivery_fee, total_amount, notes, cost_center_id, project_id, customer_tank_id, priority)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
    [generateOrderNumber(), invoiceHno, customerId, customer.qaade_id, saleType, deliveryDate || null, actorId, subtotal, discount || 0, tax || 0, deliveryFee || 0, totalAmount, notes || null, costCenterId, projectId || null, customerTankId || null, priority || 'normal']
  );
  const order = orderRows[0];

  for (const it of items) {
    const lineSubtotal = it.quantity * it.unit_price - (it.discount || 0);
    await client.query(
      `INSERT INTO sales_order_items (sales_order_id, product_id, quantity, unit_price, discount, subtotal)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [order.id, it.product_id, it.quantity, it.unit_price, it.discount || 0, lineSubtotal]
    );
  }

  let finalOrder = order;
  if (saleType === 'cash' && totalAmount > 0) {
    const transactionHno = await nextHno(client, 'transaction');
    await client.query(
      `INSERT INTO payments (sales_order_id, amount, method, transaction_hno, recorded_by)
       VALUES ($1,$2,$3,$4,$5)`,
      [order.id, totalAmount, cashPaymentMethod, transactionHno, actorId]
    );
    const { rows: updated } = await client.query(
      `UPDATE sales_orders SET payment_status = 'paid' WHERE id = $1 RETURNING *`,
      [order.id]
    );
    finalOrder = updated[0];
  }

  // Cash sales settle same-moment as the sale, so the accounting entry posts right away
  // (nothing about a cash sale is ever "draft"). Credit sales, on the other hand, don't
  // touch the ledger until they're approved (see PUT /orders/:id/approve below) — that
  // deliberate gap is what makes a pending credit order genuinely safe to edit or delete.
  if (saleType === 'cash' && totalAmount > 0) {
    const revenueAcct = await getAccountByCode(client, '4000');
    const revenueAmt = subtotal - (discount || 0) + (tax || 0);
    const cashAcct = await resolveCashOrBankAccount(client, cashPaymentMethod, null);
    const journalLines = [{ accountId: cashAcct, debit: totalAmount, credit: 0, costCenterId, projectId }];
    if (revenueAmt > 0) journalLines.push({ accountId: revenueAcct.id, debit: 0, credit: revenueAmt, costCenterId, projectId });
    if (deliveryFee > 0) {
      const feeAcct = await getAccountByCode(client, '4100');
      journalLines.push({ accountId: feeAcct.id, debit: 0, credit: deliveryFee, costCenterId, projectId });
    }
    await postJournalEntry(client, {
      entryDate: finalOrder.order_date, description: `Sale ${finalOrder.invoice_hno || finalOrder.order_number}`,
      source: 'system', referenceType: 'sales_order', referenceId: order.id, createdBy: actorId, lines: journalLines
    });
  }

  await logAudit(client, { userId: actorId, action: 'CREATE', entityType: 'sales_order', entityId: order.id, newValue: finalOrder });
  return finalOrder;
}

router.post('/orders', requireRole('Admin', 'Sales Manager'), validate(schemas.salesOrderCreate), asyncHandler(async (req, res) => {
  const { customer_id, delivery_date, items, discount, tax, delivery_fee, notes, cost_center_id, project_id, customer_tank_id, priority } = req.body;
  const saleType = req.body.sale_type || 'credit';
  const cashPaymentMethod = req.body.cash_payment_method || 'cash';

  const result = await withTransaction((client) => createSalesOrderFromItems(client, {
    customerId: customer_id, deliveryDate: delivery_date, items, discount, tax, deliveryFee: delivery_fee, notes,
    saleType, cashPaymentMethod, costCenterIdInput: cost_center_id, projectId: project_id,
    actorId: req.user.id, actorRole: req.user.role, customerTankId: customer_tank_id, priority
  }));

  res.status(201).json({ data: result, error: null });
}));

// A pending CREDIT order has posted nothing to the ledger yet, so it's a genuine draft:
// freely editable (full replace of items/amounts) until it's approved.
router.put('/orders/:id', requireRole('Admin', 'Sales Manager'), validate(schemas.salesOrderUpdate), asyncHandler(async (req, res) => {
  const { customer_id, delivery_date, items, discount, tax, delivery_fee, notes, cost_center_id, project_id } = req.body;

  const result = await withTransaction(async (client) => {
    const { rows: orderRows } = await client.query('SELECT * FROM sales_orders WHERE id = $1 FOR UPDATE', [req.params.id]);
    const order = orderRows[0];
    if (!order) throw new ApiError(404, 'Sales order not found');
    if (order.status !== 'pending') throw new ApiError(409, 'Only a pending order can be edited — approved/dispatched orders are posted and locked. Use Reverse to correct them.');
    if (order.sale_type === 'cash') throw new ApiError(409, 'Cash sales settle immediately and cannot be edited. Use Reverse to correct them.');

    const custId = customer_id || order.customer_id;
    let qaadeId = order.qaade_id;
    if (customer_id) {
      const { rows: customerRows } = await client.query('SELECT * FROM customers WHERE id = $1', [customer_id]);
      if (!customerRows[0]) throw new ApiError(404, 'Customer not found');
      qaadeId = customerRows[0].qaade_id;
    }

    let subtotal = Number(order.subtotal);
    if (items) {
      await client.query('DELETE FROM sales_order_items WHERE sales_order_id = $1', [order.id]);
      subtotal = items.reduce((sum, it) => sum + it.quantity * it.unit_price - (it.discount || 0), 0);
      for (const it of items) {
        const lineSubtotal = it.quantity * it.unit_price - (it.discount || 0);
        await client.query(
          `INSERT INTO sales_order_items (sales_order_id, product_id, quantity, unit_price, discount, subtotal)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [order.id, it.product_id, it.quantity, it.unit_price, it.discount || 0, lineSubtotal]
        );
      }
    }

    const finalDiscount = discount !== undefined ? discount : Number(order.discount);
    const finalTax = tax !== undefined ? tax : Number(order.tax);
    const finalDeliveryFee = delivery_fee !== undefined ? delivery_fee : Number(order.delivery_fee);
    const totalAmount = subtotal - finalDiscount + finalTax + finalDeliveryFee;

    const { rows: updated } = await client.query(
      `UPDATE sales_orders SET customer_id = $1, qaade_id = $2, delivery_date = COALESCE($3, delivery_date),
              subtotal = $4, discount = $5, tax = $6, delivery_fee = $7, total_amount = $8, notes = COALESCE($9, notes),
              cost_center_id = COALESCE($10, cost_center_id), project_id = COALESCE($11, project_id)
       WHERE id = $12 RETURNING *`,
      [custId, qaadeId, delivery_date || null, subtotal, finalDiscount, finalTax, finalDeliveryFee, totalAmount, notes || null, cost_center_id || null, project_id || null, order.id]
    );
    await logAudit(client, { userId: req.user.id, action: 'UPDATE', entityType: 'sales_order', entityId: order.id, oldValue: order, newValue: updated[0] });
    return updated[0];
  });

  res.json({ data: result, error: null });
}));

// Draft-only hard delete — nothing has posted to the ledger for a pending credit order,
// so removing it entirely is safe. Anything past this point must go through Reverse.
router.delete('/orders/:id', requireRole('Admin', 'Sales Manager'), asyncHandler(async (req, res) => {
  const result = await withTransaction(async (client) => {
    const { rows: orderRows } = await client.query('SELECT * FROM sales_orders WHERE id = $1 FOR UPDATE', [req.params.id]);
    const order = orderRows[0];
    if (!order) throw new ApiError(404, 'Sales order not found');
    if (order.status !== 'pending' || order.sale_type === 'cash') {
      throw new ApiError(409, 'Only a pending credit order can be deleted outright. Use Reverse for posted invoices.');
    }
    await client.query('DELETE FROM sales_order_items WHERE sales_order_id = $1', [order.id]);
    await client.query('DELETE FROM sales_orders WHERE id = $1', [order.id]);
    await logAudit(client, { userId: req.user.id, action: 'DELETE', entityType: 'sales_order', entityId: order.id, oldValue: order });
    return { id: order.id };
  });
  res.json({ data: result, error: null });
}));

// Approving a CREDIT order is the moment it actually posts to the ledger (Dr Accounts
// Receivable, Cr Revenue) — this is the boundary the whole draft/posted policy hinges on.
// Cash orders posted at creation already, so approving one is just a status formality.
// Shared by PUT /orders/:id/approve and the tank-based dispatch flow (routeops.routes.js) —
// a credit order's revenue only ever posts once, at the moment it's approved, regardless
// of whether that approval happens manually here or automatically as part of dispatch.
async function postCreditApprovalRevenue(client, order, actorId) {
  if (order.sale_type !== 'credit' || Number(order.total_amount) <= 0) return;
  const arAcct = await getAccountByCode(client, '1100');
  const revenueAcct = await getAccountByCode(client, '4000');
  const revenueAmt = Number(order.subtotal) - Number(order.discount) + Number(order.tax);
  const dims = { costCenterId: order.cost_center_id, projectId: order.project_id };
  const journalLines = [{ accountId: arAcct.id, debit: Number(order.total_amount), credit: 0, customerId: order.customer_id, ...dims }];
  if (revenueAmt > 0) journalLines.push({ accountId: revenueAcct.id, debit: 0, credit: revenueAmt, ...dims });
  if (Number(order.delivery_fee) > 0) {
    const feeAcct = await getAccountByCode(client, '4100');
    journalLines.push({ accountId: feeAcct.id, debit: 0, credit: Number(order.delivery_fee), ...dims });
  }
  await postJournalEntry(client, {
    entryDate: order.order_date, description: `Sale ${order.invoice_hno || order.order_number}`,
    source: 'system', referenceType: 'sales_order', referenceId: order.id, createdBy: actorId, lines: journalLines
  });
}

router.put('/orders/:id/approve', requireRole('Admin', 'Sales Manager'), asyncHandler(async (req, res) => {
  const result = await withTransaction(async (client) => {
    const { rows: orderRows } = await client.query(
      `UPDATE sales_orders SET status = 'approved' WHERE id = $1 AND status = 'pending' RETURNING *`,
      [req.params.id]
    );
    const order = orderRows[0];
    if (!order) throw new ApiError(400, 'Order not found or not pending');

    await postCreditApprovalRevenue(client, order, req.user.id);
    await logAudit(client, { userId: req.user.id, action: 'UPDATE', entityType: 'sales_order', entityId: order.id, newValue: order });
    return order;
  });

  res.json({ data: result, error: null });
}));

// Reverse a posted invoice: posts an offsetting counter-entry against the original sale's
// journal entry (found by reference_type/reference_id) and flags the order 'reversed'. The
// original row is never touched, so the invoice's full history stays intact.
router.post('/orders/:id/reverse', requireRole('Admin', 'Sales Manager'), validate(schemas.reverseRequest), asyncHandler(async (req, res) => {
  const { reason } = req.body;

  const result = await withTransaction(async (client) => {
    const { rows: orderRows } = await client.query('SELECT * FROM sales_orders WHERE id = $1 FOR UPDATE', [req.params.id]);
    const order = orderRows[0];
    if (!order) throw new ApiError(404, 'Sales order not found');
    if (order.status === 'pending') throw new ApiError(409, 'This order has not posted to the ledger yet — delete it instead of reversing it.');
    if (order.status === 'reversed' || order.status === 'cancelled') throw new ApiError(409, `Order is already ${order.status}`);

    // A cash sale never touches Accounts Receivable — its own settlement payment is part
    // of the same journal entry being reversed here, so there's no debtor relationship to
    // protect. A credit sale's AR balance, though, must be untouched by any collections
    // before its invoice can be reversed, or the reversal would leave a phantom credit.
    if (order.sale_type === 'credit') {
      const { rows: paidRows } = await client.query(
        `SELECT COALESCE(SUM(amount), 0) AS paid FROM payments WHERE sales_order_id = $1 AND voided_at IS NULL`,
        [order.id]
      );
      if (Number(paidRows[0].paid) > 0.005) {
        throw new ApiError(409, 'This invoice has payments collected against it — reverse those payments first.');
      }
    }

    const { rows: entryRows } = await client.query(
      `SELECT id FROM journal_entries WHERE reference_type = 'sales_order' AND reference_id = $1 AND status = 'posted' ORDER BY id DESC LIMIT 1`,
      [order.id]
    );
    if (!entryRows[0]) throw new ApiError(409, 'No posted journal entry found for this order');

    await reverseJournalEntry(client, {
      entryId: entryRows[0].id, createdBy: req.user.id,
      description: `Reversal of ${order.invoice_hno || order.order_number}${reason ? ' - ' + reason : ''}`
    });

    const { rows: updated } = await client.query(
      `UPDATE sales_orders SET status = 'reversed' WHERE id = $1 RETURNING *`,
      [order.id]
    );
    await logAudit(client, { userId: req.user.id, action: 'UPDATE', entityType: 'sales_order', entityId: order.id, oldValue: order, newValue: updated[0] });
    return updated[0];
  });

  res.json({ data: result, error: null });
}));

router.put('/orders/:id/cancel', requireRole('Admin', 'Sales Manager'), asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    `UPDATE sales_orders SET status = 'cancelled' WHERE id = $1 AND status IN ('pending','approved') RETURNING *`,
    [req.params.id]
  );
  if (!rows[0]) throw new ApiError(400, 'Order not found or cannot be cancelled');
  res.json({ data: rows[0], error: null });
}));

// Dispatch: assigns truck/driver, creates a delivery, and posts stock OUT for every order line —
// UNLESS a truck_load_id is given, in which case the bulk water already left inventory when the
// tanker was loaded (see POST /sales/truck-loads), so dispatch only needs to link the delivery.
router.post('/orders/:id/dispatch', requireRole('Admin', 'Sales Manager'), validate(schemas.dispatchCreate), asyncHandler(async (req, res) => {
  const { truck_id, driver_id, warehouse_id, delivery_address, truck_load_id, customer_tank_id } = req.body;

  const result = await withTransaction(async (client) => {
    const { rows: orderRows } = await client.query('SELECT * FROM sales_orders WHERE id = $1 FOR UPDATE', [req.params.id]);
    const order = orderRows[0];
    if (!order) throw new ApiError(404, 'Sales order not found');
    if (order.status !== 'approved') throw new ApiError(400, 'Only approved orders can be dispatched');

    if (truck_load_id) {
      const { rows: loadRows } = await client.query('SELECT * FROM truck_loads WHERE id = $1', [truck_load_id]);
      if (!loadRows[0]) throw new ApiError(400, 'Truck load not found');
    } else {
      if (!warehouse_id) throw new ApiError(400, 'warehouse_id is required when dispatching without a truck load');
      const { rows: items } = await client.query('SELECT * FROM sales_order_items WHERE sales_order_id = $1', [order.id]);
      for (const item of items) {
        await postStockMovement(client, {
          productId: item.product_id, warehouseId: warehouse_id, movementType: 'OUT', quantity: item.quantity,
          referenceType: 'sales', referenceId: order.id, performedBy: req.user.id,
          notes: `Dispatched against ${order.order_number}`
        });
      }
    }

    const { rows: deliveryRows } = await client.query(
      `INSERT INTO deliveries (sales_order_id, truck_id, driver_id, dispatch_time, status, delivery_address, truck_load_id, customer_tank_id)
       VALUES ($1,$2,$3, now(), 'in_transit', $4, $5, $6) RETURNING *`,
      [order.id, truck_id, driver_id, delivery_address || null, truck_load_id || null, customer_tank_id || null]
    );

    await client.query(`UPDATE sales_orders SET status = 'dispatched' WHERE id = $1`, [order.id]);
    return deliveryRows[0];
  });

  res.status(201).json({ data: result, error: null });
}));

router.get('/deliveries', asyncHandler(async (req, res) => {
  const { status, driver_id } = req.query;
  const conditions = [];
  const params = [];
  if (status) { params.push(status); conditions.push(`d.status = $${params.length}`); }
  if (driver_id) { params.push(driver_id); conditions.push(`d.driver_id = $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `SELECT d.*, so.order_number, so.total_amount, t.plate_number, u.full_name AS driver_name,
            c.name AS customer_name, ct.tank_code, ct.location AS tank_location
     FROM deliveries d
     JOIN sales_orders so ON so.id = d.sales_order_id
     JOIN customers c ON c.id = so.customer_id
     JOIN trucks t ON t.id = d.truck_id
     JOIN users u ON u.id = d.driver_id
     LEFT JOIN customer_tanks ct ON ct.id = d.customer_tank_id
     ${where} ORDER BY d.dispatch_time DESC NULLS LAST`,
    params
  );
  res.json({ data: rows, error: null });
}));

router.put('/deliveries/:id/status', requireRole('Admin', 'Sales Manager', 'Driver'), validate(schemas.deliveryStatusUpdate), asyncHandler(async (req, res) => {
  const { status, pod_reference, last_known_lat, last_known_lng } = req.body;

  const result = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `UPDATE deliveries SET status = $1, pod_reference = COALESCE($2, pod_reference),
              last_known_lat = COALESCE($3, last_known_lat), last_known_lng = COALESCE($4, last_known_lng),
              delivery_time = CASE WHEN $1 = 'delivered' THEN now() ELSE delivery_time END
       WHERE id = $5 RETURNING *`,
      [status, pod_reference || null, last_known_lat || null, last_known_lng || null, req.params.id]
    );
    if (!rows[0]) throw new ApiError(404, 'Delivery not found');
    if (status === 'delivered') {
      await client.query(`UPDATE sales_orders SET status = 'delivered' WHERE id = $1`, [rows[0].sales_order_id]);
    }
    return rows[0];
  });

  res.json({ data: result, error: null });
}));

// Driver confirms what was actually delivered. Bulk water is invoiced on the confirmed
// quantity, not the ordered estimate, so — when the order has exactly one line item — this
// rewrites that line's quantity/subtotal and rolls the change up into the order total before
// the invoice is generated.
router.put('/deliveries/:id/confirm', requireRole('Admin', 'Sales Manager', 'Driver'), validate(schemas.deliveryConfirm), asyncHandler(async (req, res) => {
  const { quantity_delivered, signature_name, last_known_lat, last_known_lng, pod_reference } = req.body;

  const result = await withTransaction(async (client) => {
    const { rows: deliveryRows } = await client.query('SELECT * FROM deliveries WHERE id = $1 FOR UPDATE', [req.params.id]);
    const delivery = deliveryRows[0];
    if (!delivery) throw new ApiError(404, 'Delivery not found');
    if (delivery.status === 'delivered') throw new ApiError(400, 'Delivery already confirmed');

    const { rows: updatedDelivery } = await client.query(
      `UPDATE deliveries SET status = 'delivered', quantity_delivered = $1, signature_name = $2,
              confirmed_at = now(), delivery_time = now(),
              last_known_lat = COALESCE($3, last_known_lat), last_known_lng = COALESCE($4, last_known_lng),
              pod_reference = COALESCE($5, pod_reference)
       WHERE id = $6 RETURNING *`,
      [quantity_delivered, signature_name, last_known_lat || null, last_known_lng || null, pod_reference || null, delivery.id]
    );

    const { rows: items } = await client.query('SELECT * FROM sales_order_items WHERE sales_order_id = $1', [delivery.sales_order_id]);
    if (items.length === 1) {
      const item = items[0];
      const newSubtotal = quantity_delivered * Number(item.unit_price) - Number(item.discount);
      await client.query('UPDATE sales_order_items SET quantity = $1, subtotal = $2 WHERE id = $3', [quantity_delivered, newSubtotal, item.id]);

      const { rows: orderRows } = await client.query('SELECT * FROM sales_orders WHERE id = $1', [delivery.sales_order_id]);
      const order = orderRows[0];
      const newTotal = newSubtotal - Number(order.discount) + Number(order.tax) + Number(order.delivery_fee);
      await client.query(
        `UPDATE sales_orders SET status = 'delivered', subtotal = $1, total_amount = $2 WHERE id = $3`,
        [newSubtotal, newTotal, order.id]
      );
    } else {
      await client.query(`UPDATE sales_orders SET status = 'delivered' WHERE id = $1`, [delivery.sales_order_id]);
    }

    return updatedDelivery[0];
  });

  res.json({ data: result, error: null });
}));

// ---- Tanker loading ----
router.get('/truck-loads', asyncHandler(async (req, res) => {
  const { truck_id, route_date } = req.query;
  const conditions = [];
  const params = [];
  if (truck_id) { params.push(truck_id); conditions.push(`tl.truck_id = $${params.length}`); }
  if (route_date) { params.push(route_date); conditions.push(`tl.route_date = $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows } = await pool.query(
    `SELECT tl.*, t.plate_number, p.name AS product_name, p.unit, w.name AS warehouse_name, u.full_name AS loaded_by_name,
            COALESCE((SELECT SUM(d.quantity_delivered) FROM deliveries d WHERE d.truck_load_id = tl.id), 0) AS quantity_delivered,
            tl.quantity_loaded - COALESCE((SELECT SUM(d.quantity_delivered) FROM deliveries d WHERE d.truck_load_id = tl.id), 0) AS remaining_balance
     FROM truck_loads tl
     JOIN trucks t ON t.id = tl.truck_id
     JOIN products p ON p.id = tl.product_id
     JOIN warehouses w ON w.id = tl.warehouse_id
     JOIN users u ON u.id = tl.loaded_by
     ${where} ORDER BY tl.loaded_at DESC`,
    params
  );
  res.json({ data: rows, error: null });
}));

router.get('/truck-loads/:id', asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT tl.*, t.plate_number, p.name AS product_name, p.unit,
            COALESCE((SELECT SUM(d.quantity_delivered) FROM deliveries d WHERE d.truck_load_id = tl.id), 0) AS quantity_delivered,
            tl.quantity_loaded - COALESCE((SELECT SUM(d.quantity_delivered) FROM deliveries d WHERE d.truck_load_id = tl.id), 0) AS remaining_balance
     FROM truck_loads tl JOIN trucks t ON t.id = tl.truck_id JOIN products p ON p.id = tl.product_id
     WHERE tl.id = $1`,
    [req.params.id]
  );
  if (!rows[0]) throw new ApiError(404, 'Truck load not found');
  const { rows: deliveries } = await pool.query(
    `SELECT d.*, so.order_number, c.name AS customer_name, ct.tank_code
     FROM deliveries d JOIN sales_orders so ON so.id = d.sales_order_id JOIN customers c ON c.id = so.customer_id
     LEFT JOIN customer_tanks ct ON ct.id = d.customer_tank_id
     WHERE d.truck_load_id = $1 ORDER BY d.dispatch_time`,
    [req.params.id]
  );
  res.json({ data: { ...rows[0], deliveries }, error: null });
}));

const RECONCILE_REASONS = ['delivered_not_recorded', 'spillage', 'leakage', 'returned_to_warehouse', 'other'];
// Responsibility split: Warehouse (Storekeeper)/Admin OPEN a Route Session by
// loading the tanker. Data Entry/Admin are the ones who CLOSE it — counting
// physical stock after the driver returns and recording any difference.
// Neither side does the other's job: a Storekeeper who just loaded a truck
// cannot also be the one who reconciles/closes it, and Data Entry never
// touches a loading itself.
const LOADING_ROLES = ['Admin', 'Storekeeper'];
const RECONCILE_APPROVER_ROLES = ['Admin', 'Data Entry Operator'];
// Managers may look at the full session history (open/close audit trail)
// without being able to act on either side of it.
const SESSION_VIEWER_ROLES = ['Admin', 'Storekeeper', 'Data Entry Operator', 'Sales Manager', 'Route Supervisor', 'Supervisor'];

// This version's tanker loading has exactly one source: the Finished Water
// Warehouse (WH-RO-01). Production and a separate Raw Water Tank are
// deliberately not wired in yet — a future version's job — so loading is
// hard-restricted to this one warehouse/product pair rather than left open
// to whatever the client sends.
async function assertFinishedWaterSource(client, { productId, warehouseId }) {
  const { rows: whRows } = await client.query(`SELECT id, name FROM warehouses WHERE code = 'WH-RO-01'`);
  const finishedWaterWarehouse = whRows[0];
  if (!finishedWaterWarehouse || Number(warehouseId) !== finishedWaterWarehouse.id) {
    throw new ApiError(400, `Tanker loading can only draw from the ${finishedWaterWarehouse?.name || 'Finished Water Warehouse'}.`);
  }
  const { rows: prodRows } = await client.query(
    `SELECT 1 FROM products p JOIN categories c ON c.id = p.category_id WHERE p.id = $1 AND c.name = 'Bulk Water'`,
    [productId]
  );
  if (!prodRows[0]) throw new ApiError(400, 'Tanker loading is only for the Bulk Water product.');
}

// A truck's last CLOSED load can still have physical water left on it — Data
// Entry's reconciliation records the true actual_remaining even when it
// isn't zero (e.g. the truck is closed out for the day without being fully
// emptied). That leftover is real stock sitting on the truck right now, not
// anything the warehouse still has — so opening tomorrow's Route Session
// against it must never touch warehouse inventory again.
async function existingTruckStock(client, truckId) {
  const { rows: lastLoadRows } = await client.query(
    `SELECT id, status FROM truck_loads WHERE truck_id = $1 ORDER BY loaded_at DESC LIMIT 1`,
    [truckId]
  );
  const lastLoad = lastLoadRows[0];
  if (!lastLoad || lastLoad.status === 'loaded') return 0; // no history, or already active — not this code path's concern
  const { rows: reconRows } = await client.query(
    `SELECT actual_remaining FROM stock_reconciliations WHERE truck_load_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [lastLoad.id]
  );
  return reconRows[0] ? Number(reconRows[0].actual_remaining) : 0;
}

// Two, and only two, valid ways to open a Route Session:
//   1. New Loading (quantity_loaded > 0) — deducts that amount from the
//      Finished Water Warehouse immediately, same as before.
//   2. Existing Truck Stock (quantity_loaded omitted/0) — only when the
//      truck's last closed session left real water still on it; the new
//      session simply starts from that same figure, no warehouse movement
//      at all, since nothing new left the warehouse.
// A truck may have only one active ('loaded') load at a time, and — if that
// load still has water remaining in the system — it cannot be loaded again
// until that remaining stock is reconciled against what's physically in the
// tank (see POST /truck-loads/:id/reconcile). idx_truck_loads_one_active_per_truck
// backs the one-active-load rule at the database level too, so even a race
// between two requests can't create a second one.
router.post('/truck-loads', requireRole(...LOADING_ROLES), validate(schemas.truckLoadCreate), asyncHandler(async (req, res) => {
  const { truck_id, product_id, warehouse_id, notes } = req.body;
  const quantityLoaded = Number(req.body.quantity_loaded || 0);

  const result = await withTransaction(async (client) => {
    await assertFinishedWaterSource(client, { productId: product_id, warehouseId: warehouse_id });

    const { rows: activeRows } = await client.query(
      `SELECT * FROM truck_loads WHERE truck_id = $1 AND status = 'loaded' FOR UPDATE`,
      [truck_id]
    );
    const active = activeRows[0];
    if (active) {
      const remaining = Number(active.quantity_loaded) - Number(active.delivered_liters);
      if (remaining > 0) {
        throw new ApiError(409, `This truck still has ${remaining.toLocaleString()} L remaining. Please reconcile the remaining water before loading again.`);
      }
      throw new ApiError(409, `This truck already has an active loading. Complete or cancel it before loading again.`);
    }

    let sessionQuantity = quantityLoaded;
    let usedExistingStock = false;

    if (quantityLoaded <= 0) {
      const existing = await existingTruckStock(client, truck_id);
      if (existing <= 0) {
        throw new ApiError(400, 'Cannot open Route Session. Load water first or use a truck with existing remaining stock.');
      }
      sessionQuantity = existing;
      usedExistingStock = true;
    }

    const { rows } = await client.query(
      `INSERT INTO truck_loads (truck_id, product_id, warehouse_id, quantity_loaded, loaded_by, notes)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [truck_id, product_id, warehouse_id, sessionQuantity, req.user.id, notes || null]
    );
    const load = rows[0];

    if (!usedExistingStock) {
      await postStockMovement(client, {
        productId: product_id, warehouseId: warehouse_id, movementType: 'OUT', quantity: sessionQuantity,
        referenceType: 'tanker_load', referenceId: load.id, performedBy: req.user.id,
        notes: `Loaded onto truck #${truck_id}`
      });
    }

    return {
      load,
      message: usedExistingStock
        ? `Opening Route Session using existing truck stock (${sessionQuantity.toLocaleString()} L).`
        : null
    };
  });

  res.status(201).json({ data: result.load, message: result.message, error: null });
}));

// Reconcile — the mandatory gate between one trip and the next tanker loading.
// Option 1 (physical matches system): actual_remaining == previous_remaining, no
// reason needed. Option 2 (mismatch, e.g. truck physically empty): a reason is
// required, plus a note when the reason is "Other". Either way this is the only
// path that closes an active load that still has stock outstanding — a plain
// Complete is refused for that case (see below) so the adjustment is never
// skipped. The reconciliation record itself is the permanent audit trail
// (previous/actual/difference/reason/note/user/timestamp); after it's written,
// the load's own delivered_liters is adjusted so Remaining becomes exactly
// actual_remaining, and status flips to completed — freeing the truck for its
// next loading.
router.post('/truck-loads/:id/reconcile', requireRole(...RECONCILE_APPROVER_ROLES), asyncHandler(async (req, res) => {
  const { actual_remaining, reason, note } = req.body;
  if (actual_remaining === undefined || actual_remaining === null || actual_remaining === '') {
    throw new ApiError(400, 'Actual Remaining is required');
  }

  const result = await withTransaction(async (client) => {
    const { rows: loadRows } = await client.query(
      `SELECT * FROM truck_loads WHERE id = $1 AND status = 'loaded' FOR UPDATE`,
      [req.params.id]
    );
    const load = loadRows[0];
    if (!load) throw new ApiError(404, 'No active loading found with that id');

    const previousRemaining = Number(load.quantity_loaded) - Number(load.delivered_liters);
    const actualRemaining = Number(actual_remaining);
    if (actualRemaining < 0) throw new ApiError(400, 'Actual Remaining cannot be negative');
    const difference = actualRemaining - previousRemaining;

    if (difference !== 0) {
      if (!reason) throw new ApiError(400, 'A reason is required when the physical stock does not match the system');
      if (!RECONCILE_REASONS.includes(reason)) throw new ApiError(400, `Reason must be one of: ${RECONCILE_REASONS.join(', ')}`);
      if (reason === 'other' && !note?.trim()) throw new ApiError(400, 'A note is required when the reason is "Other"');
    }

    const { rows: reconRows } = await client.query(
      `INSERT INTO stock_reconciliations (truck_id, truck_load_id, previous_remaining, actual_remaining, difference, reason, note, warehouse_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [load.truck_id, load.id, previousRemaining, actualRemaining, difference, difference !== 0 ? reason : null, note || null, req.user.id]
    );

    const newDeliveredLiters = Number(load.quantity_loaded) - actualRemaining;
    const { rows: updatedLoadRows } = await client.query(
      `UPDATE truck_loads SET delivered_liters = $1, status = 'completed', completed_at = now() WHERE id = $2 RETURNING *`,
      [newDeliveredLiters, load.id]
    );

    await logAudit(client, {
      userId: req.user.id, action: 'CREATE', entityType: 'stock_reconciliation', entityId: reconRows[0].id, newValue: reconRows[0]
    });

    return { reconciliation: reconRows[0], load: updatedLoadRows[0] };
  });

  res.status(201).json({ data: result, error: null });
}));

// Adjustment history — Managers (and Warehouse) may view it, but only
// Admin/Data Entry ever create an entry (enforced above, not here).
router.get('/stock-reconciliations', requireRole(...SESSION_VIEWER_ROLES), asyncHandler(async (req, res) => {
  const { truck_id } = req.query;
  const conditions = [];
  const params = [];
  if (truck_id) { params.push(truck_id); conditions.push(`sr.truck_id = $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows } = await pool.query(
    `SELECT sr.*, t.plate_number, u.full_name AS warehouse_user_name
     FROM stock_reconciliations sr
     JOIN trucks t ON t.id = sr.truck_id
     JOIN users u ON u.id = sr.warehouse_user_id
     ${where} ORDER BY sr.created_at DESC`,
    params
  );
  res.json({ data: rows, error: null });
}));

// Route Session audit log — one row per truck_loads record (every "open a
// truck with water" cycle from Load Tanker through to Close), showing exactly
// who opened it, who closed it, and what the numbers were. A session with no
// matching stock_reconciliations row was closed by fully selling out (or is
// still active) rather than through an explicit adjustment — closed_by/
// adjustment fields are simply null in that case, never fabricated.
router.get('/route-sessions', requireRole(...SESSION_VIEWER_ROLES), asyncHandler(async (req, res) => {
  const { truck_id } = req.query;
  const conditions = [];
  const params = [];
  if (truck_id) { params.push(truck_id); conditions.push(`tl.truck_id = $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows } = await pool.query(
    `SELECT tl.id, tl.status, tl.loaded_at, tl.completed_at,
            t.plate_number,
            driver.full_name AS driver_name,
            opener.full_name AS opened_by_name,
            closer.full_name AS closed_by_name,
            tl.quantity_loaded AS loaded_liters,
            tl.delivered_liters,
            (tl.quantity_loaded - tl.delivered_liters) AS remaining_liters,
            sr.actual_remaining, sr.difference, sr.reason, sr.note
     FROM truck_loads tl
     JOIN trucks t ON t.id = tl.truck_id
     LEFT JOIN users driver ON driver.id = t.assigned_driver_id
     JOIN users opener ON opener.id = tl.loaded_by
     LEFT JOIN stock_reconciliations sr ON sr.truck_load_id = tl.id
     LEFT JOIN users closer ON closer.id = sr.warehouse_user_id
     ${where} ORDER BY tl.loaded_at DESC`,
    params
  );
  res.json({ data: rows, error: null });
}));

// Complete — closing a Route Session that's already fully accounted for
// (remaining <= 0). Same closer as Reconcile: Data Entry/Admin, never
// Warehouse/Storekeeper — closing is not the loading team's job.
router.post('/truck-loads/:id/complete', requireRole(...RECONCILE_APPROVER_ROLES), asyncHandler(async (req, res) => {
  const result = await withTransaction(async (client) => {
    const { rows: loadRows } = await client.query(`SELECT * FROM truck_loads WHERE id = $1 AND status = 'loaded' FOR UPDATE`, [req.params.id]);
    const load = loadRows[0];
    if (!load) throw new ApiError(404, 'No active loading found with that id');
    const remaining = Number(load.quantity_loaded) - Number(load.delivered_liters);
    if (remaining > 0) {
      throw new ApiError(400, `This truck still has ${remaining.toLocaleString()} L remaining. Use Reconcile Stock instead of Complete.`);
    }
    const { rows } = await client.query(
      `UPDATE truck_loads SET status = 'completed', completed_at = now() WHERE id = $1 RETURNING *`,
      [load.id]
    );
    return rows[0];
  });
  res.json({ data: result, error: null });
}));

// Cancel — the load was recorded in error or the tanker never actually left with
// this water. This is undoing the loading team's own mistake, so it belongs to
// the same roles that can open a Route Session, not the ones who close it.
router.post('/truck-loads/:id/cancel', requireRole(...LOADING_ROLES), asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    `UPDATE truck_loads SET status = 'cancelled', completed_at = now() WHERE id = $1 AND status = 'loaded' RETURNING *`,
    [req.params.id]
  );
  if (!rows[0]) throw new ApiError(404, 'No active loading found with that id');
  res.json({ data: rows[0], error: null });
}));

// "Payment receiving" — the legacy debtor-collection workflow: apply a payment against
// an outstanding (credit-sale) invoice and roll the order's payment status forward.
router.post('/orders/:id/payments', requireRole('Admin', 'Sales Manager', 'Finance Officer'), validate(schemas.paymentCreate), asyncHandler(async (req, res) => {
  const { amount, method, reference_number, payment_date, bank_account_id } = req.body;

  const result = await withTransaction(async (client) => {
    const { rows: orderRows } = await client.query('SELECT * FROM sales_orders WHERE id = $1', [req.params.id]);
    if (!orderRows[0]) throw new ApiError(404, 'Sales order not found');
    const order = orderRows[0];
    if (order.status === 'pending') throw new ApiError(409, 'This order has not been approved yet, so it has no outstanding balance to collect against.');
    if (order.status === 'reversed' || order.status === 'cancelled') throw new ApiError(409, `Order is ${order.status} — no balance to collect against.`);

    const transactionHno = await nextHno(client, 'transaction');
    const { rows: payRows } = await client.query(
      `INSERT INTO payments (sales_order_id, amount, payment_date, method, reference_number, transaction_hno, recorded_by, bank_account_id)
       VALUES ($1,$2,COALESCE($3, CURRENT_DATE),$4,$5,$6,$7,$8) RETURNING *`,
      [req.params.id, amount, payment_date || null, method, reference_number || null, transactionHno, req.user.id, bank_account_id || null]
    );
    const payment = payRows[0];

    const { rows: totals } = await client.query(
      `SELECT so.total_amount, COALESCE(SUM(p.amount), 0) AS paid
       FROM sales_orders so LEFT JOIN payments p ON p.sales_order_id = so.id AND p.voided_at IS NULL
       WHERE so.id = $1 GROUP BY so.total_amount`,
      [req.params.id]
    );
    const { total_amount, paid } = totals[0];
    const paymentStatus = Number(paid) >= Number(total_amount) ? 'paid' : Number(paid) > 0 ? 'partial' : 'unpaid';
    await client.query(`UPDATE sales_orders SET payment_status = $1 WHERE id = $2`, [paymentStatus, req.params.id]);

    // Collections against a credit sale clear Accounts Receivable — the invoice itself
    // posted the AR debit when the order was approved (see PUT /orders/:id/approve above).
    const arAcct = await getAccountByCode(client, '1100');
    const cashOrBankAcct = await resolveCashOrBankAccount(client, method, bank_account_id);
    await postJournalEntry(client, {
      entryDate: payment.payment_date, description: `Payment ${payment.transaction_hno} - ${order.order_number}`,
      source: 'system', referenceType: 'payment', referenceId: payment.id, createdBy: req.user.id,
      lines: [
        { accountId: cashOrBankAcct, debit: amount, credit: 0, costCenterId: order.cost_center_id, projectId: order.project_id },
        { accountId: arAcct.id, debit: 0, credit: amount, customerId: order.customer_id, costCenterId: order.cost_center_id, projectId: order.project_id }
      ]
    });

    await logAudit(client, { userId: req.user.id, action: 'CREATE', entityType: 'payment', entityId: payment.id, newValue: payment });
    return payment;
  });

  res.status(201).json({ data: result, error: null });
}));

// Reverse a collected payment: posts an offsetting entry that reinstates the receivable
// (Dr AR, Cr Cash/Bank), voids the payment (excluded from every balance calc from then on),
// and rolls the order's payment_status back to reflect the now-smaller amount collected.
router.post('/orders/:orderId/payments/:paymentId/reverse', requireRole('Admin', 'Sales Manager', 'Finance Officer'), validate(schemas.reverseRequest), asyncHandler(async (req, res) => {
  const { reason } = req.body;

  const result = await withTransaction(async (client) => {
    const { rows: payRows } = await client.query(
      'SELECT * FROM payments WHERE id = $1 AND sales_order_id = $2 FOR UPDATE', [req.params.paymentId, req.params.orderId]
    );
    const payment = payRows[0];
    if (!payment) throw new ApiError(404, 'Payment not found');
    if (payment.voided_at) throw new ApiError(409, 'This payment has already been reversed');

    const { rows: entryRows } = await client.query(
      `SELECT id FROM journal_entries WHERE reference_type = 'payment' AND reference_id = $1 AND status = 'posted' ORDER BY id DESC LIMIT 1`,
      [payment.id]
    );
    if (!entryRows[0]) throw new ApiError(409, 'No posted journal entry found for this payment');

    await reverseJournalEntry(client, {
      entryId: entryRows[0].id, createdBy: req.user.id,
      description: `Reversal of payment ${payment.transaction_hno || payment.id}${reason ? ' - ' + reason : ''}`
    });

    const { rows: voided } = await client.query(
      `UPDATE payments SET voided_at = now(), voided_by = $1, void_reason = $2 WHERE id = $3 RETURNING *`,
      [req.user.id, reason || null, payment.id]
    );

    const { rows: totals } = await client.query(
      `SELECT so.total_amount, COALESCE(SUM(p.amount), 0) AS paid
       FROM sales_orders so LEFT JOIN payments p ON p.sales_order_id = so.id AND p.voided_at IS NULL
       WHERE so.id = $1 GROUP BY so.total_amount`,
      [req.params.orderId]
    );
    const { total_amount, paid } = totals[0];
    const paymentStatus = Number(paid) >= Number(total_amount) ? 'paid' : Number(paid) > 0 ? 'partial' : 'unpaid';
    await client.query(`UPDATE sales_orders SET payment_status = $1 WHERE id = $2`, [paymentStatus, req.params.orderId]);

    await logAudit(client, { userId: req.user.id, action: 'UPDATE', entityType: 'payment', entityId: payment.id, oldValue: payment, newValue: voided[0] });
    return voided[0];
  });

  res.json({ data: result, error: null });
}));

// ---- Quotations: the pre-Sales-Order step. Never touches the ledger — only the
// sales order created by /convert does. Mirrors the sales-order draft/edit/delete
// pattern (freely editable while 'draft', locked once sent to the customer). ----

function generateQuoteNumber() {
  const y = new Date().getFullYear();
  return `QUO-${y}-${Math.floor(100000 + Math.random() * 900000)}`;
}

async function getQuotationWithItems(id) {
  const { rows } = await pool.query(
    `SELECT q.*, c.name AS customer_name, u.full_name AS sales_rep_name
     FROM quotations q JOIN customers c ON c.id = q.customer_id LEFT JOIN users u ON u.id = q.sales_rep_id
     WHERE q.id = $1`,
    [id]
  );
  if (!rows[0]) return null;
  const { rows: items } = await pool.query(
    `SELECT qi.*, p.name AS product_name, p.sku, p.unit FROM quotation_items qi JOIN products p ON p.id = qi.product_id WHERE quotation_id = $1`,
    [id]
  );
  return { ...rows[0], items };
}

router.get('/quotations', asyncHandler(async (req, res) => {
  const { status, customer_id } = req.query;
  const conditions = [];
  const params = [];
  if (status) { params.push(status); conditions.push(`q.status = $${params.length}`); }
  if (customer_id) { params.push(customer_id); conditions.push(`q.customer_id = $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `SELECT q.*, c.name AS customer_name, u.full_name AS sales_rep_name
     FROM quotations q JOIN customers c ON c.id = q.customer_id LEFT JOIN users u ON u.id = q.sales_rep_id
     ${where} ORDER BY q.created_at DESC`,
    params
  );
  res.json({ data: rows, error: null });
}));

router.get('/quotations/:id', asyncHandler(async (req, res) => {
  const quotation = await getQuotationWithItems(req.params.id);
  if (!quotation) throw new ApiError(404, 'Quotation not found');
  res.json({ data: quotation, error: null });
}));

router.post('/quotations', requireRole('Admin', 'Sales Manager'), validate(schemas.quotationCreate), asyncHandler(async (req, res) => {
  const { customer_id, valid_until, items, discount, tax, notes } = req.body;

  const result = await withTransaction(async (client) => {
    const { rows: customerRows } = await client.query('SELECT * FROM customers WHERE id = $1', [customer_id]);
    if (!customerRows[0]) throw new ApiError(404, 'Customer not found');

    const subtotal = items.reduce((sum, it) => sum + it.quantity * it.unit_price - (it.discount || 0), 0);
    const totalAmount = subtotal - (discount || 0) + (tax || 0);
    const costCenterId = await resolveCostCenterId(client, req.body.cost_center_id, 'CC-SALES');

    const { rows: quoteRows } = await client.query(
      `INSERT INTO quotations (quote_number, customer_id, valid_until, sales_rep_id, subtotal, discount, tax, total_amount, notes, cost_center_id, project_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [generateQuoteNumber(), customer_id, valid_until || null, req.user.id, subtotal, discount || 0, tax || 0, totalAmount, notes || null, costCenterId, req.body.project_id || null, req.user.id]
    );
    const quotation = quoteRows[0];

    for (const it of items) {
      const lineSubtotal = it.quantity * it.unit_price - (it.discount || 0);
      await client.query(
        `INSERT INTO quotation_items (quotation_id, product_id, quantity, unit_price, discount, subtotal)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [quotation.id, it.product_id, it.quantity, it.unit_price, it.discount || 0, lineSubtotal]
      );
    }

    await logAudit(client, { userId: req.user.id, action: 'CREATE', entityType: 'quotation', entityId: quotation.id, newValue: quotation });
    return quotation;
  });

  res.status(201).json({ data: result, error: null });
}));

router.put('/quotations/:id', requireRole('Admin', 'Sales Manager'), validate(schemas.quotationUpdate), asyncHandler(async (req, res) => {
  const { customer_id, valid_until, items, discount, tax, notes, cost_center_id, project_id } = req.body;

  const result = await withTransaction(async (client) => {
    const { rows: quoteRows } = await client.query('SELECT * FROM quotations WHERE id = $1 FOR UPDATE', [req.params.id]);
    const quotation = quoteRows[0];
    if (!quotation) throw new ApiError(404, 'Quotation not found');
    if (quotation.status !== 'draft') throw new ApiError(409, 'Only a draft quotation can be edited.');

    let subtotal = Number(quotation.subtotal);
    if (items) {
      await client.query('DELETE FROM quotation_items WHERE quotation_id = $1', [quotation.id]);
      subtotal = items.reduce((sum, it) => sum + it.quantity * it.unit_price - (it.discount || 0), 0);
      for (const it of items) {
        const lineSubtotal = it.quantity * it.unit_price - (it.discount || 0);
        await client.query(
          `INSERT INTO quotation_items (quotation_id, product_id, quantity, unit_price, discount, subtotal) VALUES ($1,$2,$3,$4,$5,$6)`,
          [quotation.id, it.product_id, it.quantity, it.unit_price, it.discount || 0, lineSubtotal]
        );
      }
    }

    const finalDiscount = discount !== undefined ? discount : Number(quotation.discount);
    const finalTax = tax !== undefined ? tax : Number(quotation.tax);
    const totalAmount = subtotal - finalDiscount + finalTax;

    const { rows: updated } = await client.query(
      `UPDATE quotations SET customer_id = COALESCE($1, customer_id), valid_until = COALESCE($2, valid_until),
              subtotal = $3, discount = $4, tax = $5, total_amount = $6, notes = COALESCE($7, notes),
              cost_center_id = COALESCE($8, cost_center_id), project_id = COALESCE($9, project_id)
       WHERE id = $10 RETURNING *`,
      [customer_id || null, valid_until || null, subtotal, finalDiscount, finalTax, totalAmount, notes || null, cost_center_id || null, project_id || null, quotation.id]
    );
    await logAudit(client, { userId: req.user.id, action: 'UPDATE', entityType: 'quotation', entityId: quotation.id, oldValue: quotation, newValue: updated[0] });
    return updated[0];
  });

  res.json({ data: result, error: null });
}));

router.delete('/quotations/:id', requireRole('Admin', 'Sales Manager'), asyncHandler(async (req, res) => {
  const result = await withTransaction(async (client) => {
    const { rows: quoteRows } = await client.query('SELECT * FROM quotations WHERE id = $1 FOR UPDATE', [req.params.id]);
    const quotation = quoteRows[0];
    if (!quotation) throw new ApiError(404, 'Quotation not found');
    if (quotation.status !== 'draft') throw new ApiError(409, 'Only a draft quotation can be deleted.');
    await client.query('DELETE FROM quotation_items WHERE quotation_id = $1', [quotation.id]);
    await client.query('DELETE FROM quotations WHERE id = $1', [quotation.id]);
    await logAudit(client, { userId: req.user.id, action: 'DELETE', entityType: 'quotation', entityId: quotation.id, oldValue: quotation });
    return { id: quotation.id };
  });
  res.json({ data: result, error: null });
}));

router.put('/quotations/:id/send', requireRole('Admin', 'Sales Manager'), asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    `UPDATE quotations SET status = 'sent' WHERE id = $1 AND status = 'draft' RETURNING *`, [req.params.id]
  );
  if (!rows[0]) throw new ApiError(400, 'Quotation not found or not a draft');
  res.json({ data: rows[0], error: null });
}));

router.put('/quotations/:id/reject', requireRole('Admin', 'Sales Manager'), asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    `UPDATE quotations SET status = 'rejected' WHERE id = $1 AND status IN ('draft','sent') RETURNING *`, [req.params.id]
  );
  if (!rows[0]) throw new ApiError(400, 'Quotation not found or already resolved');
  res.json({ data: rows[0], error: null });
}));

router.put('/quotations/:id/accept', requireRole('Admin', 'Sales Manager'), asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    `UPDATE quotations SET status = 'accepted' WHERE id = $1 AND status = 'sent' RETURNING *`, [req.params.id]
  );
  if (!rows[0]) throw new ApiError(400, 'Quotation not found or not sent');
  res.json({ data: rows[0], error: null });
}));

// Converts an accepted (or still-draft, for a fast in-person sale) quotation into a real
// sales order via the exact same creation path /orders uses — a quotation itself never
// posts to the ledger, only the resulting order does.
router.post('/quotations/:id/convert', requireRole('Admin', 'Sales Manager'), validate(schemas.quotationConvert), asyncHandler(async (req, res) => {
  const saleType = req.body.sale_type || 'credit';
  const cashPaymentMethod = req.body.cash_payment_method || 'cash';

  const result = await withTransaction(async (client) => {
    const { rows: quoteRows } = await client.query('SELECT * FROM quotations WHERE id = $1 FOR UPDATE', [req.params.id]);
    const quotation = quoteRows[0];
    if (!quotation) throw new ApiError(404, 'Quotation not found');
    if (quotation.status === 'converted') throw new ApiError(409, 'This quotation has already been converted');
    if (['rejected', 'expired'].includes(quotation.status)) throw new ApiError(409, `A ${quotation.status} quotation cannot be converted`);

    const { rows: items } = await client.query(
      `SELECT product_id, quantity, unit_price, discount FROM quotation_items WHERE quotation_id = $1`, [quotation.id]
    );

    const order = await createSalesOrderFromItems(client, {
      customerId: quotation.customer_id, deliveryDate: req.body.delivery_date, items,
      discount: Number(quotation.discount), tax: Number(quotation.tax), deliveryFee: 0,
      notes: `Converted from ${quotation.quote_number}`,
      saleType, cashPaymentMethod, costCenterIdInput: quotation.cost_center_id, projectId: quotation.project_id,
      actorId: req.user.id, actorRole: req.user.role
    });

    const { rows: updatedQuote } = await client.query(
      `UPDATE quotations SET status = 'converted', converted_sales_order_id = $1 WHERE id = $2 RETURNING *`,
      [order.id, quotation.id]
    );
    await logAudit(client, { userId: req.user.id, action: 'UPDATE', entityType: 'quotation', entityId: quotation.id, oldValue: quotation, newValue: updatedQuote[0] });

    return { quotation: updatedQuote[0], order };
  });

  res.status(201).json({ data: result, error: null });
}));

module.exports = router;
// Reused by routeops.routes.js's tank-based dispatch flow, which creates and
// approves a sales order in the same atomic action as building/dispatching the route.
module.exports.createSalesOrderFromItems = createSalesOrderFromItems;
module.exports.postCreditApprovalRevenue = postCreditApprovalRevenue;
module.exports.generateOrderNumber = generateOrderNumber;
