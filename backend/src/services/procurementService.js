// Shared procurement helpers: atomic reference numbers, the append-only audit log, signed approvals,
// department-head checks and requisition visibility. Everything that mutates takes a transaction client.
const crypto = require('crypto');

// PR-2026-00001 style numbers, atomic under concurrency (single-statement UPSERT on the counter row).
async function nextRef(client, prefix) {
  const year = new Date().getFullYear();
  const { rows } = await client.query(
    `INSERT INTO procurement_counters (prefix, year, next_value) VALUES ($1, $2, 2)
     ON CONFLICT (prefix, year) DO UPDATE SET next_value = procurement_counters.next_value + 1
     RETURNING next_value - 1 AS issued`,
    [prefix, year]
  );
  return `${prefix}-${year}-${String(rows[0].issued).padStart(5, '0')}`;
}

async function audit(client, { entityType, entityId, action, user, oldValue = null, newValue = null }) {
  await client.query(
    `INSERT INTO procurement_audit_logs (entity_type, entity_id, action, actor_id, actor_role, old_value, new_value)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [entityType, entityId, action, user.id, user.role, oldValue ? JSON.stringify(oldValue) : null, newValue ? JSON.stringify(newValue) : null]
  );
}

// A decision on a document. The signature hash covers the exact snapshot that was approved, who approved it, in
// which role, for which step and when - so the record can be re-verified later and any later edit is detectable.
// Canonical JSON (keys sorted recursively) so the same content always hashes the same, no matter how PostgreSQL's JSONB
// re-orders the keys of the stored snapshot - which is what lets a signature be re-verified later.
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  return JSON.stringify(value === undefined ? null : value);
}
function signatureFor({ snapshot, user, step, decision, decidedAt }) {
  return crypto.createHash('sha256')
    .update(canonicalJson({ snapshot, actor_id: user.id, role: user.role, step, decision, decided_at: decidedAt }))
    .digest('hex');
}
// Re-computes the signature of a stored approval row (snapshot, actor_id, actor_role, step, decision, decided_at).
function verifySignature(row) {
  const decidedAt = row.decided_at instanceof Date ? row.decided_at.toISOString() : row.decided_at;
  return signatureFor({ snapshot: row.snapshot, user: { id: row.actor_id, role: row.actor_role }, step: row.step, decision: row.decision, decidedAt }) === row.signature_hash;
}

async function recordApproval(client, { entityType, entityId, step, decision, user, comments = null, snapshot = null }) {
  const decidedAt = new Date().toISOString();
  const signature = signatureFor({ snapshot, user, step, decision, decidedAt });
  const { rows } = await client.query(
    `INSERT INTO procurement_approvals (entity_type, entity_id, step, decision, actor_id, actor_role, comments, decided_at, signature_hash, snapshot)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id, decided_at, signature_hash`,
    [entityType, entityId, step, decision, user.id, user.role, comments, decidedAt, signature, snapshot ? JSON.stringify(snapshot) : null]
  );
  return rows[0];
}

// Is this user the head of the department? (departments.manager_id is the single source of truth.)
async function isDepartmentHead(client, userId, departmentId) {
  const { rows } = await client.query('SELECT 1 FROM departments WHERE id = $1 AND manager_id = $2', [departmentId, userId]);
  return rows.length > 0;
}

// Requisitions this role may see. Staff see only their own; the head sees their department; Operation Manager and
// Admin see everything; Procurement/Finance see requests that have passed approval (plus anything they raised).
const POST_APPROVAL = ['approved', 'sourcing', 'po_issued', 'fulfilled', 'closed'];
function visibilitySql(user, params, alias = 'pr') {
  if (user.role === 'Admin' || user.role === 'Operation Manager') return 'TRUE';
  params.push(user.id);
  const me = `$${params.length}`;
  const own = `${alias}.requested_by = ${me}`;
  if (user.role === 'Department Head') {
    return `(${own} OR ${alias}.department_id IN (SELECT id FROM departments WHERE manager_id = ${me}))`;
  }
  if (user.role === 'Procurement Officer') {
    return `(${own} OR ${alias}.assigned_to = ${me} OR ${alias}.status IN (${POST_APPROVAL.map((s) => `'${s}'`).join(',')}))`;
  }
  if (user.role === 'Finance Officer') {
    return `(${own} OR ${alias}.status IN (${POST_APPROVAL.map((s) => `'${s}'`).join(',')}))`;
  }
  if (user.role === 'Storekeeper' || user.role === 'Inventory Manager') {
    return `(${own} OR ${alias}.status IN ('po_issued','fulfilled'))`;
  }
  return own;
}

module.exports = { nextRef, audit, signatureFor, verifySignature, canonicalJson, recordApproval, isDepartmentHead, visibilitySql, POST_APPROVAL };
