# Alnaciim Water Company — Inventory & Manufacturing ERP
## Complete System Design

**Company:** Alnaciim Water Company — RO water purification, bottled water production, ice production, and distribution
**Scale:** 100+ employees, 5 departments (Production, Sales, Finance, Logistics, Technical), multiple warehouses/plants
**Status:** Design + implementable scaffold (see `/database`, `/backend`, `/frontend`)

---

## Table of Contents

1. [Core Modules](#1-core-modules)
2. [Database Design](#2-database-design)
3. [User Roles & Permissions](#3-user-roles--permissions)
4. [Workflows](#4-workflows)
5. [Dashboards & KPIs](#5-dashboards--kpis)
6. [Technology Stack](#6-technology-stack)
7. [API Structure](#7-api-structure)
8. [UI Structure](#8-ui-structure)
9. [Reports](#9-reports)
10. [Bonus Features](#10-bonus-features)
11. [Bulk Water Tanker Distribution (redesign)](#11-bulk-water-tanker-distribution-redesign)
12. [Automated Backup & Restore](#12-automated-backup--restore)

---

## 1. Core Modules

### A. Inventory Management
- Raw materials: preforms, caps, labels, shrink film, chemicals (coagulants, chlorine, RO membranes/filters)
- Finished goods: bottled water (330ml, 500ml, 1L, 1.5L, 5L, 10L, 19L), ice blocks/cubes
- Spare parts: pumps, membranes, motors, belts, sensors
- Stock in/out ledger (`stock_movements`) with full traceability to source document (PO, production batch, sales order, transfer, adjustment)
- Multi-warehouse (plant store, finished-goods warehouse, spare-parts store, distribution depot)
- Reorder level alerts per product per warehouse

### B. Production Management
- Daily production planning (planned vs actual)
- RO water production tracking (m³/day, per shift, per machine)
- Bottle filling & packaging tracking (units/day, by SKU)
- Ice production tracking (kg/day, by block size)
- Machine usage logs (hours run, output, operator)
- Downtime tracking (breakdown, scheduled maintenance, power outage) with cause codes

### C. Sales & Distribution
- Customer database (retail shops, wholesalers, distributors, direct/tanker customers)
- Sales orders for bottled water, bulk/tanker water, and ice
- Delivery tracking via trucks (dispatch → in transit → delivered)
- Sales team performance (orders, revenue, collections by rep)
- Price lists by product and customer type

### D. Procurement
- Supplier database (raw material, packaging, spare parts, chemicals suppliers)
- Purchase orders with line items
- Goods receiving (full/partial) that feeds `stock_movements`
- Supplier performance (on-time %, quality rating)

### E. Finance (light)
- Revenue tracking (from sales orders / payments)
- Cost tracking (production cost, logistics cost, procurement cost)
- Profit per product (revenue − material cost − allocated logistics/production cost)
- Expense categories (utilities, fuel, salaries allocation, maintenance, admin)

### F. Maintenance
- Equipment list (RO plant units, filling lines, ice machines, generators, trucks)
- Preventive maintenance schedules (frequency-based, e.g., every 30 days)
- Corrective/breakdown maintenance logs
- Spare parts consumption per maintenance job (draws from inventory)

---

## 2. Database Design

PostgreSQL, 3rd normal form with a few pragmatic denormalizations (e.g., `stock_levels` as a materialized running balance next to the append-only `stock_movements` ledger — standard inventory-system pattern: ledger for audit truth, balance table for fast reads).

Full DDL: [`database/schema.sql`](../database/schema.sql). Sample data: [`database/seed.sql`](../database/seed.sql).

### 2.1 Entity Relationship Overview

```
roles ──< users ──< (created_by / performed_by / assigned_to across most tables)

categories ──< products ──< stock_levels >── warehouses
                  │              │
                  │              └──< stock_movements >── warehouses (from/to)
                  │
                  ├──< sales_order_items >── sales_orders >── customers
                  ├──< purchase_items >── purchase_orders >── suppliers
                  ├──< production_batch_materials >── production_batches >── machines
                  └──< maintenance_parts_used >── maintenance_logs >── machines

machines ──< machine_usage_logs
machines ──< downtime_logs
machines ──< maintenance_schedules ──< maintenance_logs
machines ──< iot_sensor_readings

sales_orders ──< deliveries >── trucks
purchase_orders ──< goods_receipts ──< goods_receipt_items >── purchase_items
sales_orders ──< payments
expense_categories ──< expenses
```

### 2.2 Core Tables

#### `roles`
| Column | Type | Notes |
|---|---|---|
| id | SERIAL PK | |
| name | VARCHAR(50) UNIQUE | Admin, Production Manager, Inventory Manager, Sales Manager, Finance Officer, Storekeeper, Technician, Procurement Officer, Driver |
| description | TEXT | |

#### `users`
| Column | Type | Notes |
|---|---|---|
| id | SERIAL PK | |
| employee_code | VARCHAR(20) UNIQUE | |
| full_name | VARCHAR(120) | |
| email | VARCHAR(120) UNIQUE | |
| password_hash | VARCHAR(255) | bcrypt |
| role_id | INT FK → roles.id | |
| department | VARCHAR(50) | Production / Sales / Finance / Logistics / Technical |
| phone | VARCHAR(30) | |
| assigned_warehouse_id | INT FK → warehouses.id NULL | for storekeepers scoped to one warehouse |
| is_active | BOOLEAN DEFAULT true | |
| created_at / updated_at | TIMESTAMPTZ | |

#### `warehouses`
| Column | Type | Notes |
|---|---|---|
| id | SERIAL PK | |
| code | VARCHAR(20) UNIQUE | e.g. `WH-RM-01` |
| name | VARCHAR(100) | |
| type | VARCHAR(30) CHECK | raw_material, finished_goods, spare_parts, general |
| location | VARCHAR(200) | |
| manager_id | INT FK → users.id NULL | |
| is_active | BOOLEAN DEFAULT true | |

#### `categories`
| Column | Type | Notes |
|---|---|---|
| id | SERIAL PK | |
| name | VARCHAR(100) | Preforms, Caps, Labels, Chemicals, Bottled Water, Ice, Spare Parts... |
| parent_id | INT FK → categories.id NULL | for sub-categories |
| product_type | VARCHAR(20) CHECK | raw_material, finished_good, spare_part |

#### `products`
| Column | Type | Notes |
|---|---|---|
| id | SERIAL PK | |
| sku | VARCHAR(30) UNIQUE | |
| barcode | VARCHAR(50) UNIQUE NULL | EAN-13 / Code-128 |
| name | VARCHAR(150) | |
| category_id | INT FK → categories.id | |
| product_type | VARCHAR(20) CHECK | raw_material, finished_good, spare_part |
| unit | VARCHAR(20) | pcs, kg, L, m3, box, block |
| unit_cost | NUMERIC(12,2) | standard/last cost |
| unit_price | NUMERIC(12,2) | default sale price |
| reorder_level | NUMERIC(12,2) | trigger for low-stock alert |
| reorder_qty | NUMERIC(12,2) | suggested reorder quantity |
| is_active | BOOLEAN DEFAULT true | |
| created_at / updated_at | TIMESTAMPTZ | |

#### `stock_levels` (running balance, one row per product+warehouse)
| Column | Type | Notes |
|---|---|---|
| id | SERIAL PK | |
| product_id | INT FK → products.id | |
| warehouse_id | INT FK → warehouses.id | |
| quantity | NUMERIC(14,3) DEFAULT 0 | |
| updated_at | TIMESTAMPTZ | |
| | UNIQUE(product_id, warehouse_id) | |

#### `stock_movements` (append-only ledger, source of truth)
| Column | Type | Notes |
|---|---|---|
| id | BIGSERIAL PK | |
| product_id | INT FK → products.id | |
| warehouse_id | INT FK → warehouses.id | |
| movement_type | VARCHAR(20) CHECK | IN, OUT, TRANSFER_IN, TRANSFER_OUT, ADJUSTMENT |
| quantity | NUMERIC(14,3) | always positive; sign implied by movement_type |
| reference_type | VARCHAR(30) | purchase, production, sales, maintenance, transfer, adjustment |
| reference_id | INT | id of the PO / batch / sales order / maintenance log |
| related_warehouse_id | INT FK → warehouses.id NULL | other side of a transfer |
| performed_by | INT FK → users.id | |
| notes | TEXT | |
| created_at | TIMESTAMPTZ DEFAULT now() | |

### 2.3 Production Tables

#### `machines`
| Column | Type | Notes |
|---|---|---|
| id | SERIAL PK | |
| code | VARCHAR(30) UNIQUE | |
| name | VARCHAR(100) | |
| type | VARCHAR(30) CHECK | RO_PLANT, FILLING_LINE, ICE_MACHINE, PACKAGING, GENERATOR, VEHICLE |
| warehouse_id | INT FK → warehouses.id NULL | plant/location |
| purchase_date | DATE | |
| status | VARCHAR(20) CHECK | operational, under_maintenance, breakdown, retired |
| specifications | JSONB | capacity, model, manufacturer |

#### `production_batches`
| Column | Type | Notes |
|---|---|---|
| id | SERIAL PK | |
| batch_number | VARCHAR(30) UNIQUE | |
| production_type | VARCHAR(20) CHECK | RO_WATER, BOTTLING, ICE |
| product_id | INT FK → products.id | finished good produced (nullable for bulk RO water) |
| machine_id | INT FK → machines.id | |
| planned_qty / actual_qty | NUMERIC(14,3) | |
| unit | VARCHAR(20) | m3, pcs, kg |
| shift | VARCHAR(10) | Morning/Afternoon/Night |
| start_time / end_time | TIMESTAMPTZ | |
| supervisor_id | INT FK → users.id | |
| status | VARCHAR(20) CHECK | planned, in_progress, completed, cancelled |
| destination_warehouse_id | INT FK → warehouses.id | where output is stocked |
| notes | TEXT | |

#### `production_batch_materials` (raw material consumption per batch)
| Column | Type | Notes |
|---|---|---|
| id | SERIAL PK | |
| batch_id | INT FK → production_batches.id | |
| product_id | INT FK → products.id | raw material consumed |
| quantity_used | NUMERIC(14,3) | |
| warehouse_id | INT FK → warehouses.id | source warehouse |

#### `machine_usage_logs`
| Column | Type | Notes |
|---|---|---|
| id | SERIAL PK | |
| machine_id | INT FK → machines.id | |
| log_date | DATE | |
| shift | VARCHAR(10) | |
| hours_used | NUMERIC(5,2) | |
| output_quantity | NUMERIC(14,3) | |
| output_unit | VARCHAR(20) | |
| operator_id | INT FK → users.id | |
| notes | TEXT | |

#### `downtime_logs`
| Column | Type | Notes |
|---|---|---|
| id | SERIAL PK | |
| machine_id | INT FK → machines.id | |
| start_time / end_time | TIMESTAMPTZ | end_time NULL while ongoing |
| category | VARCHAR(30) CHECK | breakdown, scheduled_maintenance, power_outage, other |
| reason | TEXT | |
| reported_by | INT FK → users.id | |
| resolved_by | INT FK → users.id NULL | |

### 2.4 Maintenance Tables

#### `maintenance_schedules`
| Column | Type | Notes |
|---|---|---|
| id | SERIAL PK | |
| machine_id | INT FK → machines.id | |
| maintenance_type | VARCHAR(20) CHECK | preventive, corrective |
| frequency_days | INT | e.g. 30, 90 |
| last_done_date | DATE | |
| next_due_date | DATE | drives the maintenance-due dashboard widget |
| assigned_to | INT FK → users.id | |
| description | TEXT | |

#### `maintenance_logs`
| Column | Type | Notes |
|---|---|---|
| id | SERIAL PK | |
| machine_id | INT FK → machines.id | |
| schedule_id | INT FK → maintenance_schedules.id NULL | |
| downtime_id | INT FK → downtime_logs.id NULL | |
| type | VARCHAR(20) CHECK | preventive, corrective, breakdown_repair |
| performed_by | INT FK → users.id | |
| log_date | DATE | |
| description | TEXT | |
| cost | NUMERIC(12,2) | |
| status | VARCHAR(20) CHECK | pending, completed |

#### `maintenance_parts_used`
| Column | Type | Notes |
|---|---|---|
| id | SERIAL PK | |
| maintenance_log_id | INT FK → maintenance_logs.id | |
| product_id | INT FK → products.id | spare part |
| quantity | NUMERIC(12,3) | |
| warehouse_id | INT FK → warehouses.id | |

### 2.5 Sales & Distribution Tables

#### `customers`
| Column | Type | Notes |
|---|---|---|
| id | SERIAL PK | |
| code | VARCHAR(20) UNIQUE | |
| name | VARCHAR(150) | |
| type | VARCHAR(20) CHECK | retail, wholesale, distributor, tanker |
| phone / email | VARCHAR | |
| address / city | VARCHAR | |
| credit_limit | NUMERIC(12,2) DEFAULT 0 | |
| payment_terms_days | INT DEFAULT 0 | |
| sales_rep_id | INT FK → users.id | |
| is_active | BOOLEAN DEFAULT true | |

#### `price_lists`
| Column | Type | Notes |
|---|---|---|
| id | SERIAL PK | |
| product_id | INT FK → products.id | |
| customer_type | VARCHAR(20) | retail, wholesale, distributor, tanker |
| unit_price | NUMERIC(12,2) | |
| effective_from / effective_to | DATE | |

#### `sales_orders`
| Column | Type | Notes |
|---|---|---|
| id | SERIAL PK | |
| order_number | VARCHAR(30) UNIQUE | |
| customer_id | INT FK → customers.id | |
| order_date | DATE | |
| delivery_date | DATE | |
| sales_rep_id | INT FK → users.id | |
| status | VARCHAR(20) CHECK | pending, approved, dispatched, delivered, cancelled |
| payment_status | VARCHAR(20) CHECK | unpaid, partial, paid |
| subtotal / discount / tax / total_amount | NUMERIC(12,2) | |
| notes | TEXT | |

#### `sales_order_items`
| Column | Type | Notes |
|---|---|---|
| id | SERIAL PK | |
| sales_order_id | INT FK → sales_orders.id | |
| product_id | INT FK → products.id | |
| quantity | NUMERIC(12,3) | |
| unit_price | NUMERIC(12,2) | |
| discount | NUMERIC(12,2) DEFAULT 0 | |
| subtotal | NUMERIC(12,2) | |

#### `trucks`
| Column | Type | Notes |
|---|---|---|
| id | SERIAL PK | |
| plate_number | VARCHAR(20) UNIQUE | |
| model | VARCHAR(60) | |
| capacity | NUMERIC(10,2) | |
| capacity_unit | VARCHAR(20) | liters, kg, cartons |
| status | VARCHAR(20) CHECK | active, maintenance, inactive |
| assigned_driver_id | INT FK → users.id NULL | |

#### `deliveries`
| Column | Type | Notes |
|---|---|---|
| id | SERIAL PK | |
| sales_order_id | INT FK → sales_orders.id | |
| truck_id | INT FK → trucks.id | |
| driver_id | INT FK → users.id | |
| dispatch_time | TIMESTAMPTZ | |
| delivery_time | TIMESTAMPTZ NULL | |
| status | VARCHAR(20) CHECK | scheduled, in_transit, delivered, failed |
| delivery_address | TEXT | |
| last_known_lat / last_known_lng | NUMERIC | basic GPS ping (bonus feature) |
| pod_reference | VARCHAR(100) | proof-of-delivery signature/photo ref |

#### `payments`
| Column | Type | Notes |
|---|---|---|
| id | SERIAL PK | |
| sales_order_id | INT FK → sales_orders.id | |
| amount | NUMERIC(12,2) | |
| payment_date | DATE | |
| method | VARCHAR(20) CHECK | cash, bank_transfer, cheque, credit |
| reference_number | VARCHAR(60) | |
| recorded_by | INT FK → users.id | |

### 2.6 Procurement Tables

#### `suppliers`
| Column | Type | Notes |
|---|---|---|
| id | SERIAL PK | |
| code | VARCHAR(20) UNIQUE | |
| name | VARCHAR(150) | |
| category | VARCHAR(30) | raw_material, packaging, spare_part, chemicals |
| contact_person / phone / email / address | VARCHAR | |
| rating | NUMERIC(3,2) DEFAULT 0 | rolling average from supplier_performance |
| is_active | BOOLEAN DEFAULT true | |

#### `purchase_orders`
| Column | Type | Notes |
|---|---|---|
| id | SERIAL PK | |
| po_number | VARCHAR(30) UNIQUE | |
| supplier_id | INT FK → suppliers.id | |
| order_date / expected_date | DATE | |
| status | VARCHAR(20) CHECK | draft, sent, partially_received, received, cancelled |
| total_amount | NUMERIC(12,2) | |
| created_by | INT FK → users.id | |
| notes | TEXT | |

#### `purchase_items`
| Column | Type | Notes |
|---|---|---|
| id | SERIAL PK | |
| purchase_order_id | INT FK → purchase_orders.id | |
| product_id | INT FK → products.id | |
| quantity_ordered | NUMERIC(14,3) | |
| quantity_received | NUMERIC(14,3) DEFAULT 0 | |
| unit_cost | NUMERIC(12,2) | |
| subtotal | NUMERIC(12,2) | |

#### `goods_receipts` / `goods_receipt_items`
| Table | Key Columns |
|---|---|
| goods_receipts | id PK, purchase_order_id FK, received_date, received_by FK users, warehouse_id FK, notes |
| goods_receipt_items | id PK, goods_receipt_id FK, purchase_item_id FK, quantity_received, condition (good/damaged) |

#### `supplier_performance`
| Column | Type | Notes |
|---|---|---|
| id | SERIAL PK | |
| supplier_id | INT FK → suppliers.id | |
| purchase_order_id | INT FK → purchase_orders.id | |
| on_time_delivery | BOOLEAN | |
| quality_rating | INT CHECK 1-5 | |
| notes | TEXT | |
| evaluated_by | INT FK → users.id | |
| evaluated_at | TIMESTAMPTZ | |

### 2.7 Finance Tables

#### `expense_categories`
| Column | Type | Notes |
|---|---|---|
| id | SERIAL PK | |
| name | VARCHAR(100) | Fuel, Utilities, Salaries, Maintenance, Admin |
| type | VARCHAR(30) | production, logistics, admin, maintenance, utilities |

#### `expenses`
| Column | Type | Notes |
|---|---|---|
| id | SERIAL PK | |
| category_id | INT FK → expense_categories.id | |
| amount | NUMERIC(12,2) | |
| expense_date | DATE | |
| description | TEXT | |
| related_reference_type | VARCHAR(30) NULL | production_batch, delivery, maintenance_log |
| related_reference_id | INT NULL | |
| recorded_by | INT FK → users.id | |

> **Profit per product** is computed, not stored: `revenue (sales_order_items) − unit_cost (products, at time of sale, snapshot recommended) − allocated logistics/production overhead (expenses)`. See [Reports](#9-reports).

### 2.8 Bonus / Future Tables

#### `iot_sensor_readings` (future IoT integration)
| Column | Type | Notes |
|---|---|---|
| id | BIGSERIAL PK | |
| machine_id | INT FK → machines.id | |
| reading_type | VARCHAR(30) | flow_rate, tds, pressure, temperature, water_level |
| value | NUMERIC(12,4) | |
| unit | VARCHAR(20) | |
| recorded_at | TIMESTAMPTZ | |

#### `audit_logs`
| Column | Type | Notes |
|---|---|---|
| id | BIGSERIAL PK | |
| user_id | INT FK → users.id | |
| action | VARCHAR(20) | CREATE, UPDATE, DELETE |
| entity_type | VARCHAR(50) | table name |
| entity_id | INT | |
| old_value / new_value | JSONB | |
| created_at | TIMESTAMPTZ | |

---

## 3. User Roles & Permissions

| Role | Inventory | Production | Sales | Procurement | Finance | Maintenance | Users/Settings |
|---|---|---|---|---|---|---|---|
| **Admin** | Full | Full | Full | Full | Full | Full | Full — manages users, roles, warehouses, system settings |
| **Production Manager** | Read (raw materials & FG) | Full — create/approve batches, machine logs, downtime | Read-only | Read-only | Read production-cost reports | Read schedules, view downtime | None |
| **Inventory Manager** | Full — stock levels, transfers, reorder rules, warehouses | Read | Read (FG availability) | Read (create receiving) | None | Read spare-parts stock | None |
| **Sales Manager** | Read (finished goods only) | Read | Full — orders, pricing, customers, deliveries | None | Read revenue/sales reports | None | None |
| **Finance Officer** | Read | Read (cost data) | Read (payments, invoices) | Read (PO costs) | Full — expenses, revenue, profitability | Read (maintenance cost) | None |
| **Storekeeper** | Create stock in/out, physical counts — scoped to `assigned_warehouse_id` | Record raw-material issue to production | None | Receive goods against PO | None | Issue spare parts | None |
| **Technician** | Read spare parts | Read machine status | None | None | None | Full — logs, schedules, downtime reporting | None |
| **Procurement Officer** *(suggested addition)* | Read | None | None | Full — suppliers, POs, receiving | Read PO costs | None | None |
| **Driver** *(suggested addition)* | None | None | Read own deliveries | None | None | None | Update own delivery status only |

Enforcement pattern: `roles` + `role_id` on `users`, checked in an Express middleware (`requireRole(['Admin','Inventory Manager'])`) on every route; storekeepers are additionally scoped by `assigned_warehouse_id` at the query level.

---

## 4. Workflows

### A. Inventory Flow
```
Supplier PO created (Procurement Officer)
   → Goods received at warehouse (Storekeeper) → goods_receipts + goods_receipt_items
   → stock_movements (IN) + stock_levels updated
   → Raw material issued to production (Storekeeper/Production Manager)
   → stock_movements (OUT) → production_batch_materials
   → Finished goods produced → stock_movements (IN) into finished-goods warehouse
   → Finished goods sold → stock_movements (OUT) on delivery dispatch
```
Every step writes to the append-only `stock_movements` ledger; `stock_levels` is updated in the same DB transaction so it never drifts from the ledger.

### B. Production Flow
```
Production Manager creates daily plan (production_batches, status=planned)
   → Materials reserved/issued from raw-material warehouse (production_batch_materials)
   → Batch started (status=in_progress) — RO processing / bottling / ice freezing
   → machine_usage_logs recorded per shift
   → Batch completed (status=completed) — actual_qty recorded
   → Output stocked into destination_warehouse_id (finished goods)
   → Downtime, if any, logged against the machine (downtime_logs) independent of batch status
```

### C. Sales Flow
```
Customer places order (Sales Manager/rep) → sales_orders (status=pending)
   → Credit limit & stock availability checked
   → Order approved (status=approved) — price_lists applied per customer type
   → Dispatch: truck + driver assigned → deliveries (status=scheduled → in_transit)
      → stock_movements (OUT) fired at dispatch
   → Delivered (status=delivered) → pod_reference captured
   → Payment recorded (payments) → sales_orders.payment_status updated (unpaid/partial/paid)
```

### D. Procurement Flow
```
Reorder alert triggered (stock_levels.quantity <= products.reorder_level)
   → Procurement Officer creates purchase_orders (status=draft → sent)
   → Supplier delivers → goods_receipts (full or partial)
   → purchase_items.quantity_received updated; status → partially_received / received
   → supplier_performance recorded (on-time %, quality rating)
```

### E. Maintenance Flow
```
maintenance_schedules.next_due_date reached → dashboard alert to Technician
   → Preventive: maintenance_logs (type=preventive) created, spare parts drawn (maintenance_parts_used)
   → Breakdown: downtime_logs created immediately → linked maintenance_logs (type=breakdown_repair)
   → machines.status updated (operational ↔ under_maintenance ↔ breakdown)
   → Cost posted to expenses (category=maintenance)
```

---

## 5. Dashboards & KPIs

### Main Dashboard (role-aware widgets)
| Widget | Metric | Source |
|---|---|---|
| Today's Production | RO water (m³), bottles filled by SKU, ice (kg) | `production_batches` (today) |
| Low Stock Alerts | Products where `stock_levels.quantity <= products.reorder_level` | `stock_levels` + `products` |
| Sales Today/MTD | Orders count, revenue, top products | `sales_orders`, `sales_order_items` |
| Revenue vs Cost (MTD) | Revenue (payments) vs production+logistics cost (expenses) | `payments`, `expenses` |
| Machine Downtime | Hours down this week, by machine/category | `downtime_logs` |
| Pending Deliveries | Scheduled/in-transit count | `deliveries` |
| Maintenance Due | Machines with `next_due_date` within 7 days | `maintenance_schedules` |
| Outstanding Receivables | Sum of unpaid/partial sales orders | `sales_orders` + `payments` |

### Role-specific dashboard slices
- **Production Manager:** planned vs actual output chart, machine utilization %, downtime Pareto
- **Inventory Manager:** stock value by warehouse, reorder queue, slow-moving stock
- **Sales Manager:** rep leaderboard, order pipeline by status, customer aging
- **Finance Officer:** P&L snapshot, cost breakdown by category, profit per product ranking
- **Technician:** open maintenance jobs, machines by status, spare-parts usage trend

---

## 6. Technology Stack

| Layer | Choice | Why |
|---|---|---|
| Database | **PostgreSQL 16** | Strong relational integrity, JSONB for flexible fields (machine specs, IoT payloads), window functions for reporting |
| Backend | **Node.js + Express + TypeScript-ready JS** | Fast to build REST APIs, huge ecosystem, easy to hire for; `pg` driver with parameterized queries |
| Auth | **JWT** (access token) + bcrypt password hashing | Stateless, scales across multiple frontend clients (web + future mobile driver app) |
| Frontend | **React + Vite** | Component reuse across modules, fast dev server, easy to extend to mobile (React Native) later |
| API style | **REST**, versioned `/api/v1` | Simpler caching/tooling than GraphQL for a CRUD-heavy ERP; revisit GraphQL only if the UI needs deeply nested ad-hoc queries |
| Deployment | Docker Compose (db + api + web) → any VPS/cloud VM | Company-scale (100+ users) doesn't need Kubernetes; keep ops simple |
| Alternative considered | **Odoo** (customize Inventory/MRP/Sales/Purchase/Maintenance apps) | Fastest path to a working system with less flexibility for water-industry-specific tracking (m³, ice kg, RO batch semantics); good fallback if in-house dev capacity is limited |

---

## 7. API Structure

Base URL: `/api/v1`. All endpoints (except `/auth/login`) require `Authorization: Bearer <JWT>`. Responses: `{ data, error, meta }`.

### Auth
| Method | Endpoint | Description |
|---|---|---|
| POST | `/auth/login` | `{ email, password }` → `{ token, user }` |
| GET | `/auth/me` | Current user profile + role/permissions |

### Products & Categories
| Method | Endpoint | Description |
|---|---|---|
| GET | `/products?type=raw_material&category_id=3&search=cap` | List with filters |
| GET | `/products/:id` | Single product |
| POST | `/products` | Create — Admin/Inventory Manager |
| PUT | `/products/:id` | Update |
| DELETE | `/products/:id` | Soft-delete (`is_active=false`) |
| GET | `/categories` | Tree list |

### Inventory
| Method | Endpoint | Description |
|---|---|---|
| GET | `/inventory/stock-levels?warehouse_id=2` | Current balances |
| GET | `/inventory/low-stock` | Products at/under reorder level |
| GET | `/inventory/movements?product_id=10&from=2026-06-01` | Ledger query |
| POST | `/inventory/movements` | Record IN/OUT/ADJUSTMENT — `{ product_id, warehouse_id, movement_type, quantity, reference_type, notes }` |
| POST | `/inventory/transfer` | `{ product_id, from_warehouse_id, to_warehouse_id, quantity }` |
| GET | `/warehouses` / `POST /warehouses` | Warehouse CRUD |

### Production
| Method | Endpoint | Description |
|---|---|---|
| GET | `/production/batches?date=2026-07-07&type=BOTTLING` | List batches |
| POST | `/production/batches` | Create planned batch |
| PUT | `/production/batches/:id/start` | → in_progress |
| PUT | `/production/batches/:id/complete` | `{ actual_qty, materials: [...] }` → posts stock movements |
| GET | `/production/machines` / `POST /production/machines` | Machine CRUD |
| POST | `/production/machines/:id/usage-logs` | Log daily usage |
| POST | `/production/machines/:id/downtime` | Start downtime; `PUT /downtime/:id/resolve` to close |

### Sales
| Method | Endpoint | Description |
|---|---|---|
| GET | `/customers` / `POST /customers` | Customer CRUD |
| GET | `/sales/orders?status=pending&customer_id=5` | List |
| POST | `/sales/orders` | `{ customer_id, items: [{product_id, quantity, unit_price}], delivery_date }` |
| PUT | `/sales/orders/:id/approve` | pending → approved |
| PUT | `/sales/orders/:id/cancel` | |
| POST | `/sales/orders/:id/dispatch` | `{ truck_id, driver_id }` → creates `deliveries`, posts stock OUT |
| PUT | `/deliveries/:id/status` | in_transit / delivered / failed |
| POST | `/sales/orders/:id/payments` | Record payment |

### Procurement
| Method | Endpoint | Description |
|---|---|---|
| GET | `/suppliers` / `POST /suppliers` | Supplier CRUD |
| GET | `/procurement/purchase-orders?status=sent` | List |
| POST | `/procurement/purchase-orders` | `{ supplier_id, items: [{product_id, quantity_ordered, unit_cost}] }` |
| POST | `/procurement/purchase-orders/:id/receive` | `{ items: [{purchase_item_id, quantity_received, condition}], warehouse_id }` → posts stock IN |
| GET | `/procurement/supplier-performance/:supplier_id` | Aggregated rating |

### Maintenance
| Method | Endpoint | Description |
|---|---|---|
| GET | `/maintenance/schedules?due_within=7` | Upcoming due |
| POST | `/maintenance/schedules` | Create schedule |
| GET | `/maintenance/logs?machine_id=4` | History |
| POST | `/maintenance/logs` | `{ machine_id, type, description, parts_used: [...] }` → draws spare parts from stock |

### Finance
| Method | Endpoint | Description |
|---|---|---|
| GET | `/finance/expenses?category_id=2&from&to` | List/filter |
| POST | `/finance/expenses` | Create |
| GET | `/finance/revenue-summary?from&to` | Aggregated revenue |
| GET | `/finance/profitability?product_id=&from&to` | Revenue − cost per product |

### Reports
| Method | Endpoint | Description |
|---|---|---|
| GET | `/reports/inventory` | Stock on hand + value, by warehouse |
| GET | `/reports/production?period=monthly&year=2026&month=7` | Output vs plan |
| GET | `/reports/sales?period=monthly` | Revenue, units, by product/customer |
| GET | `/reports/profitability` | Per-product P&L |
| GET | `/reports/stock-movements?from&to&product_id` | Full ledger export (CSV) |

**Example — create a sales order (POST `/api/v1/sales/orders`):**
```json
{
  "customer_id": 12,
  "delivery_date": "2026-07-10",
  "items": [
    { "product_id": 5, "quantity": 200, "unit_price": 0.35 },
    { "product_id": 9, "quantity": 50, "unit_price": 1.20 }
  ]
}
```
Response `201`:
```json
{ "data": { "id": 341, "order_number": "SO-2026-0341", "status": "pending", "total_amount": 130.00 }, "error": null }
```

---

## 8. UI Structure

| Page | Key Contents | Primary Roles |
|---|---|---|
| **Login** | Email/password | All |
| **Dashboard** | Role-aware KPI cards + charts (see §5) | All |
| **Inventory** → Products, Stock Levels, Movements, Warehouses, Transfers, Low-Stock Alerts | Table views, barcode field, filters by warehouse/category | Inventory Manager, Storekeeper, Admin |
| **Production** → Daily Plan, Batches, Machines, Usage Logs, Downtime | Kanban-style batch status board + calendar plan view | Production Manager, Technician |
| **Sales** → Customers, Orders, Price Lists, Deliveries, Payments | Order wizard (customer → items → review), delivery tracking map/list | Sales Manager, Driver |
| **Procurement** → Suppliers, Purchase Orders, Goods Receiving, Supplier Ratings | PO wizard, receiving screen with partial-receipt support | Procurement Officer, Storekeeper |
| **Maintenance** → Equipment, Schedules, Logs, Breakdown Reports | Due-soon list, machine detail timeline | Technician, Production Manager |
| **Finance** → Expenses, Revenue, Profitability | Filterable ledgers, P&L per product table | Finance Officer |
| **Reports** → Inventory / Production / Sales / Profitability / Stock Movement | Date-range pickers, export to CSV/PDF | All (scoped by role) |
| **Settings** | Users, Roles, Warehouses, Categories, Price Lists, System config | Admin |

Navigation is a left sidebar filtered by the logged-in user's role; every list page supports search, pagination, and CSV export.

---

## 9. Reports

| Report | Contents | Filters |
|---|---|---|
| **Inventory Report** | On-hand qty & value per product per warehouse, reorder flags | warehouse, category, date |
| **Production Report** | Planned vs actual output (RO m³, bottles by SKU, ice kg), machine utilization | date range, production type, machine |
| **Sales Report** | Orders, units sold, revenue by product/customer/rep | date range, customer, rep, product |
| **Profitability Report** | Revenue − material cost − allocated overhead, per product/month | product, date range |
| **Stock Movement Report** | Full ledger (IN/OUT/TRANSFER/ADJUSTMENT) with reference drill-down | product, warehouse, date range, movement_type |
| **Supplier Performance Report** | On-time %, quality rating, PO value, by supplier | supplier, date range |
| **Maintenance Report** | Downtime hours, maintenance cost, breakdown frequency, by machine | machine, date range |

---

## 10. Bonus Features

- **Barcode support:** `products.barcode` (EAN-13/Code-128); frontend uses a camera-based scanner (`react-zxing` or similar) on the Inventory and Goods Receiving screens to look up products instantly — no extra table needed, scan just resolves to `products.id`.
- **Multi-warehouse:** already first-class in the schema (`warehouses`, `stock_levels`, `stock_movements.related_warehouse_id` for transfers); add warehouses freely as the company opens new plants/depots.
- **Basic truck tracking:** `trucks` + `deliveries.last_known_lat/lng` — a driver mobile view (or simple periodic browser geolocation POST) updates position; status pipeline (`scheduled → in_transit → delivered/failed`) gives dispatch visibility without needing a full telematics integration.
- **Future IoT integration:** `iot_sensor_readings` table is ready to receive flow-rate/TDS/pressure data from RO plant sensors or smart water meters via a simple webhook/MQTT bridge (`POST /api/v1/iot/readings`) — feeds directly into the production dashboard once physical sensors are installed.

---

## Implementation Notes

- All monetary values: `NUMERIC(12,2)` (never float).
- All quantities: `NUMERIC(14,3)` to allow fractional units (e.g., partial m³, kg).
- Every mutating endpoint runs inside a DB transaction when it touches more than one table (e.g., dispatch → `deliveries` insert + `stock_movements` insert + `stock_levels` update).
- `stock_levels` must only ever be changed via the same transaction that inserts a `stock_movements` row — never edited directly — so the ledger and balance can't drift apart.

---

## 11. Bulk Water Tanker Distribution (redesign)

Alnaciim's primary revenue line isn't retail bottled water — it's **bulk water delivered by tanker truck** to customer-owned tanks, drums, and underground reservoirs, billed on the quantity actually delivered rather than a fixed catalog price. Sections 1–10 above describe the general-purpose ERP; this section describes how the Sales & Distribution module was redesigned specifically around that workflow (migration: `database/migrations/002_bulk_water_operations.sql`, folded into `schema.sql`).

### 11.1 New tables

| Table | Purpose |
|---|---|
| `customer_tanks` | Registry of every tank/drum/underground reservoir a customer owns — `tank_code` (unique), `barcode` (QR-ready), `capacity_liters`, `location`, `installed_date`, `status`. |
| `tank_maintenance_logs` | Service history per tank (cleaning, repairs), independent of delivery history. |
| `truck_loads` | One tanker-loading event: `truck_id`, `product_id` (the bulk water product), `warehouse_id` (RO storage source), `quantity_loaded`. Posts a `stock_movements` OUT (`reference_type = 'tanker_load'`) immediately — the water has left inventory the moment it's loaded, before any customer stop happens. One load typically serves several stops on a route. |
| `bill_of_materials` / `bom_items` | Defines how much of each raw material one unit of a finished good consumes (e.g., 24 preforms + 24 caps + 24 labels + 1 carton per box of 500ml water) — see §11.5. |

`deliveries` gained `truck_load_id`, `customer_tank_id`, `quantity_delivered`, `signature_name`, `confirmed_at`. `sales_orders` gained `delivery_fee`. `production_batches` gained `wastage_qty` / `wastage_notes`.

### 11.2 Workflow: order → load → dispatch → confirm → invoice

```
Customer order placed (estimated quantity, e.g. "5,000 L to Tank TANK-BC-01")
   → sales_orders (status=pending), delivery_fee captured for tanker customers
   → Approved (status=approved)

Tanker loaded independently of any specific order:
   → POST /sales/truck-loads: quantity_loaded deducted from RO storage warehouse NOW
   → truck_loads.remaining_balance = quantity_loaded − Σ(deliveries.quantity_delivered against this load)

Dispatch links the order to that load + the specific tank being filled:
   → POST /sales/orders/:id/dispatch { truck_load_id, customer_tank_id, driver_id }
   → No second stock deduction — the water already left inventory at load time.
   → (Non-tanker dispatch, e.g. boxed bottled water, still deducts stock at dispatch as in §4.)

Driver confirms what was ACTUALLY delivered (measured at the tank, not the order estimate):
   → PUT /sales/deliveries/:id/confirm { quantity_delivered, signature_name, gps? }
   → When the order has exactly one line item, its quantity/subtotal — and the order's
     total_amount — are rewritten to the confirmed amount before the invoice is generated.
   → Tank refill history (GET /tanks/:id/history) picks this up automatically.

Payment recorded → sales_orders.payment_status updates the customer's running balance.
```

This is why invoicing is a *post*-delivery step for bulk water: the PDF invoice (`GET /sales/orders/:id/invoice`) reflects the confirmed quantity, the tanker delivery fee, the customer's credit limit, and their outstanding balance across all orders — not just a pre-priced catalog line.

### 11.3 Water Sales Dashboard & customer statement

`GET /reports/water-dashboard` — scoped strictly to tanker deliveries (`truck_load_id IS NOT NULL`) so retail box deliveries don't pollute bulk-water metrics: liters sold today, deliveries completed today, tanker utilization % (loaded ÷ available truck capacity), top customers by volume, unpaid balances, and per-driver route performance for today.

`GET /customers/:id/statement` — full account ledger: every invoice (debit) and payment (credit) in date order with a running balance, the standard customer statement a bulk-water business needs for collections.

### 11.4 Mobile driver mode

Drivers get a deliberately minimal, single-column mobile layout (`/driver`, no sidebar) instead of the back-office console: their assigned stops for the day, a "Start Trip" action, and a "Confirm Delivery" form (quantity, typed signature, optional one-tap GPS capture via `navigator.geolocation`). Logging in as a Driver redirects here instead of the main dashboard.

### 11.5 Manufacturing: bill of materials & wastage

`PUT /production/batches/:id/complete` now auto-calculates raw-material consumption from the finished product's active BOM — `quantity_per_unit × (actual_qty + wastage_qty)`, since wasted units still consumed raw material — instead of requiring every consumption line to be entered by hand. Explicit `materials` in the request body still overrides the BOM for one-off batches. `wastage_qty`/`wastage_notes` are recorded on the batch itself for yield reporting.

---

## 12. Automated Backup & Restore

A daily `pg_dump` (custom format, compressed) runs on a configurable cron schedule (`BACKUP_CRON_SCHEDULE`, default 2am), with on-demand backups, downloads, and a type-to-confirm restore available from **Settings → Backups** (Admin only). Implementation: `backend/src/services/backupService.js`, `backend/src/routes/backups.routes.js`, table `backup_logs` (`database/migrations/003_backup_system.sql`).

### 12.1 Why the audit log lives outside the dump

`backup_logs` is **excluded from every `pg_dump`** (`--exclude-table=public.backup_logs`). If it weren't, restoring a backup would replay whatever `backup_logs` looked like at the moment that backup was taken — silently erasing every entry recorded since, including the restore operation's own "success" row. Excluding it means the audit trail survives every restore intact. For the same reason, `backup_logs.triggered_by` is a **plain column, not a foreign key** to `users(id)`: a live FK from a table outside the dump would stop `pg_restore --clean` from being able to drop and recreate the `users` table at all.

pg_dump still emits `backup_logs`'s owned sequence (`backup_logs_id_seq`) even though the table itself is excluded — there's no `--exclude-sequence` flag. Left alone, `pg_restore --clean` can't drop/recreate that sequence either, because the live table's `id` column default still depends on it. The restore step works around this by briefly detaching the column default, letting `pg_restore` do its thing, then reattaching the default and bumping the sequence past the live table's current `MAX(id)` — so backup/restore history keeps accumulating correctly across repeated restores.

### 12.2 Workflow

```
Scheduled (node-cron, daily) or manual (POST /backups):
   → backup_logs row inserted (status=running)
   → pg_dump -F c --exclude-table=public.backup_logs → backend/backups/*.dump
   → row updated to status=success + file size, old files past BACKUP_RETENTION_DAYS pruned

Restore (POST /backups/:id/restore, body { "confirm": "RESTORE" }):
   → backup_logs row inserted (operation=restore, status=running)
   → detach backup_logs.id's sequence default
   → terminate other sessions on the target database (via a connection to `postgres`)
   → pg_restore --clean --if-exists --no-owner <file>
   → reattach the sequence default, bump it past MAX(id)
   → row updated to status=success/failed (+ error detail on failure)
```

Every write endpoint (`POST`, `restore`, `DELETE`) requires the **Admin** role. Restoring requires the exact literal `{ "confirm": "RESTORE" }` in the request body — the frontend enforces this with a type-to-confirm input that keeps the button disabled until it matches.
