// Procurement sourcing (phase 2): supplier quotations, comparison, supplier selection with justification,
// purchase-order generation and Operation Manager authorization. Mounted at /api/v1/procurement.
const { Router } = require('express');
const { pool, withTransaction } = require('../config/db');
const { asyncHandler, ApiError } = require('../utils/asyncHandler');
const { requireRole } = require('../middleware/auth');
const { PERM } = require('../middleware/permissions');
const { validate } = require('../middleware/validate');
const schemas = require('../validation/schemas');
const { nextRef, audit, recordApproval } = require('../services/procurementService');

const router = Router();
const isOps = (u) => u.role === 'Operation Manager' || u.role === 'Admin';
const num = (v) => Number(v);
const round2 = (v) => Math.round(v * 100) / 100;

// ------------------------------------------------------------------ access
// Working on a requisition's sourcing = the assigned Procurement Officer (or Admin). Reading = also Operation Manager and Finance.
// Requesters and department heads never see supplier prices.
async function loadSourcing(client, id, user, { write = false, lock = false } = {}) {
  const { rows } = await client.query(`SELECT * FROM purchase_requisitions WHERE id = $1 ${lock ? 'FOR UPDATE' : ''}`, [id]);
  const pr = rows[0];
  const works = user.role === 'Admin' || (user.role === 'Procurement Officer' && pr && pr.assigned_to === user.id);
  const reads = works || user.role === 'Operation Manager' || user.role === 'Finance Officer';
  if (!pr || !reads) throw new ApiError(404, 'Requisition not found');
  if (write && !works) throw new ApiError(403, 'Only the Procurement Officer assigned to this requisition can do this');
  return pr;
}

async function reqLines(client, id) {
  return (await client.query(
    `SELECT l.id, l.line_no, l.product_id, l.item_name, l.quantity, l.unit, l.estimated_unit_cost
     FROM purchase_requisition_lines l WHERE l.requisition_id = $1 ORDER BY l.line_no`, [id])).rows;
}

async function quotationsOf(client, requisitionId) {
  const qs = (await client.query(
    `SELECT q.*, s.name AS supplier_name, s.code AS supplier_code, s.rating AS supplier_rating
     FROM supplier_quotations q JOIN suppliers s ON s.id = q.supplier_id WHERE q.requisition_id = $1 ORDER BY q.id`, [requisitionId])).rows;
  const lines = (await client.query(
    `SELECT l.* FROM supplier_quotation_lines l JOIN supplier_quotations q ON q.id = l.quotation_id WHERE q.requisition_id = $1`, [requisitionId])).rows;
  return qs.map((q) => ({ ...q, lines: lines.filter((l) => l.quotation_id === q.id) }));
}

// Side-by-side comparison: price (server-computed totals), delivery time, payment terms and quality, with the best of each flagged.
function compare(reqLinesList, quotations) {
  const live = quotations.filter((q) => ['received', 'selected', 'rejected'].includes(q.status));
  const complete = live.filter((q) => q.is_complete);
  const min = (arr, f) => (arr.length ? Math.min(...arr.map(f)) : null);
  const max = (arr, f) => (arr.length ? Math.max(...arr.map(f)) : null);
  const lowest = min(complete, (q) => num(q.total_amount));
  const fastest = min(complete.filter((q) => q.delivery_days !== null), (q) => q.delivery_days);
  const longestTerms = max(complete.filter((q) => q.payment_terms_days !== null), (q) => q.payment_terms_days);
  const bestQuality = max(complete.filter((q) => q.quality_rating !== null), (q) => q.quality_rating);
  return {
    lines: reqLinesList,
    quotations: live.map((q) => ({
      id: q.id, quotation_number: q.quotation_number, supplier_id: q.supplier_id, supplier_name: q.supplier_name, status: q.status, is_complete: q.is_complete,
      total_amount: num(q.total_amount), delivery_days: q.delivery_days, payment_terms_days: q.payment_terms_days, quality_rating: q.quality_rating,
      prices: Object.fromEntries(q.lines.map((l) => [l.requisition_line_id, num(l.unit_price)])),
      is_lowest_total: q.is_complete && num(q.total_amount) === lowest,
      is_fastest: q.is_complete && q.delivery_days !== null && q.delivery_days === fastest,
      has_best_payment_terms: q.is_complete && q.payment_terms_days !== null && q.payment_terms_days === longestTerms,
      has_best_quality: q.is_complete && q.quality_rating !== null && q.quality_rating === bestQuality
    })),
    complete_count: complete.length,
    lowest_total: lowest
  };
}

// ------------------------------------------------------------------ quotations
router.get('/requisitions/:id/quotations', asyncHandler(async (req, res) => {
  const client = await pool.connect();
  try {
    const pr = await loadSourcing(client, Number(req.params.id), req.user);
    res.json({ data: { requisition_status: pr.status, quotations: await quotationsOf(client, pr.id) }, error: null });
  } finally { client.release(); }
}));

router.post('/requisitions/:id/quotations', validate(schemas.quotationRequest), asyncHandler(async (req, res) => {
  const out = await withTransaction(async (client) => {
    const pr = await loadSourcing(client, Number(req.params.id), req.user, { write: true, lock: true });
    if (pr.status !== 'sourcing') throw new ApiError(409, `Quotations can only be requested while the requisition is in sourcing (it is ${pr.status})`);
    const ids = [...new Set(req.body.supplier_ids)];
    const sup = (await client.query('SELECT id FROM suppliers WHERE id = ANY($1) AND is_active', [ids])).rows.map((r) => r.id);
    const missing = ids.filter((i) => !sup.includes(i));
    if (missing.length) throw new ApiError(400, `Unknown or inactive supplier(s): ${missing.join(', ')}`);
    const existing = (await client.query('SELECT supplier_id FROM supplier_quotations WHERE requisition_id = $1 AND supplier_id = ANY($2)', [pr.id, ids])).rows;
    if (existing.length) throw new ApiError(409, `A quotation was already requested from supplier(s): ${existing.map((e) => e.supplier_id).join(', ')}`);
    const created = [];
    for (const supplierId of ids) {
      const number = await nextRef(client, 'QT');
      const r = await client.query(
        `INSERT INTO supplier_quotations (quotation_number, requisition_id, supplier_id, requested_by, valid_until) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [number, pr.id, supplierId, req.user.id, req.body.valid_until || null]);
      created.push(r.rows[0]);
      await audit(client, { entityType: 'quotation', entityId: r.rows[0].id, action: 'request', user: req.user, newValue: { quotation_number: number, requisition_id: pr.id, supplier_id: supplierId } });
    }
    return created;
  });
  res.status(201).json({ data: out, error: null });
}));

router.put('/requisitions/:id/quotations/:qid', validate(schemas.quotationRecord), asyncHandler(async (req, res) => {
  const out = await withTransaction(async (client) => {
    const pr = await loadSourcing(client, Number(req.params.id), req.user, { write: true, lock: true });
    if (pr.status !== 'sourcing') throw new ApiError(409, `Quotations can only be recorded while the requisition is in sourcing (it is ${pr.status})`);
    const q = (await client.query('SELECT * FROM supplier_quotations WHERE id = $1 AND requisition_id = $2 FOR UPDATE', [Number(req.params.qid), pr.id])).rows[0];
    if (!q) throw new ApiError(404, 'Quotation not found');
    if (!['requested', 'received'].includes(q.status)) throw new ApiError(409, `A ${q.status} quotation can no longer be changed`);
    const lines = await reqLines(client, pr.id);
    const byId = new Map(lines.map((l) => [l.id, l]));
    const seen = new Set();
    for (const l of req.body.lines) {
      if (!byId.has(l.requisition_line_id)) throw new ApiError(400, `Line ${l.requisition_line_id} does not belong to this requisition`);
      if (seen.has(l.requisition_line_id)) throw new ApiError(400, `Line ${l.requisition_line_id} is priced twice`);
      seen.add(l.requisition_line_id);
    }
    await client.query('DELETE FROM supplier_quotation_lines WHERE quotation_id = $1', [q.id]);
    let total = 0;
    for (const l of req.body.lines) {
      const lineTotal = round2(num(byId.get(l.requisition_line_id).quantity) * l.unit_price);
      total += lineTotal;
      await client.query('INSERT INTO supplier_quotation_lines (quotation_id, requisition_line_id, unit_price, line_total) VALUES ($1,$2,$3,$4)', [q.id, l.requisition_line_id, l.unit_price, lineTotal]);
    }
    const complete = lines.every((l) => seen.has(l.id));
    const upd = await client.query(
      `UPDATE supplier_quotations SET status = 'received', received_at = now(), delivery_days = $1, payment_terms_days = $2, quality_rating = $3,
              valid_until = COALESCE($4, valid_until), notes = $5, is_complete = $6, total_amount = $7 WHERE id = $8 RETURNING *`,
      [req.body.delivery_days, req.body.payment_terms_days, req.body.quality_rating || null, req.body.valid_until || null, req.body.notes || null, complete, round2(total), q.id]);
    await audit(client, { entityType: 'quotation', entityId: q.id, action: 'record', user: req.user, oldValue: { status: q.status, total_amount: num(q.total_amount) }, newValue: { status: 'received', total_amount: round2(total), complete, lines: req.body.lines.length } });
    return upd.rows[0];
  });
  res.json({ data: out, error: null });
}));

router.post('/requisitions/:id/quotations/:qid/decline', validate(schemas.requisitionCancel), asyncHandler(async (req, res) => {
  const out = await withTransaction(async (client) => {
    const pr = await loadSourcing(client, Number(req.params.id), req.user, { write: true, lock: true });
    const q = (await client.query('SELECT * FROM supplier_quotations WHERE id = $1 AND requisition_id = $2 FOR UPDATE', [Number(req.params.qid), pr.id])).rows[0];
    if (!q) throw new ApiError(404, 'Quotation not found');
    if (!['requested', 'received'].includes(q.status)) throw new ApiError(409, `A ${q.status} quotation cannot be declined`);
    const upd = await client.query(`UPDATE supplier_quotations SET status = 'declined', notes = COALESCE($1, notes) WHERE id = $2 RETURNING *`, [req.body.comments || null, q.id]);
    await audit(client, { entityType: 'quotation', entityId: q.id, action: 'decline', user: req.user, oldValue: { status: q.status }, newValue: { status: 'declined', comments: req.body.comments } });
    return upd.rows[0];
  });
  res.json({ data: out, error: null });
}));

router.get('/requisitions/:id/comparison', asyncHandler(async (req, res) => {
  const client = await pool.connect();
  try {
    const pr = await loadSourcing(client, Number(req.params.id), req.user);
    const cmp = compare(await reqLines(client, pr.id), await quotationsOf(client, pr.id));
    res.json({ data: { ...cmp, selected_quotation_id: pr.selected_quotation_id, selection_justification: pr.selection_justification, requisition_status: pr.status }, error: null });
  } finally { client.release(); }
}));

// ------------------------------------------------------------------ supplier selection (justified)
router.post('/requisitions/:id/select-supplier', validate(schemas.supplierSelection), asyncHandler(async (req, res) => {
  const { quotation_id, justification } = req.body;
  const out = await withTransaction(async (client) => {
    const pr = await loadSourcing(client, Number(req.params.id), req.user, { write: true, lock: true });
    if (pr.status !== 'sourcing') throw new ApiError(409, `A supplier can only be selected while the requisition is in sourcing (it is ${pr.status})`);
    const quotations = await quotationsOf(client, pr.id);
    const chosen = quotations.find((q) => q.id === quotation_id);
    if (!chosen) throw new ApiError(404, 'Quotation not found for this requisition');
    if (!['received', 'selected', 'rejected'].includes(chosen.status)) throw new ApiError(409, 'Only a received quotation can be selected');
    if (!chosen.is_complete) throw new ApiError(400, 'This quotation does not price every line of the requisition');
    const cmp = compare(await reqLines(client, pr.id), quotations);
    const isLowest = num(chosen.total_amount) === cmp.lowest_total;
    const soleSource = cmp.complete_count < 2;
    const needs = !isLowest || soleSource;
    const text = (justification || '').trim();
    if (needs && text.length < 10) {
      throw new ApiError(400, soleSource
        ? 'Only one complete quotation exists: a justification of at least 10 characters is required for a sole-source selection'
        : 'This is not the lowest complete quotation: a justification of at least 10 characters is required');
    }
    await client.query(`UPDATE supplier_quotations SET status = 'received' WHERE requisition_id = $1 AND status IN ('selected','rejected')`, [pr.id]);
    await client.query(`UPDATE supplier_quotations SET status = 'selected' WHERE id = $1`, [chosen.id]);
    await client.query(`UPDATE supplier_quotations SET status = 'rejected' WHERE requisition_id = $1 AND id <> $2 AND status = 'received'`, [pr.id, chosen.id]);
    await client.query(
      `UPDATE purchase_requisitions SET selected_quotation_id = $1, selection_justification = $2, selected_by = $3, selected_at = now(), updated_at = now() WHERE id = $4`,
      [chosen.id, text || null, req.user.id, pr.id]);
    await recordApproval(client, { entityType: 'requisition', entityId: pr.id, step: 'supplier_selection', decision: 'approved', user: req.user, comments: text || 'Lowest complete quotation', snapshot: { comparison: cmp, selected_quotation_id: chosen.id } });
    await audit(client, { entityType: 'requisition', entityId: pr.id, action: 'select_supplier', user: req.user, newValue: { quotation_id: chosen.id, supplier_id: chosen.supplier_id, total: num(chosen.total_amount), lowest: isLowest, justification: text } });
    return { selected_quotation_id: chosen.id, supplier_id: chosen.supplier_id, is_lowest: isLowest, justification_required: needs };
  });
  res.json({ data: out, error: null });
}));

router.put('/requisitions/:id/line-products', validate(schemas.lineProducts), asyncHandler(async (req, res) => {
  await withTransaction(async (client) => {
    const pr = await loadSourcing(client, Number(req.params.id), req.user, { write: true, lock: true });
    if (pr.status !== 'sourcing') throw new ApiError(409, `Products can only be mapped while the requisition is in sourcing (it is ${pr.status})`);
    for (const m of req.body.mappings) {
      const line = (await client.query('SELECT id FROM purchase_requisition_lines WHERE id = $1 AND requisition_id = $2', [m.line_id, pr.id])).rows[0];
      if (!line) throw new ApiError(400, `Line ${m.line_id} does not belong to this requisition`);
      const prod = (await client.query('SELECT id FROM products WHERE id = $1 AND is_active', [m.product_id])).rows[0];
      if (!prod) throw new ApiError(400, `Product ${m.product_id} does not exist or is inactive`);
      await client.query('UPDATE purchase_requisition_lines SET product_id = $1 WHERE id = $2', [m.product_id, m.line_id]);
    }
    await audit(client, { entityType: 'requisition', entityId: pr.id, action: 'map_products', user: req.user, newValue: { mappings: req.body.mappings } });
  });
  res.json({ data: { ok: true }, error: null });
}));

// ------------------------------------------------------------------ purchase order from the selected quotation
router.post('/requisitions/:id/purchase-order', validate(schemas.poFromRequisition), asyncHandler(async (req, res) => {
  const out = await withTransaction(async (client) => {
    const pr = await loadSourcing(client, Number(req.params.id), req.user, { write: true, lock: true });
    if (pr.status !== 'sourcing') throw new ApiError(409, `A purchase order can only be raised while the requisition is in sourcing (it is ${pr.status})`);
    if (!pr.selected_quotation_id) throw new ApiError(409, 'Select a supplier (quotation) first');
    const q = (await client.query('SELECT * FROM supplier_quotations WHERE id = $1', [pr.selected_quotation_id])).rows[0];
    const lines = await reqLines(client, pr.id);
    const unmapped = lines.filter((l) => !l.product_id).map((l) => l.line_no);
    if (unmapped.length) throw new ApiError(400, `Link every line to a stock item before raising the PO (unlinked lines: ${unmapped.join(', ')})`);
    const prices = new Map((await client.query('SELECT requisition_line_id, unit_price FROM supplier_quotation_lines WHERE quotation_id = $1', [q.id])).rows.map((r) => [r.requisition_line_id, num(r.unit_price)]));
    const dept = (await client.query('SELECT cost_center_id FROM departments WHERE id = $1', [pr.department_id])).rows[0];
    const poNumber = await nextRef(client, 'PO');
    const expected = req.body.expected_date || new Date(Date.now() + (q.delivery_days || 0) * 86400000).toISOString().slice(0, 10);
    const total = round2(lines.reduce((s, l) => s + round2(num(l.quantity) * prices.get(l.id)), 0));
    const po = (await client.query(
      `INSERT INTO purchase_orders (po_number, supplier_id, expected_date, status, total_amount, created_by, notes, cost_center_id, requisition_id, quotation_id, department_id, payment_terms_days)
       VALUES ($1,$2,$3,'pending_authorization',$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [poNumber, q.supplier_id, expected, total, req.user.id, req.body.notes || null, dept ? dept.cost_center_id : null, pr.id, q.id, pr.department_id, q.payment_terms_days])).rows[0];
    for (const l of lines) {
      const price = prices.get(l.id);
      await client.query(
        `INSERT INTO purchase_items (purchase_order_id, product_id, quantity_ordered, unit_cost, subtotal, requisition_line_id) VALUES ($1,$2,$3,$4,$5,$6)`,
        [po.id, l.product_id, l.quantity, price, round2(num(l.quantity) * price), l.id]);
    }
    await client.query(`UPDATE purchase_requisitions SET status = 'po_issued', updated_at = now() WHERE id = $1`, [pr.id]);
    await recordApproval(client, { entityType: 'purchase_order', entityId: po.id, step: 'po_submission', decision: 'submitted', user: req.user, snapshot: { po_number: poNumber, supplier_id: q.supplier_id, total, requisition: pr.pr_number, quotation: q.quotation_number } });
    await audit(client, { entityType: 'purchase_order', entityId: po.id, action: 'create_from_requisition', user: req.user, newValue: { po_number: poNumber, requisition_id: pr.id, total } });
    await audit(client, { entityType: 'requisition', entityId: pr.id, action: 'po_issued', user: req.user, oldValue: { status: 'sourcing' }, newValue: { status: 'po_issued', po_number: poNumber } });
    return po;
  });
  res.status(201).json({ data: out, error: null });
}));

// ------------------------------------------------------------------ PO flow: authorization, send, tracking
const poRead = requireRole(...PERM.PROCUREMENT_VIEW);

router.get('/po-flow/pending', requireRole('Admin', 'Operation Manager'), asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT po.id, po.po_number, po.total_amount, po.expected_date, po.status, po.created_at, s.name AS supplier_name, cu.full_name AS created_by_name,
            pr.pr_number, pr.title AS requisition_title, d.name AS department_name, pr.selection_justification
     FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id JOIN users cu ON cu.id = po.created_by
     LEFT JOIN purchase_requisitions pr ON pr.id = po.requisition_id LEFT JOIN departments d ON d.id = po.department_id
     WHERE po.status = 'pending_authorization' ORDER BY po.created_at`);
  res.json({ data: rows, error: null });
}));

router.get('/po-flow/outstanding', poRead, asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT po.id, po.po_number, po.status, po.total_amount, po.expected_date, s.name AS supplier_name, pr.pr_number, d.name AS department_name,
            GREATEST(0, CURRENT_DATE - po.expected_date) AS days_overdue,
            COALESCE((SELECT SUM(i.quantity_received) FROM purchase_items i WHERE i.purchase_order_id = po.id), 0) AS qty_received,
            COALESCE((SELECT SUM(i.quantity_ordered) FROM purchase_items i WHERE i.purchase_order_id = po.id), 0) AS qty_ordered
     FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id
     LEFT JOIN purchase_requisitions pr ON pr.id = po.requisition_id LEFT JOIN departments d ON d.id = po.department_id
     WHERE po.status IN ('pending_authorization','authorized','sent','partially_received') ORDER BY po.expected_date NULLS LAST, po.id`);
  res.json({ data: rows.map((r) => ({ ...r, is_delayed: r.days_overdue > 0 && ['sent', 'partially_received', 'authorized'].includes(r.status) })), error: null });
}));

router.get('/po-flow/:id', poRead, asyncHandler(async (req, res) => {
  const po = (await pool.query(
    `SELECT po.*, s.name AS supplier_name, cu.full_name AS created_by_name, au.full_name AS authorized_by_name,
            pr.pr_number, pr.title AS requisition_title, pr.selection_justification, d.name AS department_name
     FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id JOIN users cu ON cu.id = po.created_by LEFT JOIN users au ON au.id = po.authorized_by
     LEFT JOIN purchase_requisitions pr ON pr.id = po.requisition_id LEFT JOIN departments d ON d.id = po.department_id WHERE po.id = $1`, [Number(req.params.id)])).rows[0];
  if (!po) throw new ApiError(404, 'Purchase order not found');
  const items = (await pool.query(
    `SELECT i.*, p.name AS product_name, p.sku FROM purchase_items i JOIN products p ON p.id = i.product_id WHERE i.purchase_order_id = $1 ORDER BY i.id`, [po.id])).rows;
  const approvals = (await pool.query(
    `SELECT a.id, a.step, a.decision, u.full_name AS actor_name, a.actor_role, a.comments, a.decided_at, a.signature_hash
     FROM procurement_approvals a JOIN users u ON u.id = a.actor_id WHERE a.entity_type = 'purchase_order' AND a.entity_id = $1 ORDER BY a.id`, [po.id])).rows;
  res.json({ data: { ...po, items, approvals }, error: null });
}));

router.post('/po-flow/:id/authorize', validate(schemas.requisitionDecision), asyncHandler(async (req, res) => {
  if (!isOps(req.user)) throw new ApiError(403, 'Only the Operation Manager can authorize purchase orders');
  const { decision, comments } = req.body;
  const out = await withTransaction(async (client) => {
    const po = (await client.query('SELECT * FROM purchase_orders WHERE id = $1 FOR UPDATE', [Number(req.params.id)])).rows[0];
    if (!po) throw new ApiError(404, 'Purchase order not found');
    if (po.status !== 'pending_authorization') throw new ApiError(409, `This purchase order is ${po.status}, not waiting for authorization`);
    if (po.created_by === req.user.id) throw new ApiError(403, 'You cannot authorize a purchase order you created');
    const pr = po.requisition_id ? (await client.query('SELECT * FROM purchase_requisitions WHERE id = $1 FOR UPDATE', [po.requisition_id])).rows[0] : null;
    if (pr && pr.requested_by === req.user.id) throw new ApiError(403, 'You cannot authorize the purchase of your own requisition');
    if (decision !== 'approve' && !(comments && comments.trim())) throw new ApiError(400, 'Comments are required when rejecting or requesting a revision');
    const snapshot = { po_number: po.po_number, supplier_id: po.supplier_id, total_amount: num(po.total_amount), expected_date: po.expected_date, requisition: pr ? pr.pr_number : null };
    if (decision === 'approve') {
      await client.query(`UPDATE purchase_orders SET status = 'authorized', authorized_by = $1, authorized_at = now() WHERE id = $2`, [req.user.id, po.id]);
      await recordApproval(client, { entityType: 'purchase_order', entityId: po.id, step: 'po_authorization', decision: 'authorized', user: req.user, comments, snapshot });
    } else if (decision === 'revision') {
      await client.query(`UPDATE purchase_orders SET status = 'draft' WHERE id = $1`, [po.id]);
      await recordApproval(client, { entityType: 'purchase_order', entityId: po.id, step: 'po_authorization', decision: 'revision_requested', user: req.user, comments, snapshot });
    } else {
      await client.query(`UPDATE purchase_orders SET status = 'cancelled' WHERE id = $1`, [po.id]);
      if (pr) {
        // The purchase falls through: the requisition goes back to sourcing so a different supplier/PO can be chosen.
        await client.query(`UPDATE supplier_quotations SET status = 'received' WHERE requisition_id = $1 AND status IN ('selected','rejected')`, [pr.id]);
        await client.query(`UPDATE purchase_requisitions SET status = 'sourcing', selected_quotation_id = NULL, selection_justification = NULL, selected_by = NULL, selected_at = NULL, updated_at = now() WHERE id = $1`, [pr.id]);
      }
      await recordApproval(client, { entityType: 'purchase_order', entityId: po.id, step: 'po_authorization', decision: 'rejected', user: req.user, comments, snapshot });
    }
    await audit(client, { entityType: 'purchase_order', entityId: po.id, action: `authorize:${decision}`, user: req.user, oldValue: { status: po.status }, newValue: { decision, comments } });
    return (await client.query('SELECT * FROM purchase_orders WHERE id = $1', [po.id])).rows[0];
  });
  res.json({ data: out, error: null });
}));

router.post('/po-flow/:id/resubmit', requireRole('Admin', 'Procurement Officer'), asyncHandler(async (req, res) => {
  const out = await withTransaction(async (client) => {
    const po = (await client.query('SELECT * FROM purchase_orders WHERE id = $1 FOR UPDATE', [Number(req.params.id)])).rows[0];
    if (!po) throw new ApiError(404, 'Purchase order not found');
    if (req.user.role !== 'Admin' && po.created_by !== req.user.id) throw new ApiError(403, 'Only the Procurement Officer who raised this purchase order can resubmit it');
    if (po.status !== 'draft') throw new ApiError(409, `Only a draft purchase order can be resubmitted (this one is ${po.status})`);
    await client.query(`UPDATE purchase_orders SET status = 'pending_authorization' WHERE id = $1`, [po.id]);
    await recordApproval(client, { entityType: 'purchase_order', entityId: po.id, step: 'po_submission', decision: 'submitted', user: req.user, snapshot: { po_number: po.po_number, total_amount: num(po.total_amount) } });
    await audit(client, { entityType: 'purchase_order', entityId: po.id, action: 'resubmit', user: req.user, oldValue: { status: 'draft' }, newValue: { status: 'pending_authorization' } });
    return (await client.query('SELECT * FROM purchase_orders WHERE id = $1', [po.id])).rows[0];
  });
  res.json({ data: out, error: null });
}));

router.post('/po-flow/:id/send', requireRole('Admin', 'Procurement Officer'), asyncHandler(async (req, res) => {
  const out = await withTransaction(async (client) => {
    const po = (await client.query('SELECT * FROM purchase_orders WHERE id = $1 FOR UPDATE', [Number(req.params.id)])).rows[0];
    if (!po) throw new ApiError(404, 'Purchase order not found');
    if (req.user.role !== 'Admin' && po.created_by !== req.user.id) throw new ApiError(403, 'Only the Procurement Officer who raised this purchase order can send it');
    if (po.status !== 'authorized') throw new ApiError(409, `Only an authorized purchase order can be sent to the supplier (this one is ${po.status})`);
    await client.query(`UPDATE purchase_orders SET status = 'sent' WHERE id = $1`, [po.id]);
    await audit(client, { entityType: 'purchase_order', entityId: po.id, action: 'send', user: req.user, oldValue: { status: 'authorized' }, newValue: { status: 'sent' } });
    return (await client.query('SELECT * FROM purchase_orders WHERE id = $1', [po.id])).rows[0];
  });
  res.json({ data: out, error: null });
}));

module.exports = router;
