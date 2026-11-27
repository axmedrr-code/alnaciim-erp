// Unit tests for the Admin-reset password policy (utils/passwordPolicy.js), shared with set-user-password.js.
const test = require('node:test');
const assert = require('node:assert');
const { passwordPolicyError } = require('../src/utils/passwordPolicy');

const EMAIL = 'uat.cashier@alnaciim.test';

test('accepts a long, uncommon password that does not contain the e-mail name', () => {
  assert.strictEqual(passwordPolicyError('Tamarind-River-92', EMAIL), null);
});

test('rejects fewer than 12 characters (11 refused, 12 accepted)', () => {
  assert.match(passwordPolicyError('Abcdefgh-12', EMAIL), /at least 12/);
  assert.strictEqual(passwordPolicyError('Abcdefgh-123', EMAIL), null);
});

test('rejects more than 128 characters', () => {
  assert.match(passwordPolicyError('x'.repeat(129), EMAIL), /at most 128/);
});

test('rejects common prefixes regardless of case', () => {
  for (const p of ['Password-2026!', 'ADMIN-secret-99', 'alnaciim-2026-ok', 'Qwerty-keyboard', '123456789012'])
    assert.match(passwordPolicyError(p, EMAIL), /too common/, p);
});

test("rejects a password containing the e-mail's local part (5+ characters)", () => {
  assert.match(passwordPolicyError('my-UAT.CASHIER-pass', EMAIL), /e-mail name/);
  // A very short local part is not checked, or it would reject almost everything.
  assert.strictEqual(passwordPolicyError('contains-abc-inside', 'abc@alnaciim.test'), null);
});

test('rejects a missing or non-string password', () => {
  assert.ok(passwordPolicyError(undefined, EMAIL));
  assert.ok(passwordPolicyError(123456789012, EMAIL));
});

test('error messages never contain the password', () => {
  for (const p of ['short1', 'Password-2026!', 'my-uat.cashier-pass', 'y'.repeat(130)]) {
    const msg = passwordPolicyError(p, EMAIL);
    assert.ok(msg && !msg.includes(p), p);
  }
});
