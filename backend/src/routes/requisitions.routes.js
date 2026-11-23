// Purchase Requisitions: department request -> Department Head review -> Operation Manager approval (signed) ->
// assignment to a Procurement Officer. Mounted at /api/v1/procurement/requisitions.
const { Router } = require('express');
const multer = require('multer');
const { pool, withTransaction } = require('../config/db');
const { asyncHandler, ApiError } = require('../utils/asyncHandler');
const { validate } = require('../middleware/validate');
const schemas = require('../validation/schemas');
const { nextRef, audit, recordApproval, isDepartmentHead, visibilitySql } = require('../services/procurementService');

const router = Router();

const MAX_FILE = 5 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  'application/pdf', 'image/png', 'image/jpeg', 'text/plain',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
]);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE, files: 1 } });
function receiveFile(req, res, next) {
  upload.single('file')(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') return next(new ApiError(413, 'File too large (5 MB maximum)'));
    return next(new ApiError(400, 'Upload failed: send one file in the "file" field'));
  });
}

const isAdminLike = (u) => u.role === 'Admin';
const isOps = (u) => u.role === 'Operation Manager' || u.role === 'Admin';

async function loadVisible(client, id, user, { lock = false } = {}) {
  const params = [id];
  const vis = visibilitySql(user, params);
  const { rows } = await client.query(
    `SELECT pr.*, d.name AS department_name, ru.full_name AS requester_name
     FROM purchase_requisitions pr
     JOIN departments d ON d.id = pr.department_id
     JOIN users ru ON ru.id = pr.requested_by
     WHERE pr.id = $1 AND ${vis} ${lock ? 'FOR UPDATE OF pr' : ''}`,
    params
  );
  if (!rows[0]) throw new ApiError(404, 'Requisition not found'); // also returned when the caller may not see it
  return rows[0];
}

async function loadLines(client, id) {
  const { rows } = await client.query(
    `SELECT l.*, p.sku, p.name AS product_name, (l.quantity * l.estimated_unit_cost) AS estimated_total
     FROM purchase_requisition_lines l LEFT JOIN products p ON p.id = l.product_id
     WHERE l.requisition_id = $1 ORDER BY l.line_no`,
    [id]
  );
  return rows;
}

function snapshotOf(pr, lines) {
  return {
    pr_number: pr.pr_number, version: pr.version, department_id: pr.department_id, requested_by: pr.requested_by,
    title: pr.title, justification: pr.justification, priority: pr.priority, required_date: pr.required_date,
    estimated_total: Number(pr.estimated_total),
    lines: lines.map((l) => ({ line_no: l.line_no, product_id: l.product_id, item_name: l.item_name, quantity: Number(l.quantity), unit: l.unit, estimated_unit_cost: Number(l.estimated_unit_cost) }))
  };
}

// What the signed-in user may do with this requisition right now (also drives the UI buttons).
async function actionsFor(client, user, pr) {
  const own = pr.requested_by === user.id;
  const head = user.role === 'Department Head' ? await isDepartmentHead(client, user.id, pr.department_id) : false;
  const editable = ['draft', 'returned_for_revision'].includes(pr.status);
  return {
    can_edit: own && editable,
    can_submit: own && editable,
    can_review: pr.status === 'submitted' && !own && (head || isAdminLike(user)),
    can_approve: pr.status === 'dept_approved' && !own && isOps(user),
    can_assign: pr.status === 'approved' && isOps(user),
    can_cancel: (own && ['draft', 'submitted', 'returned_for_revision'].includes(pr.status)) || (isOps(user) && !['po_issued', 'fulfilled', 'closed', 'cancelled'].includes(pr.status)),
    can_attach: !['closed', 'cancelled'].includes(pr.status) && (own || head || isOps(user) || pr.assigned_to === user.id)
  };
}

async function insertLines(client, requisitionId, lines) {
  let total = 0;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    total += l.quantity * l.estimated_unit_cost;
    await client.query(
      `INSERT INTO purchase_requisition_lines (requisition_id, line_no, product_id, item_name, description, quantity, unit, estimated_unit_cost)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [requisitionId, i + 1, l.product_id || null, l.item_name, l.description || null, l.quantity, l.unit, l.estimated_unit_cost]
    );
  }
  return Math.round(total * 100) / 100;
}

async function move(client, pr, lines, { to, step, decision, user, comments, extraSet = '', extraParams = [] }) {
  const old = { status: pr.status };
  await client.query(`UPDATE purchase_requisitions SET status = $1, updated_at = now()${extraSet} WHERE id = $${extraParams.length + 2}`, [to, ...extraParams, pr.id]);
  const approval = await recordApproval(client, { entityType: 'requisition', entityId: pr.id, step, decision, user, comments, snapshot: snapshotOf(pr, lines) });
  await audit(client, { entityType: 'requisition', entityId: pr.id, action: `${step}:${decision}`, user, oldValue: old, newValue: { status: to, comments } });
  return approval;
}

// ---------------------------------------------------------------- list
router.get('/', asyncHandler(async (req, res) => {
  const { status, department_id, mine, pending } = req.query;
  const params = [];
  const where = [visibilitySql(req.user, params)];
  if (status) { params.push(status); where.push(`pr.status = $${params.length}`); }
  if (department_id) { params.push(Number(department_id)); where.push(`pr.department_id = $${params.length}`); }
  if (mine) { params.push(req.user.id); where.push(`pr.requested_by = $${params.length}`); }
  if (pending) {
    params.push(req.user.id);
    const me = `$${params.length}`;
    const forRole = {
      'Department Head': `(pr.status = 'submitted' AND pr.requested_by <> ${me} AND pr.department_id IN (SELECT id FROM departments WHERE manager_id = ${me}))`,
      'Operation Manager': `(pr.status IN ('dept_approved','approved') AND pr.requested_by <> ${me})`,
      Admin: `(pr.status IN ('submitted','dept_approved','approved'))`,
      'Procurement Officer': `(pr.assigned_to = ${me} AND pr.status = 'sourcing')`
    }[req.user.role];
    where.push(`(${forRole ? forRole + ' OR ' : ''}(pr.requested_by = ${me} AND pr.status = 'returned_for_revision'))`);
  }
  const { rows } = await pool.query(
    `SELECT pr.id, pr.pr_number, pr.title, pr.priority, pr.required_date, pr.status, pr.estimated_total, pr.submitted_at, pr.created_at,
            pr.department_id, d.name AS department_name, pr.requested_by, ru.full_name AS requester_name,
            pr.assigned_to, au.full_name AS assigned_name,
            (SELECT count(*)::int FROM purchase_requisition_lines l WHERE l.requisition_id = pr.id) AS line_count
     FROM purchase_requisitions pr
     JOIN departments d ON d.id = pr.department_id
     JOIN users ru ON ru.id = pr.requested_by
     LEFT JOIN users au ON au.id = pr.assigned_to
     WHERE ${where.join(' AND ')}
     ORDER BY pr.created_at DESC, pr.id DESC LIMIT 500`,
    params
  );
  res.json({ data: rows, error: null });
}));

// Active Procurement Officers (for the Operation Manager's assignment dropdown).
router.get('/meta/officers', asyncHandler(async (req, res) => {
  if (!isOps(req.user)) throw new ApiError(403, 'Only the Operation Manager can list procurement officers');
  const { rows } = await pool.query(
    `SELECT u.id, u.full_name FROM users u JOIN roles r ON r.id = u.role_id WHERE u.is_active AND r.name = 'Procurement Officer' ORDER BY u.full_name`);
  res.json({ data: rows, error: null });
}));

// ---------------------------------------------------------------- detail
router.get('/:id', asyncHandler(async (req, res) => {
  const client = await pool.connect();
  try {
    const pr = await loadVisible(client, Number(req.params.id), req.user);
    const lines = await loadLines(client, pr.id);
    const approvals = (await client.query(
      `SELECT a.id, a.step, a.decision, a.actor_id, u.full_name AS actor_name, a.actor_role, a.comments, a.decided_at, a.signature_hash
       FROM procurement_approvals a JOIN users u ON u.id = a.actor_id
       WHERE a.entity_type = 'requisition' AND a.entity_id = $1 ORDER BY a.id`, [pr.id])).rows;
    const attachments = (await client.query(
      `SELECT a.id, a.file_name, a.mime_type, a.file_size, a.uploaded_at, u.full_name AS uploaded_by_name
       FROM attachments a JOIN users u ON u.id = a.uploaded_by WHERE a.entity_type = 'requisition' AND a.entity_id = $1 ORDER BY a.id`, [pr.id])).rows;
    const assigned = pr.assigned_to ? (await client.query('SELECT full_name FROM users WHERE id = $1', [pr.assigned_to])).rows[0] : null;
    res.json({ data: { ...pr, assigned_name: assigned && assigned.full_name, lines, approvals, attachments, actions: await actionsFor(client, req.user, pr) }, error: null });
  } finally { client.release(); }
}));

// ---------------------------------------------------------------- create
router.post('/', validate(schemas.requisitionCreate), asyncHandler(async (req, res) => {
  const { department_id, title, justification, priority, required_date, lines, submit } = req.body;
  const result = await withTransaction(async (client) => {
    const me = (await client.query('SELECT department_id FROM users WHERE id = $1', [req.user.id])).rows[0];
    let deptId = me && me.department_id;
    if (department_id && department_id !== deptId) {
      if (!isOps(req.user)) throw new ApiError(403, 'You can only raise requisitions for your own department');
      deptId = department_id;
    }
    if (!deptId) throw new ApiError(400, 'Your account is not assigned to a department. Ask an administrator to assign one.');
    const total = lines.reduce((s, l) => s + l.quantity * l.estimated_unit_cost, 0);
    const prNumber = await nextRef(client, 'PR');
    const { rows } = await client.query(
      `INSERT INTO purchase_requisitions (pr_number, department_id, requested_by, title, justification, priority, required_date, estimated_total)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [prNumber, deptId, req.user.id, title, justification, priority, required_date || null, Math.round(total * 100) / 100]
    );
    const pr = rows[0];
    await insertLines(client, pr.id, lines);
    await audit(client, { entityType: 'requisition', entityId: pr.id, action: 'create', user: req.user, newValue: { pr_number: prNumber, title, lines: lines.length, estimated_total: pr.estimated_total } });
    if (submit) await submitRequisition(client, pr, req.user);
    return pr.id;
  });
  const client = await pool.connect();
  try {
    const pr = await loadVisible(client, result, req.user);
    res.status(201).json({ data: pr, error: null });
  } finally { client.release(); }
}));

async function submitRequisition(client, pr, user) {
  const lines = await loadLines(client, pr.id);
  if (!lines.length) throw new ApiError(400, 'Add at least one line item before submitting');
  const head = await isDepartmentHead(client, pr.requested_by, pr.department_id);
  // A request raised by the department head cannot be reviewed by that same head: it goes straight to the Operation Manager.
  const to = head ? 'dept_approved' : 'submitted';
  await client.query(`UPDATE purchase_requisitions SET submitted_at = now() WHERE id = $1`, [pr.id]);
  await move(client, { ...pr, status: pr.status }, lines, { to, step: 'submission', decision: 'submitted', user,
    comments: head ? 'Raised by the department head: department review skipped, sent to the Operation Manager' : null });
}

// ---------------------------------------------------------------- edit (requester only, draft / returned)
router.put('/:id', validate(schemas.requisitionUpdate), asyncHandler(async (req, res) => {
  const { title, justification, priority, required_date, lines } = req.body;
  const out = await withTransaction(async (client) => {
    const pr = await loadVisible(client, Number(req.params.id), req.user, { lock: true });
    if (pr.requested_by !== req.user.id && !isAdminLike(req.user)) throw new ApiError(403, 'Only the requester can edit this requisition');
    if (!['draft', 'returned_for_revision'].includes(pr.status)) throw new ApiError(409, `A ${pr.status} requisition cannot be edited`);
    const before = snapshotOf(pr, await loadLines(client, pr.id));
    await client.query('DELETE FROM purchase_requisition_lines WHERE requisition_id = $1', [pr.id]);
    const total = await insertLines(client, pr.id, lines);
    const bump = pr.status === 'returned_for_revision' ? ', version = version + 1' : '';
    await client.query(
      `UPDATE purchase_requisitions SET title = $1, justification = $2, priority = $3, required_date = $4, estimated_total = $5, updated_at = now()${bump} WHERE id = $6`,
      [title, justification, priority, required_date || null, total, pr.id]);
    await audit(client, { entityType: 'requisition', entityId: pr.id, action: 'update', user: req.user, oldValue: before, newValue: { title, justification, priority, required_date, estimated_total: total, lines: lines.length } });
    return pr.id;
  });
  const client = await pool.connect();
  try { res.json({ data: await loadVisible(client, out, req.user), error: null }); } finally { client.release(); }
}));

// ---------------------------------------------------------------- submit
router.post('/:id/submit', asyncHandler(async (req, res) => {
  await withTransaction(async (client) => {
    const pr = await loadVisible(client, Number(req.params.id), req.user, { lock: true });
    if (pr.requested_by !== req.user.id) throw new ApiError(403, 'Only the requester can submit this requisition');
    if (!['draft', 'returned_for_revision'].includes(pr.status)) throw new ApiError(409, `A ${pr.status} requisition cannot be submitted`);
    await submitRequisition(client, pr, req.user);
  });
  const client = await pool.connect();
  try { res.json({ data: await loadVisible(client, Number(req.params.id), req.user), error: null }); } finally { client.release(); }
}));

// ---------------------------------------------------------------- Department Head review
const DECISION = {
  approve: { decision: 'approved' },
  reject: { decision: 'rejected', needsComment: true },
  revision: { decision: 'revision_requested', needsComment: true }
};

router.post('/:id/review', validate(schemas.requisitionDecision), asyncHandler(async (req, res) => {
  const { decision, comments } = req.body;
  await withTransaction(async (client) => {
    const pr = await loadVisible(client, Number(req.params.id), req.user, { lock: true });
    if (pr.status !== 'submitted') throw new ApiError(409, `This requisition is ${pr.status}, not waiting for department review`);
    if (pr.requested_by === req.user.id) throw new ApiError(403, 'You cannot review your own requisition');
    const head = await isDepartmentHead(client, req.user.id, pr.department_id);
    if (!(req.user.role === 'Department Head' && head) && !isAdminLike(req.user)) throw new ApiError(403, 'Only the head of this department can review it');
    const d = DECISION[decision];
    if (d.needsComment && !(comments && comments.trim())) throw new ApiError(400, 'Comments are required when rejecting or requesting a revision');
    const to = { approve: 'dept_approved', reject: 'rejected', revision: 'returned_for_revision' }[decision];
    await move(client, pr, await loadLines(client, pr.id), { to, step: 'dept_review', decision: d.decision, user: req.user, comments });
  });
  const client = await pool.connect();
  try { res.json({ data: await loadVisible(client, Number(req.params.id), req.user), error: null }); } finally { client.release(); }
}));

// ---------------------------------------------------------------- Operation Manager approval (signed)
router.post('/:id/approve', validate(schemas.requisitionDecision), asyncHandler(async (req, res) => {
  const { decision, comments } = req.body;
  if (!isOps(req.user)) throw new ApiError(403, 'Only the Operation Manager can approve requisitions');
  await withTransaction(async (client) => {
    const pr = await loadVisible(client, Number(req.params.id), req.user, { lock: true });
    if (pr.status !== 'dept_approved') throw new ApiError(409, `This requisition is ${pr.status}, not waiting for Operation Manager approval`);
    if (pr.requested_by === req.user.id) throw new ApiError(403, 'You cannot approve your own requisition');
    const d = DECISION[decision];
    if (d.needsComment && !(comments && comments.trim())) throw new ApiError(400, 'Comments are required when rejecting or requesting a revision');
    const to = { approve: 'approved', reject: 'rejected', revision: 'returned_for_revision' }[decision];
    await move(client, pr, await loadLines(client, pr.id), { to, step: 'ops_approval', decision: d.decision, user: req.user, comments });
  });
  const client = await pool.connect();
  try { res.json({ data: await loadVisible(client, Number(req.params.id), req.user), error: null }); } finally { client.release(); }
}));

// ---------------------------------------------------------------- assign to a Procurement Officer
router.post('/:id/assign', validate(schemas.requisitionAssign), asyncHandler(async (req, res) => {
  const { assigned_to, comments } = req.body;
  if (!isOps(req.user)) throw new ApiError(403, 'Only the Operation Manager can assign requisitions to procurement');
  await withTransaction(async (client) => {
    const pr = await loadVisible(client, Number(req.params.id), req.user, { lock: true });
    if (pr.status !== 'approved') throw new ApiError(409, `Only approved requisitions can be assigned (this one is ${pr.status})`);
    const officer = (await client.query(
      `SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = $1 AND u.is_active AND r.name = 'Procurement Officer'`, [assigned_to])).rows[0];
    if (!officer) throw new ApiError(400, 'The assignee must be an active Procurement Officer');
    if (assigned_to === pr.requested_by) throw new ApiError(409, 'A Procurement Officer cannot source their own requisition');
    await move(client, pr, await loadLines(client, pr.id), { to: 'sourcing', step: 'assignment', decision: 'assigned', user: req.user, comments, extraSet: ', assigned_to = $2', extraParams: [assigned_to] });
  });
  const client = await pool.connect();
  try { res.json({ data: await loadVisible(client, Number(req.params.id), req.user), error: null }); } finally { client.release(); }
}));

// ---------------------------------------------------------------- cancel
router.post('/:id/cancel', validate(schemas.requisitionCancel), asyncHandler(async (req, res) => {
  await withTransaction(async (client) => {
    const pr = await loadVisible(client, Number(req.params.id), req.user, { lock: true });
    const own = pr.requested_by === req.user.id;
    const okOwn = own && ['draft', 'submitted', 'returned_for_revision'].includes(pr.status);
    const okOps = isOps(req.user) && !['po_issued', 'fulfilled', 'closed', 'cancelled'].includes(pr.status);
    if (!okOwn && !okOps) throw new ApiError(403, 'You cannot cancel this requisition in its current state');
    await move(client, pr, await loadLines(client, pr.id), { to: 'cancelled', step: 'submission', decision: 'cancelled', user: req.user, comments: req.body.comments });
  });
  const client = await pool.connect();
  try { res.json({ data: await loadVisible(client, Number(req.params.id), req.user), error: null }); } finally { client.release(); }
}));

// ---------------------------------------------------------------- attachments (stored in the database, <= 5 MB)
router.post('/:id/attachments', receiveFile, asyncHandler(async (req, res) => {
  if (!req.file) throw new ApiError(400, 'No file received');
  if (!ALLOWED_MIME.has(req.file.mimetype)) throw new ApiError(415, 'Allowed types: PDF, PNG, JPEG, TXT, DOCX, XLSX');
  const att = await withTransaction(async (client) => {
    const pr = await loadVisible(client, Number(req.params.id), req.user, { lock: true });
    const a = await actionsFor(client, req.user, pr);
    if (!a.can_attach) throw new ApiError(403, 'You cannot attach files to this requisition');
    const name = String(req.file.originalname || 'file').replace(/[^\w.\- ()]/g, '_').slice(0, 200);
    const { rows } = await client.query(
      `INSERT INTO attachments (entity_type, entity_id, file_name, file_path, mime_type, file_size, uploaded_by, content)
       VALUES ('requisition', $1, $2, 'db://requisition', $3, $4, $5, $6) RETURNING id, file_name, mime_type, file_size, uploaded_at`,
      [pr.id, name, req.file.mimetype, req.file.size, req.user.id, req.file.buffer]);
    await audit(client, { entityType: 'requisition', entityId: pr.id, action: 'attach', user: req.user, newValue: { file: name, size: req.file.size } });
    return rows[0];
  });
  res.status(201).json({ data: att, error: null });
}));

router.get('/:id/attachments/:aid', asyncHandler(async (req, res) => {
  const client = await pool.connect();
  try {
    const pr = await loadVisible(client, Number(req.params.id), req.user);
    const { rows } = await client.query(
      `SELECT file_name, mime_type, content FROM attachments WHERE id = $1 AND entity_type = 'requisition' AND entity_id = $2`, [Number(req.params.aid), pr.id]);
    if (!rows[0] || !rows[0].content) throw new ApiError(404, 'Attachment not found');
    res.set('Content-Type', rows[0].mime_type || 'application/octet-stream');
    res.set('Content-Disposition', `attachment; filename="${rows[0].file_name.replace(/"/g, '')}"`);
    res.send(rows[0].content);
  } finally { client.release(); }
}));

module.exports = router;
