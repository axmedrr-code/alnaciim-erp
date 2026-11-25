// Procurement Phase 2 (sourcing, quotations, PO authorization) - end-to-end API tests against a DATABASE THAT HAS migration 026 applied.
//
//   TEST_DATABASE_URL=... node backend/tests/procurement/phase2.sourcing.test.js
//
// It starts the real backend on a free port with a throwaway JWT secret, creates its own role accounts (@alnaciim.test),
// and only ever inserts test rows. It requires a dedicated TEST_DATABASE_URL whose database name contains "test".
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const crypto = require('crypto');
const { spawn } = require('child_process');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const DB = process.env.TEST_DATABASE_URL;
if (!DB) { console.log('refusing: set TEST_DATABASE_URL to an isolated test database'); process.exit(1); }
const parsedDbUrl = new URL(DB);
const host = parsedDbUrl.hostname.toLowerCase();
const dbName = decodeURIComponent(parsedDbUrl.pathname.replace(/^\/+/, '')).toLowerCase();
if (!(host.endsWith('.neon.tech') || host === 'localhost' || host === '127.0.0.1') || !(/(^|[-_])test($|[-_])/.test(dbName) || (process.env.TEST_DATABASE_EXPECT_HOST && process.env.TEST_DATABASE_EXPECT_HOST.toLowerCase() === host))) {
  console.log('refusing: TEST_DATABASE_URL must point to localhost or Neon and the database name must include a test suffix');
  process.exit(1);
}
const SSL = process.env.TEST_DATABASE_SSL === 'true';
const SECRET = crypto.randomBytes(24).toString('hex');
const PORT = 4900 + Math.floor(Math.random() * 90);
let pass = 0, total = 0;
const rep = (name, ok, extra = '') => { total++; if (ok) pass++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ACCOUNTS = [
  // key, role, department id (1 Production, 2 Sales, 4 Procurement, 6 Warehouse, 8 Finance, 9 Administration)
  ['req1', 'Technician', 1], ['req1b', 'Technician', 1], ['head1', 'Department Head', 1],
  ['req2', 'Sales Manager', 2], ['head2', 'Department Head', 2],
  ['ops', 'Operation Manager', 9], ['officer', 'Procurement Officer', 4], ['officer2', 'Procurement Officer', 4],
  ['fin', 'Finance Officer', 8], ['store', 'Storekeeper', 6], ['nodept', 'Cashier', null]
];

(async () => {
  const pool = new Pool({ connectionString: DB, ssl: SSL ? { rejectUnauthorized: false } : false, max: 2 }); pool.on('error', () => {});
  const q = async (s, p) => (await pool.query(s, p)).rows;
  const roles = Object.fromEntries((await q('select id, name from roles')).map((r) => [r.name, r.id]));
  if (!roles['Department Head'] || !roles['Operation Manager']) { console.log('migration 026 is not applied here (roles missing)'); process.exit(1); }
  const discarded = await bcrypt.hash(crypto.randomBytes(16).toString('hex'), 10);
  const U = {};
  for (const [key, role, dept] of ACCOUNTS) {
    const email = `proc.${key}@alnaciim.test`;
    const ex = await q('select id from users where email=$1', [email]);
    if (ex[0]) { await pool.query('update users set role_id=$1, department_id=$2, is_active=true where id=$3', [roles[role], dept, ex[0].id]); U[key] = { id: ex[0].id, role }; }
    else { const r = await q(`insert into users (employee_code, full_name, email, password_hash, role_id, department_id, is_active) values ($1,$2,$3,$4,$5,$6,true) returning id`, [`PROC-${key.toUpperCase()}`, `Proc Test ${key}`, email, discarded, roles[role], dept]); U[key] = { id: r[0].id, role }; }
  }
  await pool.query('update departments set manager_id=$1 where id=1', [U.head1.id]);
  await pool.query('update departments set manager_id=$1 where id=2', [U.head2.id]);
  const admin = (await q(`select u.id from users u join roles r on r.id=u.role_id where r.name='Admin' and u.is_active order by u.id limit 1`))[0];
  U.admin = { id: admin.id, role: 'Admin' };
  const tok = {}; for (const [k, v] of Object.entries(U)) tok[k] = jwt.sign({ id: v.id, email: k, role: 'x' }, SECRET, { algorithm: 'HS256', expiresIn: '1h' });

  const srv = spawn(process.execPath, ['--no-warnings', 'src/index.js'], { cwd: path.join(__dirname, '../..'), env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, PORT: String(PORT), DATABASE_URL: DB, DATABASE_SSL: SSL ? 'true' : '', JWT_SECRET: SECRET, BACKUP_CRON_SCHEDULE: 'disabled', CORS_ORIGIN: '', NODE_ENV: '', AUTH_CACHE_TTL_MS: '0', RATE_LIMIT_API_MAX: '1000000' }, stdio: 'ignore' });
  let up = false; for (let i = 0; i < 60 && !up; i++) { await sleep(300); try { up = (await fetch(`http://localhost:${PORT}/health`)).ok; } catch (_) {} }
  if (!up) { console.log('backend did not start'); srv.kill(); process.exit(1); }
  const api = async (who, method, p, body) => {
    const isForm = body instanceof FormData;
    const r = await fetch(`http://localhost:${PORT}/api/v1${p}`, { method, headers: { Authorization: 'Bearer ' + tok[who], ...(body && !isForm ? { 'Content-Type': 'application/json' } : {}) }, body: body ? (isForm ? body : JSON.stringify(body)) : undefined });
    const buf = Buffer.from(await r.arrayBuffer()); let j = {}; try { j = JSON.parse(buf.toString()); } catch (_) {}
    return { s: r.status, b: j, raw: buf, ct: r.headers.get('content-type') };
  };
  const LINES = [{ item_name: 'Centrifugal pump 2HP', quantity: 2, unit: 'pcs', estimated_unit_cost: 150.5 }, { item_name: 'Mechanical seal kit', description: 'for pump above', quantity: 5, unit: 'set', estimated_unit_cost: 20 }];
  const mk = async (who, over = {}) => api(who, 'POST', '', { title: 'Pump replacement', justification: 'Pump #3 failed; production line is down', priority: 'high', required_date: '2026-12-15', lines: LINES, ...over });
  const approvalsOf = async (id) => q(`select step, decision, actor_id, actor_role, signature_hash from procurement_approvals where entity_type='requisition' and entity_id=$1 order by id`, [id]);
  const PR = '/procurement/requisitions', PF = '/procurement';
  const toSourcing = async () => {
    let r = await api('req1', 'POST', PR, { title: 'Sourcing test', justification: 'Needed for line maintenance', priority: 'normal', required_date: '2026-12-30', lines: LINES });
    const id = r.b.data.id;
    await api('req1', 'POST', `${PR}/${id}/submit`);
    await api('head1', 'POST', `${PR}/${id}/review`, { decision: 'approve' });
    await api('ops', 'POST', `${PR}/${id}/approve`, { decision: 'approve' });
    r = await api('ops', 'POST', `${PR}/${id}/assign`, { assigned_to: U.officer.id });
    if (r.s !== 200) throw new Error('could not reach sourcing: ' + r.s);
    return (await api('officer', 'GET', `${PR}/${id}`)).b.data;
  };
  const sup = async (n) => (await q(`select id from suppliers where is_active order by id limit ${n}`)).map((s) => s.id);
  if ((await sup(3)).length < 3) { await pool.query(`insert into suppliers (code, name, is_active) select 'TST-'||g, 'Test Supplier '||g, true from generate_series(1, 3) g on conflict do nothing`); }
  const S = await sup(3);
  const prod = (await q('select id from products where is_active order by id limit 2')).map((p) => p.id);

  const pr = await toSourcing();
  const L = pr.lines.map((l) => l.id);
  rep('Requisition reaches sourcing assigned to the Procurement Officer', pr.status === 'sourcing' && pr.assigned_to === U.officer.id);

  // ---------- quotation requests + access
  let r = await api('officer2', 'POST', `${PF}/requisitions/${pr.id}/quotations`, { supplier_ids: [S[0]] }); rep('A different Procurement Officer cannot work on it (404)', r.s === 404, `[${r.s}]`);
  r = await api('req1', 'GET', `${PF}/requisitions/${pr.id}/quotations`); rep('Requester cannot see supplier quotations (404)', r.s === 404);
  r = await api('head1', 'GET', `${PF}/requisitions/${pr.id}/comparison`); rep('Department Head cannot see the price comparison (404)', r.s === 404);
  r = await api('ops', 'POST', `${PF}/requisitions/${pr.id}/quotations`, { supplier_ids: [S[0]] }); rep('Operation Manager can read but not run sourcing (403)', r.s === 403, `[${r.s}]`);
  r = await api('officer', 'POST', `${PF}/requisitions/${pr.id}/quotations`, { supplier_ids: [] }); rep('Empty supplier list -> 400', r.s === 400);
  r = await api('officer', 'POST', `${PF}/requisitions/${pr.id}/quotations`, { supplier_ids: [999999] }); rep('Unknown supplier -> 400', r.s === 400);
  r = await api('officer', 'POST', `${PF}/requisitions/${pr.id}/quotations`, { supplier_ids: S });
  const Q = r.b.data || [];
  rep('Officer requests quotations from 3 suppliers (QT numbers)', r.s === 201 && Q.length === 3 && Q.every((x) => /^QT-\d{4}-\d{5}$/.test(x.quotation_number)), `[${r.s}]`);
  r = await api('officer', 'POST', `${PF}/requisitions/${pr.id}/quotations`, { supplier_ids: [S[0]] }); rep('Duplicate request to the same supplier -> 409', r.s === 409);

  // ---------- recording quotations
  const rec = (qid, prices, extra = {}) => api('officer', 'PUT', `${PF}/requisitions/${pr.id}/quotations/${qid}`, { delivery_days: 5, payment_terms_days: 30, quality_rating: 3, lines: L.map((id, i) => ({ requisition_line_id: id, unit_price: prices[i] })), ...extra });
  r = await rec(Q[0].id, [-1, 5]); rep('Negative price -> 400', r.s === 400);
  r = await api('officer', 'PUT', `${PF}/requisitions/${pr.id}/quotations/${Q[0].id}`, { delivery_days: 5, payment_terms_days: 30, lines: [{ requisition_line_id: 999999, unit_price: 5 }] }); rep('Price for a foreign line -> 400', r.s === 400);
  r = await rec(Q[0].id, [160, 22], { delivery_days: 10, payment_terms_days: 15, quality_rating: 3 });
  rep('Quotation A recorded; total computed server-side (2x160 + 5x22 = 430)', r.s === 200 && Number(r.b.data.total_amount) === 430 && r.b.data.is_complete === true, `[${r.s}] ${r.b.data && r.b.data.total_amount}`);
  r = await rec(Q[1].id, [140, 20], { delivery_days: 3, payment_terms_days: 45, quality_rating: 5 });
  rep('Quotation B (cheapest: 380) recorded', r.s === 200 && Number(r.b.data.total_amount) === 380);
  r = await api('officer', 'PUT', `${PF}/requisitions/${pr.id}/quotations/${Q[2].id}`, { delivery_days: 2, payment_terms_days: 0, lines: [{ requisition_line_id: L[0], unit_price: 10 }] });
  rep('Quotation C prices only one line -> recorded but flagged incomplete', r.s === 200 && r.b.data.is_complete === false);

  // ---------- comparison
  r = await api('officer', 'GET', `${PF}/requisitions/${pr.id}/comparison`); const cmp = r.b.data;
  const byQ = (id) => cmp.quotations.find((x) => x.id === id);
  rep('Comparison flags lowest total, fastest, best terms, best quality (complete quotations only)', r.s === 200 && byQ(Q[1].id).is_lowest_total && byQ(Q[1].id).is_fastest && byQ(Q[1].id).has_best_payment_terms && byQ(Q[1].id).has_best_quality && !byQ(Q[2].id).is_lowest_total && !byQ(Q[2].id).is_fastest);
  rep('Operation Manager and Finance can read the comparison', (await api('ops', 'GET', `${PF}/requisitions/${pr.id}/comparison`)).s === 200 && (await api('fin', 'GET', `${PF}/requisitions/${pr.id}/comparison`)).s === 200);

  // ---------- selection rules
  r = await api('officer', 'POST', `${PF}/requisitions/${pr.id}/select-supplier`, { quotation_id: Q[2].id }); rep('Incomplete quotation cannot be selected (400)', r.s === 400);
  r = await api('officer', 'POST', `${PF}/requisitions/${pr.id}/select-supplier`, { quotation_id: Q[0].id }); rep('Not the lowest and no justification -> 400', r.s === 400 && /justification/i.test(r.b.error || ''), r.b.error);
  r = await api('officer', 'POST', `${PF}/requisitions/${pr.id}/select-supplier`, { quotation_id: Q[0].id, justification: 'short' }); rep('Justification shorter than 10 characters -> 400', r.s === 400);
  r = await api('officer', 'POST', `${PF}/requisitions/${pr.id}/select-supplier`, { quotation_id: Q[0].id, justification: 'Existing warranty agreement with this supplier' });
  rep('Non-lowest selected with a justification', r.s === 200 && r.b.data.is_lowest === false);
  r = await api('officer', 'POST', `${PF}/requisitions/${pr.id}/select-supplier`, { quotation_id: Q[1].id }); rep('Lowest complete quotation needs no justification (re-selection allowed)', r.s === 200 && r.b.data.is_lowest === true);
  const qs = await q('select id, status from supplier_quotations where requisition_id=$1 order by id', [pr.id]);
  rep('Chosen quotation = selected; the other received one = rejected', qs.find((x) => x.id === Q[1].id).status === 'selected' && qs.find((x) => x.id === Q[0].id).status === 'rejected');
  rep('Selection signed in the approvals table', (await approvalsOf(pr.id)).some((a) => a.step === 'supplier_selection' && a.signature_hash));

  // ---------- PO from selection
  r = await api('officer', 'POST', `${PF}/requisitions/${pr.id}/purchase-order`, {}); rep('PO refused while lines are not linked to stock items (400)', r.s === 400 && /Link every line/i.test(r.b.error || ''), r.b.error);
  r = await api('officer', 'PUT', `${PF}/requisitions/${pr.id}/line-products`, { mappings: [{ line_id: L[0], product_id: 999999 }] }); rep('Mapping to an unknown product -> 400', r.s === 400);
  r = await api('officer', 'PUT', `${PF}/requisitions/${pr.id}/line-products`, { mappings: [{ line_id: L[0], product_id: prod[0] }, { line_id: L[1], product_id: prod[1] }] }); rep('Lines linked to stock items', r.s === 200);
  r = await api('req1', 'POST', `${PF}/requisitions/${pr.id}/purchase-order`, {}); rep('Requester cannot raise the PO (404)', r.s === 404);
  r = await api('officer', 'POST', `${PF}/requisitions/${pr.id}/purchase-order`, {});
  const po = r.b.data || {};
  rep('PO raised from the selected quotation: PO number, pending authorization, total 380 from the quotation', r.s === 201 && /^PO-\d{4}-\d{5}$/.test(po.po_number) && po.status === 'pending_authorization' && Number(po.total_amount) === 380, `[${r.s}] ${po.po_number} ${po.status} ${po.total_amount}`);
  r = await api('officer', 'POST', `${PF}/requisitions/${pr.id}/purchase-order`, {}); rep('Second PO for the same requisition refused (409)', r.s === 409);
  rep('Requisition moved to po_issued', (await api('officer', 'GET', `${PR}/${pr.id}`)).b.data.status === 'po_issued');
  r = await api('officer', 'PUT', `${PF}/requisitions/${pr.id}/quotations/${Q[0].id}`, { delivery_days: 1, payment_terms_days: 1, lines: [{ requisition_line_id: L[0], unit_price: 1 }] }); rep('Quotations are frozen once the PO exists (409)', r.s === 409);

  // ---------- authorization
  rep('Not-yet-authorized PO cannot be sent (409)', (await api('officer', 'POST', `${PF}/po-flow/${po.id}/send`)).s === 409);
  r = await api('officer', 'GET', `${PF}/po-flow/pending`); rep('Pending-authorization queue is closed to the Procurement Officer (403)', r.s === 403);
  r = await api('ops', 'GET', `${PF}/po-flow/pending`); rep('Operation Manager sees the PO in the pending queue', r.s === 200 && r.b.data.some((x) => x.id === po.id));
  r = await api('officer', 'POST', `${PF}/po-flow/${po.id}/authorize`, { decision: 'approve' }); rep('Procurement Officer cannot authorize their own PO (403)', r.s === 403);
  r = await api('fin', 'POST', `${PF}/po-flow/${po.id}/authorize`, { decision: 'approve' }); rep('Finance cannot authorize a PO (403)', r.s === 403);
  r = await api('ops', 'POST', `${PF}/po-flow/${po.id}/authorize`, { decision: 'reject' }); rep('Rejecting without comments -> 400', r.s === 400);
  r = await api('ops', 'POST', `${PF}/po-flow/${po.id}/authorize`, { decision: 'revision', comments: 'Confirm delivery date' });
  rep('Operation Manager returns the PO for revision -> draft', r.s === 200 && r.b.data.status === 'draft');
  rep('A draft PO cannot be authorized (409)', (await api('ops', 'POST', `${PF}/po-flow/${po.id}/authorize`, { decision: 'approve' })).s === 409);
  r = await api('fin', 'POST', `${PF}/po-flow/${po.id}/resubmit`); rep('Finance cannot resubmit (403)', r.s === 403);
  r = await api('officer', 'POST', `${PF}/po-flow/${po.id}/resubmit`); rep('Officer resubmits -> pending authorization', r.s === 200 && r.b.data.status === 'pending_authorization');
  r = await api('ops', 'POST', `${PF}/po-flow/${po.id}/authorize`, { decision: 'approve', comments: 'Approved' }); rep('Operation Manager authorizes', r.s === 200 && r.b.data.status === 'authorized' && r.b.data.authorized_by === U.ops.id);
  r = await api('officer2', 'POST', `${PF}/po-flow/${po.id}/send`); rep('Another officer cannot send it (403)', r.s === 403);
  const wh = (await q('select id from warehouses order by id limit 1'))[0].id;
  const legacy = async (who, method, p, body) => { const x = await fetch(`http://localhost:${PORT}/api/v1/procurement${p}`, { method, headers: { Authorization: 'Bearer ' + tok[who], 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); let j = {}; try { j = await x.json(); } catch (_) {} return { s: x.status, b: j }; };
  const poItems = (await q('select id from purchase_items where purchase_order_id=$1 order by id', [po.id]));
  r = await legacy('store', 'POST', `/purchase-orders/${po.id}/receive`, { warehouse_id: wh, items: [{ purchase_item_id: poItems[0].id, quantity_received: 1 }] }); rep('Goods cannot be received before the PO is sent (409)', r.s === 409, `[${r.s}]`);
  r = await api('officer', 'POST', `${PF}/po-flow/${po.id}/send`); rep('Officer sends the authorized PO to the supplier', r.s === 200 && r.b.data.status === 'sent');
  rep('Sent PO appears in the outstanding list', (await api('officer', 'GET', `${PF}/po-flow/outstanding`)).b.data.some((x) => x.id === po.id));
  const det = (await api('ops', 'GET', `${PF}/po-flow/${po.id}`)).b.data;
  rep('PO detail shows the approval chain (submission x2, revision, authorization)', ['po_submission', 'po_authorization'].every((s) => det.approvals.some((a) => a.step === s)) && det.approvals.length >= 4 && det.approvals.every((a) => a.signature_hash));
  rep('Detail is closed to roles without procurement access (403)', (await api('req1', 'GET', `${PF}/po-flow/${po.id}`)).s === 403);

  // ---------- rejection returns the requisition to sourcing
  const pr2 = await toSourcing(); const L2 = pr2.lines.map((l) => l.id);
  const q2 = (await api('officer', 'POST', `${PF}/requisitions/${pr2.id}/quotations`, { supplier_ids: [S[0]] })).b.data[0];
  await api('officer', 'PUT', `${PF}/requisitions/${pr2.id}/quotations/${q2.id}`, { delivery_days: 4, payment_terms_days: 30, lines: L2.map((id) => ({ requisition_line_id: id, unit_price: 9 })) });
  r = await api('officer', 'POST', `${PF}/requisitions/${pr2.id}/select-supplier`, { quotation_id: q2.id }); rep('Sole complete quotation needs a justification (400)', r.s === 400);
  r = await api('officer', 'POST', `${PF}/requisitions/${pr2.id}/select-supplier`, { quotation_id: q2.id, justification: 'Only supplier of this part in region' }); rep('Sole-source accepted with justification', r.s === 200);
  await api('officer', 'PUT', `${PF}/requisitions/${pr2.id}/line-products`, { mappings: [{ line_id: L2[0], product_id: prod[0] }, { line_id: L2[1], product_id: prod[1] }] });
  const po2 = (await api('officer', 'POST', `${PF}/requisitions/${pr2.id}/purchase-order`, {})).b.data;
  r = await api('ops', 'POST', `${PF}/po-flow/${po2.id}/authorize`, { decision: 'reject', comments: 'Price too high for this quarter' });
  rep('Rejected PO is cancelled and the requisition returns to sourcing for another supplier', r.s === 200 && r.b.data.status === 'cancelled' && (await api('officer', 'GET', `${PR}/${pr2.id}`)).b.data.status === 'sourcing');

  // ---------- legacy PO flow guards
  r = await legacy('officer', 'POST', '/purchase-orders', { supplier_id: S[0], warehouse_id: wh, items: [{ product_id: prod[0], quantity_ordered: 3, unit_cost: 10 }] });
  rep('Direct (legacy) PO now starts as pending_authorization', r.s === 201 && r.b.data.status === 'pending_authorization', `[${r.s}] ${(r.b.data && r.b.data.status) || JSON.stringify(r.b).slice(0, 160)}`);
  if (r.s === 201) {
    const lp = r.b.data;
    const lpItem = (await q('select id from purchase_items where purchase_order_id=$1 limit 1', [lp.id]))[0];
    r = await legacy('store', 'POST', `/purchase-orders/${lp.id}/receive`, { warehouse_id: wh, items: [{ purchase_item_id: lpItem.id, quantity_received: 1 }] }); rep('Legacy PO cannot be received until authorized and sent', r.s === 409 || r.s === 400, `[${r.s}]`);
    r = await api('ops', 'POST', `${PF}/po-flow/${lp.id}/authorize`, { decision: 'approve' }); rep('Operation Manager authorizes the direct PO too', r.s === 200 && r.b.data.status === 'authorized');
  }

  // ---------- audit + integrity
  const aud = await q(`select action from procurement_audit_logs where (entity_type='quotation' and entity_id = any($1)) or (entity_type='requisition' and entity_id=$2) or (entity_type='purchase_order' and entity_id=$3)`, [Q.map((x) => x.id), pr.id, po.id]);
  rep('Audit trail records quotation requests, recording, selection, PO creation, authorization and send', ['request', 'record', 'select_supplier', 'create_from_requisition', 'authorize:approve', 'send', 'po_issued'].every((a) => aud.some((x) => x.action === a)), aud.map((a) => a.action).join(','));
  const gl = (await q('select coalesce(sum(debit),0)::numeric(14,2) d, coalesce(sum(credit),0)::numeric(14,2) c from journal_lines'))[0];
  rep('General ledger still balanced (sourcing posts nothing)', Number(gl.d) === Number(gl.c), `${gl.d}/${gl.c}`);
  rep('Existing PO list still works', (await legacy('officer', 'GET', '/purchase-orders')).s === 200);

  srv.kill(); await pool.end();
  console.log(`\nSUMMARY: ${pass}/${total} PASS`);
  process.exit(pass === total ? 0 : 1);
})().catch((e) => { console.log('ERR', String(e.stack || e.message).replace(/postgres(ql)?:\/\/\S+/gi, '<url>')); process.exit(1); });
