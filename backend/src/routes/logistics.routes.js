// Logistics incident register. This is separate from the driver POS so it can
// manage audit/exception follow-up without changing the delivery workflow.
const { Router } = require('express');
const { pool, withTransaction } = require('../config/db');
const { asyncHandler, ApiError } = require('../utils/asyncHandler');
const { requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const schemas = require('../validation/schemas');
const { logAudit } = require('../services/auditService');

const router = Router();
const VIEW_ROLES = ['Admin', 'Operation Manager', 'Route Supervisor', 'Supervisor', 'Sales Manager', 'Data Entry Operator', 'Driver'];
const CREATE_ROLES = ['Admin', 'Operation Manager', 'Route Supervisor', 'Supervisor', 'Data Entry Operator', 'Driver'];
const RESOLVE_ROLES = ['Admin', 'Operation Manager', 'Route Supervisor', 'Supervisor'];

router.get('/routes', requireRole(...VIEW_ROLES), asyncHandler(async (req, res) => {
  const driverScope = req.user.role === 'Driver' ? 'WHERE rr.driver_id=$1' : '';
  const params = req.user.role === 'Driver' ? [req.user.id] : [];
  const { rows } = await pool.query(
    `SELECT rr.id,rr.route_number,rr.route_date,rr.status,rr.truck_id,t.plate_number,rr.driver_id,u.full_name AS driver_name
     FROM route_runs rr JOIN trucks t ON t.id=rr.truck_id LEFT JOIN users u ON u.id=rr.driver_id
     ${driverScope} ORDER BY rr.route_date DESC,rr.id DESC LIMIT 300`, params
  );
  res.json({ data: rows, error: null });
}));

router.get('/routes/:id/stops', requireRole(...VIEW_ROLES), asyncHandler(async (req, res) => {
  const params = [Number(req.params.id)];
  const driverScope = req.user.role === 'Driver' ? 'AND rr.driver_id=$2' : '';
  if (req.user.role === 'Driver') params.push(req.user.id);
  const { rows } = await pool.query(
    `SELECT rs.id,rs.sequence_number,rs.status,c.name AS customer_name,c.hno
     FROM route_runs rr JOIN route_stops rs ON rs.route_run_id=rr.id LEFT JOIN customers c ON c.id=rs.customer_id
     WHERE rr.id=$1 ${driverScope} ORDER BY rs.sequence_number`, params
  );
  if (req.user.role === 'Driver' && !rows.length) {
    const allowed = (await pool.query('SELECT 1 FROM route_runs WHERE id=$1 AND driver_id=$2', [Number(req.params.id), req.user.id])).rows[0];
    if (!allowed) throw new ApiError(404, 'Route not found');
  }
  res.json({ data: rows, error: null });
}));

router.get('/exceptions', requireRole(...VIEW_ROLES), asyncHandler(async (req, res) => {
  const { status, type, route_run_id } = req.query;
  const conditions = [];
  const params = [];
  if (status) { params.push(status); conditions.push(`e.status=$${params.length}`); }
  if (type) { params.push(type); conditions.push(`e.type=$${params.length}`); }
  if (route_run_id) { params.push(route_run_id); conditions.push(`e.route_run_id=$${params.length}`); }
  if (req.user.role === 'Driver') {
    params.push(req.user.id);
    conditions.push(`(e.raised_by=$${params.length} OR EXISTS (SELECT 1 FROM route_runs rr WHERE rr.id=e.route_run_id AND rr.driver_id=$${params.length}))`);
  }
  const { rows } = await pool.query(
    `SELECT e.*,rr.route_number,rr.route_date,t.plate_number,stop.sequence_number,
            raised.full_name AS raised_by_name,resolved.full_name AS resolved_by_name
     FROM exceptions e LEFT JOIN route_runs rr ON rr.id=e.route_run_id LEFT JOIN trucks t ON t.id=COALESCE(e.truck_id,rr.truck_id)
     LEFT JOIN route_stops stop ON stop.id=e.route_stop_id JOIN users raised ON raised.id=e.raised_by
     LEFT JOIN users resolved ON resolved.id=e.resolved_by
     ${conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''}
     ORDER BY CASE e.status WHEN 'open' THEN 0 WHEN 'investigating' THEN 1 ELSE 2 END,e.created_at DESC LIMIT 500`, params
  );
  res.json({ data: rows, error: null });
}));

router.post('/exceptions', requireRole(...CREATE_ROLES), validate(schemas.exceptionCreate), asyncHandler(async (req, res) => {
  const b = req.body;
  const created = await withTransaction(async (client) => {
    let routeRunId = b.route_run_id || null;
    let truckId = b.truck_id || null;
    if (b.route_stop_id) {
      const stop = (await client.query('SELECT route_run_id FROM route_stops WHERE id=$1', [b.route_stop_id])).rows[0];
      if (!stop) throw new ApiError(404, 'Route stop not found');
      if (routeRunId && Number(routeRunId) !== Number(stop.route_run_id)) throw new ApiError(400, 'Route stop does not belong to the selected route');
      routeRunId = stop.route_run_id;
    }
    if (routeRunId) {
      const route = (await client.query('SELECT id,truck_id,driver_id FROM route_runs WHERE id=$1 FOR UPDATE', [routeRunId])).rows[0];
      if (!route) throw new ApiError(404, 'Route not found');
      if (truckId && Number(truckId) !== Number(route.truck_id)) throw new ApiError(400, 'Selected truck does not belong to this route');
      truckId = truckId || route.truck_id;
      if (req.user.role === 'Driver' && Number(route.driver_id) !== Number(req.user.id)) throw new ApiError(403, 'Drivers may only report incidents on their assigned route');
    } else if (req.user.role === 'Driver') {
      throw new ApiError(400, 'A driver incident must be linked to the driver’s assigned route');
    }
    if (b.payment_id && !(await client.query('SELECT id FROM payments WHERE id=$1', [b.payment_id])).rows[0])
      throw new ApiError(404, 'Payment not found');

    const row = (await client.query(
      `INSERT INTO exceptions (type,route_run_id,route_stop_id,truck_id,payment_id,description,quantity,amount,raised_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [b.type, routeRunId, b.route_stop_id || null, truckId, b.payment_id || null, b.description || null,
        b.quantity ?? null, b.amount ?? null, req.user.id]
    )).rows[0];
    await logAudit(client, { userId: req.user.id, action: 'CREATE', entityType: 'logistics_exception', entityId: row.id, newValue: row });
    return row;
  });
  res.status(201).json({ data: created, error: null });
}));

router.post('/exceptions/:id/investigate', requireRole(...RESOLVE_ROLES), validate(schemas.exceptionInvestigate), asyncHandler(async (req, res) => {
  const result = await withTransaction(async (client) => {
    const prior = (await client.query('SELECT * FROM exceptions WHERE id=$1 FOR UPDATE', [Number(req.params.id)])).rows[0];
    if (!prior) throw new ApiError(404, 'Logistics exception not found');
    if (prior.status !== 'open') throw new ApiError(409, 'Only an open exception can enter investigation');
    if (prior.raised_by === req.user.id && req.user.role !== 'Admin') throw new ApiError(403, 'The person who raised an exception cannot investigate it');
    const updated = (await client.query(
      `UPDATE exceptions SET status='investigating',investigation_notes=$1 WHERE id=$2 RETURNING *`,
      [req.body.investigation_notes, prior.id]
    )).rows[0];
    await logAudit(client, { userId: req.user.id, action: 'UPDATE', entityType: 'logistics_exception', entityId: prior.id,
      oldValue: { status: 'open' }, newValue: { status: 'investigating', investigation_notes: req.body.investigation_notes } });
    return updated;
  });
  res.json({ data: result, error: null });
}));

router.post('/exceptions/:id/resolve', requireRole(...RESOLVE_ROLES), validate(schemas.exceptionResolve), asyncHandler(async (req, res) => {
  const result = await withTransaction(async (client) => {
    const prior = (await client.query('SELECT * FROM exceptions WHERE id=$1 FOR UPDATE', [Number(req.params.id)])).rows[0];
    if (!prior) throw new ApiError(404, 'Logistics exception not found');
    if (prior.status === 'resolved') throw new ApiError(409, 'This logistics exception is already resolved');
    if (prior.raised_by === req.user.id && req.user.role !== 'Admin') throw new ApiError(403, 'The person who raised an exception cannot resolve it');
    const updated = (await client.query(
      `UPDATE exceptions SET status='resolved',resolved_by=$1,resolved_at=now(),resolution_notes=$2 WHERE id=$3 RETURNING *`,
      [req.user.id, req.body.resolution_notes, prior.id]
    )).rows[0];
    await logAudit(client, { userId: req.user.id, action: 'UPDATE', entityType: 'logistics_exception', entityId: prior.id,
      oldValue: { status: prior.status }, newValue: { status: 'resolved', resolution_notes: req.body.resolution_notes } });
    return updated;
  });
  res.json({ data: result, error: null });
}));

module.exports = router;
