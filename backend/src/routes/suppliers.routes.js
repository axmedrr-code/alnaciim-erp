const { Router } = require('express');
const { pool, withTransaction } = require('../config/db');
const { asyncHandler, ApiError } = require('../utils/asyncHandler');
const { requireRole } = require('../middleware/auth');
const { PERM } = require('../middleware/permissions');
const { validate } = require('../middleware/validate');
const schemas = require('../validation/schemas');
const { logAudit } = require('../services/auditService');

const router = Router();

router.get('/', requireRole(...PERM.PROCUREMENT_VIEW), asyncHandler(async (req, res) => {
  const { category, search } = req.query;
  const conditions = [];
  const params = [];
  if (category) { params.push(category); conditions.push(`category = $${params.length}`); }
  if (search) { params.push(`%${search}%`); conditions.push(`(name ILIKE $${params.length} OR code ILIKE $${params.length})`); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await pool.query(`SELECT * FROM suppliers ${where} ORDER BY name`, params);
  res.json({ data: rows, error: null });
}));

router.post('/', requireRole('Admin', 'Procurement Officer'), validate(schemas.supplierCreate), asyncHandler(async (req, res) => {
  const { code, name, category, contact_person, phone, email, address } = req.body;
  const result = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO suppliers (code, name, category, contact_person, phone, email, address)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [code, name, category || null, contact_person || null, phone || null, email || null, address || null]
    );
    await logAudit(client, { userId: req.user.id, action: 'CREATE', entityType: 'supplier', entityId: rows[0].id, newValue: rows[0] });
    return rows[0];
  });
  res.status(201).json({ data: result, error: null });
}));

module.exports = router;
