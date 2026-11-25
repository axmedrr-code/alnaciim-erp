// Procurement Phase 1 (requisitions + approvals) - end-to-end API tests against a DATABASE THAT HAS migration 026 applied.
//
//   TEST_DATABASE_URL=... node backend/tests/procurement/phase1.requisitions.test.js
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
    const r = await fetch(`http://localhost:${PORT}/api/v1/procurement/requisitions${p}`, { method, headers: { Authorization: 'Bearer ' + tok[who], ...(body && !isForm ? { 'Content-Type': 'application/json' } : {}) }, body: body ? (isForm ? body : JSON.stringify(body)) : undefined });
    const buf = Buffer.from(await r.arrayBuffer()); let j = {}; try { j = JSON.parse(buf.toString()); } catch (_) {}
    return { s: r.status, b: j, raw: buf, ct: r.headers.get('content-type') };
  };
  const LINES = [{ item_name: 'Centrifugal pump 2HP', quantity: 2, unit: 'pcs', estimated_unit_cost: 150.5 }, { item_name: 'Mechanical seal kit', description: 'for pump above', quantity: 5, unit: 'set', estimated_unit_cost: 20 }];
  const mk = async (who, over = {}) => api(who, 'POST', '', { title: 'Pump replacement', justification: 'Pump #3 failed; production line is down', priority: 'high', required_date: '2026-12-15', lines: LINES, ...over });
  const approvalsOf = async (id) => q(`select step, decision, actor_id, actor_role, signature_hash from procurement_approvals where entity_type='requisition' and entity_id=$1 order by id`, [id]);

  // ---------- creation + validation
  let r = await mk('req1');
  const pr = r.b.data;
  rep('Employee creates a requisition (draft) with an automatic PR number', r.s === 201 && /^PR-\d{4}-\d{5}$/.test(pr.pr_number) && pr.status === 'draft', `[${r.s}] ${pr && pr.pr_number}`);
  rep('Department is taken from the employee account; estimated total computed server-side (2x150.50 + 5x20 = 401.00)', pr.department_id === 1 && Number(pr.estimated_total) === 401, `dept=${pr.department_id} total=${pr.estimated_total}`);
  r = await mk('req1', { lines: [] }); rep('No line items -> 400', r.s === 400);
  r = await mk('req1', { lines: [{ item_name: 'x', quantity: 0, unit: 'pcs' }] }); rep('Zero quantity -> 400', r.s === 400);
  r = await mk('req1', { justification: '' }); rep('Missing justification -> 400', r.s === 400);
  r = await mk('nodept'); rep('Account with no department cannot raise a requisition (400, clear message)', r.s === 400 && /department/i.test(r.b.error || ''), r.b.error);
  r = await mk('req1', { department_id: 2 }); rep('Staff cannot raise a requisition for another department (403)', r.s === 403, `[${r.s}]`);
  r = await mk('ops', { department_id: 1 }); const opsPr = r.b.data; rep('Operation Manager may raise one on behalf of a department', r.s === 201 && opsPr.department_id === 1);

  // ---------- privacy / visibility
  const see = async (who, id) => (await api(who, 'GET', `/${id}`)).s;
  rep('Owner, own Department Head, Operation Manager and Admin can open a draft', (await see('req1', pr.id)) === 200 && (await see('head1', pr.id)) === 200 && (await see('ops', pr.id)) === 200 && (await see('admin', pr.id)) === 200);
  rep('A colleague in the same department cannot open another employee\'s request (404)', (await see('req1b', pr.id)) === 404);
  rep('Other department staff / other department head cannot open it (404)', (await see('req2', pr.id)) === 404 && (await see('head2', pr.id)) === 404);
  rep('Procurement, Finance, Storekeeper cannot open a draft (404)', (await see('officer', pr.id)) === 404 && (await see('fin', pr.id)) === 404 && (await see('store', pr.id)) === 404);
  const listIds = async (who, qs = '') => (await api(who, 'GET', qs)).b.data.map((x) => x.id);
  rep('List: owner sees it, other-department users do not', (await listIds('req1')).includes(pr.id) && !(await listIds('req2')).includes(pr.id) && !(await listIds('head2')).includes(pr.id) && !(await listIds('officer')).includes(pr.id));

  // ---------- edit
  r = await api('req1', 'PUT', `/${pr.id}`, { title: 'Pump replacement (rev)', justification: 'Pump #3 failed; production line is down', priority: 'urgent', required_date: '2026-12-10', lines: LINES.slice(0, 1) });
  rep('Requester edits a draft', r.s === 200 && r.b.data.priority === 'urgent' && Number(r.b.data.estimated_total) === 301, `[${r.s}] total=${r.b.data && r.b.data.estimated_total}`);
  r = await api('head1', 'PUT', `/${pr.id}`, { title: 'hijack', justification: 'hijack attempt', priority: 'low', lines: LINES }); rep('Someone else cannot edit it (403)', r.s === 403, `[${r.s}]`);
  await api('req1', 'PUT', `/${pr.id}`, { title: 'Pump replacement', justification: 'Pump #3 failed; production line is down', priority: 'high', required_date: '2026-12-15', lines: LINES });

  // ---------- submit
  r = await api('head1', 'POST', `/${pr.id}/submit`); rep('Only the requester can submit (403)', r.s === 403);
  r = await api('req1', 'POST', `/${pr.id}/submit`); rep('Requester submits -> waiting for Department Head review', r.s === 200 && r.b.data.status === 'submitted', `[${r.s}] ${r.b.data && r.b.data.status}`);
  r = await api('req1', 'POST', `/${pr.id}/submit`); rep('Submitting twice is refused (409)', r.s === 409);
  r = await api('req1', 'PUT', `/${pr.id}`, { title: 'late edit', justification: 'late edit attempt', priority: 'low', lines: LINES }); rep('A submitted requisition can no longer be edited (409)', r.s === 409);

  // ---------- Department Head review: who may / may not
  r = await api('req1', 'POST', `/${pr.id}/review`, { decision: 'approve' }); rep('Requester cannot review their own request (403)', r.s === 403, `[${r.s}]`);
  r = await api('head2', 'POST', `/${pr.id}/review`, { decision: 'approve' }); rep('Head of ANOTHER department cannot review it (404, not visible)', r.s === 404, `[${r.s}]`);
  r = await api('ops', 'POST', `/${pr.id}/review`, { decision: 'approve' }); rep('Operation Manager cannot bypass the department review (403)', r.s === 403, `[${r.s}]`);
  r = await api('officer', 'POST', `/${pr.id}/review`, { decision: 'approve' }); rep('Procurement Officer cannot review (404)', r.s === 404);
  r = await api('ops', 'POST', `/${pr.id}/approve`, { decision: 'approve' }); rep('Operation Manager cannot approve before the department head did (409)', r.s === 409, `[${r.s}]`);
  r = await api('head1', 'POST', `/${pr.id}/review`, { decision: 'revision' }); rep('Requesting a revision without comments -> 400', r.s === 400);
  r = await api('head1', 'POST', `/${pr.id}/review`, { decision: 'revision', comments: 'Please attach the supplier quote' }); rep('Department Head returns it for revision (with comments)', r.s === 200 && r.b.data.status === 'returned_for_revision');
  r = await api('req1', 'PUT', `/${pr.id}`, { title: 'Pump replacement', justification: 'Pump #3 failed; quote attached', priority: 'high', required_date: '2026-12-15', lines: LINES });
  rep('Requester revises the returned requisition (version becomes 2)', r.s === 200 && r.b.data.version === 2, `version=${r.b.data && r.b.data.version}`);
  r = await api('req1', 'POST', `/${pr.id}/submit`); rep('Resubmitted after revision', r.s === 200 && r.b.data.status === 'submitted');
  r = await api('head1', 'POST', `/${pr.id}/review`, { decision: 'approve', comments: 'Justified' }); rep('Department Head approves -> waiting for Operation Manager', r.s === 200 && r.b.data.status === 'dept_approved');
  r = await api('head1', 'POST', `/${pr.id}/review`, { decision: 'approve' }); rep('Reviewing again is refused (409)', r.s === 409);

  // ---------- Operation Manager approval (+ digital signature)
  r = await api('head1', 'POST', `/${pr.id}/approve`, { decision: 'approve' }); rep('Department Head cannot give Operation Manager approval (403)', r.s === 403);
  r = await api('officer', 'POST', `/${pr.id}/approve`, { decision: 'approve' }); rep('Procurement Officer cannot approve a purchase (403)', r.s === 403 || r.s === 404, `[${r.s}]`);
  r = await api('fin', 'POST', `/${pr.id}/approve`, { decision: 'approve' }); rep('Finance cannot approve a requisition (403/404)', r.s === 403 || r.s === 404);
  r = await api('req1', 'POST', `/${pr.id}/approve`, { decision: 'approve' }); rep('Requester cannot approve (403)', r.s === 403);
  r = await api('ops', 'POST', `/${pr.id}/approve`, { decision: 'approve', comments: 'Approved for sourcing' });
  rep('Operation Manager approves', r.s === 200 && r.b.data.status === 'approved', `[${r.s}] ${r.b.data && r.b.data.status}`);
  const ap = await approvalsOf(pr.id);
  rep('Approval history: submission, revision, resubmission, head approval, ops approval (with actor, role)', ap.map((a) => `${a.step}:${a.decision}`).join(',') === 'submission:submitted,dept_review:revision_requested,submission:submitted,dept_review:approved,ops_approval:approved', ap.map((a) => `${a.step}:${a.decision}`).join(','));
  rep('Every decision carries a 64-hex signature hash and the actor role', ap.every((a) => /^[0-9a-f]{64}$/.test(a.signature_hash) && a.actor_role), '');
  const full = await q(`select snapshot, decided_at, actor_id, actor_role, step, decision, signature_hash from procurement_approvals where entity_type='requisition' and entity_id=$1 and step='ops_approval'`, [pr.id]);
  const { verifySignature } = require('../../src/services/procurementService');
  rep('The Operation Manager signature can be re-verified from the stored snapshot', verifySignature(full[0]));
  const tampered = { ...full[0], snapshot: { ...full[0].snapshot, estimated_total: 1 } };
  rep('A tampered snapshot no longer verifies', !verifySignature(tampered));
  let blocked = false; try { await pool.query(`update procurement_approvals set comments='tampered' where entity_id=$1`, [pr.id]); } catch (e) { blocked = /append-only/.test(e.message); }
  let blocked2 = false; try { await pool.query(`delete from procurement_audit_logs where entity_id=$1 and entity_type='requisition'`, [pr.id]); } catch (e) { blocked2 = /append-only/.test(e.message); }
  rep('Approvals and the audit log cannot be altered or deleted (database trigger)', blocked && blocked2);

  // ---------- assignment to a Procurement Officer
  r = await api('officer', 'POST', `/${pr.id}/assign`, { assigned_to: U.officer.id }); rep('Procurement Officer cannot assign work to themselves (403)', r.s === 403);
  r = await api('ops', 'POST', `/${pr.id}/assign`, { assigned_to: U.fin.id }); rep('Assignee must be a Procurement Officer (400)', r.s === 400, `[${r.s}]`);
  r = await api('ops', 'POST', `/${pr.id}/assign`, { assigned_to: U.officer.id, comments: 'Please source 3 quotes' });
  rep('Operation Manager assigns it to a Procurement Officer -> sourcing', r.s === 200 && r.b.data.status === 'sourcing' && r.b.data.assigned_to === U.officer.id, `[${r.s}]`);
  rep('Assigned Procurement Officer can now open it; the other officer is not assigned but can see approved requests', (await see('officer', pr.id)) === 200 && (await see('officer2', pr.id)) === 200);
  rep('Finance can now see it (read-only); the colleague in the same department still cannot', (await see('fin', pr.id)) === 200 && (await see('req1b', pr.id)) === 404);
  rep('Pending-for-me list: the officer sees the sourcing task', (await listIds('officer', '?pending=1')).includes(pr.id));
  r = await api('officer', 'POST', `/${pr.id}/cancel`, {}); rep('Procurement cannot cancel an approved requisition (403)', r.s === 403);
  r = await api('req1', 'POST', `/${pr.id}/cancel`, {}); rep('Requester cannot cancel once it is in sourcing (403)', r.s === 403);

  // ---------- separation of duties: no one approves their own purchase
  const own = (await mk('ops', { department_id: 1, title: 'Ops own purchase' })).b.data;
  await api('ops', 'POST', `/${own.id}/submit`);
  const st1 = (await api('ops', 'GET', `/${own.id}`)).b.data.status;
  r = await api('ops', 'POST', `/${own.id}/review`, { decision: 'approve' }); rep('Operation Manager cannot department-review their own request (403)', r.s === 403, `status=${st1}`);
  await api('head1', 'POST', `/${own.id}/review`, { decision: 'approve' });
  r = await api('ops', 'POST', `/${own.id}/approve`, { decision: 'approve' }); rep('Operation Manager cannot approve their OWN requisition (403)', r.s === 403, `[${r.s}]`);
  r = await api('admin', 'POST', `/${own.id}/approve`, { decision: 'approve' }); rep('A different approver (Admin) can approve it', r.s === 200 && r.b.data.status === 'approved');
  const headOwn = (await api('head1', 'POST', '', { title: 'Head raised', justification: 'Needed by the department head', lines: LINES })).b.data;
  r = await api('head1', 'POST', `/${headOwn.id}/submit`); rep('A request raised by the department head skips self-review and goes to the Operation Manager', r.s === 200 && r.b.data.status === 'dept_approved', r.b.data && r.b.data.status);
  r = await api('head1', 'POST', `/${headOwn.id}/review`, { decision: 'approve' }); rep('...and the head cannot review it anyway (409/403)', r.s === 403 || r.s === 409);
  const pOff = (await api('officer', 'POST', '', { title: 'Officer own need', justification: 'Procurement department office supplies', lines: LINES })).b.data;
  r = await api('ops', 'POST', `/${pOff.id}/assign`, { assigned_to: U.officer.id }); rep('Cannot assign a requisition before approval (409)', r.s === 409);

  // ---------- reject path / cancel path
  const rj = (await mk('req1', { title: 'Reject me' })).b.data; await api('req1', 'POST', `/${rj.id}/submit`);
  r = await api('head1', 'POST', `/${rj.id}/review`, { decision: 'reject' }); rep('Rejecting without comments -> 400', r.s === 400);
  r = await api('head1', 'POST', `/${rj.id}/review`, { decision: 'reject', comments: 'Not in the budget' }); rep('Department Head rejects (with comments)', r.s === 200 && r.b.data.status === 'rejected');
  r = await api('req1', 'POST', `/${rj.id}/submit`); rep('A rejected requisition cannot be resubmitted (409)', r.s === 409);
  const cn = (await mk('req1', { title: 'Cancel me' })).b.data;
  r = await api('req1', 'POST', `/${cn.id}/cancel`, { comments: 'No longer needed' }); rep('Requester cancels a draft', r.s === 200 && r.b.data.status === 'cancelled');
  r = await api('req1', 'POST', `/${cn.id}/submit`); rep('A cancelled requisition cannot be submitted (409)', r.s === 409);

  // ---------- attachments
  const form = (name, type, bytes) => { const f = new FormData(); f.append('file', new Blob([bytes], { type }), name); return f; };
  const pdf = Buffer.from('%PDF-1.4 test quote document');
  r = await api('req1', 'POST', `/${pr.id}/attachments`, form('quote.pdf', 'application/pdf', pdf)); const att = r.b.data;
  rep('Requester attaches a PDF (stored in the database)', r.s === 201 && Number(att.file_size) === pdf.length, `[${r.s}] size=${att && att.file_size}`);
  r = await api('ops', 'GET', `/${pr.id}/attachments/${att.id}`); rep('Operation Manager downloads the identical bytes', r.s === 200 && Buffer.compare(r.raw, pdf) === 0 && /pdf/.test(r.ct || ''));
  r = await api('req1b', 'GET', `/${pr.id}/attachments/${att.id}`); rep('A colleague without access cannot download it (404)', r.s === 404);
  r = await api('req2', 'POST', `/${pr.id}/attachments`, form('x.pdf', 'application/pdf', pdf)); rep('Other-department staff cannot attach (404)', r.s === 404);
  r = await api('req1', 'POST', `/${pr.id}/attachments`, form('run.exe', 'application/x-msdownload', Buffer.from('MZ'))); rep('Disallowed file type -> 415', r.s === 415);
  r = await api('req1', 'POST', `/${pr.id}/attachments`, form('big.pdf', 'application/pdf', Buffer.alloc(5 * 1024 * 1024 + 10, 1))); rep('File over 5 MB -> 413', r.s === 413, `[${r.s}]`);
  const detail = (await api('req1', 'GET', `/${pr.id}`)).b.data;
  rep('Detail shows lines, approval timeline, attachment list and the actions this user may take', detail.lines.length === 2 && detail.approvals.length === 6 && detail.attachments.length === 1 && detail.actions && detail.actions.can_attach === true, `lines=${detail.lines.length} approvals=${detail.approvals.length} attachments=${detail.attachments.length} can_attach=${detail.actions && detail.actions.can_attach}`);

  // ---------- concurrency
  const par = await Promise.all(Array.from({ length: 10 }, (_, i) => mk('req1', { title: `Parallel ${i}` })));
  const nums = par.map((x) => x.b.data && x.b.data.pr_number);
  rep('10 simultaneous requisitions get 10 distinct PR numbers', par.every((x) => x.s === 201) && new Set(nums).size === 10, nums.slice(0, 3).join(','));
  const cc = (await mk('req1', { title: 'Race' })).b.data; await api('req1', 'POST', `/${cc.id}/submit`);
  const race = await Promise.all([api('head1', 'POST', `/${cc.id}/review`, { decision: 'approve' }), api('head1', 'POST', `/${cc.id}/review`, { decision: 'approve' }), api('head1', 'POST', `/${cc.id}/review`, { decision: 'approve' })]);
  rep('Three simultaneous approvals: exactly one succeeds, the rest get 409', race.filter((x) => x.s === 200).length === 1 && race.filter((x) => x.s === 409).length === 2, race.map((x) => x.s).join(','));
  const rowsAp = await q(`select count(*)::int n from procurement_approvals where entity_type='requisition' and entity_id=$1 and step='dept_review'`, [cc.id]);
  rep('...and only one approval record was written', rowsAp[0].n === 1);

  // ---------- audit trail
  const aud = await q(`select action, actor_role from procurement_audit_logs where entity_type='requisition' and entity_id=$1 order by id`, [pr.id]);
  rep('Audit log has create, update, submit, review, approve, assign and attach entries for the requisition', ['create', 'update', 'submission:submitted', 'dept_review:approved', 'ops_approval:approved', 'assignment:assigned', 'attach'].every((a) => aud.some((x) => x.action === a)), aud.map((a) => a.action).join(','));

  // ---------- regression: existing procurement + role gates
  const reg = async (who, p) => (await fetch(`http://localhost:${PORT}/api/v1${p}`, { headers: { Authorization: 'Bearer ' + tok[who] } })).status;
  rep('Existing purchase-order and supplier endpoints still work for Procurement (200)', (await reg('officer', '/procurement/purchase-orders')) === 200 && (await reg('officer', '/suppliers')) === 200);
  rep('...and are still closed to staff without a procurement role (403)', (await reg('req1', '/procurement/purchase-orders')) === 403);
  rep('Operation Manager can read purchase orders (oversight)', (await reg('ops', '/procurement/purchase-orders')) === 200);
  const gl = (await q('select coalesce(sum(debit),0)::numeric(14,2) d, coalesce(sum(credit),0)::numeric(14,2) c from journal_lines'))[0];
  rep('General ledger still balanced (Phase 1 posts nothing)', Number(gl.d) === Number(gl.c), `${gl.d}/${gl.c}`);

  srv.kill(); await pool.end();
  console.log(`\nSUMMARY: ${pass}/${total} PASS`);
  process.exit(pass === total ? 0 : 1);
})().catch((e) => { console.log('ERR', String(e.stack || e.message).replace(/postgres(ql)?:\/\/\S+/gi, '<url>')); process.exit(1); });
