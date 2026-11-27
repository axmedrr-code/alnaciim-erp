import { useState } from 'react';
import { X } from 'lucide-react';
import client from '../api/client';

// Admin resets a user's forgotten password (PUT /users/:id/password). The server enforces the policy (12+ characters,
// not a common password, not the e-mail name), refuses the Admin's own account and other Admins, and audits the reset.
// The new password is only sent to the API: it is cleared from the form after every submit and never shown again.
export const RESET_MIN_LENGTH = 12;

export default function ResetPasswordModal({ user, onClose }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    if (password.length < RESET_MIN_LENGTH) { setError(`The new password must be at least ${RESET_MIN_LENGTH} characters.`); return; }
    if (password !== confirm) { setError('The two passwords do not match.'); return; }
    setBusy(true);
    try {
      await client.put(`/users/${user.id}/password`, { password, password_confirmation: confirm });
      setDone(true);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not reset the password.');
    } finally {
      // Never keep the password in the page after it has been sent, whatever the outcome.
      setPassword(''); setConfirm(''); setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Reset password"
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div className="card" style={{ width: 'min(440px, 92vw)' }}>
        <div className="card__header">
          <h3>Reset password</h3>
          <button className="btn-icon" onClick={onClose} aria-label="Close"><X size={14} /></button>
        </div>
        <p className="muted">{user.full_name} ({user.email})</p>
        {done ? (
          <div>
            <p role="status">The password was reset. All of this user&apos;s open sessions were signed out. Give them the new password privately and ask them to change it from the user menu.</p>
            <button className="btn" onClick={onClose}>Close</button>
          </div>
        ) : (
          <form onSubmit={submit}>
            {error && <div className="error-box">{error}</div>}
            <div className="form-field"><label htmlFor="rp-new">New password ({RESET_MIN_LENGTH}+ characters)</label>
              <input id="rp-new" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></div>
            <div className="form-field"><label htmlFor="rp-confirm">Repeat the new password</label>
              <input id="rp-confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required /></div>
            <p className="muted" style={{ fontSize: 12 }}>Not a common password and not the user&apos;s e-mail name.</p>
            <div className="toolbar">
              <button className="btn" type="submit" disabled={busy}>Reset password</button>
              <button className="btn secondary" type="button" onClick={onClose}>Cancel</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
