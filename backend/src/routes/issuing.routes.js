// Procurement phase 3: issuing purchased materials from a warehouse to the requesting department,
// with department confirmation. Mounted at /api/v1/procurement/issues.
const { Router } = require('express');
const { pool, withTransaction } = require('../config/db');
const { asyncHandler, ApiError } = require('../utils/asyncHandler');
const { requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const schemas = require('../validation/schemas');
const { postStockMovement } = require('../utils/stockLedger');
const { postJournalEntry, getAccountByCode, reverseJournalEntry } = require('../services/accountingService');
const { nextRef, audit, recordApproval, isDepartmentHead } = require('../services/procurementService');

const router = Router();
const INVENTORY_ACCOUNT_CODE = { raw_material: '1200', finished_good: '1210', spare_part: '1220' };
const STORE = ['Admin', 'Storekeeper', 'Inventory Manager'];
const OVERSIGHT = [...STORE, 'Operation Manager', 'Finance Officer'];
const expenseCode = (deptName) => (/production/i.test(deptName) ? '5100' : /(logistic|warehouse|distribution|transport)/i.test(deptName) ? '5200' : /maint/i.test(deptName) ? '5400' : '5300');

// What can still be issued for a requisition: accepted (good) quantity received on its PO lines, minus what was already issued.
async function issuable(client, requisitionId) {
  const { rows } = await client.query(
    `SELECT l.id AS requisition_line_id, l.line_no, l.item_name, l.unit, l.product_id, l.quantity AS requested,
            COALESCE(SUM(pi.quantity_accepted), 0) AS accepted,
            COALESCE((SELECT SUM(mi.quantity) FROM material_issue_items mi JOIN material_issues m ON m.id = mi.issue_id
                      WHERE mi.requisition_line_id = l.id AND m.status <> 'disputed'), 0) AS issued,
            MAX(pi.unit_cost) AS unit_cost
     FROM purchase_requisition_lines l
     LEFT JOIN purchase_items pi ON pi.requisition_line_id = l.id
     LEFT JOIN purchase_orders po ON po.id = pi.purchase_order_id AND po.status NOT IN ('cancelled','reversed')
     WHERE l.requisition_id = $1 GROUP BY l.id ORDER BY l.line_no`, [requisitionId]);
  return rows.map((r) => ({ ...r, requested: Number(r.requested), accepted: Number(r.accepted), issued: Number(r.issued), available_to_issue: Math.max(0, Number(r.accepted) - Number(r.issued)) }));
}

router.get('/issuable/:requisitionId', requireRole(...STORE, 'Operation Manager'), asyncHandler(async (req, res) => {
  const pr = (await pool.query('SELECT id, pr_number, status, department_id FROM purchase_requisitions WHERE id = $1', [Number(req.params.requisitionId)])).rows[0];
  if (!pr) throw new ApiError(404, 'Requisition not found');
  res.json({ data: { requisition: pr, lines: await issuable(pool, pr.id) }, error: null });
}));

// Anyone may list issues they are entitled to see: store/oversight roles all; others only their own department's (requester or head).
router.get('/', asyncHandler(async (req, res) => {
  const oversight = OVERSIGHT.includes(req.user.role);
  const { rows } = await pool.query(
    `SELECT m.*, pr.pr_number, pr.title, d.name AS department_name, w.name AS warehouse_name, iu.full_name AS issued_by_name, cu.full_name AS confirmed_by_name
     FROM material_issues m JOIN purchase_requisitions pr ON pr.id = m.requisition_id JOIN departments d ON d.id = m.department_id
     JOIN warehouses w ON w.id = m.warehouse_id JOIN users iu ON iu.id = m.issued_by LEFT JOIN users cu ON cu.id = m.confirmed_by
     WHERE ($1 OR pr.requested_by = $2 OR d.manager_id = $2) ${req.query.status ? 'AND m.status = $3' : ''} ORDER BY m.id DESC LIMIT 300`,
    req.query.status ? [oversight, req.user.id, String(req.query.status)] : [oversight, req.user.id]);
  res.json({ data: rows, error: null });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const m = (await pool.query(
    `SELECT m.*, pr.pr_number, pr.title, pr.requested_by, d.name AS department_name, d.manager_id, w.name AS warehouse_name, iu.full_name AS issued_by_name
     FROM material_issues m JOIN purchase_requisitions pr ON pr.id = m.requisition_id JOIN departments d ON d.id = m.department_id
     JOIN warehouses w ON w.id = m.warehouse_id JOIN users iu ON iu.id = m.issued_by WHERE m.id = $1`, [Number(req.params.id)])).rows[0];
  if (!m || !(OVERSIGHT.includes(req.user.role) || m.requested_by === req.user.id || m.manager_id === req.user.id)) throw new ApiError(404, 'Issue not found');
  const items = (await pool.query(
    `SELECT i.*, p.name AS product_name, l.item_name, l.unit FROM material_issue_items i JOIN products p ON p.id = i.product_id
     JOIN purchase_requisition_lines l ON l.id = i.requisition_line_id WHERE i.issue_id = $1 ORDER BY i.id`, [m.id])).rows;
  const can_confirm = m.status === 'issued' && m.issued_by !== req.user.id && (m.requested_by === req.user.id || m.manager_id === req.user.id);
  res.json({ data: { ...m, items, can_confirm }, error: null });
}));

router.post('/', requireRole(...STORE), validate(schemas.issueCreate), asyncHandler(async (req, res) => {
  const { requisition_id, warehouse_id, lines, notes } = req.body;
  const out = await withTransaction(async (client) => {
    const pr = (await client.query('SELECT * FROM purchase_requisitions WHERE id = $1 FOR UPDATE', [requisition_id])).rows[0];
    if (!pr) throw new ApiError(404, 'Requisition not found');
    if (!['po_issued', 'fulfilled'].includes(pr.status)) throw new ApiError(409, `Materials can only be issued for a requisition with a purchase order (this one is ${pr.status})`);
    if (pr.requested_by === req.user.id) throw new ApiError(403, 'You cannot issue materials for your own requisition');
    if (!(await client.query('SELECT 1 FROM warehouses WHERE id = $1', [warehouse_id])).rows[0]) throw new ApiError(400, 'Unknown warehouse');
    const avail = new Map((await issuable(client, pr.id)).map((l) => [l.requisition_line_id, l]));
    const seen = new Set();
    for (const l of lines) {
      const a = avail.get(l.requisition_line_id);
      if (!a) throw new ApiError(400, `Line ${l.requisition_line_id} does not belong to this requisition`);
      if (seen.has(l.requisition_line_id)) throw new ApiError(400, `Line ${l.requisition_line_id} appears twice`);
      seen.add(l.requisition_line_id);
      if (!a.product_id) throw new ApiError(400, `Line ${a.line_no} is not linked to a stock item`);
      if (l.quantity > a.available_to_issue + 1e-9) throw new ApiError(409, `Line ${a.line_no} (${a.item_name}): only ${a.available_to_issue} accepted and not yet issued`);
    }
    const dept = (await client.query('SELECT id, name, cost_center_id FROM departments WHERE id = $1', [pr.department_id])).rows[0];
    const issue = (await client.query(
      `INSERT INTO material_issues (issue_number, requisition_id, department_id, warehouse_id, issued_by, notes) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [await nextRef(client, 'MIN'), pr.id, pr.department_id, warehouse_id, req.user.id, notes || null])).rows[0];
    const valueByAccount = {};
    for (const l of lines) {
      const a = avail.get(l.requisition_line_id);
      const type = (await client.query('SELECT product_type FROM products WHERE id = $1', [a.product_id])).rows[0].product_type;
      await client.query(`INSERT INTO material_issue_items (issue_id, requisition_line_id, product_id, quantity, unit_cost) VALUES ($1,$2,$3,$4,$5)`,
        [issue.id, l.requisition_line_id, a.product_id, l.quantity, a.unit_cost]);
      await postStockMovement(client, { productId: a.product_id, warehouseId: warehouse_id, movementType: 'OUT', quantity: l.quantity, referenceType: 'issue', referenceId: issue.id, performedBy: req.user.id, notes: `${issue.issue_number} to ${dept.name}` });
      const code = INVENTORY_ACCOUNT_CODE[type];
      valueByAccount[code] = (valueByAccount[code] || 0) + Math.round(l.quantity * Number(a.unit_cost) * 100) / 100;
    }
    const total = Object.values(valueByAccount).reduce((s, v) => s + v, 0);
    if (total > 0) {
      const exp = await getAccountByCode(client, expenseCode(dept.name));
      const jl = [{ accountId: exp.id, debit: total, credit: 0, costCenterId: dept.cost_center_id }];
      for (const [code, v] of Object.entries(valueByAccount)) jl.push({ accountId: (await getAccountByCode(client, code)).id, debit: 0, credit: v, costCenterId: dept.cost_center_id });
      await postJournalEntry(client, { entryDate: new Date().toISOString().slice(0, 10), description: `Materials issued ${issue.issue_number} to ${dept.name}`, source: 'system', referenceType: 'material_issue', referenceId: issue.id, createdBy: req.user.id, lines: jl });
    }
    await audit(client, { entityType: 'material_issue', entityId: issue.id, action: 'issue', user: req.user, newValue: { issue_number: issue.issue_number, requisition_id: pr.id, lines: lines.length, value: total } });
    return issue;
  });
  res.status(201).json({ data: out, error: null });
}));

router.post('/:id/confirm', validate(schemas.issueConfirm), asyncHandler(async (req, res) => {
  const { decision, comments } = req.body;
  const out = await withTransaction(async (client) => {
    const m = (await client.query(
      `SELECT m.*, pr.requested_by FROM material_issues m JOIN purchase_requisitions pr ON pr.id = m.requisition_id WHERE m.id = $1 FOR UPDATE OF m`, [Number(req.params.id)])).rows[0];
    if (!m) throw new ApiError(404, 'Issue not found');
    const head = await isDepartmentHead(client, req.user.id, m.department_id);
    if (!(m.requested_by === req.user.id || head)) throw new ApiError(404, 'Issue not found');
    if (m.issued_by === req.user.id) throw new ApiError(403, 'The person who issued the materials cannot confirm receipt');
    if (m.status !== 'issued') throw new ApiError(409, `This issue is already ${m.status}`);
    if (decision === 'dispute' && !(comments && comments.trim())) throw new ApiError(400, 'Comments are required to dispute an issue');
    await client.query(`UPDATE material_issues SET status = $1, confirmed_by = $2, confirmed_at = now(), confirm_notes = $3 WHERE id = $4`, [decision === 'confirm' ? 'confirmed' : 'disputed', req.user.id, comments || null, m.id]);
    await recordApproval(client, { entityType: 'material_issue', entityId: m.id, step: 'issue_confirmation', decision: decision === 'confirm' ? 'confirmed' : 'disputed', user: req.user, comments, snapshot: { issue_number: m.issue_number, requisition_id: m.requisition_id } });
    await audit(client, { entityType: 'material_issue', entityId: m.id, action: `confirm:${decision}`, user: req.user, oldValue: { status: 'issued' }, newValue: { decision, comments } });
    if (decision === 'dispute') {
      // A disputed issue is undone in full: the goods go back to the warehouse (stock IN) and the expense journal is reversed,
      // so the quantity can be re-issued without ever double-counting stock.
      for (const it of (await client.query('SELECT product_id, quantity FROM material_issue_items WHERE issue_id = $1', [m.id])).rows) {
        await postStockMovement(client, { productId: it.product_id, warehouseId: m.warehouse_id, movementType: 'IN', quantity: Number(it.quantity), referenceType: 'issue', referenceId: m.id, performedBy: req.user.id, notes: `Reversal of disputed ${m.issue_number}` });
      }
      for (const e of (await client.query(`SELECT id FROM journal_entries WHERE reference_type = 'material_issue' AND reference_id = $1 AND status = 'posted'`, [m.id])).rows) {
        await reverseJournalEntry(client, { entryId: e.id, createdBy: req.user.id, description: `Reversal of disputed ${m.issue_number}` });
      }
    }
    if (decision === 'confirm') {
      const lines = await issuable(client, m.requisition_id);
      const open = (await client.query(`SELECT 1 FROM material_issues WHERE requisition_id = $1 AND status = 'issued' LIMIT 1`, [m.requisition_id])).rows[0];
      const po = (await client.query(`SELECT 1 FROM purchase_orders WHERE requisition_id = $1 AND status = 'received' LIMIT 1`, [m.requisition_id])).rows[0];
      if (po && !open && lines.every((l) => l.issued + 1e-9 >= l.accepted && l.accepted > 0)) {
        await client.query(`UPDATE purchase_requisitions SET status = 'closed', updated_at = now() WHERE id = $1 AND status = 'fulfilled'`, [m.requisition_id]);
        await audit(client, { entityType: 'requisition', entityId: m.requisition_id, action: 'closed', user: req.user, oldValue: { status: 'fulfilled' }, newValue: { status: 'closed' } });
      }
    }
    return (await client.query('SELECT * FROM material_issues WHERE id = $1', [m.id])).rows[0];
  });
  res.json({ data: out, error: null });
}));

module.exports = router;
