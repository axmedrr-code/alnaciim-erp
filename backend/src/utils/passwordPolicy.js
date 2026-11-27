// Password policy for passwords that an administrator sets for someone else (Admin reset in the app and the
// set-user-password.js script). One rule in one place, so the API and the script can never drift apart again.
// Messages describe the rule only: they never repeat the password.
const MIN_LENGTH = 12;
const MAX_LENGTH = 128;
const COMMON = /^(password|passw0rd|letmein|welcome|qwerty|admin|alnaciim|changeme|12345)/i;

function passwordPolicyError(password, email) {
  if (typeof password !== 'string' || password.length < MIN_LENGTH) return `Password must be at least ${MIN_LENGTH} characters`;
  if (password.length > MAX_LENGTH) return `Password must be at most ${MAX_LENGTH} characters`;
  if (COMMON.test(password)) return 'Password is too common or easy to guess';
  const localPart = String(email || '').split('@')[0].toLowerCase();
  if (localPart.length >= 5 && password.toLowerCase().includes(localPart)) return 'Password must not contain the account e-mail name';
  return null;
}

module.exports = { passwordPolicyError, MIN_LENGTH, MAX_LENGTH };
