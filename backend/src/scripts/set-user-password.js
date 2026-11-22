// Usage:  NEW_PASSWORD='<at least 12 chars>' node src/scripts/set-user-password.js user@example.com
// Sets (or resets) one user's password. The password is read from the environment so it never
// appears in shell history arguments, logs or this repository, and is never printed.
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { pool } = require('../config/db');

(async () => {
  const email = (process.argv[2] || '').trim().toLowerCase();
  const password = process.env.NEW_PASSWORD || '';
  if (!email) throw new Error('Usage: NEW_PASSWORD=... node src/scripts/set-user-password.js <email>');
  if (password.length < 12) throw new Error('NEW_PASSWORD must be set and at least 12 characters long');
  if (/^password/i.test(password)) throw new Error('NEW_PASSWORD is too guessable');

  const hash = await bcrypt.hash(password, 12);
  const { rowCount } = await pool.query('UPDATE users SET password_hash = $1 WHERE lower(email) = $2', [hash, email]);
  if (!rowCount) throw new Error(`No user with email ${email}`);
  console.log(`Password updated for ${email}`);
})()
  .catch((err) => { console.error(String(err.message).replace(/postgres(ql)?:\/\/\S+/gi, '<url>')); process.exitCode = 1; })
  .finally(() => pool.end());
