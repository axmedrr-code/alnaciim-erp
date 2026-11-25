// Shared harness for DB-backed end-to-end tests (production / inventory / logistics).
// - refuses to run unless TEST_DATABASE_URL points at localhost or Neon AND (db name has a "test" part OR the host is pinned
//   explicitly with TEST_DATABASE_EXPECT_HOST); never reads DATABASE_URL, never touches Railway/production.
// - starts the real backend on a free port with a throwaway JWT secret; users are created as <key>@alnaciim.test and tokens are
//   minted for that throwaway process, so no password is ever used.
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const crypto = require('crypto');
const { spawn } = require('child_process');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

async function start(prefix, accounts) {
  const DB = process.env.TEST_DATABASE_URL;
  if (!DB) { console.log('refusing: set TEST_DATABASE_URL to an isolated test database'); process.exit(1); }
  const u = new URL(DB);
  const host = u.hostname.toLowerCase();
  const dbName = decodeURIComponent(u.pathname.replace(/^\/+/, '')).toLowerCase();
  const hostOk = host.endsWith('.neon.tech') || host === 'localhost' || host === '127.0.0.1';
  const nameOk = /(^|[-_])test($|[-_])/.test(dbName) || (process.env.TEST_DATABASE_EXPECT_HOST && process.env.TEST_DATABASE_EXPECT_HOST.toLowerCase() === host);
  if (!hostOk || !nameOk || /railway|rlwy/.test(host)) { console.log('refusing: not an isolated test database'); process.exit(1); }
  const SSL = process.env.TEST_DATABASE_SSL === 'true';
  const SECRET = crypto.randomBytes(24).toString('hex');
  const PORT = 5100 + Math.floor(Math.random() * 400);
  let pass = 0, total = 0;
  const rep = (name, ok, extra = '') => { total++; if (ok) pass++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${ok ? '' : extra}`); };

  const pool = new Pool({ connectionString: DB, ssl: SSL ? { rejectUnauthorized: false } : false, max: 2 }); pool.on('error', () => {});
  const q = async (s, p) => (await pool.query(s, p)).rows;
  const roles = Object.fromEntries((await q('select id, name from roles')).map((r) => [r.name, r.id]));
  const discarded = await bcrypt.hash(crypto.randomBytes(16).toString('hex'), 10);
  const U = {};
  for (const [key, role, dept] of accounts) {
    if (!roles[role]) { console.log('missing role ' + role); process.exit(1); }
    const email = `${prefix}.${key}@alnaciim.test`;
    const ex = await q('select id from users where email=$1', [email]);
    if (ex[0]) { await pool.query('update users set role_id=$1, department_id=$2, is_active=true where id=$3', [roles[role], dept || null, ex[0].id]); U[key] = { id: ex[0].id, role }; }
    else { const r = await q(`insert into users (employee_code, full_name, email, password_hash, role_id, department_id, is_active) values ($1,$2,$3,$4,$5,$6,true) returning id`, [`${prefix.toUpperCase()}-${key.toUpperCase()}`, `E2E ${prefix} ${key}`, email, discarded, roles[role], dept || null]); U[key] = { id: r[0].id, role }; }
  }
  const admin = (await q(`select u.id from users u join roles r on r.id=u.role_id where r.name='Admin' and u.is_active order by u.id limit 1`))[0];
  U.admin = { id: admin.id, role: 'Admin' };
  const tok = {}; for (const [k, v] of Object.entries(U)) tok[k] = jwt.sign({ id: v.id, email: k, role: 'x' }, SECRET, { algorithm: 'HS256', expiresIn: '1h' });

  const srv = spawn(process.execPath, ['--no-warnings', 'src/index.js'], { cwd: path.join(__dirname, '../..'), env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, PORT: String(PORT), DATABASE_URL: DB, DATABASE_SSL: SSL ? 'true' : '', JWT_SECRET: SECRET, BACKUP_CRON_SCHEDULE: 'disabled', CORS_ORIGIN: '', NODE_ENV: '', AUTH_CACHE_TTL_MS: '0', RATE_LIMIT_API_MAX: '1000000' }, stdio: 'ignore' });
  let up = false; for (let i = 0; i < 60 && !up; i++) { await new Promise((r) => setTimeout(r, 300)); try { up = (await fetch(`http://localhost:${PORT}/health`)).ok; } catch (_) {} }
  if (!up) { console.log('backend did not start'); srv.kill(); process.exit(1); }

  const api = async (who, method, p, body) => {
    const r = await fetch(`http://localhost:${PORT}/api/v1${p}`, { method, headers: { Authorization: 'Bearer ' + tok[who], ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    let j = {}; try { j = await r.json(); } catch (_) {}
    return { s: r.status, b: j, d: j.data, e: j.error };
  };
  // Inventory / ledger integrity helpers shared by all suites.
  const gl = async () => { const g = (await q('select coalesce(sum(debit),0)::numeric(14,2) d, coalesce(sum(credit),0)::numeric(14,2) c from journal_lines'))[0]; return Number(g.d) === Number(g.c); };
  const stock = async (pid, wid) => Number((await q('select coalesce(sum(quantity),0) n from stock_levels where product_id=$1 and warehouse_id=$2', [pid, wid]))[0].n);
  const ledgerMatches = async (pid) => {
    const sl = Number((await q('select coalesce(sum(quantity),0) n from stock_levels where product_id=$1', [pid]))[0].n);
    const sm = Number((await q(`select coalesce(sum(case when movement_type in ('IN','TRANSFER_IN') then quantity when movement_type in ('OUT','TRANSFER_OUT') then -quantity else 0 end),0) n from stock_movements where product_id=$1 and movement_type <> 'ADJUSTMENT'`, [pid]))[0].n);
    const adj = Number((await q(`select coalesce(sum(delta),0) n from (select case when movement_type='ADJUSTMENT' then 0 else 0 end delta from stock_movements where false) x`))[0].n);
    return { sl, sm: sm + adj };
  };
  const finish = async () => {
    srv.kill(); await pool.end();
    console.log(`\nSUMMARY: ${pass}/${total} PASS`);
    process.exit(pass === total ? 0 : 1);
  };
  const raw = async (method, p, body, headers = {}) => { const r = await fetch(`http://localhost:${PORT}/api/v1${p}`, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined }); let j = {}; try { j = await r.json(); } catch (_) {} return { s: r.status, b: j, d: j.data, e: j.error }; };
  return { api, raw, secret: SECRET, jwt, q, pool, U, rep, finish, gl, stock, ledgerMatches };
}

module.exports = { start };
