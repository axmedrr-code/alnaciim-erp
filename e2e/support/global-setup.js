// Starts the real backend + the ERP Vite dev server against the isolated test database, creates the pwui.* accounts with a
// random per-run password (never printed; kept only in e2e/.state/state.json, mode 0600, and scrambled again in teardown)
// and seeds the fixtures the specs use. Every stock change goes through the API so the signed ledger stays consistent.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const { ERP_PORT, API_PORT, STATE_DIR, STATE_FILE, PREFIX, testDatabase } = require('./env');

const ROOT = path.join(__dirname, '..', '..');
const ACCOUNTS = [
  // key, role, department id
  ['admin', 'Admin', null], // fixture setup through the API only; never used by a spec
  ['cashier', 'Cashier', null],
  ['store_fg', 'Storekeeper', 6],
  ['store_rm', 'Storekeeper', 6],
  ['collector', 'Collector', null],
  ['reset_target', 'Cashier', null], // only for admin-reset.spec.js, whose password it changes
  ['prod1', 'Production Manager', 1], // completes batches (production.spec.js)
  ['prod2', 'Production Manager', 1] // approves the output prod1 completed
];

async function waitFor(url, label, tries = 120) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url); if (r.status < 500) return; } catch (_) {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${label} did not start (${url})`);
}

module.exports = async function globalSetup() {
  const { url: DB, ssl } = testDatabase();
  const pool = new Pool({ connectionString: DB, ssl: ssl ? { rejectUnauthorized: false } : false, max: 2 });
  pool.on('error', () => {});
  const q = async (s, p) => (await pool.query(s, p)).rows;
  const stamp = Date.now();
  const procs = [];
  const logs = process.env.E2E_SERVER_LOG ? 'inherit' : 'ignore';

  try {
    // ---------- servers
    const api = spawn(process.execPath, ['--no-warnings', 'src/index.js'], {
      cwd: path.join(ROOT, 'backend'),
      env: {
        PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, PORT: String(API_PORT), DATABASE_URL: DB, DATABASE_SSL: ssl ? 'true' : '',
        JWT_SECRET: crypto.randomBytes(24).toString('hex'), BACKUP_CRON_SCHEDULE: 'disabled', CORS_ORIGIN: '', NODE_ENV: '',
        AUTH_CACHE_TTL_MS: '0', RATE_LIMIT_API_MAX: '1000000', RATE_LIMIT_LOGIN_MAX: '100000', RATE_LIMIT_LOGIN_IP_MAX: '100000'
      },
      stdio: ['ignore', logs, logs]
    });
    procs.push(api.pid);
    await waitFor(`http://localhost:${API_PORT}/health`, 'backend');

    const viteBin = path.join(ROOT, 'frontend', 'node_modules', 'vite', 'bin', 'vite.js');
    const erp = spawn(process.execPath, [viteBin, '--port', String(ERP_PORT), '--strictPort'], {
      cwd: path.join(ROOT, 'frontend'),
      env: { ...process.env, E2E_API_TARGET: `http://localhost:${API_PORT}`, VITE_API_URL: '' },
      stdio: ['ignore', logs, logs]
    });
    procs.push(erp.pid);
    await waitFor(`http://localhost:${ERP_PORT}/login`, 'ERP dev server');

    // ---------- accounts (random per-run password, bcrypt-hashed like the app does)
    const password = crypto.randomBytes(18).toString('base64url');
    const hash = await bcrypt.hash(password, 10);
    const roles = Object.fromEntries((await q('select id, name from roles')).map((r) => [r.name, r.id]));
    const users = {};
    for (const [key, role, dept] of ACCOUNTS) {
      if (!roles[role]) throw new Error(`missing role ${role}`);
      const email = `${PREFIX}.${key}@alnaciim.test`;
      const rows = await q(
        `insert into users (employee_code, full_name, email, password_hash, role_id, department_id, is_active, password_changed_at)
         values ($1,$2,$3,$4,$5,$6,true, now() - interval '1 minute')
         on conflict (email) do update set password_hash=$4, role_id=$5, department_id=$6, is_active=true, assigned_warehouse_id=null,
           password_changed_at = now() - interval '1 minute'
         returning id`,
        [`${PREFIX.toUpperCase()}-${key.toUpperCase()}`, `E2E UI ${key}`, email, hash, roles[role], dept]
      );
      users[key] = { id: rows[0].id, email, role };
    }

    const login = await fetch(`http://localhost:${API_PORT}/api/v1/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: users.admin.email, password })
    }).then((r) => r.json());
    if (!login.data?.token) throw new Error('fixture admin could not sign in: ' + login.error);
    const call = async (method, p, body) => {
      const r = await fetch(`http://localhost:${API_PORT}/api/v1${p}`, {
        method, headers: { Authorization: 'Bearer ' + login.data.token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined
      });
      const j = await r.json().catch(() => ({}));
      if (r.status >= 300) throw new Error(`${method} ${p} -> ${r.status} ${j.error || ''}`);
      return j.data;
    };

    // ---------- fixtures
    const mkWh = async (code, name, type) => (await q(
      `insert into warehouses (code, name, type) values ($1,$2,$3) on conflict (code) do update set is_active=true, name=$2, type=$3 returning id`, [code, name, type]
    ))[0].id;
    const FG = await mkWh('TST-PWUI-FG', 'PWUI Finished Store', 'finished_goods');
    const RM = await mkWh('TST-PWUI-RM', 'PWUI Raw Store', 'raw_material');
    await pool.query('update users set assigned_warehouse_id=$1 where id=$2', [FG, users.store_fg.id]);
    await pool.query('update users set assigned_warehouse_id=$1 where id=$2', [RM, users.store_rm.id]);

    const catId = async (n) => (await q('select id from categories where name=$1', [n]))[0]?.id;
    const bottledCat = await catId('Bottled Water');
    if (!bottledCat) throw new Error('category "Bottled Water" is missing');
    const anyCat = (await q(`select id from categories where name <> 'Bottled Water' order by id limit 1`))[0].id;
    const mkProd = async (sku, name, cat, type) => (await q(
      `insert into products (sku, name, category_id, product_type, unit) values ($1,$2,$3,$4,'pcs') returning id, name`, [`${sku}-${stamp}`, `${name} ${stamp}`, cat, type]
    ))[0];
    const bottle = await mkProd('PWUI-BOT', 'PWUI Bottle 1.5L', bottledCat, 'finished_good');
    const preform = await mkProd('PWUI-RAW', 'PWUI Preform 12g', anyCat, 'raw_material');
    await call('POST', '/inventory/movements', { product_id: bottle.id, warehouse_id: FG, movement_type: 'IN', quantity: 100, reference_type: 'adjustment' });
    await call('POST', '/inventory/movements', { product_id: preform.id, warehouse_id: RM, movement_type: 'IN', quantity: 50, reference_type: 'adjustment' });

    const hnoBase = 800000 + (stamp % 90000);
    const mkCust = async (n, name) => (await q(
      `insert into customers (code, name, hno, type, credit_limit, status, collector_id) values ($1,$2,$3,'retail',0,'active',$4) returning id, name, hno`,
      [`PWUI${n}-${stamp}`.slice(0, 20), `${name} ${stamp}`, String(hnoBase + n), users.collector.id]
    ))[0];
    const cashCustomer = await mkCust(1, 'PWUI Cash Customer');
    const debtor = await mkCust(2, 'PWUI Debtor');
    // A $20.00 bottled-water credit invoice for the collector to collect against.
    const credit = await call('POST', '/retail/sales', {
      customer_id: debtor.id, department: 'bottled_water', warehouse_id: FG, payment_type: 'credit', items: [{ product_id: bottle.id, quantity: 10, unit_price: 2 }]
    });

    // Production: a machine, a BOM (1 preform per bottle), a finished product with no BOM, and three planned batches.
    const machineId = (await q(
      `insert into machines (code, name, type) values ('PWUI-FILL','PWUI Filler','FILLING_LINE') on conflict (code) do update set status='operational' returning id`
    ))[0].id;
    const iceCat = (await catId('Ice Products')) || bottledCat;
    const noBom = await mkProd('PWUI-NOBOM', 'PWUI Ice Bag', iceCat, 'finished_good');
    await call('POST', '/production/bom', { product_id: bottle.id, name: `PWUI BOM ${stamp}`, items: [{ raw_material_product_id: preform.id, quantity_per_unit: 1 }] });
    const mkBatch = async (suffix, productId) => (await call('POST', '/production/batches', {
      batch_number: `PWUI-${suffix}-${stamp}`, production_type: 'BOTTLING', machine_id: machineId, product_id: productId || undefined,
      planned_qty: 20, unit: 'pcs', shift: 'Morning', destination_warehouse_id: productId ? FG : undefined
    }));
    const batchMain = await mkBatch('MAIN', bottle.id);
    const batchNoBom = await mkBatch('NOBOM', noBom.id);
    const batchNoProduct = await mkBatch('NOPROD', null);

    const state = {
      password, users, procs, apiPort: API_PORT, stamp,
      warehouses: { fg: { id: FG, name: 'PWUI Finished Store' }, rm: { id: RM, name: 'PWUI Raw Store' } },
      products: { bottle, preform, noBom },
      batches: { main: batchMain.batch_number, noBom: batchNoBom.batch_number, noProduct: batchNoProduct.batch_number },
      customers: { cash: cashCustomer, debtor },
      creditInvoice: { id: credit.id, hno: credit.invoice_hno, total: Number(credit.total_amount) }
    };
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), { mode: 0o600 });
  } catch (err) {
    for (const pid of procs) { try { process.kill(pid); } catch (_) {} }
    throw err;
  } finally {
    await pool.end();
  }
};
