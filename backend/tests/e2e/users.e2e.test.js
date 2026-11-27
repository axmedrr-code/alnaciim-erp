// Users & authentication E2E: user administration (Admin only), login, token security, immediate effect of deactivation / role
// changes, lock-out protection, password change and reset (never exposed), brute-force limiting, assignments and audit.
const crypto = require('crypto');
const { start } = require('./harness');

(async () => {
  const { api, raw, secret, jwt, q, pool, U, rep, finish, gl } = await start('usr', [
    ['adm2', 'Admin'], ['sales', 'Sales Manager'], ['fin', 'Finance Officer'], ['cash', 'Cashier'], ['store', 'Storekeeper']
  ]);
  const stamp = Date.now();
  const roleId = async (n) => (await q('select id from roles where name=$1', [n]))[0].id;
  const R = { cashier: await roleId('Cashier'), finance: await roleId('Finance Officer'), store: await roleId('Storekeeper'), admin: await roleId('Admin'), driver: await roleId('Driver') };
  const pw = () => `Pw-${crypto.randomBytes(9).toString('hex')}`; // random test passwords: never printed
  const login = (email, password) => raw('POST', '/auth/login', { email, password });
  const dept = (await q('select id from departments order by id limit 1'))[0].id;
  const W = (await q(`insert into warehouses (code, name, type) values ('TST-USR-W','E2E Users Store','general') on conflict (code) do update set is_active=true returning id`))[0].id;
  const body = (n, over = {}) => ({ employee_code: `TU${n}-${String(stamp).slice(-8)}`, full_name: `E2E User ${n}`, email: `usr.n${n}.${stamp}@alnaciim.test`, password: pw(), role_id: R.cashier, ...over });

  // ---------- access
  let r = await api('sales', 'GET', '/users'); rep('Sales Manager cannot list users (403)', r.s === 403);
  r = await api('fin', 'GET', '/users'); rep('Finance cannot list users (403)', r.s === 403);
  r = await api('cash', 'POST', '/users', body(0)); rep('Cashier cannot create users (403)', r.s === 403);
  r = await api('sales', 'PUT', `/users/${U.cash.id}`, { full_name: 'Hacked' }); rep('A non-admin cannot edit users (403)', r.s === 403);
  r = await api('adm2', 'GET', '/users'); rep('Admin lists users with role names and no password data', r.s === 200 && r.d.length > 3 && !JSON.stringify(r.d).includes('password'), `[${r.s}]`);
  r = await api('cash', 'GET', '/users/roles'); rep('The role catalogue is readable by any signed-in user', r.s === 200 && r.d.some((x) => x.name === 'Admin'));
  r = await raw('GET', '/users'); rep('No token -> 401', r.s === 401);

  // ---------- create + validation
  r = await api('adm2', 'POST', '/users', { ...body(1), employee_code: '' }); rep('Empty employee code -> 400', r.s === 400);
  r = await api('adm2', 'POST', '/users', { ...body(1), email: 'not-an-email' }); rep('Invalid email -> 400', r.s === 400);
  r = await api('adm2', 'POST', '/users', { ...body(1), password: 'short' }); rep('A password shorter than 8 characters -> 400', r.s === 400);
  r = await api('adm2', 'POST', '/users', { ...body(1), role_id: 99999 }); rep('Unknown role -> 4xx (not a 500)', r.s >= 400 && r.s < 500, `[${r.s}]`);
  r = await api('adm2', 'POST', '/users', { ...body(1), assigned_warehouse_id: 99999999 }); rep('Unknown assigned warehouse -> 4xx', r.s >= 400 && r.s < 500, `[${r.s}]`);
  const b1 = body(1, { role_id: R.store, department_id: dept, assigned_warehouse_id: W, phone: '+252600000000' }); const p1 = b1.password;
  r = await api('adm2', 'POST', '/users', b1); const N1 = r.d || {};
  rep('Admin creates a user: no password in the response, department and warehouse stored', r.s === 201 && N1.id > 0 && !('password_hash' in N1) && !JSON.stringify(N1).includes(p1) && N1.department_id === dept && N1.assigned_warehouse_id === W, `[${r.s}] ${r.e}`);
  r = await api('adm2', 'POST', '/users', { ...body(2), email: b1.email }); rep('Duplicate email -> 409', r.s === 409);
  r = await api('adm2', 'POST', '/users', { ...body(2), employee_code: b1.employee_code }); rep('Duplicate employee code -> 409', r.s === 409);
  const audCreate = (await q(`select new_value::text t from audit_logs where entity_type='user' and entity_id=$1 and action='CREATE'`, [N1.id]))[0];
  rep('The creation is audited and the audit record holds no password or hash', audCreate && !audCreate.t.toLowerCase().includes('password') && !audCreate.t.includes('$2'), audCreate && audCreate.t.slice(0, 80));
  const hashRow = (await q('select password_hash from users where id=$1', [N1.id]))[0].password_hash;
  rep('The password is stored only as a bcrypt hash', /^\$2[aby]\$10\$/.test(hashRow) && !hashRow.includes(p1));

  // ---------- login + token
  r = await login(b1.email, p1); const tok1 = r.d && r.d.token;
  rep('The new user can sign in; the token carries role and assigned warehouse', r.s === 200 && tok1 && r.d.user.role === 'Storekeeper' && r.d.user.assignedWarehouseId === W && !JSON.stringify(r.d).includes('password'), `[${r.s}] ${r.e}`);
  const asUser = (t, m, p, b) => raw(m, p, b, { Authorization: `Bearer ${t}` });
  r = await asUser(tok1, 'GET', '/auth/me'); rep('/auth/me returns the live role and warehouse', r.s === 200 && r.d.role === 'Storekeeper' && r.d.assignedWarehouseId === W);
  const wrong = await login(b1.email, 'definitely-wrong-password'); const unknown = await login(`nobody.${stamp}@alnaciim.test`, 'definitely-wrong-password');
  rep('Wrong password and unknown email give the same generic 401 (no account enumeration)', wrong.s === 401 && unknown.s === 401 && wrong.e === unknown.e, `${wrong.e} | ${unknown.e}`);
  r = await login(b1.email, ''); rep('An empty password -> 400', r.s === 400 || r.s === 401);
  r = await login('x', 'y'); rep('A malformed login body -> 400', r.s === 400);
  r = await asUser('garbage', 'GET', '/auth/me'); rep('A malformed token -> 401', r.s === 401);
  const forged = jwt.sign({ id: N1.id, role: 'Admin' }, 'another-secret-entirely', { algorithm: 'HS256' }); r = await asUser(forged, 'GET', '/users'); rep('A token signed with a different secret -> 401', r.s === 401);
  const none = `${Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify({ id: N1.id, role: 'Admin' })).toString('base64url')}.`; r = await asUser(none, 'GET', '/users'); rep('An unsigned (alg=none) token -> 401', r.s === 401);
  const expired = jwt.sign({ id: N1.id }, secret, { algorithm: 'HS256', expiresIn: -60 }); r = await asUser(expired, 'GET', '/auth/me'); rep('An expired token -> 401', r.s === 401);
  const hs512 = jwt.sign({ id: N1.id }, secret, { algorithm: 'HS512' }); r = await asUser(hs512, 'GET', '/auth/me'); rep('A token using another algorithm (HS512) is rejected (algorithm pinned to HS256)', r.s === 401);
  const claimAdmin = jwt.sign({ id: N1.id, role: 'Admin' }, secret, { algorithm: 'HS256' }); r = await asUser(claimAdmin, 'GET', '/users'); rep('A role claim inside the token is ignored: the database role decides (403)', r.s === 403);
  r = await api('store', 'GET', '/auth/client-ip'); rep('The proxy diagnostic is Admin-only (403)', r.s === 403);
  r = await api('adm2', 'GET', '/auth/client-ip'); rep('Admin can read the proxy diagnostic', r.s === 200);

  // ---------- role change / deactivation take effect immediately
  r = await asUser(tok1, 'GET', '/finance/chart-of-accounts'); rep('As a Storekeeper the user cannot read the chart of accounts (403)', r.s === 403);
  r = await api('adm2', 'PUT', `/users/${N1.id}`, { role_id: R.finance });
  rep('Admin changes the role to Finance Officer', r.s === 200 && r.d.role_id === R.finance);
  r = await asUser(tok1, 'GET', '/finance/chart-of-accounts'); rep('The SAME token now has Finance access immediately (role is read from the database)', r.s === 200);
  const aud = await q(`select old_value->>'role_id' o, new_value->>'role_id' n from audit_logs where entity_type='user' and entity_id=$1 and action='UPDATE' order by id desc limit 1`, [N1.id]);
  rep('The role change is audited with old and new values', aud[0] && Number(aud[0].o) === R.store && Number(aud[0].n) === R.finance);
  r = await api('adm2', 'PUT', `/users/${N1.id}`, { is_active: false }); rep('Admin deactivates the user', r.s === 200 && r.d.is_active === false);
  r = await asUser(tok1, 'GET', '/auth/me'); rep('The existing token stops working at once (401)', r.s === 401);
  r = await login(b1.email, p1); rep('A deactivated user cannot sign in (401)', r.s === 401);
  r = await api('adm2', 'PUT', `/users/${N1.id}`, { is_active: true }); r = await login(b1.email, p1); rep('Reactivating restores the sign-in', r.s === 200);

  // ---------- update validation
  r = await api('adm2', 'PUT', `/users/${N1.id}`, {}); rep('An empty update -> 400', r.s === 400);
  r = await api('adm2', 'PUT', `/users/${N1.id}`, { email: 'bad' }); rep('Invalid email on update -> 400', r.s === 400);
  r = await api('adm2', 'PUT', `/users/${N1.id}`, { commission_rate: 150 }); rep('Commission above 100% -> 400', r.s === 400);
  r = await api('adm2', 'PUT', `/users/${N1.id}`, { email: U.cash.id ? `usr.cash@alnaciim.test` : 'x@y.z' }); rep('Changing to an email already in use -> 409', r.s === 409);
  r = await api('adm2', 'PUT', '/users/99999999', { full_name: 'ghost' }); rep('Unknown user -> 404', r.s === 404);
  r = await api('adm2', 'PUT', '/users/not-a-number', { full_name: 'ghost' }); rep('A non-numeric user id -> 404 (not a 500)', r.s === 404);
  r = await api('adm2', 'PUT', `/users/${N1.id}`, { department_id: dept, assigned_warehouse_id: null, phone: null, commission_rate: 2.5 }); rep('Department, phone, warehouse and commission can be updated/cleared', r.s === 200 && r.d.department_id === dept && r.d.assigned_warehouse_id === null && Number(r.d.commission_rate) === 2.5);

  // ---------- lock-out protection (uses a dedicated test Admin, never the real one)
  r = await api('adm2', 'PUT', `/users/${U.adm2.id}`, { is_active: false }); rep('An Admin cannot disable their own account (409)', r.s === 409, `[${r.s}] ${r.e}`);
  r = await api('adm2', 'PUT', `/users/${U.adm2.id}`, { role_id: R.cashier }); rep('An Admin cannot demote their own account (409)', r.s === 409, `[${r.s}] ${r.e}`);
  const stillAdmin = (await q(`select r.name, u.is_active from users u join roles r on r.id=u.role_id where u.id=$1`, [U.adm2.id]))[0];
  rep('...and the account really is still an active Admin', stillAdmin.name === 'Admin' && stillAdmin.is_active === true);
  r = await api('adm2', 'PUT', `/users/${U.adm2.id}`, { phone: '+252611111111' }); rep('An Admin can still edit their own non-privileged fields', r.s === 200);

  // ---------- password change (self) and reset (admin)
  const nu = body(3); const login3 = await login((await api('adm2', 'POST', '/users', nu)).d.email, nu.password); const t3 = login3.d.token;
  r = await asUser(t3, 'POST', '/auth/change-password', { current_password: 'wrong-current-password', new_password: pw() }); rep('Changing the password with a wrong current password -> 401', r.s === 401);
  r = await asUser(t3, 'POST', '/auth/change-password', { current_password: nu.password, new_password: 'short' }); rep('A new password under 8 characters -> 400', r.s === 400);
  r = await asUser(t3, 'POST', '/auth/change-password', { current_password: nu.password, new_password: nu.password }); rep('Reusing the same password -> 400', r.s === 400);
  await new Promise((res) => setTimeout(res, 1100)); // the session must be older than the change (JWT iat has 1 s resolution)
  const np = pw(); r = await asUser(t3, 'POST', '/auth/change-password', { current_password: nu.password, new_password: np });
  rep('A user changes their own password; the response holds no password', r.s === 200 && r.d.password_changed === true && !JSON.stringify(r.b).includes(np));
  const freshTok = r.d && r.d.token;
  rep('The change returns a fresh token so the current session stays signed in', !!freshTok && (await asUser(freshTok, 'GET', '/auth/me')).s === 200);
  rep('The token issued before the password change is rejected (401)', (await asUser(t3, 'GET', '/auth/me')).s === 401);
  rep('...and so is every protected route with it', (await asUser(t3, 'GET', '/products')).s === 401);
  r = await login(nu.email, nu.password); rep('The old password no longer works', r.s === 401);
  r = await login(nu.email, np); rep('The new password works', r.s === 200);
  r = await raw('POST', '/auth/change-password', { current_password: np, new_password: pw() }); rep('Changing a password needs a signed-in session (401)', r.s === 401);
  const reset = pw();
  const two = (p, c = p) => ({ password: p, password_confirmation: c });
  const hashOf = async (id) => (await q('select password_hash from users where id=$1', [id]))[0].password_hash;
  const n1Hash = await hashOf(N1.id);
  // authorization
  for (const who of ['cash', 'sales', 'fin', 'store']) { r = await api(who, 'PUT', `/users/${N1.id}/password`, two(reset)); rep(`A ${who} (non-admin) cannot reset passwords (403)`, r.s === 403); }
  r = await raw('PUT', `/users/${N1.id}/password`, two(reset)); rep('Resetting without signing in -> 401', r.s === 401);
  r = await api('adm2', 'PUT', `/users/${U.adm2.id}/password`, two(pw())); rep('An Admin cannot reset their own password here (409: use Change password)', r.s === 409, `[${r.s}] ${r.e}`);
  const otherAdminHash = await hashOf(U.admin.id);
  r = await api('adm2', 'PUT', `/users/${U.admin.id}/password`, two(pw())); rep("An Admin cannot reset another Admin's password (403)", r.s === 403, `[${r.s}] ${r.e}`);
  rep("The other Admin's password hash is unchanged", (await hashOf(U.admin.id)) === otherAdminHash);
  // validation (each refused attempt leaves the stored hash untouched and never echoes the value)
  const bad = [
    ['below 12 characters', two('Short-pw-11')],
    ['a common password', two('Password-2026-ok')],
    ['containing the e-mail name', two(`x-${N1.email.split('@')[0]}-y`)],
    ['the two entries differ', two(pw(), pw())],
    ['the confirmation missing', { password: reset }],
    ['an unexpected extra field', { ...two(reset), role_id: R.admin }],
    ['over 128 characters', two('Z'.repeat(129))]
  ];
  for (const [name, b] of bad) {
    r = await api('adm2', 'PUT', `/users/${N1.id}/password`, b);
    rep(`Admin reset with ${name} -> 400, value not echoed`, r.s === 400 && !JSON.stringify(r.b).includes(b.password), `[${r.s}] ${r.e}`);
  }
  rep('No refused reset changed the stored password hash', (await hashOf(N1.id)) === n1Hash);
  r = await api('adm2', 'PUT', '/users/99999999/password', two(reset)); rep('Resetting an unknown user -> 404', r.s === 404);
  // success
  const auditBefore = Number((await q(`select count(*)::int n from audit_logs where entity_type='user_password'`))[0].n);
  const otherHashes = await q('select id, password_hash from users where id <> $1 order by id', [N1.id]);
  r = await api('adm2', 'PUT', `/users/${N1.id}/password`, two(reset)); rep('Admin resets a forgotten password; nothing sensitive is returned', r.s === 200 && r.d.password_reset === true && r.d.id === N1.id && !JSON.stringify(r.b).includes(reset) && !JSON.stringify(r.b).includes('$2'), `[${r.s}] ${r.e}`);
  const newHash = await hashOf(N1.id);
  rep('The new password is stored only as a bcrypt hash', newHash !== n1Hash && /^\$2[aby]\$10\$/.test(newHash) && !newHash.includes(reset));
  const afterHashes = await q('select id, password_hash from users where id <> $1 order by id', [N1.id]);
  rep('No other account was changed by the reset', JSON.stringify(afterHashes) === JSON.stringify(otherHashes));
  const audR = (await q(`select user_id, entity_id, created_at, new_value, new_value::text t, old_value from audit_logs where entity_type='user_password' order by id desc limit 1`))[0];
  rep('The reset is audited: who (Admin), whose (target), when', Number((await q(`select count(*)::int n from audit_logs where entity_type='user_password'`))[0].n) === auditBefore + 1
    && Number(audR.user_id) === U.adm2.id && Number(audR.entity_id) === N1.id && audR.created_at && audR.new_value.event === 'password_reset_by_admin' && audR.new_value.target_email === N1.email, audR && audR.t);
  rep('The audit record holds no password or hash', !audR.t.includes(reset) && !audR.t.includes('$2') && !/"password"/.test(audR.t) && audR.old_value === null);

  // ---------- an Admin reset ends the user's open sessions
  const nu4 = body(4); await api('adm2', 'POST', '/users', nu4);
  const t4 = (await login(nu4.email, nu4.password)).d.token;
  rep('Before the reset the user session works', (await asUser(t4, 'GET', '/auth/me')).s === 200);
  await new Promise((res) => setTimeout(res, 1100));
  const reset4 = pw(); r = await api('adm2', 'PUT', `/users/${(await q('select id from users where email=$1', [nu4.email]))[0].id}/password`, { password: reset4, password_confirmation: reset4 });
  rep('Admin reset succeeds', r.s === 200);
  rep('The user session opened before the Admin reset is rejected (401)', (await asUser(t4, 'GET', '/auth/me')).s === 401);
  r = await login(nu4.email, reset4); rep('Signing in with the reset password works and gives a working token', r.s === 200 && (await asUser(r.d.token, 'GET', '/auth/me')).s === 200);
  rep('Other users sessions are not affected by someone else password change', (await api('cash', 'GET', '/auth/me')).s === 200);
  r = await login(b1.email, p1); rep('The forgotten password stops working after the reset', r.s === 401);
  r = await login(b1.email, reset); rep('The reset password works', r.s === 200);
  const audPw = await q(`select new_value::text t from audit_logs where entity_type='user_password' and entity_id = any($1)`, [[N1.id, (await q('select id from users where email=$1', [nu.email]))[0].id]]);
  rep('Password changes and resets are audited without the password', audPw.length >= 2 && audPw.every((x) => !x.t.includes(reset) && !x.t.includes(np) && !x.t.includes('$2')), `rows=${audPw.length}`);

  // ---------- assignments reach the rest of the ERP
  r = await api('adm2', 'PUT', `/users/${N1.id}`, { role_id: R.store, assigned_warehouse_id: W });
  const tokStore = (await login(b1.email, reset)).d.token;
  const cat = (await q('select id from categories order by id limit 1'))[0].id;
  const P = (await q(`insert into products (sku, name, category_id, product_type, unit) values ($1,$2,$3,'raw_material','pcs') returning id`, [`TUSR-${stamp}`, `E2E users item ${stamp}`, cat]))[0].id;
  r = await asUser(tokStore, 'POST', '/inventory/movements', { product_id: P, warehouse_id: W, movement_type: 'IN', quantity: 5, reference_type: 'adjustment' }); rep('A Storekeeper created through the API can post stock in their assigned warehouse', r.s === 201, `[${r.s}] ${r.e}`);
  const other = (await q(`select id from warehouses where id <> $1 order by id limit 1`, [W]))[0].id;
  r = await asUser(tokStore, 'POST', '/inventory/movements', { product_id: P, warehouse_id: other, movement_type: 'IN', quantity: 5 }); rep('...but not in any other warehouse (403)', r.s === 403);

  // ---------- brute-force protection (last: it locks the throwaway address only)
  const victim = `usr.victim.${stamp}@alnaciim.test`; let codes = [];
  for (let i = 0; i < 12; i++) codes.push((await login(victim, `wrong-${i}-password`)).s);
  rep('After 10 failed attempts the account is rate-limited (429) without revealing whether it exists', codes.slice(0, 10).every((c) => c === 401) && codes.slice(10).every((c) => c === 429), codes.join(','));
  r = await login(b1.email, reset); rep('Rate-limiting one address does not lock out other accounts', r.s === 200);

  // ---------- audit + integrity
  const cnt = await q(`select count(*)::int n from audit_logs where entity_type='user' and user_id=$1`, [U.adm2.id]);
  rep('User creations and updates by the Admin are all in the audit trail', cnt[0].n >= 6, `rows=${cnt[0].n}`);
  rep('General ledger balanced at the end', await gl());

  await finish();
})().catch((e) => { console.log('ERR', String(e.stack || e.message).replace(/postgres(ql)?:\/\/\S+/gi, '<url>')); process.exit(1); });
