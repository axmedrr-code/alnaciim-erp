const { Router } = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../config/db');
const { asyncHandler, ApiError } = require('../utils/asyncHandler');
const { authenticate, requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const schemas = require('../validation/schemas');
const { loginAccountLimiter, loginIpLimiter } = require('../middleware/rateLimit');

const router = Router();

router.post('/login', loginIpLimiter, loginAccountLimiter, validate(schemas.login), asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const { rows } = await pool.query(
    `SELECT u.*, r.name AS role_name FROM users u
     JOIN roles r ON r.id = u.role_id
     WHERE u.email = $1 AND u.is_active = true`,
    [email]
  );
  const user = rows[0];
  if (!user) throw new ApiError(401, 'Invalid email or password');

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) throw new ApiError(401, 'Invalid email or password');

  const payload = {
    id: user.id,
    email: user.email,
    fullName: user.full_name,
    role: user.role_name,
    assignedWarehouseId: user.assigned_warehouse_id
  };
  const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '8h' });

  res.json({ data: { token, user: payload }, error: null });
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
