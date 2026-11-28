// Creates the test users and fixtures in the isolated test database. Every user gets a random password that exists only in this
// process' environment (E2E_PW_<KEY>) and is never printed or written to disk. Idempotent: re-running resets the same users.
const crypto = require('crypto');
const path = require('path');
const { assertTestDatabase } = require('./lib/guard');

const backend = (m) => require(path.join(__dirname, '..', 'backend', 'node_modules', m));

// key, role, needs a warehouse, in the E2E department
const USERS = [
  ['cashier', 'Cashier'], ['store', 'Storekeeper', 'rm'], ['store2', 'Storekeeper', 'fg'], ['head', 'Department Head', null, true],
  ['opm', 'Operation Manager'], ['fin', 'Finance Officer'], ['coll', 'Collector'], ['de', 'Data Entry Operator'],
  ['admin', 'Admin'], ['pw', 'Cashier']
];

module.exports = async () => {
  const db = assertTestDatabase();
  const { Pool } = backend('pg');
  const bcrypt = backend('bcryptjs');
  const pool = new Pool({ connectionString: db.url, ssl: db.ssl ? { rejectUnauthorized: false } : false, max: 2 });
  pool.on('error', () => {});
  const q = async (s, p) => (await pool.query(s, p)).rows;
  try {
    const roles = Object.fromEntries((await q('select id, name from roles')).map((r) => [r.name, r.id]));
    const stamp = Date.now();

    // an isolated department so the real UAT departments and their heads are never touched
    const dept = (await q(`insert into departments (code, name) values ('E2E-DEPT', 'E2E Test Department') on conflict (code) do update set is_active = true returning id`))[0].id;
    const wh = async (code, name, type) => (await q(`insert into warehouses (code, name, type) values ($1,$2,$3) on conflict (code) do update set is_active = true, type = $3 returning id`, [code, name, type]))[0].id;
    const RM = await wh('E2E-RM', 'E2E Raw Materials Store', 'raw_material');
    const FG = await wh('E2E-FG', 'E2E Finished Goods Store', 'finished_goods');

    for (const [key, role, whKey, isHead] of USERS) {
      const password = `Pw-${crypto.randomBytes(9).toString('hex')}`;
      process.env[`E2E_PW_${key.toUpperCase()}`] = password;
      const hash = await bcrypt.hash(password, 10);
      const email = `e2e.${key}@alnaciim.test`;
      const assigned = whKey === 'rm' ? RM : whKey === 'fg' ? FG : null;
      const ex = await q('select id from users where email = $1', [email]);
      let id;
      if (ex[0]) {
        id = ex[0].id;
        await pool.query('update users set password_hash=$1, role_id=$2, department_id=$3, assigned_warehouse_id=$4, is_active=true, password_changed_at=null where id=$5', [hash, roles[role], dept, assigned, id]);
      } else {
        id = (await q(`insert into users (employee_code, full_name, email, password_hash, role_id, department_id, assigned_warehouse_id, is_active)
                       values ($1,$2,$3,$4,$5,$6,$7,true) returning id`, [`E2E-${key.toUpperCase()}`.slice(0, 20), `E2E ${role} (${key})`, email, hash, roles[role], dept, assigned]))[0].id;
      }
      if (isHead) await pool.query('update departments set manager_id = $1 where id = $2', [id, dept]);
    }
    const admin = (await q(`select id from users where email = 'e2e.admin@alnaciim.test'`))[0].id;

    // fixtures for the Cashier and Storekeeper flows
    const cat = async (name) => (await q('select id from categories where name = $1', [name]))[0].id;
    const prod = async (sku, name, catId, type) => (await q(`insert into products (sku, name, category_id, product_type, unit) values ($1,$2,$3,$4,'pcs')
                                                           on conflict (sku) do update set is_active = true returning id`, [sku, name, catId, type]))[0].id;
    const bottle = await prod('E2E-BOTTLE', 'E2E Bottled Water 1.5L', await cat('Bottled Water'), 'finished_good');
    const preform = await prod('E2E-PREFORM', 'E2E PET Preform', await cat((await q('select name from categories order by id limit 1'))[0].name), 'raw_material');
    const setStock = async (p, w, qty) => {
      await pool.query(`insert into stock_levels (product_id, warehouse_id, quantity) values ($1,$2,$3) on conflict (product_id, warehouse_id) do update set quantity = $3, updated_at = now()`, [p, w, qty]);
      await pool.query(`insert into stock_movements (product_id, warehouse_id, movement_type, quantity, reference_type, performed_by, notes, signed_quantity) values ($1,$2,'ADJUSTMENT',$3,'adjustment',$4,'E2E fixture',$3)`, [p, w, qty, admin]);
    };
    // reset to a known level each run (the movement row records the fixture, the level is what the tests assert on)
    await setStock(bottle, FG, 200);
    await setStock(preform, RM, 500);
    const cust = (await q(`insert into customers (code, name, hno, type, credit_limit, status) values ('E2E-CUST', 'E2E Test Customer', '990001', 'retail', 0, 'active')
                           on conflict (code) do update set status = 'active' returning id`))[0].id;

    process.env.E2E_FIXTURES = JSON.stringify({ dept, RM, FG, bottle, preform, cust, stamp });
  } finally {
    await pool.end();
  }
};
