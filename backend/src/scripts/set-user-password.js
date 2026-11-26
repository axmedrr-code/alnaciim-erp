// Sets (or resets) ONE user's password.
//
//   NEW_PASSWORD='<12+ chars>' node src/scripts/set-user-password.js <email> [--yes] [--expect-host=<db host>]
//
// Safeguards (this script writes to whichever database DATABASE_URL points at):
//  * The password is read from the NEW_PASSWORD environment variable, so it never appears in argv,
//    shell history, logs or this repository, and it is never printed.
//  * The target database (host + database name, never credentials) and the account are always shown.
//  * Interactive terminal: you must type the database name to confirm.
//  * Non-interactive (CI/remote shell, no TTY): refuses to run unless --yes is passed.
//  * --expect-host=<host> aborts if the database host differs, so a script/runbook can pin its target.
//  * Minimum 12 characters, not a trivially guessable value, and not the account's e-mail.
require('dotenv').config();
const readline = require('readline');
const bcrypt = require('bcryptjs');
const { pool } = require('../config/db');

const COMMON = /^(password|passw0rd|letmein|welcome|qwerty|admin|alnaciim|changeme|12345)/i;

function parseArgs(argv) {
  const flags = new Set();
  let expectHost = null;
  const positional = [];
  for (const a of argv) {
    if (a === '--yes' || a === '-y') flags.add('yes');
    else if (a.startsWith('--expect-host=')) expectHost = a.slice('--expect-host='.length).trim().toLowerCase();
    else if (a.startsWith('--')) throw new Error(`Unknown option ${a}`);
    else positional.push(a);
  }
  return { email: (positional[0] || '').trim().toLowerCase(), yes: flags.has('yes'), expectHost };
}

function describeTarget() {
  try {
    const u = new URL(process.env.DATABASE_URL);
    return { host: u.hostname.toLowerCase(), db: decodeURIComponent(u.pathname.replace(/^\//, '')) };
  } catch (_) {
    throw new Error('DATABASE_URL is missing or not a valid connection URL');
  }
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (answer) => { rl.close(); resolve(answer.trim()); }));
}

(async () => {
  const { email, yes, expectHost } = parseArgs(process.argv.slice(2));
  const password = process.env.NEW_PASSWORD || '';
  if (!email) throw new Error('Usage: NEW_PASSWORD=... node src/scripts/set-user-password.js <email> [--yes] [--expect-host=<host>]');
  if (password.length < 12) throw new Error('NEW_PASSWORD must be set and at least 12 characters long');
  // Only compare against the e-mail's local part when it is long enough to be meaningful (a 1-2 character
  // local part would otherwise reject almost every password).
  const localPart = email.split('@')[0];
  if (COMMON.test(password) || (localPart.length >= 5 && password.toLowerCase().includes(localPart))) throw new Error('NEW_PASSWORD is too guessable');

  const target = describeTarget();
  if (expectHost && expectHost !== target.host) {
    throw new Error(`Refusing: database host is "${target.host}" but --expect-host was "${expectHost}"`);
  }
  console.log(`Target database : ${target.db} @ ${target.host}`);
  console.log(`Account         : ${email}`);

  if (!yes) {
    if (!process.stdin.isTTY) throw new Error('Non-interactive run: pass --yes to confirm (optionally with --expect-host=<host>)');
    const typed = await ask(`Type the database name (${target.db}) to confirm: `);
    if (typed !== target.db) throw new Error('Confirmation did not match — nothing changed');
  }

  const hash = await bcrypt.hash(password, 10); // same cost the app uses elsewhere (keeps login timing uniform)
  const { rowCount } = await pool.query('UPDATE users SET password_hash = $1, password_changed_at = now() WHERE lower(email) = $2', [hash, email]);
  if (!rowCount) throw new Error(`No user with email ${email} — nothing changed`);
  console.log(`Password updated for ${email}. Existing sessions stay valid until their token expires.`);
})()
  .catch((err) => { console.error(String(err.message).replace(/postgres(ql)?:\/\/\S+/gi, '<url>')); process.exitCode = 1; })
  .finally(() => pool.end());
