require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');

const { authenticate } = require('./middleware/auth');
const errorHandler = require('./middleware/errorHandler');
const backupService = require('./services/backupService');
const { pool } = require('./config/db');

const authRoutes = require('./routes/auth.routes');
const productsRoutes = require('./routes/products.routes');
const categoriesRoutes = require('./routes/categories.routes');
const warehousesRoutes = require('./routes/warehouses.routes');
const inventoryRoutes = require('./routes/inventory.routes');
const productionRoutes = require('./routes/production.routes');
const salesRoutes = require('./routes/sales.routes');
const customersRoutes = require('./routes/customers.routes');
const procurementRoutes = require('./routes/procurement.routes');
const suppliersRoutes = require('./routes/suppliers.routes');
const maintenanceRoutes = require('./routes/maintenance.routes');
const financeRoutes = require('./routes/finance.routes');
const accountingRoutes = require('./routes/accounting.routes');
const reportsRoutes = require('./routes/reports.routes');
const usersRoutes = require('./routes/users.routes');
const trucksRoutes = require('./routes/trucks.routes');
const tanksRoutes = require('./routes/tanks.routes');
const backupsRoutes = require('./routes/backups.routes');
const qaadesRoutes = require('./routes/qaades.routes');
const auditRoutes = require('./routes/audit.routes');
const costCentersRoutes = require('./routes/costcenters.routes');
const projectsRoutes = require('./routes/projects.routes');
const vehiclesRoutes = require('./routes/vehicles.routes');
const routeOpsRoutes = require('./routes/routeops.routes');
const importsRoutes = require('./routes/imports.routes');
const billingRoutes = require('./routes/billing.routes');
const retailRoutes = require('./routes/retail.routes');

// Fail fast on missing required configuration (names only — values are never logged).
const missing = ['JWT_SECRET'].concat(isHostedEnv() ? ['DATABASE_URL'] : []).filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`Missing required environment variable(s): ${missing.join(', ')} — refusing to start`);
  process.exit(1);
}
function isHostedEnv() { return process.env.NODE_ENV === 'production' || !!process.env.RENDER || !!process.env.RAILWAY_ENVIRONMENT; }

const app = express();
// CORS is an exact-match allowlist from CORS_ORIGIN (comma-separated). If it is
// not set: local dev keeps '*' (so the pos app on another port works unchanged),
// but a hosted environment (NODE_ENV=production, or Render/Railway) fails CLOSED
// and allows no cross-origin browser access at all.
const isHosted = process.env.NODE_ENV === 'production' || !!process.env.RENDER || !!process.env.RAILWAY_ENVIRONMENT;
const allowedOrigins = (process.env.CORS_ORIGIN || '').split(',').map((o) => o.trim().replace(/\/$/, '')).filter(Boolean);
if (!allowedOrigins.length && isHosted) console.error('CORS_ORIGIN is not set — all cross-origin browser requests will be rejected');
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // non-browser clients (curl, server-to-server) send no Origin
    if (allowedOrigins.length) return cb(null, allowedOrigins.includes(origin));
    return cb(null, !isHosted);
  }
}));
// Bulk import commits (thousands of rows) round-trip as JSON well past the
// 100kb default body limit — bumped for that one real use case.
app.use(express.json({ limit: '20mb' }));

app.get('/health', (req, res) => res.json({ status: 'ok' }));
// Deeper check: proves the API can actually reach the database (SELECT 1). Never returns connection details.
app.get('/health/db', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'ok' });
  } catch (err) {
    console.error('Health DB check failed:', err.code || err.name, err.message);
    res.status(503).json({ status: 'degraded', db: 'down' });
  }
});

const v1 = express.Router();
v1.use('/auth', authRoutes);

// Everything below requires a valid JWT.
v1.use(authenticate);
v1.use('/products', productsRoutes);
v1.use('/categories', categoriesRoutes);
v1.use('/warehouses', warehousesRoutes);
v1.use('/inventory', inventoryRoutes);
v1.use('/production', productionRoutes);
v1.use('/sales', salesRoutes);
v1.use('/customers', customersRoutes);
v1.use('/procurement', procurementRoutes);
v1.use('/suppliers', suppliersRoutes);
v1.use('/maintenance', maintenanceRoutes);
v1.use('/finance', financeRoutes);
v1.use('/finance', accountingRoutes);
v1.use('/reports', reportsRoutes);
v1.use('/users', usersRoutes);
v1.use('/trucks', trucksRoutes);
v1.use('/tanks', tanksRoutes);
v1.use('/backups', backupsRoutes);
v1.use('/qaades', qaadesRoutes);
v1.use('/audit-logs', auditRoutes);
v1.use('/cost-centers', costCentersRoutes);
v1.use('/projects', projectsRoutes);
v1.use('/', vehiclesRoutes);
v1.use('/routes', routeOpsRoutes);
v1.use('/imports', importsRoutes);
// Billing & Collections — a dedicated Finance sub-module, mounted separately
// from /finance itself so it never collides with the existing expenses/GL
// routes, even though it reads/writes the exact same customers/sales_orders/
// payments tables as the rest of Finance and Sales.
v1.use('/billing', billingRoutes);
// Retail Sales & Billing — invoice-based POS workflow for Bottled Water and
// Ice only. Bulk Water keeps using Route Operations (routeops.routes.js,
// the pos/ app) untouched; this module never touches that code path.
v1.use('/retail', retailRoutes);

app.use('/api/v1', v1);

app.use((req, res) => res.status(404).json({ data: null, error: 'Not found' }));
app.use(errorHandler);

const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`Alnaciim ERP API listening on port ${port}`));

const backupSchedule = process.env.BACKUP_CRON_SCHEDULE || '0 2 * * *';
if (cron.validate(backupSchedule)) {
  cron.schedule(backupSchedule, () => {
    backupService.createBackup({ triggerType: 'scheduled' })
      .then((b) => console.log(`Scheduled backup completed: ${b.filename}`))
      .catch((err) => console.error('Scheduled backup failed:', err.message));
  });
  console.log(`Daily backup scheduled: "${backupSchedule}"`);
} else {
  console.error(`Invalid BACKUP_CRON_SCHEDULE "${backupSchedule}" — scheduled backups disabled`);
}
