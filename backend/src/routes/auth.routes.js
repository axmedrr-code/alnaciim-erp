const { Router } = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../config/db');
const { asyncHandler, ApiError } = require('../utils/asyncHandler');
const { authenticate } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const schemas = require('../validation/schemas');

const router = Router();

router.post('/login', validate(schemas.login), asyncHandler(async (req, res) => {
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

module.exports = router;
