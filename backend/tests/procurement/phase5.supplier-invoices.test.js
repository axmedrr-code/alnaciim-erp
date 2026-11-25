// Phase 5 end-to-end supplier invoice, match, approval and voucher checks.
// Deliberately requires an isolated TEST_DATABASE_URL; never falls back to DATABASE_URL.
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const crypto = require('crypto');
const { spawn } = require('child_process');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const DB = process.env.TEST_DATABASE_URL;
if (!DB) { console.log('refusing: set TEST_DATABASE_URL to an isolated test database'); process.exit(1); }
const dbUrl = new URL(DB);
const dbName = decodeURIComponent(dbUrl.pathname.replace(/^\/+/, '')).toLowerCase();
if (!(dbUrl.hostname.endsWith('.neon.tech') || ['localhost', '127.0.0.1'].includes(dbUrl.hostname)) || !(/(^|[-_])test($|[-_])/.test(dbName) || (process.env.TEST_DATABASE_EXPECT_HOST && process.env.TEST_DATABASE_EXPECT_HOST.toLowerCase() === dbUrl.hostname.toLowerCase()))) {
  console.log('refusing: TEST_DATABASE_URL must point to localhost or Neon and use a database name with a test suffix');
  process.exit(1);
}
const SSL = process.env.TEST_DATABASE_SSL === 'true';
const SECRET = crypto.randomBytes(32).toString('hex');
const PORT = 5000 + Math.floor(Math.random() * 80);
let passed = 0, total = 0, srv, pool;
const check = (name, ok, detail = '') => { total++; if (ok) passed++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' — ' + detail : '')); };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  pool = new Pool({ connectionString: DB, ssl: SSL ? { rejectUnauthorized: false } : false, max: 3 });
  pool.on('error', () => {});
  const q = async (sql, values) => (await pool.query(sql, values)).rows;
  const roles = Object.fromEntries((await q('SELECT id,name FROM roles')).map((r) => [r.name, r.id]));
  if (!roles['Operation Manager'] || !roles['Department Head']) throw new Error('Procurement migrations 026–030 must be applied to this TEST database');
  const userMap = {};
  const accounts = [['finance','Finance Officer',8],['finance2','Finance Officer',8],['ops','Operation Manager',9],['proc','Procurement Officer',4],['store','Storekeeper',6]];
  const hash = await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 10);
  for (const [key, role, department] of accounts) {
    const email = 'phase5.' + key + '@alnaciim.test';
    let user = (await q('SELECT id FROM users WHERE email=$1', [email]))[0];
    if (user) {
      await pool.query('UPDATE users SET role_id=$1,department_id=$2,is_active=true WHERE id=$3', [roles[role], department, user.id]);
    } else {
      user = (await q('INSERT INTO users (employee_code,full_name,email,password_hash,role_id,department_id,is_active) VALUES ($1,$2,$3,$4,$5,$6,true) RETURNING id',
        ['P5-' + key.toUpperCase(), 'Phase5 ' + key, email, hash, roles[role], department]))[0];
    }
    userMap[key] = { id: user.id, role };
  }
  const admin = (await q("SELECT u.id FROM users u JOIN roles r ON r.id=u.role_id WHERE r.name='Admin' AND u.is_active ORDER BY u.id LIMIT 1"))[0];
  userMap.admin = { id: admin.id, role: 'Admin' };
  const tokens = Object.fromEntries(Object.entries(userMap).map(([key, u]) =>
    [key, jwt.sign({ id: u.id, email: key, role: 'ignored' }, SECRET, { algorithm: 'HS256', expiresIn: '1h' })]));

  srv = spawn(process.execPath, ['--no-warnings', 'src/index.js'], {
    cwd: path.join(__dirname, '../..'),
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, PORT: String(PORT), DATABASE_URL: DB,
      DATABASE_SSL: SSL ? 'true' : '', JWT_SECRET: SECRET, BACKUP_CRON_SCHEDULE: 'disabled', CORS_ORIGIN: '',
      NODE_ENV: '', AUTH_CACHE_TTL_MS: '0', RATE_LIMIT_API_MAX: '1000000' },
    stdio: 'ignore'
  });
  let started = false;
  for (let i = 0; i < 60 && !started; i++) { await sleep(250); try { started = (await fetch('http://localhost:' + PORT + '/health')).ok; } catch (_) {} }
  if (!started) throw new Error('TEST backend did not start');
  const api = async (who, method, endpoint, body) => {
    const response = await fetch('http://localhost:' + PORT + '/api/v1' + endpoint, {
      method, headers: { Authorization: 'Bearer ' + tokens[who], ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
    let result = {}; try { result = await response.json(); } catch (_) {}
    return { status: response.status, data: result.data, error: result.error };
  };
  const finance = '/procurement/supplier-invoices';

  const supplier = (await q('SELECT id FROM suppliers WHERE is_active=true ORDER BY id LIMIT 1'))[0];
  const product = (await q("SELECT id,unit_cost,product_type FROM products WHERE is_active=true AND product_type IN ('raw_material','spare_part') ORDER BY id LIMIT 1"))[0];
  if (!supplier || !product) throw new Error('TEST fixtures need an active supplier and raw-material/spare-part product');
  const warehouseType = product.product_type === 'raw_material' ? 'raw_material' : 'spare_parts';
  let warehouse = (await q('SELECT id FROM warehouses WHERE type=$1 ORDER BY id LIMIT 1', [warehouseType]))[0];
  if (!warehouse) warehouse = (await q('INSERT INTO warehouses (code,name,type) VALUES ($1,$2,$3) RETURNING id',
    ['P5-WH-' + Date.now(), 'Phase 5 Test Warehouse', warehouseType]))[0];
  const qty = 5, unitPrice = Number(product.unit_cost || 10), amount = Math.round(qty * unitPrice * 100) / 100;
  const poResult = await api('proc', 'POST', '/procurement/purchase-orders', {
    supplier_id: supplier.id, expected_date: null, notes: 'Phase 5 isolated test',
    items: [{ product_id: product.id, quantity_ordered: qty, unit_cost: unitPrice }]
  });
  check('Create test PO', poResult.status === 201, String(poResult.status));
  if (poResult.status !== 201) throw new Error('Could not create test purchase order: ' + poResult.error);
  const po = poResult.data;
  check('Operation Manager authorizes PO', (await api('ops','POST','/procurement/po-flow/' + po.id + '/authorize',{decision:'approve'})).status === 200);
  check('Procurement sends authorized PO', (await api('proc','POST','/procurement/po-flow/' + po.id + '/send')).status === 200);
  const purchaseItem = (await q('SELECT id FROM purchase_items WHERE purchase_order_id=$1', [po.id]))[0];
  const received = await api('store', 'POST', '/procurement/purchase-orders/' + po.id + '/receive', {
    warehouse_id: warehouse.id, items: [{ purchase_item_id: purchaseItem.id, quantity_received: qty, condition: 'good' }]
  });
  check('Receive PO posts accepted goods to stock/AP', received.status === 201, String(received.status));
  if (received.status !== 201) throw new Error('Could not receive TEST goods: ' + received.error);

  const invNo = 'TEST-SUP-' + Date.now();
  const invoiceBody = {
    purchase_order_id: po.id, supplier_invoice_no: invNo, invoice_date: new Date().toISOString().slice(0,10),
    subtotal: amount, total_amount: amount, lines: [{ purchase_item_id: purchaseItem.id, quantity: qty, unit_price: unitPrice, line_total: amount }]
  };
  check('Storekeeper cannot register supplier invoices (403)', (await api('store','POST',finance,invoiceBody)).status === 403);
  const registered = await api('finance','POST',finance,invoiceBody);
  check('Finance registers supplier invoice', registered.status === 201, String(registered.status));
  if (registered.status !== 201) throw new Error('Invoice registration failed: ' + registered.error);
  const invoice = registered.data;
  check('Duplicate supplier invoice number is rejected (409)', (await api('finance2','POST',finance,invoiceBody)).status === 409);
  const match = await api('finance','POST',finance + '/' + invoice.id + '/match');
  check('Invoice matches PO and accepted GRN', match.status === 200 && match.data.status === 'matched');
  check('Invoice creator cannot approve their own invoice (403)', (await api('finance','POST',finance + '/' + invoice.id + '/approve')).status === 403);
  check('Admin approves matched invoice', (await api('admin','POST',finance + '/' + invoice.id + '/approve')).status === 200);

  const beforeJournals = Number((await q("SELECT COUNT(*)::int n FROM journal_entries WHERE reference_type='supplier_payment'"))[0].n);
  const payment1 = await api('finance','POST',finance + '/' + invoice.id + '/payments',{amount:Math.max(0.01,amount/2),method:'cash'});
  check('Finance requests a partial payment with voucher', payment1.status === 201 && /^PV-\d{4}-\d{5}$/.test(payment1.data.voucher_number) && payment1.data.status === 'pending');
  const afterRequest = Number((await q("SELECT COUNT(*)::int n FROM journal_entries WHERE reference_type='supplier_payment'"))[0].n);
  check('Pending payment does not post finance ledger entry', afterRequest === beforeJournals);
  check('Finance cannot approve payment request (403)', (await api('finance2','POST',finance + '/' + invoice.id + '/payments/' + payment1.data.id + '/decision',{decision:'approve'})).status === 403);
  const approved1 = await api('ops','POST',finance + '/' + invoice.id + '/payments/' + payment1.data.id + '/decision',{decision:'approve'});
  check('Operation Manager approves payment and posts one voucher entry', approved1.status === 200 && approved1.data.status === 'approved');
  check('Invoice becomes partially paid', (await api('finance','GET',finance + '/' + invoice.id)).data.status === 'partially_paid');

  const remaining = Math.round((amount - Math.max(0.01,amount/2)) * 100) / 100;
  const payment2 = await api('finance','POST',finance + '/' + invoice.id + '/payments',{amount:remaining,method:'bank_transfer'});
  check('Request remaining balance', payment2.status === 201 && payment2.data.status === 'pending');
  check('Overpayment request is blocked', (await api('finance','POST',finance + '/' + invoice.id + '/payments',{amount:1,method:'cash'})).status === 409);
  check('Operation Manager approves final payment', (await api('ops','POST',finance + '/' + invoice.id + '/payments/' + payment2.data.id + '/decision',{decision:'approve'})).status === 200);
  check('Invoice settles to paid status', (await api('finance','GET',finance + '/' + invoice.id)).data.status === 'paid');
  check('Legacy direct PO payment route is blocked', (await api('finance','POST','/procurement/purchase-orders/' + po.id + '/payments',{amount:1,method:'cash'})).status === 409);
  check('All posted supplier-payment journal entries balance',
    Number((await q("SELECT COUNT(*)::int n FROM (SELECT je.id FROM journal_entries je JOIN journal_lines jl ON jl.journal_entry_id=je.id WHERE je.reference_type='supplier_payment' GROUP BY je.id HAVING ABS(SUM(jl.debit)-SUM(jl.credit))>0.005) x"))[0].n) === 0);

  // A price/quantity exception is recorded, visible, and cannot be approved.
  const mismatchNo = 'TEST-MISMATCH-' + Date.now();
  const mismatchBody = { ...invoiceBody, supplier_invoice_no: mismatchNo,
    lines: [{ purchase_item_id: purchaseItem.id, quantity: 1, unit_price: unitPrice + 1, line_total: unitPrice + 1 }],
    subtotal: unitPrice + 1, total_amount: unitPrice + 1 };
  const mismatchInvoice = await api('finance2','POST',finance,mismatchBody);
  check('Register invoice with exception for matching review', mismatchInvoice.status === 201);
  const mismatch = await api('finance2','POST',finance + '/' + mismatchInvoice.data.id + '/match');
  check('3-way mismatch is retained with exception reasons', mismatch.status === 200 && mismatch.data.status === 'mismatch' && mismatch.data.match_result.exceptions.length > 0);
  check('Mismatched invoice cannot be approved', (await api('admin','POST',finance + '/' + mismatchInvoice.data.id + '/approve')).status === 409);
  const beforeVoid = await api('finance2','POST',finance + '/' + mismatchInvoice.data.id + '/void',{reason:'Test mismatch correction'});
  check('Unapproved mismatch can be voided with reason', beforeVoid.status === 200 && beforeVoid.data.status === 'voided');

  srv.kill(); await pool.end();
  console.log('SUMMARY: ' + passed + '/' + total + ' PASS');
  process.exit(passed === total ? 0 : 1);
})().catch(async (error) => {
  console.log('ERROR: ' + String(error.stack || error.message).replace(/postgres(ql)?:\/\/\S+/gi, '<redacted database URL>'));
  if (srv) srv.kill();
  if (pool) await pool.end().catch(() => {});
  process.exit(1);
});
