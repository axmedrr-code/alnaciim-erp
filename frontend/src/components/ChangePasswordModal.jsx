import { useState } from 'react';
import { X } from 'lucide-react';
import client from '../api/client';

// Self-service password change (POST /auth/change-password). The password is only ever sent to the API; nothing is stored in the browser.
export default function ChangePasswordModal({ onClose }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    if (next.length < 8) { setError('The new password must be at least 8 characters.'); return; }
    if (next !== confirm) { setError('The new password and its confirmation do not match.'); return; }
    setBusy(true);
    try {
      const res = await client.post('/auth/change-password', { current_password: current, new_password: next });
      // All other sessions of this account were just ended by the server; keep this one alive with the fresh token it returns.
      if (res.data?.data?.token) localStorage.setItem('token', res.data.data.token);
      setDone(true); setCurrent(''); setNext(''); setConfirm('');
    } catch (err) {
      setError(err.response?.data?.error || 'Could not change the password.');
    } finally { setBusy(false); }
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Change password"
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div className="card" style={{ width: 'min(420px, 92vw)' }}>
        <div className="card__header">
          <h3>Change password</h3>
          <button className="btn-icon" onClick={onClose} aria-label="Close"><X size={14} /></button>
        </div>
        {done ? (
          <div>
            <p>Your password was changed. Your other sessions (other devices or browsers) were signed out; use the new password the next time you sign in.</p>
            <button className="btn" onClick={onClose}>Close</button>
          </div>
        ) : (
          <form onSubmit={submit}>
            {error && <div className="error-box">{error}</div>}
            <div className="form-field"><label htmlFor="cp-current">Current password</label>
              <input id="cp-current" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required /></div>
            <div className="form-field"><label htmlFor="cp-new">New password (8+ characters)</label>
              <input id="cp-new" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required /></div>
            <div className="form-field"><label htmlFor="cp-confirm">Repeat the new password</label>
              <input id="cp-confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required /></div>
            <div className="toolbar">
              <button className="btn" type="submit" disabled={busy}>Change password</button>
              <button className="btn secondary" type="button" onClick={onClose}>Cancel</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
