# Alnaciim Water Company — Inventory & Manufacturing ERP

> **Also in this repository:** [`ro-calculator/`](ro-calculator) — a standalone, local-only (localhost + SQLite)
> **RO System Engineering Calculator** for preliminary RO water-treatment design. See [ro-calculator/README.md](ro-calculator/README.md).

Full system design + a working implementation scaffold for a real water purification,
bottling, ice production, and distribution company.

- **Design document (start here):** [docs/DESIGN.md](docs/DESIGN.md) — modules, database schema,
  roles & permissions, workflows, dashboards/KPIs, tech stack, API structure, UI structure, reports,
  and bonus features (barcode, multi-warehouse, truck tracking, IoT-ready).
- **Database:** [database/schema.sql](database/schema.sql) (full PostgreSQL DDL),
  [database/seed.sql](database/seed.sql) (realistic sample data for Alnaciim Water Company).
- **Backend:** [backend/](backend) — Node.js + Express + PostgreSQL REST API (`/api/v1/...`).
- **Frontend:** [frontend/](frontend) — React + Vite single-page app covering every module.

## Quick start

### 1. Database

Requires PostgreSQL 16 (or use Docker):

```bash
docker run -d --name alnaciim_pg \
  -e POSTGRES_USER=alnaciim -e POSTGRES_PASSWORD=alnaciim_dev_pw -e POSTGRES_DB=alnaciim_erp \
  -p 55432:5432 postgres:16-alpine
```

### 2. Backend

```bash
cd backend
cp .env.example .env      # adjust DATABASE_URL / JWT_SECRET if needed
npm install
npm run migrate           # applies database/schema.sql
npm run seed               # loads database/seed.sql sample data
npm run dev                 # starts the API on http://localhost:4000
```

### 3. Frontend

```bash
cd frontend
npm install
npm run dev                 # starts the app on http://localhost:5173 (proxies /api to :4000)
```

### 4. Backups

Requires `pg_dump`/`pg_restore` on `PATH` (or set `PG_BIN_PATH` in `.env` to their install
directory). A daily backup runs automatically on `BACKUP_CRON_SCHEDULE` (default 2am); manage
backups — run one now, download, restore, delete — from **Settings → Backups** (Admin only).

### 5. Log in

Any seeded user works with password **`Password123!`**, e.g.:

| Email | Role |
|---|---|
| admin@alnaciim.com | Admin |
| production.mgr@alnaciim.com | Production Manager |
| inventory.mgr@alnaciim.com | Inventory Manager |
| sales.mgr@alnaciim.com | Sales Manager |
| finance@alnaciim.com | Finance Officer |
| storekeeper.rm@alnaciim.com | Storekeeper (Raw Material store) |
| technician@alnaciim.com | Technician |
| procurement@alnaciim.com | Procurement Officer |
| driver1@alnaciim.com | Driver — redirects to the simplified mobile view at `/driver` |

## What's implemented vs. scaffolded

Implemented end-to-end (DB transaction → API → UI):
- Auth (JWT) with role-based route guards; request validation (zod) on every write endpoint
- Products, categories, warehouses, stock levels, stock movements & transfers
- **Bulk water tanker distribution** (see [docs/DESIGN.md §11](docs/DESIGN.md#11-bulk-water-tanker-distribution-redesign)): customer tank registry with refill/maintenance history, tanker loading that deducts RO storage inventory immediately, dispatch-to-tank, driver delivery confirmation that reprices the invoice on actual delivered quantity, a water-specific sales dashboard, and per-customer account statements
- Mobile driver mode (`/driver`) — assigned deliveries, start trip, confirm delivery with quantity/signature/GPS
- Production batches (plan → start → complete with material consumption + finished-goods output posted to the stock ledger), bill-of-materials-driven auto-consumption, production wastage tracking, machines, downtime
- Sales orders (create → approve → dispatch [posts stock OUT + creates a delivery, or links to a tanker load] → deliver → payment), PDF invoices with delivery fee/credit/balance, WhatsApp invoice sharing
- Purchase orders (create → receive [posts stock IN, supports partial receipt]), suppliers, supplier performance
- Maintenance schedules & logs (with spare-parts consumption posted to the stock ledger)
- Finance: expenses, revenue-vs-cost, per-product profitability
- Reports: inventory, production, sales, stock movements, revenue/production trend charts
- Dashboard with live KPIs and charts
- **Automated PostgreSQL backups** (see [docs/DESIGN.md §12](docs/DESIGN.md#12-automated-backup--restore)): daily scheduled `pg_dump` (custom format) plus on-demand backups, downloadable files, an audit log that survives restores by design, and a type-to-confirm restore flow that reverts the live database to a chosen backup

Simplified for scope (documented in code/comments, not hidden):
- Profitability uses **current** `products.unit_cost` rather than a cost snapshot at sale time — fine for a demo, but a production build should snapshot unit cost onto `sales_order_items` at order time for exact historical margins.
- WhatsApp sharing opens a `wa.me` deep link with an invoice summary rather than attaching the PDF — sending the actual file requires the paid WhatsApp Business API and a publicly reachable invoice URL.
- The driver's "signature" is a typed name, not a captured drawing/image.
- A few interactions use minimal UI (e.g. `prompt()` for payment amount) rather than full modal dialogs, to keep the scaffold's surface area manageable.
- Barcode scanning and IoT ingestion are designed in the schema/API (see §10 of the design doc) but not wired to physical hardware; GPS truck tracking is implemented (driver-submitted lat/lng on delivery confirmation) but not a live map view.
