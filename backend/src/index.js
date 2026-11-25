require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { apiLimiter } = require('./middleware/rateLimit');
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
const requisitionRoutes = require('./routes/requisitions.routes');
const sourcingRoutes = require('./routes/sourcing.routes');
const issuingRoutes = require('./routes/issuing.routes');
const supplierInvoicesRoutes = require('./routes/supplier-invoices.routes');
const operationsRoutes = require('./routes/operations.routes');
const logisticsRoutes = require('./routes/logistics.routes');

// Fail fast on missing required configuration (names only — values are never logged).
const missing = ['JWT_SECRET'].concat(isHostedEnv() ? ['DATABASE_URL'] : []).filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`Missing required environment variable(s): ${missing.join(', ')} — refusing to start`);
  process.exit(1);
}
if (process.env.JWT_SECRET.length < 32) {
  const msg = 'JWT_SECRET is shorter than 32 characters';
  if (isHostedEnv()) { console.error(`${msg} — refusing to start`); process.exit(1); }
  console.warn(`WARNING: ${msg}; use a random value of at least 32 characters (required on hosted environments)`);
}
function isHostedEnv() { return process.env.NODE_ENV === 'production' || !!process.env.RENDER || !!process.env.RAILWAY_ENVIRONMENT; }

const app = express();
// Behind a hosting proxy the client IP arrives in X-Forwarded-For. TRUST_PROXY_HOPS is the number of
// proxies in front of this app whose X-Forwarded-For entry we trust (default 1 on hosted environments).
// Verify the right value for the host with GET /api/v1/auth/client-ip (Admin) before relying on
// per-IP rate limits; a value that is too low attributes every user to the proxy's own IP.
if (isHostedEnv()) {
  const hops = Number(process.env.TRUST_PROXY_HOPS);
  app.set('trust proxy', Number.isInteger(hops) && hops >= 0 ? hops : 1);
}
// Security headers (also removes X-Powered-By). The API only serves JSON/files, so the
// default CSP is fine; CORP is relaxed so the separately-hosted ERP/POS can read responses.
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
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
// Unauthenticated auth endpoints never need more than a few hundred bytes — parse them with a tiny limit
// BEFORE the large global parser (the first parser to run wins) so oversized login bodies are rejected cheaply.
app.use('/api/v1/auth', express.json({ limit: '10kb' }));
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
v1.use('/procurement/requisitions', requisitionRoutes);
v1.use('/procurement/issues', issuingRoutes);
v1.use('/procurement/supplier-invoices', supplierInvoicesRoutes);
v1.use('/operations', operationsRoutes);
v1.use('/logistics', logisticsRoutes);
v1.use('/procurement', sourcingRoutes);
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

app.use('/api/v1', apiLimiter, v1);

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
