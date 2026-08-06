// Water Distribution Operating System — route lifecycle (Rev. 3 blueprint,
// Route Planning redesigned as an enterprise dispatch screen).
// Every posting reuses the existing accountingService/stockLedger/
// auditService — this file adds route orchestration on top, not a second
// ledger or inventory engine. No separate Operator role at planning time —
// drivers record their own deliveries.
const { Router } = require('express');
const { pool, withTransaction } = require('../config/db');
const { asyncHandler, ApiError } = require('../utils/asyncHandler');
const { requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const schemas = require('../validation/schemas');
const { logAudit } = require('../services/auditService');
const { postStockMovement } = require('../utils/stockLedger');
const { postJournalEntry, getAccountByCode, resolveCostCenterId } = require('../services/accountingService');
const { nextHno } = require('../services/hnoService');
// Tank-based dispatch creates and approves the sales order in the same atomic
// action as building the route — reuses the exact same order-creation and
// revenue-recognition logic the manual Sales Order screen uses, so there is
// no second, divergent accounting path.
const { createSalesOrderFromItems, postCreditApprovalRevenue } = require('./sales.routes');

const router = Router();

// Planning-estimate constants only — never presented as metered readings.
// Shared with the frontend's own copy of these same figures for the Summary panel.
const AVG_ROUTE_SPEED_KMH = 30;
const AVG_FUEL_PER_100KM = 12;
const FUEL_PRICE_PER_LITER = 1.1;

// Liters actually assigned to a truck today (today's active + prepared routes),
// computed straight from route_stops/sales_order_items — the same tables the
// rest of the Dispatch Center reads from, so "available capacity" here always
// agrees with what the dispatcher sees on the Available Orders grid. $1 = date.
const LOADED_TODAY_SQL = `COALESCE((
  SELECT SUM(soi.quantity) FROM route_runs rr2
  JOIN route_stops rs2 ON rs2.route_run_id = rr2.id
  JOIN sales_orders so2 ON so2.id = rs2.sales_order_id
  JOIN sales_order_items soi ON soi.sales_order_id = so2.id
  WHERE rr2.truck_id = t.id AND rr2.route_date = $1 AND rr2.status NOT IN ('cancelled')
), 0)`;

// Derived from the highest existing sequence for the year, not a row COUNT — a
// COUNT collides with an already-used number the moment any row in the sequence
// has been deleted (leaving a gap), since a shrunken count can regenerate a
// number that's still taken.
async function nextRouteNumber(client, routeDate) {
  const year = new Date(routeDate).getFullYear();
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(CAST(SUBSTRING(route_number FROM '(\\d+)$') AS INTEGER)), 0) AS max_seq
     FROM route_runs WHERE route_number LIKE $1`,
    [`RT-${year}-%`]
  );
  const seq = Number(rows[0].max_seq) + 1;
  return `RT-${year}-${String(seq).padStart(6, '0')}`;
}

async function assertNotDoubleBooked(client, { truckId, driverId, routeDate, excludeRouteId }) {
  const checks = [
    { col: 'truck_id', val: truckId, label: 'truck' },
    { col: 'driver_id', val: driverId, label: 'driver' }
  ];
  for (const c of checks) {
    if (!c.val) continue;
    const qparams = [routeDate, c.val];
    let sql = `SELECT id FROM route_runs WHERE route_date = $1 AND ${c.col} = $2 AND status NOT IN ('closed','cancelled','completed')`;
    if (excludeRouteId) { qparams.push(excludeRouteId); sql += ` AND id != $3`; }
    const { rows } = await client.query(sql, qparams);
    if (rows[0]) throw new ApiError(409, `This ${c.label} is already assigned to another active route on ${routeDate}`);
  }
}

// Great-circle distance in km — only ever computed when both points have real
// GPS coordinates on file. Never fabricated: null in, null out.
function haversineKm(lat1, lng1, lat2, lng2) {
  if (lat1 == null || lng1 == null || lat2 == null || lng2 == null) return null;
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function bulkWaterProductIds(client) {
  const { rows } = await client.query(
    `SELECT p.id FROM products p JOIN categories c ON c.id = p.category_id WHERE c.name = 'Bulk Water'`
  );
  return rows.map((r) => r.id);
}

// Real warehouse stock on hand for Bulk Water, summed across every warehouse —
// what the fast tank-fill POS shows as "Remaining Stock". Straight off
// stock_levels, the same ledger every other movement in this ERP writes to.
router.get('/bulk-water-stock', asyncHandler(async (req, res) => {
  const productIds = await bulkWaterProductIds(pool);
  if (!productIds.length) return res.json({ data: { liters: 0 }, error: null });
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(quantity), 0) AS liters FROM stock_levels WHERE product_id = ANY($1)`,
    [productIds]
  );
  res.json({ data: { liters: Number(rows[0].liters) }, error: null });
}));

// Truck Remaining Stock — a truck never sums every historical load it has
// ever carried, and never recomputes delivered liters from route history.
// Exactly one truck_loads row is ever active for a truck (status = 'loaded'
// — enforced in POST /sales/truck-loads, which closes any prior active load
// the moment a new one is created); Remaining is that one row's own
// quantity_loaded minus its own delivered_liters, both updated together by
// every POS Save (see /tank-dispatch). If no row is active, there is
// genuinely nothing loaded on this truck right now.
router.get('/truck-stock', asyncHandler(async (req, res) => {
  const { truck_id } = req.query;
  if (!truck_id) throw new ApiError(400, 'truck_id is required');

  const { rows } = await pool.query(
    `SELECT * FROM truck_loads WHERE truck_id = $1 AND status = 'loaded' ORDER BY loaded_at DESC LIMIT 1`,
    [truck_id]
  );
  const activeLoad = rows[0];
  if (!activeLoad) {
    return res.json({ data: { liters: 0, loaded: 0, delivered: 0, active_load_id: null }, error: null });
  }

  const loaded = Number(activeLoad.quantity_loaded);
  const delivered = Number(activeLoad.delivered_liters);
  res.json({
    data: { liters: loaded - delivered, loaded, delivered, active_load_id: activeLoad.id },
    error: null
  });
}));

// Existing stock still sitting on a truck from its last CLOSED session (Data
// Entry's reconciliation can close a session without actually zeroing it
// out) — this is what lets Open Route Session skip the warehouse deduction
// entirely and just resume from that same figure. 0 whenever the truck is
// currently active (nothing to "resume", it's already open) or has no
// history of a nonzero leftover.
router.get('/truck-existing-stock', asyncHandler(async (req, res) => {
  const { truck_id } = req.query;
  if (!truck_id) throw new ApiError(400, 'truck_id is required');

  const { rows: lastLoadRows } = await pool.query(
    `SELECT id, status FROM truck_loads WHERE truck_id = $1 ORDER BY loaded_at DESC LIMIT 1`,
    [truck_id]
  );
  const lastLoad = lastLoadRows[0];
  if (!lastLoad || lastLoad.status === 'loaded') {
    return res.json({ data: { liters: 0 }, error: null });
  }
  const { rows: reconRows } = await pool.query(
    `SELECT actual_remaining FROM stock_reconciliations WHERE truck_load_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [lastLoad.id]
  );
  res.json({ data: { liters: reconRows[0] ? Number(reconRows[0].actual_remaining) : 0 }, error: null });
}));

// Route Session status — the POS's hard gate on whether a sale is even
// possible right now. A truck's Route Session is OPEN for exactly as long as
// it has one active ('loaded') truck_loads row (created the moment
// Warehouse/Admin does a Load Tanker, closed the moment Data Entry/Admin
// reconciles or completes it) — never a separate flag to keep in sync, just
// the same row this whole feature already tracks.
router.get('/route-session', asyncHandler(async (req, res) => {
  const { truck_id } = req.query;
  if (!truck_id) throw new ApiError(400, 'truck_id is required');

  const { rows } = await pool.query(
    `SELECT tl.id, tl.loaded_at, tl.quantity_loaded, tl.delivered_liters,
            t.plate_number, driver.full_name AS driver_name, opener.full_name AS opened_by_name
     FROM truck_loads tl
     JOIN trucks t ON t.id = tl.truck_id
     LEFT JOIN users driver ON driver.id = t.assigned_driver_id
     JOIN users opener ON opener.id = tl.loaded_by
     WHERE tl.truck_id = $1 AND tl.status = 'loaded'
     ORDER BY tl.loaded_at DESC LIMIT 1`,
    [truck_id]
  );
  const session = rows[0];
  if (!session) return res.json({ data: { status: 'closed' }, error: null });

  const loaded = Number(session.quantity_loaded);
  const delivered = Number(session.delivered_liters);
  res.json({
    data: {
      status: 'open',
      plate_number: session.plate_number,
      driver_name: session.driver_name,
      opened_by_name: session.opened_by_name,
      opened_at: session.loaded_at,
      loaded_liters: loaded,
      delivered_liters: delivered,
      remaining_liters: loaded - delivered
    },
    error: null
  });
}));

// Today's Driver Summary — the fast POS's one-row status bar. Scoped to a
// single truck's stops today (route_stops.cash_received is the actual cash
// the driver already collected on each stop; the remainder of that stop's
// order total is what's still outstanding on credit), never a dashboard.
router.get('/driver-summary', asyncHandler(async (req, res) => {
  const { truck_id } = req.query;
  if (!truck_id) throw new ApiError(400, 'truck_id is required');
  const today = new Date().toISOString().slice(0, 10);
  const { rows } = await pool.query(
    `SELECT COUNT(rs.id) AS deliveries,
            COALESCE(SUM(so.total_amount), 0) AS sales_today,
            COALESCE(SUM(rs.cash_received), 0) AS cash_today,
            COALESCE(SUM(so.total_amount - COALESCE(rs.cash_received, 0)), 0) AS credit_today
     FROM route_runs rr
     JOIN route_stops rs ON rs.route_run_id = rr.id
     JOIN sales_orders so ON so.id = rs.sales_order_id
     WHERE rr.truck_id = $1 AND rr.route_date = $2 AND rr.status NOT IN ('cancelled')`,
    [truck_id, today]
  );
  const r = rows[0];
  res.json({
    data: {
      sales_today: Number(r.sales_today), cash_today: Number(r.cash_today),
      credit_today: Number(r.credit_today), deliveries: Number(r.deliveries)
    },
    error: null
  });
}));

// Main dashboard — the 9 KPIs the Dispatch Center opens with. Every figure is a
// live read over sales_orders/route_runs/route_stops/trucks/users — nothing
// cached, nothing computed anywhere else.
router.get('/dashboard', asyncHandler(async (req, res) => {
  const date = req.query.date || new Date().toISOString().slice(0, 10);
  const productIds = await bulkWaterProductIds(pool);

  const [approvedOrders, plannedRoutes, trucksAvail, trucksOnRoute, driversAvail, inProgress, deliveries, revenueLiters, overdue] = await Promise.all([
    pool.query(
      `SELECT COUNT(DISTINCT so.id) AS n FROM sales_orders so
       JOIN sales_order_items soi ON soi.sales_order_id = so.id AND soi.product_id = ANY($1)
       WHERE so.status = 'approved' AND NOT EXISTS (
         SELECT 1 FROM route_stops rs JOIN route_runs rr ON rr.id = rs.route_run_id
         WHERE rs.sales_order_id = so.id AND rr.status NOT IN ('cancelled'))`,
      [productIds]
    ),
    pool.query(`SELECT COUNT(*) AS n FROM route_runs WHERE route_date = $1 AND status IN ('draft','ready')`, [date]),
    pool.query(
      `SELECT COUNT(*) AS n FROM trucks t WHERE t.status = 'active' AND NOT EXISTS (
         SELECT 1 FROM route_runs rr WHERE rr.truck_id = t.id AND rr.route_date = $1 AND rr.status IN ('dispatched','in_progress'))`,
      [date]
    ),
    pool.query(
      `SELECT COUNT(DISTINCT truck_id) AS n FROM route_runs WHERE route_date = $1 AND status IN ('dispatched','in_progress')`,
      [date]
    ),
    pool.query(
      `SELECT COUNT(*) AS n FROM users u JOIN roles r ON r.id = u.role_id
       WHERE r.name = 'Driver' AND u.is_active AND NOT EXISTS (
         SELECT 1 FROM route_runs rr WHERE rr.driver_id = u.id AND rr.route_date = $1 AND rr.status NOT IN ('closed','cancelled'))`,
      [date]
    ),
    pool.query(`SELECT COUNT(*) AS n FROM route_runs WHERE route_date = $1 AND status IN ('dispatched','in_progress')`, [date]),
    pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE rs.status = 'delivered') AS completed,
         COUNT(*) FILTER (WHERE rs.status = 'pending') AS pending
       FROM route_stops rs JOIN route_runs rr ON rr.id = rs.route_run_id WHERE rr.route_date = $1`,
      [date]
    ),
    pool.query(
      `SELECT COALESCE(SUM(so.total_amount), 0) AS revenue, COALESCE(SUM(soi.quantity), 0) AS liters
       FROM route_stops rs JOIN route_runs rr ON rr.id = rs.route_run_id
       JOIN sales_orders so ON so.id = rs.sales_order_id
       JOIN sales_order_items soi ON soi.sales_order_id = so.id
       WHERE rr.route_date = $1 AND rr.status NOT IN ('cancelled')`,
      [date]
    ),
    // "Overdue" = a stop from a route dated before today that was never delivered
    // and its route was never cancelled — a real, honest lag indicator, not a guess.
    pool.query(
      `SELECT COUNT(*) AS n FROM route_stops rs JOIN route_runs rr ON rr.id = rs.route_run_id
       WHERE rr.route_date < $1 AND rs.status = 'pending' AND rr.status NOT IN ('cancelled')`,
      [date]
    )
  ]);

  res.json({
    data: {
      approved_orders_today: Number(approvedOrders.rows[0].n),
      planned_routes_today: Number(plannedRoutes.rows[0].n),
      trucks_available: Number(trucksAvail.rows[0].n),
      trucks_on_route: Number(trucksOnRoute.rows[0].n),
      drivers_available: Number(driversAvail.rows[0].n),
      routes_in_progress: Number(inProgress.rows[0].n),
      completed_deliveries: Number(deliveries.rows[0].completed),
      pending_deliveries: Number(deliveries.rows[0].pending),
      overdue_deliveries: Number(overdue.rows[0].n),
      revenue_today: Number(revenueLiters.rows[0].revenue),
      liters_today: Number(revenueLiters.rows[0].liters)
    },
    error: null
  });
}));

// Fleet status for the truck selector: capacity, what's currently loaded and
// not yet delivered/returned today, available headroom, current assigned
// driver, and a computed Available / On Route / Maintenance status — all
// derived from existing trucks/truck_loads/route_runs, no new truck data stored.
router.get('/trucks-status', asyncHandler(async (req, res) => {
  const date = req.query.date || new Date().toISOString().slice(0, 10);
  const { rows } = await pool.query(
    `SELECT t.id, t.truck_code, t.plate_number, t.model, t.capacity, t.capacity_unit, t.status AS truck_status, t.fuel_percent,
            t.assigned_driver_id, du.full_name AS current_driver, du.phone AS current_driver_phone,
            EXISTS (SELECT 1 FROM route_runs rr WHERE rr.driver_id = t.assigned_driver_id AND rr.route_date = $1 AND rr.status NOT IN ('closed','cancelled')) AS driver_busy,
            ${LOADED_TODAY_SQL} AS loaded_today,
            (SELECT COUNT(*) FROM route_runs rr WHERE rr.truck_id = t.id AND rr.route_date = $1 AND rr.status NOT IN ('cancelled')) AS trips_today,
            EXISTS (SELECT 1 FROM route_runs rr WHERE rr.truck_id = t.id AND rr.route_date = $1
                    AND rr.status IN ('dispatched','in_progress')) AS on_route,
            EXISTS (SELECT 1 FROM route_runs rr WHERE rr.truck_id = t.id AND rr.route_date = $1
                    AND rr.status IN ('draft','ready')) AS loading
     FROM trucks t LEFT JOIN users du ON du.id = t.assigned_driver_id
     ORDER BY t.plate_number`,
    [date]
  );
  const data = rows.map((t) => {
    const available = Number(t.capacity) - Number(t.loaded_today);
    const status = t.truck_status === 'maintenance' ? 'Maintenance' : t.on_route ? 'On Route' : t.loading ? 'Loading' : 'Available';
    return { ...t, available_capacity: available, computed_status: status };
  });
  res.json({ data, error: null });
}));

// Suggests trucks with enough available capacity for a required-liters amount —
// backs "if liters exceed capacity, suggest another truck."
router.get('/suggest-trucks', asyncHandler(async (req, res) => {
  const requiredLiters = Number(req.query.required_liters || 0);
  const date = req.query.date || new Date().toISOString().slice(0, 10);
  const { rows } = await pool.query(
    `SELECT * FROM (
       SELECT t.id, t.truck_code, t.plate_number, t.model, t.capacity, t.capacity_unit,
              t.capacity - ${LOADED_TODAY_SQL} AS available_capacity
       FROM trucks t
       WHERE t.status = 'active' AND NOT EXISTS (
         SELECT 1 FROM route_runs rr WHERE rr.truck_id = t.id AND rr.route_date = $1 AND rr.status IN ('dispatched','in_progress'))
     ) sub
     WHERE available_capacity >= $2
     ORDER BY available_capacity ASC`,
    [date, requiredLiters]
  );
  res.json({ data: rows, error: null });
}));

// Driver roster with real fields only — phone/license from users, current route
// from today's route_runs. "Working hours today" has no data source (no
// attendance/clock-in system exists) and is never fabricated — always null.
router.get('/drivers-status', asyncHandler(async (req, res) => {
  const date = req.query.date || new Date().toISOString().slice(0, 10);
  // A driver already on ANY active route today (including a still-draft one) is
  // not free to take a second — matches assertNotDoubleBooked's own definition of
  // "active" exactly, so this list never shows someone as free who'd then be
  // rejected when the dispatcher tries to actually assign them.
  const { rows } = await pool.query(
    `SELECT u.id, u.full_name, u.phone, u.license_number,
            rr.route_number AS current_route
     FROM users u JOIN roles r ON r.id = u.role_id
     LEFT JOIN route_runs rr ON rr.driver_id = u.id AND rr.route_date = $1 AND rr.status NOT IN ('closed','cancelled')
     WHERE r.name = 'Driver' AND u.is_active
     ORDER BY u.full_name`,
    [date]
  );
  res.json({ data: rows.map((d) => ({ ...d, working_hours_today: null })), error: null });
}));

// Approved, unassigned Bulk Water orders — the exact list Route Planning's
// "Available Orders" table is built from. Every column comes straight off
// sales_orders/sales_order_items/customers/customer_tanks/warehouses, which
// already exist — nothing here is a new orders table.
router.get('/available-orders', asyncHandler(async (req, res) => {
  const productIds = await bulkWaterProductIds(pool);
  if (!productIds.length) return res.json({ data: [], error: null });

  const { rows: depotRows } = await pool.query(
    `SELECT latitude, longitude FROM warehouses WHERE latitude IS NOT NULL ORDER BY id LIMIT 1`
  );
  const depot = depotRows[0];

  const { search, customer_id, area, salesman_id, priority, payment_type, truck_size, date_from, date_to } = req.query;
  const conditions = ["so.status = 'approved'"];
  const params = [productIds];
  if (search) { params.push(`%${search}%`); conditions.push(`(so.order_number ILIKE $${params.length} OR c.name ILIKE $${params.length} OR c.code ILIKE $${params.length})`); }
  if (customer_id) { params.push(customer_id); conditions.push(`so.customer_id = $${params.length}`); }
  if (area) { params.push(`%${area}%`); conditions.push(`c.city ILIKE $${params.length}`); }
  if (salesman_id) { params.push(salesman_id); conditions.push(`so.sales_rep_id = $${params.length}`); }
  if (priority) { params.push(priority); conditions.push(`so.priority = $${params.length}`); }
  if (payment_type) { params.push(payment_type); conditions.push(`so.sale_type = $${params.length}`); }
  if (date_from) { params.push(date_from); conditions.push(`so.order_date >= $${params.length}`); }
  if (date_to) { params.push(date_to); conditions.push(`so.order_date <= $${params.length}`); }

  const { rows } = await pool.query(
    `SELECT so.id AS order_id, so.order_number, so.customer_id, c.code AS customer_code, c.name AS customer_name,
            c.city AS area, so.sales_rep_id, u.full_name AS salesman_name,
            so.customer_tank_id, ct.tank_code, ct.capacity_liters AS tank_size,
            ct.last_known_level_liters AS current_tank_level, ct.level_recorded_at,
            ct.location, ct.latitude, ct.longitude,
            so.priority, so.delivery_date AS requested_delivery_time, so.payment_status,
            SUM(soi.quantity) AS ordered_liters,
            (SUM(soi.quantity * soi.unit_price) / NULLIF(SUM(soi.quantity), 0)) AS price_per_liter,
            SUM(soi.quantity * p.unit_cost) AS cost_of_goods,
            so.total_amount, so.sale_type
     FROM sales_orders so
     JOIN customers c ON c.id = so.customer_id
     LEFT JOIN users u ON u.id = so.sales_rep_id
     LEFT JOIN customer_tanks ct ON ct.id = so.customer_tank_id
     JOIN sales_order_items soi ON soi.sales_order_id = so.id AND soi.product_id = ANY($1)
     JOIN products p ON p.id = soi.product_id
     WHERE ${conditions.join(' AND ')}
       AND NOT EXISTS (
         SELECT 1 FROM route_stops rs JOIN route_runs rr ON rr.id = rs.route_run_id
         WHERE rs.sales_order_id = so.id AND rr.status NOT IN ('cancelled')
       )
     GROUP BY so.id, c.code, c.name, c.city, u.full_name, ct.tank_code, ct.capacity_liters, ct.last_known_level_liters, ct.level_recorded_at, ct.location, ct.latitude, ct.longitude
     ORDER BY CASE so.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, so.delivery_date NULLS LAST, so.id`,
    params
  );

  // Truck-size bucket is derived from each order's own required liters (helps a
  // dispatcher see which orders a small/medium/large truck could actually take) —
  // not a stored attribute, just a client-facing classification of a real number.
  function sizeBucket(liters) {
    if (liters < 1000) return 'small';
    if (liters <= 3000) return 'medium';
    return 'large';
  }

  let data = rows.map((r) => ({
    ...r,
    truck_size_bucket: sizeBucket(Number(r.ordered_liters)),
    distance_km: depot ? haversineKm(depot.latitude, depot.longitude, r.latitude, r.longitude) : null
  }));
  if (truck_size) data = data.filter((r) => r.truck_size_bucket === truck_size);

  res.json({ data, error: null });
}));

// "If selected orders exceed one truck, automatically split into Route A/B/C" —
// a read-only planning helper: greedily bin-packs the given orders across
// available trucks (largest-capacity-first), so the dispatcher sees a proposed
// split before creating anything. Stops within each proposed group are ordered
// nearest-neighbor-from-depot when real coordinates exist; left in given order
// otherwise (never a fabricated route).
router.post('/suggest-split', asyncHandler(async (req, res) => {
  const { order_ids } = req.body;
  if (!Array.isArray(order_ids) || !order_ids.length) throw new ApiError(400, 'order_ids is required');

  const { rows: orders } = await pool.query(
    `SELECT so.id AS order_id, so.order_number, c.name AS customer_name, ct.latitude, ct.longitude,
            SUM(soi.quantity) AS ordered_liters
     FROM sales_orders so JOIN customers c ON c.id = so.customer_id
     LEFT JOIN customer_tanks ct ON ct.id = so.customer_tank_id
     JOIN sales_order_items soi ON soi.sales_order_id = so.id
     WHERE so.id = ANY($1) GROUP BY so.id, c.name, ct.latitude, ct.longitude`,
    [order_ids]
  );

  const { rows: depotRows } = await pool.query(`SELECT latitude, longitude FROM warehouses WHERE latitude IS NOT NULL ORDER BY id LIMIT 1`);
  const depot = depotRows[0];

  const today = new Date().toISOString().slice(0, 10);
  const { rows: trucks } = await pool.query(
    `SELECT t.id, t.truck_code, t.plate_number, t.capacity, t.capacity_unit,
            t.capacity - ${LOADED_TODAY_SQL} AS available_capacity
     FROM trucks t
     WHERE t.status = 'active' AND NOT EXISTS (
       SELECT 1 FROM route_runs rr WHERE rr.truck_id = t.id AND rr.route_date = $1 AND rr.status IN ('dispatched','in_progress'))
     ORDER BY t.capacity DESC`,
    [today]
  );

  // Greedy bin-pack: largest orders first, into the truck with the most remaining room that still fits.
  const remaining = trucks.map((t) => ({ ...t, remaining: Number(t.available_capacity), orders: [] }));
  const sortedOrders = [...orders].sort((a, b) => Number(b.ordered_liters) - Number(a.ordered_liters));
  const unassigned = [];
  for (const order of sortedOrders) {
    const liters = Number(order.ordered_liters);
    const candidate = remaining.filter((t) => t.remaining >= liters).sort((a, b) => a.remaining - b.remaining)[0];
    if (candidate) { candidate.orders.push(order); candidate.remaining -= liters; }
    else unassigned.push(order);
  }

  const labels = ['Route A', 'Route B', 'Route C', 'Route D', 'Route E'];
  const groups = remaining
    .filter((t) => t.orders.length)
    .map((t, i) => {
      const stops = [...t.orders].sort((a, b) => {
        const da = haversineKm(depot?.latitude, depot?.longitude, a.latitude, a.longitude);
        const db = haversineKm(depot?.latitude, depot?.longitude, b.latitude, b.longitude);
        if (da == null || db == null) return 0;
        return da - db;
      });
      return {
        label: labels[i] || `Route ${i + 1}`,
        truck_id: t.id, plate_number: t.plate_number, capacity: t.capacity, capacity_unit: t.capacity_unit,
        order_ids: stops.map((o) => o.order_id),
        orders: stops,
        total_liters: t.orders.reduce((s, o) => s + Number(o.ordered_liters), 0)
      };
    });

  res.json({ data: { groups, unassigned }, error: null });
}));

router.get('/', asyncHandler(async (req, res) => {
  const { date, status } = req.query;
  const conditions = [];
  const params = [];
  if (date) { params.push(date); conditions.push(`r.route_date = $${params.length}`); }
  if (status) { params.push(status); conditions.push(`r.status = $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `SELECT r.*, t.plate_number, d.full_name AS driver_name, s.full_name AS salesman_name,
            q.name AS qaade_name,
            (SELECT COUNT(*) FROM route_stops WHERE route_run_id = r.id) AS total_stops,
            (SELECT COUNT(DISTINCT rs3.customer_id) FROM route_stops rs3 WHERE rs3.route_run_id = r.id) AS total_customers,
            (SELECT COUNT(*) FROM route_stops WHERE route_run_id = r.id AND status = 'delivered') AS delivered_stops,
            (SELECT COUNT(*) FROM route_stops WHERE route_run_id = r.id AND status = 'skipped') AS skipped_stops,
            (SELECT COALESCE(SUM(quantity_loaded),0) FROM truck_loads WHERE route_run_id = r.id) AS loaded_liters,
            (SELECT COALESCE(SUM(soi.quantity), 0) FROM route_stops rs2 JOIN sales_orders so2 ON so2.id = rs2.sales_order_id
             JOIN sales_order_items soi ON soi.sales_order_id = so2.id WHERE rs2.route_run_id = r.id) AS total_ordered_liters,
            (SELECT COALESCE(SUM(so2.total_amount), 0) FROM route_stops rs2 JOIN sales_orders so2 ON so2.id = rs2.sales_order_id
             WHERE rs2.route_run_id = r.id) AS total_revenue,
            (SELECT COUNT(*) FROM route_stops rs2 JOIN sales_orders so2 ON so2.id = rs2.sales_order_id
             WHERE rs2.route_run_id = r.id AND so2.sale_type = 'cash') AS cash_orders,
            (SELECT COUNT(*) FROM route_stops rs2 JOIN sales_orders so2 ON so2.id = rs2.sales_order_id
             WHERE rs2.route_run_id = r.id AND so2.sale_type = 'credit') AS credit_orders,
            t.capacity AS truck_capacity
     FROM route_runs r
     JOIN trucks t ON t.id = r.truck_id
     LEFT JOIN users d ON d.id = r.driver_id
     LEFT JOIN users s ON s.id = r.salesman_id
     LEFT JOIN qaades q ON q.id = r.qaade_id
     ${where} ORDER BY r.route_date DESC, r.id DESC`,
    params
  );
  res.json({ data: rows, error: null });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT r.*, t.plate_number, t.capacity AS truck_capacity, d.full_name AS driver_name, s.full_name AS salesman_name, q.name AS qaade_name
     FROM route_runs r
     JOIN trucks t ON t.id = r.truck_id LEFT JOIN users d ON d.id = r.driver_id
     LEFT JOIN users s ON s.id = r.salesman_id
     LEFT JOIN qaades q ON q.id = r.qaade_id
     WHERE r.id = $1`,
    [req.params.id]
  );
  if (!rows[0]) throw new ApiError(404, 'Route not found');
  const { rows: stops } = await pool.query(
    `SELECT rs.*, c.name AS customer_name, c.code AS customer_code, c.credit_limit, ct.tank_code, ct.capacity_liters, ct.latitude, ct.longitude,
            so.order_number, so.total_amount, so.priority, so.sale_type, so.payment_status,
            (SELECT COALESCE(SUM(quantity), 0) FROM sales_order_items WHERE sales_order_id = so.id) AS ordered_liters
     FROM route_stops rs
     JOIN customers c ON c.id = rs.customer_id
     LEFT JOIN customer_tanks ct ON ct.id = rs.customer_tank_id
     LEFT JOIN sales_orders so ON so.id = rs.sales_order_id
     WHERE rs.route_run_id = $1 ORDER BY rs.sequence_number`,
    [req.params.id]
  );
  // Remaining balance is only meaningful once a delivery has actually been
  // captured (delivered_liters set) — the Driver/Operator Run module owns that
  // write path; here it's just derived, never guessed.
  const enrichedStops = stops.map((s) => ({
    ...s,
    remaining_balance: s.delivered_liters != null ? Number(s.ordered_liters) - Number(s.delivered_liters) : null
  }));
  res.json({ data: { ...rows[0], stops: enrichedStops }, error: null });
}));

// Builds route_stops directly from approved Bulk Water sales orders — each stop is
// linked to its order immediately (sales_order_id set at planning time, not just
// after delivery), and re-validated server-side so a stale client selection can
// never double-assign an order two dispatchers picked at the same time.
async function addStopsFromOrders(client, routeRunId, orderIds, startSeq = 1) {
  let seq = startSeq;
  const seenOrderIds = new Set();
  const seenCustomerIds = new Set();
  for (const orderId of orderIds || []) {
    if (seenOrderIds.has(orderId)) throw new ApiError(409, `Order ${orderId} was selected twice`);
    seenOrderIds.add(orderId);

    const { rows: orderRows } = await client.query(
      `SELECT so.id, so.customer_id, so.customer_tank_id, so.status,
              EXISTS (
                SELECT 1 FROM route_stops rs JOIN route_runs rr ON rr.id = rs.route_run_id
                WHERE rs.sales_order_id = so.id AND rr.status NOT IN ('cancelled') AND rr.id != $2
              ) AS already_assigned
       FROM sales_orders so WHERE so.id = $1 FOR UPDATE`,
      [orderId, routeRunId]
    );
    const order = orderRows[0];
    if (!order) throw new ApiError(404, `Order ${orderId} not found`);
    if (order.status !== 'approved') throw new ApiError(409, `Order ${orderId} is not approved — only approved orders can be routed`);
    if (order.already_assigned) throw new ApiError(409, `Order ${orderId} is already assigned to another route`);
    if (seenCustomerIds.has(order.customer_id)) {
      throw new ApiError(409, `This customer already has a stop on this route — combine their orders into one stop instead`);
    }
    seenCustomerIds.add(order.customer_id);

    await client.query(
      `INSERT INTO route_stops (route_run_id, customer_id, customer_tank_id, sequence_number, sales_order_id)
       VALUES ($1,$2,$3,$4,$5)`,
      [routeRunId, order.customer_id, order.customer_tank_id, seq++, order.id]
    );
  }
  return seq;
}

// Total liters currently assigned to a route vs its truck's capacity — the
// one number Dispatch is gated on.
async function routeCapacityCheck(client, routeRunId) {
  const { rows } = await client.query(
    `SELECT t.capacity, COALESCE(SUM(soi.quantity), 0) AS total_liters
     FROM route_runs r JOIN trucks t ON t.id = r.truck_id
     LEFT JOIN route_stops rs ON rs.route_run_id = r.id
     LEFT JOIN sales_orders so ON so.id = rs.sales_order_id
     LEFT JOIN sales_order_items soi ON soi.sales_order_id = so.id
     WHERE r.id = $1 GROUP BY t.capacity`,
    [routeRunId]
  );
  const row = rows[0];
  return { capacity: Number(row.capacity), totalLiters: Number(row.total_liters), overCapacity: Number(row.total_liters) > Number(row.capacity) };
}

router.post('/', requireRole('Admin', 'Route Supervisor', 'Sales Manager', 'Supervisor'), validate(schemas.routeRunCreate), asyncHandler(async (req, res) => {
  const { qaade_id, route_date, truck_id, driver_id, salesman_id, order_ids } = req.body;
  const routeDate = route_date || new Date().toISOString().slice(0, 10);

  const result = await withTransaction(async (client) => {
    await assertNotDoubleBooked(client, { truckId: truck_id, driverId: driver_id, routeDate });
    const routeNumber = await nextRouteNumber(client, routeDate);

    const { rows } = await client.query(
      `INSERT INTO route_runs (route_number, qaade_id, route_date, truck_id, driver_id, salesman_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [routeNumber, qaade_id || null, routeDate, truck_id, driver_id, salesman_id || null, req.user.id]
    );
    const route = rows[0];

    await addStopsFromOrders(client, route.id, order_ids);

    await logAudit(client, { userId: req.user.id, action: 'CREATE', entityType: 'route_run', entityId: route.id, newValue: route });
    return route;
  });

  res.status(201).json({ data: result, error: null });
}));

// Tank-based dispatch — this business runs on customer tanks, not pre-existing
// sales orders. The dispatcher picks tanks and enters actual fill liters right
// here; the sales order for each tank fill (order + item + approval + revenue
// recognition, via the exact same helpers the manual Sales Order screen uses)
// is created, approved, routed, and dispatched in one atomic transaction —
// if anything fails (capacity, a bad tank, a busy driver), nothing is created.
//
// Driver-Owned Route model: each truck has one permanent assigned driver
// (trucks.assigned_driver_id) — the dispatcher never re-picks a driver each
// time, the truck's own driver comes along automatically. An explicit
// driver_id in the request is only for the rare replacement case.
// This is the Driver's one job in this workflow — recording a sale/delivery
// on the route they were handed a loaded truck for. Admin/Supervisor roles
// can also use it (covering/overriding), but Driver access is the point.
router.post('/tank-dispatch', requireRole('Admin', 'Route Supervisor', 'Sales Manager', 'Supervisor', 'Driver'), asyncHandler(async (req, res) => {
  const { truck_id, route_date, tank_lines } = req.body;
  if (!truck_id) throw new ApiError(400, 'truck_id is required');
  if (!Array.isArray(tank_lines) || !tank_lines.length) throw new ApiError(400, 'tank_lines is required');
  const routeDate = route_date || new Date().toISOString().slice(0, 10);

  const result = await withTransaction(async (client) => {
    const { rows: truckLookup } = await client.query('SELECT assigned_driver_id FROM trucks WHERE id = $1', [truck_id]);
    const driverId = req.body.driver_id || truckLookup[0]?.assigned_driver_id || null;

    await assertNotDoubleBooked(client, { truckId: truck_id, driverId, routeDate });

    const productIds = await bulkWaterProductIds(client);
    if (!productIds.length) throw new ApiError(400, 'No Bulk Water product configured');
    const bulkWaterProductId = productIds[0];

    const routeNumber = await nextRouteNumber(client, routeDate);
    const { rows: routeRows } = await client.query(
      `INSERT INTO route_runs (route_number, route_date, truck_id, driver_id, created_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [routeNumber, routeDate, truck_id, driverId, req.user.id]
    );
    const route = routeRows[0];

    let seq = 1;
    const seenCustomerIds = new Set();
    const createdOrders = [];
    for (const line of tank_lines) {
      const liters = Number(line.liters);
      const price = Number(line.price_per_liter);
      const discount = Number(line.discount || 0);
      if (!(liters > 0)) throw new ApiError(400, 'Liters must be greater than zero for every tank');
      if (!(price >= 0)) throw new ApiError(400, 'Price per liter cannot be negative');
      if (discount < 0) throw new ApiError(400, 'Discount cannot be negative');

      // This ERP's customer registration is HNO-based, not tank-based — a line
      // normally just names a customer directly (customer_id). customer_tank_id
      // is only still accepted for the older tank-centric flow; when present,
      // its capacity is enforced same as before.
      let customerId, tank = null;
      if (line.customer_tank_id) {
        const { rows: tankRows } = await client.query('SELECT * FROM customer_tanks WHERE id = $1 FOR UPDATE', [line.customer_tank_id]);
        tank = tankRows[0];
        if (!tank) throw new ApiError(404, `Tank ${line.customer_tank_id} not found`);
        if (liters > Number(tank.capacity_liters)) {
          throw new ApiError(400, `${tank.tank_code}: ${liters.toLocaleString()} L exceeds tank capacity of ${Number(tank.capacity_liters).toLocaleString()} L`);
        }
        customerId = tank.customer_id;
      } else if (line.customer_id) {
        const { rows: custRows } = await client.query('SELECT id FROM customers WHERE id = $1 FOR UPDATE', [line.customer_id]);
        if (!custRows[0]) throw new ApiError(404, `Customer ${line.customer_id} not found`);
        customerId = line.customer_id;
      } else {
        throw new ApiError(400, 'Each line needs either customer_id or customer_tank_id');
      }

      if (seenCustomerIds.has(customerId)) {
        throw new ApiError(409, `Customer ${customerId} already has a stop on this route — combine into one line instead, dispatch separately`);
      }
      seenCustomerIds.add(customerId);

      // Remaining Stock lives on exactly one row: the truck's single active
      // ('loaded') truck_loads record. Every sale increments that same row's
      // delivered_liters directly — never recomputed from route history —
      // and the load is marked completed the instant it's fully delivered.
      // No negative truck stock is ever allowed: a truck with nothing loaded
      // can't sell any water, and a sale can never exceed what's actually
      // left on the truck.
      const { rows: activeLoadRows } = await client.query(
        `SELECT * FROM truck_loads WHERE truck_id = $1 AND status = 'loaded' ORDER BY loaded_at DESC LIMIT 1 FOR UPDATE`,
        [truck_id]
      );
      const activeLoad = activeLoadRows[0];
      if (!activeLoad) {
        throw new ApiError(400, 'This truck has no active loading — load the tanker before recording a sale.');
      }
      const truckRemaining = Number(activeLoad.quantity_loaded) - Number(activeLoad.delivered_liters);
      if (liters > truckRemaining) {
        throw new ApiError(400, `Only ${truckRemaining.toLocaleString()} L remaining on this truck — cannot deliver ${liters.toLocaleString()} L`);
      }
      const newDelivered = Number(activeLoad.delivered_liters) + liters;
      const isDepleted = newDelivered >= Number(activeLoad.quantity_loaded);
      await client.query(
        `UPDATE truck_loads SET delivered_liters = $1, status = $2, completed_at = $3 WHERE id = $4`,
        [newDelivered, isDepleted ? 'completed' : activeLoad.status, isDepleted ? new Date() : null, activeLoad.id]
      );

      const order = await createSalesOrderFromItems(client, {
        customerId,
        items: [{ product_id: bulkWaterProductId, quantity: liters, unit_price: price }],
        saleType: 'credit', discount,
        actorId: req.user.id, actorRole: req.user.role,
        customerTankId: tank?.id || null, priority: 'normal'
      });

      const { rows: approvedRows } = await client.query(
        `UPDATE sales_orders SET status = 'approved' WHERE id = $1 RETURNING *`,
        [order.id]
      );
      let approvedOrder = approvedRows[0];
      await postCreditApprovalRevenue(client, approvedOrder, req.user.id);

      const { rows: stopRows } = await client.query(
        `INSERT INTO route_stops (route_run_id, customer_id, customer_tank_id, sequence_number, sales_order_id)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [route.id, customerId, tank?.id || null, seq++, approvedOrder.id]
      );
      const stop = stopRows[0];

      // A quick tank-fill sale settles on the spot — the operator collects whatever
      // cash was handed over right there, in the same 10-second transaction. Anything
      // not covered by cash simply stays on the customer's account as real AR.
      const cashReceived = Number(line.cash_received || 0);
      if (cashReceived > 0) {
        const transactionHno = await nextHno(client, 'transaction');
        await client.query(
          `INSERT INTO payments (sales_order_id, amount, method, transaction_hno, recorded_by)
           VALUES ($1,$2,$3,$4,$5)`,
          [approvedOrder.id, cashReceived, 'cash', transactionHno, req.user.id]
        );
        const arAcct = await getAccountByCode(client, '1100');
        const cashAcct = await getAccountByCode(client, '1000');
        await postJournalEntry(client, {
          entryDate: approvedOrder.order_date, description: `Cash collected on delivery — ${approvedOrder.invoice_hno || approvedOrder.order_number}`,
          source: 'system', referenceType: 'payment', referenceId: approvedOrder.id, createdBy: req.user.id,
          lines: [
            { accountId: cashAcct.id, debit: cashReceived, credit: 0 },
            { accountId: arAcct.id, debit: 0, credit: cashReceived, customerId }
          ]
        });
        const paymentStatus = cashReceived >= Number(approvedOrder.total_amount) ? 'paid' : 'partial';
        const { rows: updatedOrderRows } = await client.query(
          `UPDATE sales_orders SET payment_status = $1 WHERE id = $2 RETURNING *`,
          [paymentStatus, approvedOrder.id]
        );
        approvedOrder = updatedOrderRows[0];
      }

      await client.query(
        `UPDATE route_stops SET payment_type = $1, cash_received = $2, discount = $3, discount_reason = $4, settlement_notes = $5
         WHERE id = $6`,
        [line.payment_type || null, cashReceived || null, discount || null, line.discount_reason || null, line.notes || null, stop.id]
      );

      createdOrders.push(approvedOrder);
    }

    await logAudit(client, { userId: req.user.id, action: 'CREATE', entityType: 'route_run', entityId: route.id, newValue: route });

    // Dispatch immediately — this business model has no separate "planned but
    // not yet dispatched" stage for tank fills; the truck is already loaded
    // the moment the dispatcher confirms these liters.
    const dispatched = await dispatchRouteInternal(client, route.id, req.user.id);

    // This is a walk-up-and-fill transaction — the water is already in the
    // tank by the time the operator hits Save, so the delivery is complete
    // immediately rather than waiting on a separate driver/delivery step.
    const orderIds = createdOrders.map((o) => o.id);
    const { rows: finalOrders } = await client.query(`UPDATE sales_orders SET status = 'delivered' WHERE id = ANY($1) RETURNING *`, [orderIds]);
    await client.query(
      `UPDATE route_stops SET status = 'delivered', delivered_liters = (
         SELECT COALESCE(SUM(soi.quantity), 0) FROM sales_order_items soi WHERE soi.sales_order_id = route_stops.sales_order_id
       ), delivered_at = now()
       WHERE route_run_id = $1 AND sales_order_id = ANY($2)`,
      [route.id, orderIds]
    );

    // The route itself must leave 'dispatched' the moment its one delivery is
    // done, or the truck stays falsely reserved as "On Route" for the rest of
    // the day even though nothing is actually still out. Quick tank-fill sales
    // have no separate close step, so completing it here is what frees the
    // truck for the next sale.
    const { rows: completedRoute } = await client.query(
      `UPDATE route_runs SET status = 'completed' WHERE id = $1 RETURNING *`,
      [route.id]
    );

    return { ...dispatched, ...completedRoute[0], orders: finalOrders };
  });

  res.status(201).json({ data: result, error: null });
}));

// Only allowed while draft — once dispatched, the stop order is locked.
router.put('/:id', requireRole('Admin', 'Route Supervisor', 'Sales Manager', 'Supervisor'), validate(schemas.routeRunUpdate), asyncHandler(async (req, res) => {
  const { truck_id, driver_id, salesman_id, order_ids } = req.body;

  const result = await withTransaction(async (client) => {
    const { rows: routeRows } = await client.query('SELECT * FROM route_runs WHERE id = $1 FOR UPDATE', [req.params.id]);
    const route = routeRows[0];
    if (!route) throw new ApiError(404, 'Route not found');
    if (route.status !== 'draft') throw new ApiError(409, 'Only a draft route can be edited — it has already been dispatched.');

    await assertNotDoubleBooked(client, {
      truckId: truck_id, driverId: driver_id,
      routeDate: route.route_date, excludeRouteId: route.id
    });

    const { rows: updated } = await client.query(
      `UPDATE route_runs SET truck_id = COALESCE($1, truck_id), driver_id = COALESCE($2, driver_id),
              salesman_id = COALESCE($3, salesman_id)
       WHERE id = $4 RETURNING *`,
      [truck_id || null, driver_id || null, salesman_id || null, route.id]
    );

    if (order_ids) {
      await client.query('DELETE FROM route_stops WHERE route_run_id = $1', [route.id]);
      await addStopsFromOrders(client, route.id, order_ids);
    }

    await logAudit(client, { userId: req.user.id, action: 'UPDATE', entityType: 'route_run', entityId: route.id, oldValue: route, newValue: updated[0] });
    return updated[0];
  });

  res.json({ data: result, error: null });
}));

// Dispatch — the hard gate: a route cannot be dispatched if its selected orders'
// total liters exceed the assigned truck's capacity. Re-checked server-side even
// though the UI already blocks it, since the underlying orders/truck could have
// changed since the screen loaded.
// Shared by POST /:id/dispatch and the tank-based dispatch flow (which builds
// the route and dispatches it in one atomic action) — every route dispatches
// through exactly this one path, whichever screen triggered it.
async function dispatchRouteInternal(client, routeId, actorId) {
  const { rows: routeRows } = await client.query('SELECT * FROM route_runs WHERE id = $1 FOR UPDATE', [routeId]);
  const route = routeRows[0];
  if (!route) throw new ApiError(404, 'Route not found');
  if (!['draft', 'ready'].includes(route.status)) throw new ApiError(409, `Route is already ${route.status}`);

  const { rows: truckRows } = await client.query('SELECT status FROM trucks WHERE id = $1 FOR UPDATE', [route.truck_id]);
  if (truckRows[0]?.status === 'maintenance') throw new ApiError(409, 'Truck is under maintenance — cannot dispatch');
  // Driver is optional at dispatch time — it's assigned later, when delivery
  // actually starts (POST /:id/start) — so only validate one if present.
  if (route.driver_id) {
    const { rows: driverRows } = await client.query('SELECT is_active FROM users WHERE id = $1', [route.driver_id]);
    if (!driverRows[0]?.is_active) throw new ApiError(409, 'Driver is not active — cannot dispatch');
  }

  const { rows: stops } = await client.query(
    `SELECT rs.id, rs.sequence_number, rs.sales_order_id, rs.customer_tank_id, ct.latitude, ct.longitude
     FROM route_stops rs LEFT JOIN customer_tanks ct ON ct.id = rs.customer_tank_id
     WHERE rs.route_run_id = $1 ORDER BY rs.sequence_number`,
    [routeId]
  );
  if (!stops.length) throw new ApiError(400, 'Cannot dispatch a route with no stops');

  const capacity = await routeCapacityCheck(client, routeId);
  if (capacity.overCapacity) {
    throw new ApiError(400, `Total liters (${capacity.totalLiters}) exceed truck capacity (${capacity.capacity}) — remove orders or assign a larger truck`);
  }

  const { rows: updated } = await client.query(
    `UPDATE route_runs SET status = 'dispatched', dispatched_at = now() WHERE id = $1 RETURNING *`,
    [routeId]
  );

  // Change Order Status — every order carried on this route moves to 'dispatched'
  // the moment the truck leaves, matching the rest of the ERP's document flow.
  const orderIds = stops.map((s) => s.sales_order_id).filter(Boolean);
  await client.query(`UPDATE sales_orders SET status = 'dispatched' WHERE id = ANY($1)`, [orderIds]);

  // Reserve/Reduce Inventory — post a real OUT stock movement per order line from
  // the default distribution warehouse, the same ledger every other dispatch in
  // this ERP writes to. This is the literal, physical inventory reduction; there
  // is no separate "reservation" quantity tracked anywhere in this system.
  const { rows: whRows } = await client.query('SELECT id FROM warehouses ORDER BY id LIMIT 1');
  const warehouseId = whRows[0]?.id;
  if (warehouseId) {
    const { rows: items } = await client.query(
      `SELECT soi.product_id, soi.quantity FROM sales_order_items soi WHERE soi.sales_order_id = ANY($1)`,
      [orderIds]
    );
    for (const item of items) {
      await postStockMovement(client, {
        productId: item.product_id, warehouseId, movementType: 'OUT', quantity: Number(item.quantity),
        referenceType: 'sales', referenceId: routeId, performedBy: actorId,
        notes: `Dispatched on route ${route.route_number}`, allowNegative: true
      });
    }
  }

  // Tank fill — a real, physical side effect of dispatch for tank-based stops:
  // the tank's on-hand level rises by whatever was actually loaded for it,
  // capped at the tank's own capacity so it never shows above full.
  for (const s of stops) {
    if (!s.customer_tank_id || !s.sales_order_id) continue;
    await client.query(
      `UPDATE customer_tanks ct SET
         last_known_level_liters = LEAST(ct.capacity_liters, COALESCE(ct.last_known_level_liters, 0) +
           (SELECT COALESCE(SUM(soi.quantity), 0) FROM sales_order_items soi WHERE soi.sales_order_id = $2)),
         level_recorded_at = now()
       WHERE ct.id = $1`,
      [s.customer_tank_id, s.sales_order_id]
    );
  }

  // Journal Preparation — a DRAFT accrual for the route's estimated distribution
  // cost (fuel), left unposted for Finance to review/adjust against the actual
  // fuel invoice before it ever hits a balance. Only created when the route has
  // enough real GPS coordinates to compute a genuine distance; otherwise skipped
  // rather than posting a fabricated estimate.
  let journalPrepared = false;
  const { rows: depotRows } = await client.query(`SELECT latitude, longitude FROM warehouses WHERE latitude IS NOT NULL ORDER BY id LIMIT 1`);
  const depot = depotRows[0];
  if (depot) {
    let totalKm = 0;
    let prev = depot;
    let allKnown = true;
    for (const s of stops) {
      const d = haversineKm(prev.latitude, prev.longitude, s.latitude, s.longitude);
      if (d == null) { allKnown = false; break; }
      totalKm += d;
      prev = s;
    }
    if (allKnown && totalKm > 0) {
      const estFuelLiters = (totalKm / 100) * AVG_FUEL_PER_100KM;
      const estFuelCost = Math.round(estFuelLiters * FUEL_PRICE_PER_LITER * 100) / 100;
      if (estFuelCost > 0) {
        const logisticsAcct = await getAccountByCode(client, '5200');
        const apAcct = await getAccountByCode(client, '2000');
        await postJournalEntry(client, {
          entryDate: route.route_date,
          description: `Estimated fuel cost — route ${route.route_number} (${totalKm.toFixed(1)} km, pending actual invoice)`,
          source: 'system', referenceType: 'route_run', referenceId: routeId, createdBy: actorId, status: 'draft',
          lines: [
            { accountId: logisticsAcct.id, debit: estFuelCost, credit: 0 },
            { accountId: apAcct.id, debit: 0, credit: estFuelCost }
          ]
        });
        journalPrepared = true;
      }
    }
  }

  await logAudit(client, { userId: actorId, action: 'UPDATE', entityType: 'route_run', entityId: routeId, oldValue: route, newValue: { ...updated[0], note: 'Dispatched — driver notify link generated (WhatsApp)' } });

  return { ...updated[0], journal_prepared: journalPrepared };
}

router.post('/:id/dispatch', requireRole('Admin', 'Route Supervisor', 'Supervisor'), asyncHandler(async (req, res) => {
  const result = await withTransaction((client) => dispatchRouteInternal(client, req.params.id, req.user.id));
  res.json({ data: result, error: null });
}));

// Basic close — flips status to closed. The full four-gate Daily Closing
// (cash reconciled / water reconciled / expenses entered / supervisor
// approved) is its own module; this is the simple "mark closed" action the
// route list's Close Route button needs today.
router.post('/:id/close', requireRole('Admin', 'Route Supervisor', 'Supervisor'), asyncHandler(async (req, res) => {
  const result = await withTransaction(async (client) => {
    const { rows: routeRows } = await client.query('SELECT * FROM route_runs WHERE id = $1 FOR UPDATE', [req.params.id]);
    const route = routeRows[0];
    if (!route) throw new ApiError(404, 'Route not found');
    if (['closed', 'cancelled'].includes(route.status)) throw new ApiError(409, `Route is already ${route.status}`);

    const { rows: updated } = await client.query(
      `UPDATE route_runs SET status = 'closed', closed_at = now() WHERE id = $1 RETURNING *`,
      [route.id]
    );
    await logAudit(client, { userId: req.user.id, action: 'UPDATE', entityType: 'route_run', entityId: route.id, oldValue: route, newValue: updated[0] });
    return updated[0];
  });

  res.json({ data: result, error: null });
}));

router.post('/:id/cancel', requireRole('Admin', 'Route Supervisor', 'Supervisor'), asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    `UPDATE route_runs SET status = 'cancelled' WHERE id = $1 AND status NOT IN ('closed','cancelled') RETURNING *`,
    [req.params.id]
  );
  if (!rows[0]) throw new ApiError(400, 'Route not found or cannot be cancelled');
  res.json({ data: rows[0], error: null });
}));

// "Clone Yesterday's Route" — copies the truck/driver/salesman assignment from
// any existing route_run onto a brand-new one for a new date. Stops are NOT
// copied: yesterday's orders are already delivered (or otherwise resolved), and
// today's route must be built from whatever is freshly approved today.
router.post('/:id/clone', requireRole('Admin', 'Route Supervisor', 'Sales Manager', 'Supervisor'), asyncHandler(async (req, res) => {
  const { route_date } = req.body;
  const routeDate = route_date || new Date().toISOString().slice(0, 10);

  const result = await withTransaction(async (client) => {
    const { rows: sourceRows } = await client.query('SELECT * FROM route_runs WHERE id = $1', [req.params.id]);
    const source = sourceRows[0];
    if (!source) throw new ApiError(404, 'Source route not found');

    await assertNotDoubleBooked(client, { truckId: source.truck_id, driverId: source.driver_id, routeDate });
    const routeNumber = await nextRouteNumber(client, routeDate);

    const { rows } = await client.query(
      `INSERT INTO route_runs (route_number, qaade_id, route_date, truck_id, driver_id, salesman_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [routeNumber, source.qaade_id, routeDate, source.truck_id, source.driver_id, source.salesman_id, req.user.id]
    );
    const clone = rows[0];

    await logAudit(client, { userId: req.user.id, action: 'CREATE', entityType: 'route_run', entityId: clone.id, newValue: clone });
    return clone;
  });

  res.status(201).json({ data: result, error: null });
}));

module.exports = router;
