const { Router } = require('express');
const { pool } = require('../config/db');
const { asyncHandler } = require('../utils/asyncHandler');
const { requireRole } = require('../middleware/auth');

const router = Router();

router.use(requireRole('Admin'));

router.get('/', asyncHandler(async (req, res) => {
  const { entity_type, entity_id, action, user_id } = req.query;
  const conditions = [];
  const params = [];
  if (entity_type) { params.push(entity_type); conditions.push(`a.entity_type = $${params.length}`); }
  if (entity_id) { params.push(entity_id); conditions.push(`a.entity_id = $${params.length}`); }
  if (action) { params.push(action); conditions.push(`a.action = $${params.length}`); }
  if (user_id) { params.push(user_id); conditions.push(`a.user_id = $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows } = await pool.query(
    `SELECT a.*, u.full_name AS user_name
     FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
     ${where} ORDER BY a.created_at DESC LIMIT 300`,
    params
  );
  res.json({ data: rows, error: null });
}));

module.exports = router;
