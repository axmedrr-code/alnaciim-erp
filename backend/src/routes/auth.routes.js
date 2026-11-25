const { Router } = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { pool } = require('../config/db');
const { asyncHandler, ApiError } = require('../utils/asyncHandler');
const { authenticate, requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const schemas = require('../validation/schemas');
const { loginAccountLimiter, loginIpLimiter } = require('../middleware/rateLimit');

const router = Router();

// Compared against when the e-mail is unknown/inactive, so a failed login costs the same bcrypt work
// either way and response time does not reveal whether an account exists (cost 10 = what the app
// uses when it creates or resets passwords).
const DUMMY_HASH = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), 10);

router.post('/login', loginIpLimiter, loginAccountLimiter, validate(schemas.login), asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const { rows } = await pool.query(
    `SELECT u.*, r.name AS role_name FROM users u
     JOIN roles r ON r.id = u.role_id
     WHERE u.email = $1 AND u.is_active = true`,
    [email]
  );
  const user = rows[0];

  const valid = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
  if (!user || !valid) throw new ApiError(401, 'Invalid email or password');

  const payload = {
    id: user.id,
    email: user.email,
    fullName: user.full_name,
    role: user.role_name,
    assignedWarehouseId: user.assigned_warehouse_id
  };
  const token = jwt.sign(payload, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: process.env.JWT_EXPIRES_IN || '8h' });

  res.json({ data: { token, user: payload }, error: null });
}));

// Self-service password change: needs the current password, never returns or logs any password.
router.post('/change-password', authenticate, validate(schemas.passwordChange), asyncHandler(async (req, res) => {
  const { current_password, new_password } = req.body;
  if (current_password === new_password) throw new ApiError(400, 'The new password must be different from the current one');
  const { rows } = await pool.query('SELECT id, password_hash FROM users WHERE id = $1 AND is_active = true', [req.user.id]);
  const valid = await bcrypt.compare(current_password, rows[0] ? rows[0].password_hash : DUMMY_HASH);
  if (!rows[0] || !valid) throw new ApiError(401, 'The current password is incorrect');
  const hash = await bcrypt.hash(new_password, 10);
  await pool.query('UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2', [hash, req.user.id]);
  await pool.query(`INSERT INTO audit_logs (user_id, action, entity_type, entity_id, new_value) VALUES ($1,'UPDATE','user_password',$1,$2)`, [req.user.id, JSON.stringify({ event: 'password_changed_by_user' })]);
  res.json({ data: { password_changed: true }, error: null });
}));

router.get('/me', authenticate, asyncHandler(async (req, res) => {
  res.json({ data: req.user, error: null });
}));

// Admin-only diagnostic: shows how THIS request's client IP is resolved behind the hosting proxy, so the
// trusted-proxy hop count (TRUST_PROXY_HOPS) can be verified. Returns only the caller's own request data.
router.get('/client-ip', authenticate, requireRole('Admin'), (req, res) => {
  const xff = String(req.headers['x-forwarded-for'] || '');
  const chain = xff ? xff.split(',').map((x) => x.trim()) : [];
  res.json({
    data: {
      resolved_ip: req.ip,
      trust_proxy_setting: req.app.get('trust proxy'),
      x_forwarded_for_chain: chain,
      forwarded_hops: chain.length,
      cf_connecting_ip: req.headers['cf-connecting-ip'] || null,
      socket_peer_ip: req.socket && req.socket.remoteAddress
    },
    error: null
  });
});

module.exports = router;
