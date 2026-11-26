// Procurement Phase 3 (goods receipt + issuing) - end-to-end API tests against a DATABASE THAT HAS migration 026 applied.
//
//   TEST_DATABASE_URL=... node backend/tests/procurement/phase3.receiving.test.js
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
  const sup = async (n) => (await q(`select id from suppliers where is_active order by id limit ${n}`)).map((s) => s.id);
  if ((await sup(1)).length < 1) await pool.query(`insert into suppliers (code, name, is_active) values ('TST-1','Test Supplier 1',true) on conflict do nothing`);
  const S = await sup(1);
  const prod = (await q(`select id from products where is_active and product_type in ('raw_material','spare_part') order by id limit 2`)).map((p) => p.id);
  const wh = (await q('select id from warehouses order by id limit 1'))[0].id;
  await pool.query('update users set assigned_warehouse_id=$1 where id=$2', [wh, U.store.id]); // storekeepers are scoped to their warehouse
  const legacy = async (who, method, p, body) => { const x = await fetch(`http://localhost:${PORT}/api/v1/procurement${p}`, { method, headers: { Authorization: 'Bearer ' + tok[who], 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); let j = {}; try { j = await x.json(); } catch (_) {} return { s: x.status, b: j }; };
  const stock = async (pid) => Number((await q('select coalesce(sum(quantity),0) n from stock_levels where product_id=$1 and warehouse_id=$2', [pid, wh]))[0].n);
  const gl = async () => { const g = (await q('select coalesce(sum(debit),0)::numeric(14,2) d, coalesce(sum(credit),0)::numeric(14,2) c from journal_lines'))[0]; return Number(g.d) === Number(g.c); };

  // build: requisition -> approved -> sourcing -> quotation -> PO authorized and sent (qty 10 of item A, 4 of item B)
  const LN = [{ item_name: 'Item A', quantity: 10, unit: 'pcs', estimated_unit_cost: 5 }, { item_name: 'Item B', quantity: 4, unit: 'pcs', estimated_unit_cost: 25 }];
  let r = await api('req1', 'POST', PR, { title: 'Receiving test', justification: 'Needed for GRN and issuing tests', priority: 'normal', lines: LN });
  const pr = r.b.data;
  await api('req1', 'POST', `${PR}/${pr.id}/submit`); await api('head1', 'POST', `${PR}/${pr.id}/review`, { decision: 'approve' });
  await api('ops', 'POST', `${PR}/${pr.id}/approve`, { decision: 'approve' }); await api('ops', 'POST', `${PR}/${pr.id}/assign`, { assigned_to: U.officer.id });
  const L = (await api('officer', 'GET', `${PR}/${pr.id}`)).b.data.lines.map((l) => l.id);
  const qt = (await api('officer', 'POST', `${PF}/requisitions/${pr.id}/quotations`, { supplier_ids: S })).b.data[0];
  await api('officer', 'PUT', `${PF}/requisitions/${pr.id}/quotations/${qt.id}`, { delivery_days: 3, payment_terms_days: 30, lines: [{ requisition_line_id: L[0], unit_price: 5 }, { requisition_line_id: L[1], unit_price: 25 }] });
  await api('officer', 'POST', `${PF}/requisitions/${pr.id}/select-supplier`, { quotation_id: qt.id, justification: 'Sole source for receiving test' });
  await api('officer', 'PUT', `${PF}/requisitions/${pr.id}/line-products`, { mappings: [{ line_id: L[0], product_id: prod[0] }, { line_id: L[1], product_id: prod[1] }] });
  const po = (await api('officer', 'POST', `${PF}/requisitions/${pr.id}/purchase-order`, {})).b.data;
  await api('ops', 'POST', `${PF}/po-flow/${po.id}/authorize`, { decision: 'approve' }); await api('officer', 'POST', `${PF}/po-flow/${po.id}/send`);
  const items = await q('select id, product_id from purchase_items where purchase_order_id=$1 order by id', [po.id]);
  const [iA, iB] = items;
  rep('Setup: PO authorized and sent (total 150)', Number(po.total_amount) === 150 && (await q('select status from purchase_orders where id=$1', [po.id]))[0].status === 'sent');

  // ---------- goods receipt
  const a0 = await stock(prod[0]);
  r = await legacy('req1', 'POST', `/purchase-orders/${po.id}/receive`, { warehouse_id: wh, items: [{ purchase_item_id: iA.id, quantity_received: 1 }] }); rep('Staff without a store role cannot receive goods (403)', r.s === 403);
  r = await legacy('store', 'POST', `/purchase-orders/${po.id}/receive`, { warehouse_id: wh, items: [{ purchase_item_id: iA.id, quantity_received: 11 }] }); rep('Over-receipt (11 of 10 ordered) is blocked (409)', r.s === 409, `[${r.s}]`);
  r = await legacy('store', 'POST', `/purchase-orders/${po.id}/receive`, { warehouse_id: wh, items: [{ purchase_item_id: iA.id, quantity_received: 2, condition: 'damaged' }] }); rep('Damaged goods need a note (400)', r.s === 400);
  r = await legacy('store', 'POST', `/purchase-orders/${po.id}/receive`, { warehouse_id: wh, delivery_note_no: 'DN-77', items: [{ purchase_item_id: iA.id, quantity_received: 6 }, { purchase_item_id: iA.id, quantity_received: 2, condition: 'damaged', notes: 'Cracked on arrival' }, { purchase_item_id: iB.id, quantity_received: 1, condition: 'rejected', notes: 'Wrong model' }] });
  rep('GRN #1: 6 accepted, 2 damaged, 1 rejected -> partially_received with GRN number', r.s === 201 && /^GRN-\d{4}-\d{5}$/.test(r.b.data.grn_number) && r.b.data.status === 'partially_received', `[${r.s}] ${JSON.stringify(r.b).slice(0, 150)}`);
  rep('Stock increased only by the 6 accepted units (damaged/rejected never enter stock)', (await stock(prod[0])) - a0 === 6);
  let pi = (await q('select quantity_ordered, quantity_received, quantity_accepted, quantity_rejected from purchase_items where id=$1', [iA.id]))[0];
  rep('Line A: received 8 physically, accepted 6, rejected/damaged 2', Number(pi.quantity_received) === 8 && Number(pi.quantity_accepted) === 6 && Number(pi.quantity_rejected) === 2);
  const apCredit = Number((await q(`select coalesce(sum(jl.credit),0) c from journal_lines jl join journal_entries je on je.id=jl.journal_entry_id join chart_of_accounts a on a.id=jl.account_id where je.reference_type='purchase_order' and je.reference_id=$1 and a.code='2000'`, [po.id]))[0].c);
  rep('Accounts Payable credited only for accepted goods (6 x 5 = 30)', apCredit === 30, `AP=${apCredit}`);
  r = await legacy('store', 'POST', `/purchase-orders/${po.id}/receive`, { warehouse_id: wh, items: [{ purchase_item_id: iA.id, quantity_received: 5 }] }); rep('Cannot accept more than the 4 still outstanding on line A (409)', r.s === 409);
  r = await legacy('store', 'POST', `/purchase-orders/${po.id}/receive`, { warehouse_id: wh, items: [{ purchase_item_id: iA.id, quantity_received: 4 }, { purchase_item_id: iB.id, quantity_received: 4 }] });
  rep('GRN #2 completes the order -> received; requisition becomes fulfilled', r.s === 201 && r.b.data.status === 'received' && (await api('officer', 'GET', `${PR}/${pr.id}`)).b.data.status === 'fulfilled', `[${r.s}]`);
  rep('General ledger balanced after receiving', await gl());

  // ---------- issuing
  r = await legacy('req1', 'GET', `/issues/issuable/${pr.id}`); rep('Requester cannot use the store issuing screen (403)', r.s === 403);
  r = await legacy('store', 'GET', `/issues/issuable/${pr.id}`); const lines = r.b.data.lines;
  rep('Issuable quantities equal accepted quantities (A=10, B=4)', r.s === 200 && lines[0].available_to_issue === 10 && lines[1].available_to_issue === 4, JSON.stringify(lines.map((l) => l.available_to_issue)));
  const a1 = await stock(prod[0]);
  r = await legacy('store', 'POST', '/issues', { requisition_id: pr.id, warehouse_id: wh, lines: [{ requisition_line_id: L[0], quantity: 11 }] }); rep('Cannot issue more than was accepted (409)', r.s === 409);
  r = await legacy('req1', 'POST', '/issues', { requisition_id: pr.id, warehouse_id: wh, lines: [{ requisition_line_id: L[0], quantity: 1 }] }); rep('Requester cannot issue to themselves (403)', r.s === 403);
  r = await legacy('store', 'POST', '/issues', { requisition_id: pr.id, warehouse_id: wh, lines: [{ requisition_line_id: L[0], quantity: 6 }] });
  const iss1 = r.b.data || {};
  rep('Storekeeper issues 6 of A to the department (MIN number, stock OUT)', r.s === 201 && /^MIN-\d{4}-\d{5}$/.test(iss1.issue_number) && a1 - (await stock(prod[0])) === 6, `[${r.s}]`);
  rep('Ledger still balanced after issuing (Dr expense / Cr inventory)', await gl());
  r = await legacy('store', 'POST', `/issues/${iss1.id}/confirm`, { decision: 'confirm' }); rep('Issuer cannot confirm their own issue (404/403)', r.s === 403 || r.s === 404);
  r = await legacy('req2', 'POST', `/issues/${iss1.id}/confirm`, { decision: 'confirm' }); rep('Another department cannot confirm (404)', r.s === 404);
  r = await legacy('head1', 'POST', `/issues/${iss1.id}/confirm`, { decision: 'dispute' }); rep('Dispute requires comments (400)', r.s === 400);
  r = await legacy('head1', 'POST', `/issues/${iss1.id}/confirm`, { decision: 'dispute', comments: 'Only 5 arrived' }); rep('Department Head disputes the issue -> stock returns to the warehouse', r.s === 200 && r.b.data.status === 'disputed' && (await stock(prod[0])) === a1);
  r = await legacy('store', 'GET', `/issues/issuable/${pr.id}`); rep('A disputed issue frees its quantity again (A available = 10)', r.b.data.lines[0].available_to_issue === 10);
  r = await legacy('store', 'POST', '/issues', { requisition_id: pr.id, warehouse_id: wh, lines: [{ requisition_line_id: L[0], quantity: 10 }, { requisition_line_id: L[1], quantity: 4 }] });
  const iss2 = r.b.data || {}; rep('Full issue of both lines', r.s === 201);
  r = await legacy('req1', 'POST', `/issues/${iss2.id}/confirm`, { decision: 'confirm', comments: 'All received' }); rep('Requester confirms receipt', r.s === 200 && r.b.data.status === 'confirmed');
  r = await legacy('req1', 'POST', `/issues/${iss2.id}/confirm`, { decision: 'confirm' }); rep('Confirming twice is refused (409)', r.s === 409);
  rep('Requisition is closed once everything accepted was issued and confirmed', (await api('officer', 'GET', `${PR}/${pr.id}`)).b.data.status === 'closed');
  const mv = (await q(`select coalesce(sum(case when movement_type='IN' then quantity else -quantity end),0) n from stock_movements where product_id=$1 and warehouse_id=$2 and ((reference_type='purchase' and reference_id=$3) or (reference_type='issue' and reference_id = any($4)))`, [prod[0], wh, po.id, [iss1.id, iss2.id]]))[0].n;
  rep('Movement ledger for this order nets to zero (IN 10 + dispute reversal 6, OUT 6 + 10)', Number(mv) === 0, `net=${mv}`);
  const sl = Number((await q('select coalesce(sum(quantity),0) n from stock_levels where product_id=$1', [prod[0]]))[0].n);
  const sm = Number((await q(`select coalesce(sum(case when movement_type in ('IN') then quantity when movement_type='ADJUSTMENT' then quantity else -quantity end),0) n from stock_movements where product_id=$1`, [prod[0]]))[0].n);
  rep('Product stock level equals the sum of its movement ledger (inventory integrity)', Math.abs(sl - sm) < 0.0001, `levels=${sl} ledger=${sm}`);
  const aud = await q(`select action from procurement_audit_logs where (entity_type='material_issue' and entity_id=any($1)) or (entity_type='purchase_order' and entity_id=$2)`, [[iss1.id, iss2.id], po.id]);
  rep('Audit trail: receive, issue, confirm entries', ['receive', 'issue', 'confirm:dispute', 'confirm:confirm'].every((a) => aud.some((x) => x.action === a)), aud.map((a) => a.action).join(','));
  rep('Issue confirmations are signed approvals', (await q(`select count(*)::int n from procurement_approvals where entity_type='material_issue' and entity_id=any($1) and signature_hash is not null`, [[iss1.id, iss2.id]]))[0].n === 2);
  rep('Existing PO list still works', (await legacy('officer', 'GET', '/purchase-orders')).s === 200);
  rep('General ledger balanced at the end', await gl());

  srv.kill(); await pool.end();
  console.log(`\nSUMMARY: ${pass}/${total} PASS`);
  process.exit(pass === total ? 0 : 1);
})().catch((e) => { console.log('ERR', String(e.stack || e.message).replace(/postgres(ql)?:\/\/\S+/gi, '<url>')); process.exit(1); });
