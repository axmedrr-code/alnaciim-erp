const { Router } = require('express');
const { pool, withTransaction } = require('../config/db');
const { asyncHandler, ApiError } = require('../utils/asyncHandler');
const { requireRole } = require('../middleware/auth');
const { postStockMovement } = require('../utils/stockLedger');
const { validate } = require('../middleware/validate');
const schemas = require('../validation/schemas');
const { postJournalEntry, getAccountByCode, reverseJournalEntry, resolveCostCenterId } = require('../services/accountingService');
const { logAudit } = require('../services/auditService');

const router = Router();

const INVENTORY_ACCOUNT_CODE = { raw_material: '1200', finished_good: '1210', spare_part: '1220' };

function generatePoNumber() {
  const y = new Date().getFullYear();
  return `PO-${y}-${Math.floor(100000 + Math.random() * 900000)}`;
}

router.get('/purchase-orders', asyncHandler(async (req, res) => {
  const { status, supplier_id } = req.query;
  const conditions = [];
  const params = [];
  if (status) { params.push(status); conditions.push(`po.status = $${params.length}`); }
  if (supplier_id) { params.push(supplier_id); conditions.push(`po.supplier_id = $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `SELECT po.*, s.name AS supplier_name FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id
     ${where} ORDER BY po.created_at DESC`,
    params
  );
  res.json({ data: rows, error: null });
}));

router.get('/purchase-orders/:id', asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT po.*, s.name AS supplier_name FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id WHERE po.id = $1`,
    [req.params.id]
  );
  if (!rows[0]) throw new ApiError(404, 'Purchase order not found');
  const { rows: items } = await pool.query(
    `SELECT pi.*, p.name AS product_name, p.sku FROM purchase_items pi JOIN products p ON p.id = pi.product_id WHERE purchase_order_id = $1`,
    [req.params.id]
  );
  res.json({ data: { ...rows[0], items }, error: null });
}));

router.post('/purchase-orders', requireRole('Admin', 'Procurement Officer'), validate(schemas.purchaseOrderCreate), asyncHandler(async (req, res) => {
  const { supplier_id, expected_date, items, notes } = req.body;

  const result = await withTransaction(async (client) => {
    const totalAmount = items.reduce((sum, it) => sum + it.quantity_ordered * it.unit_cost, 0);
    const costCenterId = await resolveCostCenterId(client, req.body.cost_center_id, 'CC-PROC');
    const projectId = req.body.project_id || null;
    const { rows: poRows } = await client.query(
      `INSERT INTO purchase_orders (po_number, supplier_id, expected_date, status, total_amount, created_by, notes, cost_center_id, project_id)
       VALUES ($1,$2,$3,'sent',$4,$5,$6,$7,$8) RETURNING *`,
      [generatePoNumber(), supplier_id, expected_date || null, totalAmount, req.user.id, notes || null, costCenterId, projectId]
    );
    const po = poRows[0];
    for (const it of items) {
      await client.query(
        `INSERT INTO purchase_items (purchase_order_id, product_id, quantity_ordered, unit_cost, subtotal)
         VALUES ($1,$2,$3,$4,$5)`,
        [po.id, it.product_id, it.quantity_ordered, it.unit_cost, it.quantity_ordered * it.unit_cost]
      );
    }
    return po;
  });

  res.status(201).json({ data: result, error: null });
}));

// A PO with nothing received yet has posted nothing to the ledger, so it's a genuine
// draft: freely editable (full replace of items) until the first receipt.
router.put('/purchase-orders/:id', requireRole('Admin', 'Procurement Officer'), validate(schemas.purchaseOrderUpdate), asyncHandler(async (req, res) => {
  const { supplier_id, expected_date, items, notes, cost_center_id, project_id } = req.body;

  const result = await withTransaction(async (client) => {
    const { rows: poRows } = await client.query('SELECT * FROM purchase_orders WHERE id = $1 FOR UPDATE', [req.params.id]);
    const po = poRows[0];
    if (!po) throw new ApiError(404, 'Purchase order not found');
    if (!['draft', 'sent'].includes(po.status)) {
      throw new ApiError(409, 'Only a PO with nothing received yet can be edited. Use Reverse to correct a received PO.');
    }

    let totalAmount = Number(po.total_amount);
    if (items) {
      await client.query('DELETE FROM purchase_items WHERE purchase_order_id = $1', [po.id]);
      totalAmount = items.reduce((sum, it) => sum + it.quantity_ordered * it.unit_cost, 0);
      for (const it of items) {
        await client.query(
          `INSERT INTO purchase_items (purchase_order_id, product_id, quantity_ordered, unit_cost, subtotal)
           VALUES ($1,$2,$3,$4,$5)`,
          [po.id, it.product_id, it.quantity_ordered, it.unit_cost, it.quantity_ordered * it.unit_cost]
        );
      }
    }

    const { rows: updated } = await client.query(
      `UPDATE purchase_orders SET supplier_id = COALESCE($1, supplier_id), expected_date = COALESCE($2, expected_date),
              total_amount = $3, notes = COALESCE($4, notes),
              cost_center_id = COALESCE($5, cost_center_id), project_id = COALESCE($6, project_id)
       WHERE id = $7 RETURNING *`,
      [supplier_id || null, expected_date || null, totalAmount, notes || null, cost_center_id || null, project_id || null, po.id]
    );
    await logAudit(client, { userId: req.user.id, action: 'UPDATE', entityType: 'purchase_order', entityId: po.id, oldValue: po, newValue: updated[0] });
    return updated[0];
  });

  res.json({ data: result, error: null });
}));

// Draft-only hard delete — nothing has posted to the ledger until goods are received.
router.delete('/purchase-orders/:id', requireRole('Admin', 'Procurement Officer'), asyncHandler(async (req, res) => {
  const result = await withTransaction(async (client) => {
    const { rows: poRows } = await client.query('SELECT * FROM purchase_orders WHERE id = $1 FOR UPDATE', [req.params.id]);
    const po = poRows[0];
    if (!po) throw new ApiError(404, 'Purchase order not found');
    if (!['draft', 'sent'].includes(po.status)) {
      throw new ApiError(409, 'Only a PO with nothing received yet can be deleted outright. Use Reverse for a received PO.');
    }
    await client.query('DELETE FROM purchase_items WHERE purchase_order_id = $1', [po.id]);
    await client.query('DELETE FROM purchase_orders WHERE id = $1', [po.id]);
    await logAudit(client, { userId: req.user.id, action: 'DELETE', entityType: 'purchase_order', entityId: po.id, oldValue: po });
    return { id: po.id };
  });
  res.json({ data: result, error: null });
}));

// Receiving: records goods_receipts/items, bumps purchase_items.quantity_received,
// posts stock IN, and rolls the PO status to partially_received or received.
router.post('/purchase-orders/:id/receive', requireRole('Admin', 'Procurement Officer', 'Storekeeper'), validate(schemas.purchaseOrderReceive), asyncHandler(async (req, res) => {
  const { items, warehouse_id, notes } = req.body; // items: [{ purchase_item_id, quantity_received, condition }]

  const result = await withTransaction(async (client) => {
    const { rows: poRows } = await client.query('SELECT * FROM purchase_orders WHERE id = $1 FOR UPDATE', [req.params.id]);
    const po = poRows[0];
    if (!po) throw new ApiError(404, 'Purchase order not found');

    const { rows: receiptRows } = await client.query(
      `INSERT INTO goods_receipts (purchase_order_id, received_by, warehouse_id, notes) VALUES ($1,$2,$3,$4) RETURNING *`,
      [po.id, req.user.id, warehouse_id, notes || null]
    );
    const receipt = receiptRows[0];

    // Accumulated per inventory-account so the AP credit is one journal entry: Dr each
    // Inventory account for the value of goods actually received in good condition
    // (damaged units never enter stock, so they never touch the books), Cr Accounts
    // Payable for the supplier's full receivable.
    const inventoryValueByAccountCode = {};

    for (const item of items) {
      const { rows: piRows } = await client.query(
        `SELECT pi.*, p.product_type FROM purchase_items pi JOIN products p ON p.id = pi.product_id WHERE pi.id = $1 AND pi.purchase_order_id = $2`,
        [item.purchase_item_id, po.id]
      );
      const purchaseItem = piRows[0];
      if (!purchaseItem) throw new ApiError(400, `purchase_item_id ${item.purchase_item_id} does not belong to this PO`);

      await client.query(
        `INSERT INTO goods_receipt_items (goods_receipt_id, purchase_item_id, quantity_received, condition) VALUES ($1,$2,$3,$4)`,
        [receipt.id, item.purchase_item_id, item.quantity_received, item.condition || 'good']
      );
      await client.query(
        `UPDATE purchase_items SET quantity_received = quantity_received + $1 WHERE id = $2`,
        [item.quantity_received, item.purchase_item_id]
      );
      if (item.condition !== 'damaged') {
        await postStockMovement(client, {
          productId: purchaseItem.product_id, warehouseId: warehouse_id, movementType: 'IN', quantity: item.quantity_received,
          referenceType: 'purchase', referenceId: po.id, performedBy: req.user.id, notes: `GRN against ${po.po_number}`
        });
        const acctCode = INVENTORY_ACCOUNT_CODE[purchaseItem.product_type];
        const value = Number(item.quantity_received) * Number(purchaseItem.unit_cost);
        inventoryValueByAccountCode[acctCode] = (inventoryValueByAccountCode[acctCode] || 0) + value;
      }
    }

    const { rows: allItems } = await client.query('SELECT quantity_ordered, quantity_received FROM purchase_items WHERE purchase_order_id = $1', [po.id]);
    const fullyReceived = allItems.every((i) => Number(i.quantity_received) >= Number(i.quantity_ordered));
    const partiallyReceived = allItems.some((i) => Number(i.quantity_received) > 0);
    const newStatus = fullyReceived ? 'received' : partiallyReceived ? 'partially_received' : po.status;
    await client.query('UPDATE purchase_orders SET status = $1 WHERE id = $2', [newStatus, po.id]);

    const totalValue = Object.values(inventoryValueByAccountCode).reduce((s, v) => s + v, 0);
    if (totalValue > 0) {
      const apAcct = await getAccountByCode(client, '2000');
      const dims = { costCenterId: po.cost_center_id, projectId: po.project_id };
      const lines = [];
      for (const [code, value] of Object.entries(inventoryValueByAccountCode)) {
        const acct = await getAccountByCode(client, code);
        lines.push({ accountId: acct.id, debit: value, credit: 0, ...dims });
      }
      lines.push({ accountId: apAcct.id, debit: 0, credit: totalValue, supplierId: po.supplier_id, ...dims });
      await postJournalEntry(client, {
        entryDate: receipt.received_date, description: `Goods received - ${po.po_number}`,
        source: 'system', referenceType: 'purchase_order', referenceId: po.id, createdBy: req.user.id, lines
      });
    }

    return { ...receipt, status: newStatus };
  });

  res.status(201).json({ data: result, error: null });
}));

// Reverse a received PO: offsets every posted "goods received" journal entry for this PO
// (there can be more than one if it was received in batches), posts compensating stock OUT
// movements for everything that came in, and flags the PO 'reversed'. Blocked if the
// supplier has already been paid against it — void those payments first.
router.post('/purchase-orders/:id/reverse', requireRole('Admin', 'Procurement Officer'), validate(schemas.reverseRequest), asyncHandler(async (req, res) => {
  const { reason } = req.body;

  const result = await withTransaction(async (client) => {
    const { rows: poRows } = await client.query('SELECT * FROM purchase_orders WHERE id = $1 FOR UPDATE', [req.params.id]);
    const po = poRows[0];
    if (!po) throw new ApiError(404, 'Purchase order not found');
    if (['draft', 'sent'].includes(po.status)) throw new ApiError(409, 'This PO has not posted to the ledger yet — delete it instead of reversing it.');
    if (po.status === 'reversed' || po.status === 'cancelled') throw new ApiError(409, `PO is already ${po.status}`);

    const { rows: paidRows } = await client.query(
      `SELECT COALESCE(SUM(amount), 0) AS paid FROM supplier_payments WHERE purchase_order_id = $1 AND voided_at IS NULL`,
      [po.id]
    );
    if (Number(paidRows[0].paid) > 0.005) {
      throw new ApiError(409, 'This PO has payments recorded against it — reverse those payments first.');
    }

    const { rows: entries } = await client.query(
      `SELECT id FROM journal_entries WHERE reference_type = 'purchase_order' AND reference_id = $1 AND status = 'posted' ORDER BY id`,
      [po.id]
    );
    if (!entries.length) throw new ApiError(409, 'No posted journal entry found for this PO');
    for (const entry of entries) {
      await reverseJournalEntry(client, {
        entryId: entry.id, createdBy: req.user.id,
        description: `Reversal of ${po.po_number}${reason ? ' - ' + reason : ''}`
      });
    }

    // Undo the physical stock effect: everything received in good condition goes back out.
    const { rows: received } = await client.query(
      `SELECT pi.product_id, gr.warehouse_id, SUM(gri.quantity_received) AS qty
       FROM goods_receipt_items gri
       JOIN purchase_items pi ON pi.id = gri.purchase_item_id
       JOIN goods_receipts gr ON gr.id = gri.goods_receipt_id
       WHERE gr.purchase_order_id = $1 AND gri.condition = 'good'
       GROUP BY pi.product_id, gr.warehouse_id`,
      [po.id]
    );
    for (const r of received) {
      await postStockMovement(client, {
        productId: r.product_id, warehouseId: r.warehouse_id, movementType: 'OUT', quantity: Number(r.qty),
        referenceType: 'adjustment', referenceId: po.id, performedBy: req.user.id,
        notes: `Reversal of goods received against ${po.po_number}`
      });
    }

    const { rows: updated } = await client.query(`UPDATE purchase_orders SET status = 'reversed' WHERE id = $1 RETURNING *`, [po.id]);
    await logAudit(client, { userId: req.user.id, action: 'UPDATE', entityType: 'purchase_order', entityId: po.id, oldValue: po, newValue: updated[0] });
    return updated[0];
  });

  res.json({ data: result, error: null });
}));

router.get('/purchase-orders/:id/payments', asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT sp.*, u.full_name AS recorded_by_name FROM supplier_payments sp JOIN users u ON u.id = sp.recorded_by
     WHERE sp.purchase_order_id = $1 ORDER BY sp.created_at`,
    [req.params.id]
  );
  res.json({ data: rows, error: null });
}));

// "Payment sending" — the AP mirror of the customer-side payment receiving workflow:
// settle part or all of a supplier's outstanding balance on a received PO.
router.post('/purchase-orders/:id/payments', requireRole('Admin', 'Procurement Officer', 'Finance Officer'), validate(schemas.supplierPaymentCreate), asyncHandler(async (req, res) => {
  const { amount, payment_date, method, bank_account_id, reference_number } = req.body;

  const result = await withTransaction(async (client) => {
    const { rows: poRows } = await client.query('SELECT * FROM purchase_orders WHERE id = $1', [req.params.id]);
    const po = poRows[0];
    if (!po) throw new ApiError(404, 'Purchase order not found');

    const { rows: payRows } = await client.query(
      `INSERT INTO supplier_payments (purchase_order_id, amount, payment_date, method, bank_account_id, reference_number, recorded_by)
       VALUES ($1,$2,COALESCE($3, CURRENT_DATE),$4,$5,$6,$7) RETURNING *`,
      [po.id, amount, payment_date || null, method, bank_account_id || null, reference_number || null, req.user.id]
    );
    const payment = payRows[0];

    const apAcct = await getAccountByCode(client, '2000');
    let cashOrBankAcct;
    if (method === 'cash') {
      cashOrBankAcct = (await getAccountByCode(client, '1000')).id;
    } else if (bank_account_id) {
      const { rows } = await client.query('SELECT coa_account_id FROM bank_accounts WHERE id = $1', [bank_account_id]);
      cashOrBankAcct = rows[0] ? rows[0].coa_account_id : (await getAccountByCode(client, '1010')).id;
    } else {
      cashOrBankAcct = (await getAccountByCode(client, '1010')).id;
    }

    await postJournalEntry(client, {
      entryDate: payment.payment_date, description: `Payment to supplier - ${po.po_number}`,
      source: 'system', referenceType: 'supplier_payment', referenceId: payment.id, createdBy: req.user.id,
      lines: [
        { accountId: apAcct.id, debit: amount, credit: 0, supplierId: po.supplier_id, costCenterId: po.cost_center_id, projectId: po.project_id },
        { accountId: cashOrBankAcct, debit: 0, credit: amount, costCenterId: po.cost_center_id, projectId: po.project_id }
      ]
    });

    await logAudit(client, { userId: req.user.id, action: 'CREATE', entityType: 'supplier_payment', entityId: payment.id, newValue: payment });
    return payment;
  });

  res.status(201).json({ data: result, error: null });
}));

// Reverse a payment sent to a supplier: posts an offsetting entry that reinstates the
// payable (Dr Cash/Bank, Cr AP) and voids the payment record.
router.post('/purchase-orders/:poId/payments/:paymentId/reverse', requireRole('Admin', 'Procurement Officer', 'Finance Officer'), validate(schemas.reverseRequest), asyncHandler(async (req, res) => {
  const { reason } = req.body;

  const result = await withTransaction(async (client) => {
    const { rows: payRows } = await client.query(
      'SELECT * FROM supplier_payments WHERE id = $1 AND purchase_order_id = $2 FOR UPDATE', [req.params.paymentId, req.params.poId]
    );
    const payment = payRows[0];
    if (!payment) throw new ApiError(404, 'Supplier payment not found');
    if (payment.voided_at) throw new ApiError(409, 'This payment has already been reversed');

    const { rows: entryRows } = await client.query(
      `SELECT id FROM journal_entries WHERE reference_type = 'supplier_payment' AND reference_id = $1 AND status = 'posted' ORDER BY id DESC LIMIT 1`,
      [payment.id]
    );
    if (!entryRows[0]) throw new ApiError(409, 'No posted journal entry found for this payment');

    await reverseJournalEntry(client, {
      entryId: entryRows[0].id, createdBy: req.user.id,
      description: `Reversal of supplier payment #${payment.id}${reason ? ' - ' + reason : ''}`
    });

    const { rows: voided } = await client.query(
      `UPDATE supplier_payments SET voided_at = now(), voided_by = $1, void_reason = $2 WHERE id = $3 RETURNING *`,
      [req.user.id, reason || null, payment.id]
    );
    await logAudit(client, { userId: req.user.id, action: 'UPDATE', entityType: 'supplier_payment', entityId: payment.id, oldValue: payment, newValue: voided[0] });
    return voided[0];
  });

  res.json({ data: result, error: null });
}));

router.get('/supplier-performance/:supplier_id', asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT sp.*, po.po_number FROM supplier_performance sp JOIN purchase_orders po ON po.id = sp.purchase_order_id
     WHERE sp.supplier_id = $1 ORDER BY sp.evaluated_at DESC`,
    [req.params.supplier_id]
  );
  const avgRating = rows.length ? rows.reduce((s, r) => s + r.quality_rating, 0) / rows.length : null;
  const onTimePct = rows.length ? (rows.filter((r) => r.on_time_delivery).length / rows.length) * 100 : null;
  res.json({ data: { records: rows, avg_quality_rating: avgRating, on_time_pct: onTimePct }, error: null });
}));

router.post('/supplier-performance', requireRole('Admin', 'Procurement Officer'), validate(schemas.supplierPerformanceCreate), asyncHandler(async (req, res) => {
  const { supplier_id, purchase_order_id, on_time_delivery, quality_rating, notes } = req.body;
  const { rows } = await pool.query(
    `INSERT INTO supplier_performance (supplier_id, purchase_order_id, on_time_delivery, quality_rating, notes, evaluated_by)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [supplier_id, purchase_order_id, on_time_delivery, quality_rating, notes || null, req.user.id]
  );
  await pool.query(
    `UPDATE suppliers SET rating = (SELECT AVG(quality_rating) FROM supplier_performance WHERE supplier_id = $1) WHERE id = $1`,
    [supplier_id]
  );
  res.status(201).json({ data: rows[0], error: null });
}));

module.exports = router;
