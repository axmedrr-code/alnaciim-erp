const { Router } = require('express');
const { pool, withTransaction } = require('../config/db');
const { asyncHandler, ApiError } = require('../utils/asyncHandler');
const { requireRole } = require('../middleware/auth');
const { postStockMovement } = require('../utils/stockLedger');
const { validate } = require('../middleware/validate');
const schemas = require('../validation/schemas');
const { resolveCostCenterId } = require('../services/accountingService');

const router = Router();

router.get('/schedules', asyncHandler(async (req, res) => {
  const { due_within, machine_id } = req.query;
  const conditions = [];
  const params = [];
  if (machine_id) { params.push(machine_id); conditions.push(`ms.machine_id = $${params.length}`); }
  if (due_within) { params.push(Number(due_within)); conditions.push(`ms.next_due_date <= CURRENT_DATE + $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `SELECT ms.*, m.name AS machine_name, u.full_name AS assigned_to_name
     FROM maintenance_schedules ms
     JOIN machines m ON m.id = ms.machine_id
     LEFT JOIN users u ON u.id = ms.assigned_to
     ${where} ORDER BY ms.next_due_date ASC`,
    params
  );
  res.json({ data: rows, error: null });
}));

router.post('/schedules', requireRole('Admin', 'Production Manager', 'Technician'), validate(schemas.maintenanceScheduleCreate), asyncHandler(async (req, res) => {
  const { machine_id, maintenance_type, frequency_days, last_done_date, next_due_date, assigned_to, description } = req.body;
  const { rows } = await pool.query(
    `INSERT INTO maintenance_schedules (machine_id, maintenance_type, frequency_days, last_done_date, next_due_date, assigned_to, description)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [machine_id, maintenance_type, frequency_days || null, last_done_date || null, next_due_date || null, assigned_to || null, description || null]
  );
  res.status(201).json({ data: rows[0], error: null });
}));

router.get('/logs', asyncHandler(async (req, res) => {
  const { machine_id } = req.query;
  const conditions = [];
  const params = [];
  if (machine_id) { params.push(machine_id); conditions.push(`ml.machine_id = $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `SELECT ml.*, m.name AS machine_name, u.full_name AS performed_by_name
     FROM maintenance_logs ml
     JOIN machines m ON m.id = ml.machine_id
     JOIN users u ON u.id = ml.performed_by
     ${where} ORDER BY ml.log_date DESC`,
    params
  );
  res.json({ data: rows, error: null });
}));

// Creates a maintenance log and draws any spare parts used from inventory in one transaction.
router.post('/logs', requireRole('Admin', 'Production Manager', 'Technician'), validate(schemas.maintenanceLogCreate), asyncHandler(async (req, res) => {
  const { machine_id, schedule_id, downtime_id, type, description, cost, parts_used } = req.body; // parts_used: [{ product_id, quantity, warehouse_id }]

  const result = await withTransaction(async (client) => {
    const costCenterId = await resolveCostCenterId(client, req.body.cost_center_id, 'CC-MAINT');
    const { rows } = await client.query(
      `INSERT INTO maintenance_logs (machine_id, schedule_id, downtime_id, type, performed_by, description, cost, status, cost_center_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'completed',$8) RETURNING *`,
      [machine_id, schedule_id || null, downtime_id || null, type, req.user.id, description || null, cost || 0, costCenterId]
    );
    const log = rows[0];

    for (const part of parts_used || []) {
      await client.query(
        `INSERT INTO maintenance_parts_used (maintenance_log_id, product_id, quantity, warehouse_id) VALUES ($1,$2,$3,$4)`,
        [log.id, part.product_id, part.quantity, part.warehouse_id]
      );
      await postStockMovement(client, {
        productId: part.product_id, warehouseId: part.warehouse_id, movementType: 'OUT', quantity: part.quantity,
        referenceType: 'maintenance', referenceId: log.id, performedBy: req.user.id, notes: `Used in maintenance log #${log.id}`
      });
    }

    if (schedule_id) {
      await client.query(
        `UPDATE maintenance_schedules SET last_done_date = CURRENT_DATE,
                next_due_date = CURRENT_DATE + (COALESCE(frequency_days, 30) || ' days')::interval
         WHERE id = $1`,
        [schedule_id]
      );
    }

    return log;
  });

  res.status(201).json({ data: result, error: null });
}));

module.exports = router;
