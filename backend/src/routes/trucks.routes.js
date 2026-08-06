// Truck fleet — role-based edit permissions:
//   Admin only:            create, Plate Number, Model (rename), archive
//   Admin + Managers:      Assigned Driver, Status, Notes
//   everyone else:         read-only
// Plate Number is this fleet's one unique vehicle identifier — every change to
// it is a distinct, audited event (old/new plate, user, timestamp, reason),
// separate from the general truck UPDATE audit entry.
const { Router } = require('express');
const { pool, withTransaction } = require('../config/db');
const { asyncHandler, ApiError } = require('../utils/asyncHandler');
const { requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const schemas = require('../validation/schemas');
const { logAudit } = require('../services/auditService');

const router = Router();

// Managers may reassign a driver, change status, or edit notes — never the
// truck's identity (Plate Number/Model). Only Admin ever touches identity.
const MANAGER_ROLES = ['Sales Manager', 'Route Supervisor', 'Supervisor'];

router.get('/', asyncHandler(async (req, res) => {
  const { include_archived } = req.query;
  const where = include_archived ? '' : 'WHERE t.archived_at IS NULL';
  const { rows } = await pool.query(
    `SELECT t.*, u.full_name AS driver_name FROM trucks t LEFT JOIN users u ON u.id = t.assigned_driver_id ${where} ORDER BY t.plate_number`
  );
  res.json({ data: rows, error: null });
}));

router.post('/', requireRole('Admin'), validate(schemas.truckCreate), asyncHandler(async (req, res) => {
  const { plate_number, model, capacity, capacity_unit, assigned_driver_id } = req.body;

  const result = await withTransaction(async (client) => {
    const { rows: dupe } = await client.query('SELECT id FROM trucks WHERE plate_number = $1', [plate_number]);
    if (dupe[0]) throw new ApiError(409, `Plate Number ${plate_number} is already registered to another truck`);

    // truck_code is a separate, permanent internal identifier (TRK-###) —
    // distinct from Plate Number, which can change — derived from the
    // highest existing sequence number, not a row COUNT (a COUNT collides
    // with an already-used code the moment any truck has been archived).
    const { rows: seqRows } = await client.query(
      `SELECT COALESCE(MAX(CAST(SUBSTRING(truck_code FROM '(\\d+)$') AS INTEGER)), 0) AS max_seq FROM trucks`
    );
    const truckCode = `TRK-${String(Number(seqRows[0].max_seq) + 1).padStart(3, '0')}`;

    const { rows } = await client.query(
      `INSERT INTO trucks (plate_number, model, capacity, capacity_unit, assigned_driver_id, truck_code) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [plate_number, model || null, capacity || null, capacity_unit || null, assigned_driver_id || null, truckCode]
    );
    await logAudit(client, { userId: req.user.id, action: 'CREATE', entityType: 'truck', entityId: rows[0].id, newValue: rows[0] });
    return rows[0];
  });

  res.status(201).json({ data: result, error: null });
}));

// A single PUT, but which fields actually take effect depends entirely on
// role — never on what the client bothered to send. A Manager's request
// body can technically include plate_number/model (nothing stops a stale
// client from sending it) and it will simply be ignored rather than
// half-trusted, since silently downgrading permissions client-side is not
// something this endpoint relies on.
router.put('/:id', requireRole('Admin', ...MANAGER_ROLES), asyncHandler(async (req, res) => {
  const isAdmin = req.user.role === 'Admin';
  const { plate_number, model, assigned_driver_id, status, notes, reason } = req.body;

  if (!isAdmin && (plate_number !== undefined || model !== undefined)) {
    throw new ApiError(403, 'Only Admin can change Plate Number or Model');
  }

  const result = await withTransaction(async (client) => {
    const { rows: existingRows } = await client.query('SELECT * FROM trucks WHERE id = $1 FOR UPDATE', [req.params.id]);
    const before = existingRows[0];
    if (!before) throw new ApiError(404, 'Truck not found');
    if (before.archived_at) throw new ApiError(400, 'This truck is archived and cannot be edited');

    const fields = [];
    const params = [];

    if (isAdmin && plate_number !== undefined && plate_number !== before.plate_number) {
      const { rows: dupe } = await client.query('SELECT id FROM trucks WHERE plate_number = $1 AND id != $2', [plate_number, before.id]);
      if (dupe[0]) throw new ApiError(409, `Plate Number ${plate_number} is already registered to another truck`);
      params.push(plate_number); fields.push(`plate_number = $${params.length}`);
    }
    if (isAdmin && model !== undefined) { params.push(model || null); fields.push(`model = $${params.length}`); }
    if (assigned_driver_id !== undefined) { params.push(assigned_driver_id || null); fields.push(`assigned_driver_id = $${params.length}`); }
    if (status !== undefined) { params.push(status); fields.push(`status = $${params.length}`); }
    if (notes !== undefined) { params.push(notes || null); fields.push(`notes = $${params.length}`); }

    if (!fields.length) throw new ApiError(400, 'No editable fields were provided');

    params.push(before.id);
    const { rows: updatedRows } = await client.query(
      `UPDATE trucks SET ${fields.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params
    );
    const after = updatedRows[0];

    // Plate Number changes get their own dedicated, explicit audit entry —
    // old/new plate, the acting user (via logAudit's userId), timestamp
    // (created_at, automatic), and the operator's stated reason — on top of
    // the general truck UPDATE entry below.
    if (after.plate_number !== before.plate_number) {
      await logAudit(client, {
        userId: req.user.id, action: 'UPDATE', entityType: 'truck_plate_number', entityId: before.id,
        oldValue: { plate_number: before.plate_number },
        newValue: { plate_number: after.plate_number, reason: reason || null }
      });
    }
    await logAudit(client, { userId: req.user.id, action: 'UPDATE', entityType: 'truck', entityId: before.id, oldValue: before, newValue: after });

    return after;
  });

  res.json({ data: result, error: null });
}));

// Archive — the only way a truck ever stops being editable/selectable.
// Never a hard DELETE: route_runs, deliveries, and truck_loads all
// reference trucks.id, and that history must never be orphaned.
router.post('/:id/archive', requireRole('Admin'), asyncHandler(async (req, res) => {
  const result = await withTransaction(async (client) => {
    const { rows: existingRows } = await client.query('SELECT * FROM trucks WHERE id = $1 FOR UPDATE', [req.params.id]);
    const before = existingRows[0];
    if (!before) throw new ApiError(404, 'Truck not found');
    if (before.archived_at) throw new ApiError(400, 'This truck is already archived');

    const { rows } = await client.query(`UPDATE trucks SET archived_at = now() WHERE id = $1 RETURNING *`, [before.id]);
    await logAudit(client, { userId: req.user.id, action: 'UPDATE', entityType: 'truck', entityId: before.id, oldValue: before, newValue: rows[0] });
    return rows[0];
  });

  res.json({ data: result, error: null });
}));

router.post('/:id/unarchive', requireRole('Admin'), asyncHandler(async (req, res) => {
  const result = await withTransaction(async (client) => {
    const { rows: existingRows } = await client.query('SELECT * FROM trucks WHERE id = $1 FOR UPDATE', [req.params.id]);
    const before = existingRows[0];
    if (!before) throw new ApiError(404, 'Truck not found');
    if (!before.archived_at) throw new ApiError(400, 'This truck is not archived');

    const { rows } = await client.query(`UPDATE trucks SET archived_at = NULL WHERE id = $1 RETURNING *`, [before.id]);
    await logAudit(client, { userId: req.user.id, action: 'UPDATE', entityType: 'truck', entityId: before.id, oldValue: before, newValue: rows[0] });
    return rows[0];
  });

  res.json({ data: result, error: null });
}));

module.exports = router;
