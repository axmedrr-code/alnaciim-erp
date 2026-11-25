// Creates (idempotently) the UAT accounts and reference data on the TEST database only.
//   DATABASE_URL=<neon test url> node src/scripts/seed-uat.js
// Safety: refuses anything that is not localhost or a Neon host whose database carries the label "ALNACIIM TEST - NOT RAILWAY DATA"
// (set with COMMENT ON DATABASE). New accounts get a random password nobody knows; a person receives a usable password only when it
// is explicitly issued (see docs/UAT_PLAN.md). No password is ever printed or stored in clear text.
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { Client } = require('pg');
const { nextHno } = require('../services/hnoService');

const LABEL = 'ALNACIIM TEST — NOT RAILWAY DATA';
const url = process.env.DATABASE_URL;
if (!url) { console.log('refusing: DATABASE_URL is not set'); process.exit(1); }
const host = new URL(url).hostname.toLowerCase();
if (!(host.endsWith('.neon.tech') || host === 'localhost' || host === '127.0.0.1') || /railway|rlwy/.test(host)) { console.log('refusing: not a TEST database host'); process.exit(1); }

// key, role, full name, department id (null = none), assigned warehouse code
const ACCOUNTS = [
  ['opm', 'Operation Manager', 'UAT Operation Manager', 9, null],
  ['head.delivery', 'Department Head', 'UAT Head of Delivery', 3, null],
  ['head.maint', 'Department Head', 'UAT Head of Maintenance', 5, null],
  ['staff.delivery', 'Data Entry Operator', 'UAT Delivery Staff (Data Entry)', 3, null],
  ['staff.maint', 'Technician', 'UAT Maintenance Technician', 5, null],
  ['proc1', 'Procurement Officer', 'UAT Procurement Officer 1', 4, null],
  ['proc2', 'Procurement Officer', 'UAT Procurement Officer 2', 4, null],
  ['store.rm', 'Storekeeper', 'UAT Storekeeper Raw Materials', 6, 'WH-RM-01'],
  ['store.fg', 'Storekeeper', 'UAT Storekeeper Finished Goods', 6, 'WH-FG-01'],
  ['store.ro', 'Storekeeper', 'UAT Storekeeper RO Tank', 6, 'WH-RO-01'],
  ['store.sp', 'Storekeeper', 'UAT Storekeeper Spare Parts', 6, 'WH-SP-01'],
  ['invmgr', 'Inventory Manager', 'UAT Inventory Manager', 6, null],
  ['prod1', 'Production Manager', 'UAT Production Manager 1', 1, null],
  ['prod2', 'Production Manager', 'UAT Production Manager 2', 1, null],
  ['fin', 'Finance Officer', 'UAT Finance Officer', 8, null],
  ['sales', 'Sales Manager', 'UAT Sales Manager', null, null],
  ['cashier', 'Cashier', 'UAT Cashier', null, null],
  ['collector', 'Collector', 'UAT Collector', null, null],
  ['routesup', 'Route Supervisor', 'UAT Route Supervisor', 3, null],
  ['driver1', 'Driver', 'UAT Driver 1', 3, null],
  ['driver2', 'Driver', 'UAT Driver 2', 3, null]
];

(async () => {
  const c = new Client({ connectionString: url, ssl: host === 'localhost' || host === '127.0.0.1' ? false : { rejectUnauthorized: false } });
  await c.connect();
  try {
    const label = (await c.query(`SELECT shobj_description(d.oid,'pg_database') AS c FROM pg_database d WHERE d.datname = current_database()`)).rows[0].c;
    if (label !== LABEL) { console.log('refusing: the database is not labelled as the TEST database'); process.exit(1); }
    await c.query('BEGIN');
    const roles = Object.fromEntries((await c.query('SELECT id, name FROM roles')).rows.map((r) => [r.name, r.id]));
    const whs = Object.fromEntries((await c.query('SELECT id, code FROM warehouses')).rows.map((w) => [w.code, w.id]));
    const ids = {};
    let created = 0;
    for (const [key, role, name, dept, wh] of ACCOUNTS) {
      if (!roles[role]) throw new Error(`missing role ${role}`);
      const email = `uat.${key}@alnaciim.test`;
      const ex = (await c.query('SELECT id FROM users WHERE email = $1', [email])).rows[0];
      if (ex) {
        await c.query('UPDATE users SET role_id=$1, full_name=$2, department_id=$3, assigned_warehouse_id=$4, is_active=true WHERE id=$5', [roles[role], name, dept, wh ? whs[wh] : null, ex.id]);
        ids[key] = ex.id;
      } else {
        const hash = await bcrypt.hash(crypto.randomBytes(18).toString('hex'), 10); // unknown to everyone until issued
        const r = await c.query(
          `INSERT INTO users (employee_code, full_name, email, password_hash, role_id, department_id, assigned_warehouse_id, is_active)
           VALUES ($1,$2,$3,$4,$5,$6,$7,true) RETURNING id`,
          [`UAT-${key.replace('.', '-').toUpperCase()}`.slice(0, 20), name, email, hash, roles[role], dept, wh ? whs[wh] : null]);
        ids[key] = r.rows[0].id; created++;
      }
    }
    // Department heads (the approvers of requisitions raised in their department)
    await c.query('UPDATE departments SET manager_id = $1 WHERE id = 3', [ids['head.delivery']]);
    await c.query('UPDATE departments SET manager_id = $1 WHERE id = 5', [ids['head.maint']]);

    // Trucks with their permanent drivers
    for (const [n, key] of [[1, 'driver1'], [2, 'driver2']]) {
      await c.query('UPDATE trucks SET assigned_driver_id = NULL WHERE assigned_driver_id = $1 AND plate_number <> $2', [ids[key], `UAT-TRK-${n}`]);
      const t = (await c.query('SELECT id FROM trucks WHERE plate_number = $1', [`UAT-TRK-${n}`])).rows[0];
      if (t) await c.query('UPDATE trucks SET assigned_driver_id = $1, capacity = 5000, capacity_unit = $2 WHERE id = $3', [ids[key], 'L', t.id]);
      else await c.query(`INSERT INTO trucks (plate_number, truck_code, capacity, capacity_unit, assigned_driver_id) VALUES ($1,$2,5000,'L',$3)`, [`UAT-TRK-${n}`, `UATT${n}`, ids[key]]);
    }
    const truck1 = (await c.query(`SELECT id FROM trucks WHERE plate_number = 'UAT-TRK-1'`)).rows[0].id;

    // Qaade with its collector
    let q = (await c.query(`SELECT id FROM qaades WHERE qaade_code = 'UAT-Q1'`)).rows[0];
    if (!q) q = (await c.query(`INSERT INTO qaades (qaade_code, name, area, collector_id, truck_id) VALUES ('UAT-Q1','UAT Qaade 1','Hodan',$1,$2) RETURNING id`, [ids.collector, truck1])).rows[0];

    // Customers
    const customers = [
      ['UAT-CUST-1', 'UAT Wholesale Customer', 'wholesale', 2000, 30],
      ['UAT-CUST-2', 'UAT Limited-Credit Customer', 'wholesale', 100, 15],
      ['UAT-CUST-3', 'UAT Retail Customer', 'retail', 0, 0],
      ['UAT-CUST-4', 'UAT Tanker Customer', 'tanker', 5000, 30]
    ];
    const custIds = {};
    for (const [code, name, type, limit, terms] of customers) {
      let row = (await c.query('SELECT id FROM customers WHERE code = $1', [code])).rows[0];
      if (!row) {
        const hno = await nextHno(c, 'customer');
        row = (await c.query(`INSERT INTO customers (code, hno, name, type, credit_limit, payment_terms_days, qaade_id) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`, [code, hno, name, type, limit, terms, q.id])).rows[0];
      }
      custIds[code] = row.id;
    }
    if (!(await c.query(`SELECT 1 FROM customer_tanks WHERE tank_code = 'UAT-TANK-1'`)).rows[0]) {
      await c.query(`INSERT INTO customer_tanks (tank_code, tank_name, customer_id, tank_type, capacity_liters, barcode, location) VALUES ('UAT-TANK-1','UAT Rooftop Tank',$1,'tank',1000,'UAT-BC-1','Hodan')`, [custIds['UAT-CUST-4']]);
    }

    // Suppliers
    for (const [code, name] of [['UAT-SUP-1', 'UAT Supplier One (preforms & caps)'], ['UAT-SUP-2', 'UAT Supplier Two (chemicals)']]) {
      if (!(await c.query('SELECT 1 FROM suppliers WHERE code = $1', [code])).rows[0]) {
        await c.query(`INSERT INTO suppliers (code, name, category, is_active) VALUES ($1,$2,'raw_material',true)`, [code, name]);
      }
    }
    await c.query('COMMIT');
    console.log(`OK: ${ACCOUNTS.length} UAT accounts (${created} newly created), department heads set for departments 3 and 5, trucks UAT-TRK-1/2, qaade UAT-Q1, 4 customers, 1 tank, 2 suppliers.`);
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    console.log('FAIL:', String(e.message).replace(/postgres(ql)?:\/\/\S+/gi, '<url>'));
    process.exitCode = 1;
  } finally { await c.end(); }
})();
