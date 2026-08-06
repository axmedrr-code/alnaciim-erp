-- =====================================================================
-- Alnaciim Water Company — Sample seed data
-- Run after schema.sql, against a fresh database (relies on SERIAL ids
-- starting at 1 and being assigned in insertion order below).
-- All sample users share the password: Password123!
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- ROLES
-- ---------------------------------------------------------------------
INSERT INTO roles (name, description) VALUES
 ('Admin',               'Full system access, user & settings management'),
 ('Production Manager',  'Manages production planning, batches, machines, downtime'),
 ('Inventory Manager',   'Manages stock, warehouses, reorder rules, transfers'),
 ('Sales Manager',       'Manages customers, sales orders, pricing, deliveries'),
 ('Finance Officer',     'Manages expenses, revenue, profitability'),
 ('Storekeeper',         'Records stock in/out at an assigned warehouse'),
 ('Technician',          'Performs maintenance and reports breakdowns'),
 ('Procurement Officer', 'Manages suppliers and purchase orders'),
 ('Driver',              'Executes deliveries and updates delivery status');

-- ---------------------------------------------------------------------
-- WAREHOUSES (manager_id filled in after users are created)
-- ---------------------------------------------------------------------
INSERT INTO warehouses (code, name, type, location) VALUES
 ('WH-RM-01',  'Raw Material Store',       'raw_material',   'Main Plant - Block A'),
 ('WH-FG-01',  'Finished Goods Warehouse', 'finished_goods', 'Main Plant - Block B'),
 ('WH-SP-01',  'Spare Parts Store',        'spare_parts',    'Main Plant - Technical Wing'),
 ('WH-DEP-01', 'Distribution Depot',       'general',        'City Distribution Depot');

-- ---------------------------------------------------------------------
-- USERS  (password_hash below = bcrypt("Password123!"))
-- ---------------------------------------------------------------------
INSERT INTO users (employee_code, full_name, email, password_hash, role_id, department, phone, assigned_warehouse_id) VALUES
 ('EMP-001', 'Ahmed Al-Naciim',   'admin@alnaciim.com',       '$2b$10$mFQBawRKb4NptNsE7O7eCeRrga4vXlvNpnPdGmcT3TZNjhtIQ1veG', 1, 'Management',  '+252-61-1000001', NULL),
 ('EMP-002', 'Farah Osman',       'production.mgr@alnaciim.com','$2b$10$mFQBawRKb4NptNsE7O7eCeRrga4vXlvNpnPdGmcT3TZNjhtIQ1veG', 2, 'Production',  '+252-61-1000002', NULL),
 ('EMP-003', 'Hodan Warsame',     'inventory.mgr@alnaciim.com', '$2b$10$mFQBawRKb4NptNsE7O7eCeRrga4vXlvNpnPdGmcT3TZNjhtIQ1veG', 3, 'Logistics',   '+252-61-1000003', NULL),
 ('EMP-004', 'Khalid Nur',        'sales.mgr@alnaciim.com',     '$2b$10$mFQBawRKb4NptNsE7O7eCeRrga4vXlvNpnPdGmcT3TZNjhtIQ1veG', 4, 'Sales',       '+252-61-1000004', NULL),
 ('EMP-005', 'Amina Yusuf',       'finance@alnaciim.com',       '$2b$10$mFQBawRKb4NptNsE7O7eCeRrga4vXlvNpnPdGmcT3TZNjhtIQ1veG', 5, 'Finance',     '+252-61-1000005', NULL),
 ('EMP-006', 'Ismail Hassan',     'storekeeper.rm@alnaciim.com','$2b$10$mFQBawRKb4NptNsE7O7eCeRrga4vXlvNpnPdGmcT3TZNjhtIQ1veG', 6, 'Logistics',   '+252-61-1000006', 1),
 ('EMP-007', 'Sagal Abdi',        'storekeeper.fg@alnaciim.com','$2b$10$mFQBawRKb4NptNsE7O7eCeRrga4vXlvNpnPdGmcT3TZNjhtIQ1veG', 6, 'Logistics',   '+252-61-1000007', 2),
 ('EMP-008', 'Mustafe Ali',       'technician@alnaciim.com',    '$2b$10$mFQBawRKb4NptNsE7O7eCeRrga4vXlvNpnPdGmcT3TZNjhtIQ1veG', 7, 'Technical',   '+252-61-1000008', NULL),
 ('EMP-009', 'Nasra Jama',        'procurement@alnaciim.com',   '$2b$10$mFQBawRKb4NptNsE7O7eCeRrga4vXlvNpnPdGmcT3TZNjhtIQ1veG', 8, 'Finance',     '+252-61-1000009', NULL),
 ('EMP-010', 'Yusuf Dahir',       'driver1@alnaciim.com',       '$2b$10$mFQBawRKb4NptNsE7O7eCeRrga4vXlvNpnPdGmcT3TZNjhtIQ1veG', 9, 'Logistics',   '+252-61-1000010', NULL),
 ('EMP-011', 'Deeqa Mohamed',     'driver2@alnaciim.com',       '$2b$10$mFQBawRKb4NptNsE7O7eCeRrga4vXlvNpnPdGmcT3TZNjhtIQ1veG', 9, 'Logistics',   '+252-61-1000011', NULL),
 ('EMP-012', 'Cabdirisaaq Nuur',  'sales.rep1@alnaciim.com',    '$2b$10$mFQBawRKb4NptNsE7O7eCeRrga4vXlvNpnPdGmcT3TZNjhtIQ1veG', 4, 'Sales',       '+252-61-1000012', NULL);

UPDATE warehouses SET manager_id = 3 WHERE code IN ('WH-RM-01','WH-FG-01','WH-SP-01');
UPDATE warehouses SET manager_id = 4 WHERE code = 'WH-DEP-01';

-- ---------------------------------------------------------------------
-- CATEGORIES
-- ---------------------------------------------------------------------
INSERT INTO categories (name, product_type) VALUES
 ('Preforms',                'raw_material'),   -- 1
 ('Caps',                    'raw_material'),   -- 2
 ('Labels',                  'raw_material'),   -- 3
 ('Packaging Materials',     'raw_material'),   -- 4
 ('Water Treatment Chemicals','raw_material'),  -- 5
 ('Bottled Water',           'finished_good'),  -- 6
 ('Ice Products',            'finished_good'),  -- 7
 ('Pumps & Motors',          'spare_part'),     -- 8
 ('Filters & Membranes',     'spare_part');     -- 9

-- ---------------------------------------------------------------------
-- PRODUCTS
-- ---------------------------------------------------------------------
INSERT INTO products (sku, barcode, name, category_id, product_type, unit, unit_cost, unit_price, reorder_level, reorder_qty) VALUES
 ('RM-PF-12G',  '6294000000011', 'PET Preform 12g (330ml)',        1, 'raw_material', 'pcs', 0.06, 0,    5000,  20000), -- 1
 ('RM-PF-25G',  '6294000000028', 'PET Preform 25g (1.5L)',         1, 'raw_material', 'pcs', 0.11, 0,    5000,  20000), -- 2
 ('RM-CAP-28',  '6294000000035', 'Bottle Cap 28mm',                2, 'raw_material', 'pcs', 0.015,0,    10000, 50000), -- 3
 ('RM-LBL-500', '6294000000042', 'Label - 500ml Design',           3, 'raw_material', 'pcs', 0.02, 0,    5000,  20000), -- 4
 ('RM-LBL-1500','6294000000059', 'Label - 1.5L Design',            3, 'raw_material', 'pcs', 0.025,0,    5000,  20000), -- 5
 ('RM-SHRINK',  '6294000000066', 'Shrink Film Roll',               4, 'raw_material', 'roll',12.00,0,    50,    200),   -- 6
 ('RM-CARTON24','6294000000073', 'Carton Box 24-pack',             4, 'raw_material', 'pcs', 0.35, 0,    2000,  10000), -- 7
 ('RM-CHLOR',   '6294000000080', 'Sodium Hypochlorite (Chlorine)', 5, 'raw_material', 'L',   1.20, 0,    200,   1000),  -- 8
 ('FG-W330',    '6294000001018', 'Bottled Water 330ml (24-pack)',  6, 'finished_good','box', 2.10, 3.50, 500,   2000),  -- 9
 ('FG-W500',    '6294000001025', 'Bottled Water 500ml (24-pack)',  6, 'finished_good','box', 2.80, 4.50, 500,   2000),  -- 10
 ('FG-W1000',   '6294000001032', 'Bottled Water 1L (12-pack)',     6, 'finished_good','box', 2.40, 4.00, 300,   1500),  -- 11
 ('FG-W1500',   '6294000001049', 'Bottled Water 1.5L (12-pack)',   6, 'finished_good','box', 3.30, 5.50, 300,   1500),  -- 12
 ('FG-W5000',   '6294000001056', 'Bottled Water 5L (4-pack)',      6, 'finished_good','box', 3.60, 6.00, 150,   800),   -- 13
 ('FG-W19000',  '6294000001063', 'Bottled Water 19L Dispenser Bottle', 6, 'finished_good','pcs', 1.80, 3.00, 100, 500), -- 14
 ('FG-ICEBLK5', '6294000002011', 'Ice Block 5kg',                  7, 'finished_good','pcs', 0.60, 1.20, 200,   1000),  -- 15
 ('FG-ICECUBE2','6294000002028', 'Ice Cubes 2kg Bag',              7, 'finished_good','pcs', 0.35, 0.80, 200,   1000),  -- 16
 ('SP-PUMP-HP', NULL,            'High Pressure RO Pump',          8, 'spare_part',  'pcs', 450.00, 0,   2,     5),     -- 17
 ('SP-MOTOR',   NULL,            'Water Pump Motor 5HP',           8, 'spare_part',  'pcs', 220.00, 0,   3,     5),     -- 18
 ('SP-BELT',    NULL,            'Conveyor Belt',                  8, 'spare_part',  'pcs', 60.00,  0,   4,     10),    -- 19
 ('SP-MEMBRANE',NULL,            'RO Membrane Element',            9, 'spare_part',  'pcs', 180.00, 0,   4,     10),    -- 20
 ('SP-FILTER-C',NULL,            'Carbon Pre-Filter Cartridge',    9, 'spare_part',  'pcs', 15.00,  0,   20,    60);    -- 21

-- ---------------------------------------------------------------------
-- MACHINES
-- ---------------------------------------------------------------------
INSERT INTO machines (code, name, type, warehouse_id, purchase_date, status, specifications) VALUES
 ('MC-RO-01',  'RO Plant Unit 1',   'RO_PLANT',     1, '2020-03-15', 'operational', '{"capacity_m3_per_day": 50, "manufacturer": "Hydrotech"}'),
 ('MC-FILL-01','Filling Line 1',    'FILLING_LINE', 2, '2020-05-01', 'operational', '{"bottles_per_hour": 3000}'),
 ('MC-FILL-02','Filling Line 2',    'FILLING_LINE', 2, '2022-01-10', 'operational', '{"bottles_per_hour": 4500}'),
 ('MC-ICE-01', 'Ice Machine 1',     'ICE_MACHINE',  2, '2021-07-20', 'operational', '{"kg_per_day": 2000}'),
 ('MC-PACK-01','Packaging Machine 1','PACKAGING',   2, '2020-05-01', 'operational', '{"cartons_per_hour": 200}'),
 ('MC-GEN-01', 'Standby Generator 1','GENERATOR',   1, '2019-11-01', 'operational', '{"kva": 250}');

-- ---------------------------------------------------------------------
-- MAINTENANCE SCHEDULES
-- ---------------------------------------------------------------------
INSERT INTO maintenance_schedules (machine_id, maintenance_type, frequency_days, last_done_date, next_due_date, assigned_to, description) VALUES
 (1, 'preventive', 30, '2026-06-10', '2026-07-10', 8, 'RO membrane cleaning & pressure check'),
 (2, 'preventive', 60, '2026-05-20', '2026-07-19', 8, 'Filling nozzle calibration'),
 (4, 'preventive', 45, '2026-05-25', '2026-07-09', 8, 'Ice machine compressor service'),
 (6, 'preventive', 90, '2026-04-01', '2026-06-30', 8, 'Generator load test & oil change');

-- ---------------------------------------------------------------------
-- SUPPLIERS
-- ---------------------------------------------------------------------
INSERT INTO suppliers (code, name, category, contact_person, phone, email, address, rating) VALUES
 ('SUP-001', 'Gulf Preform Industries',   'packaging',    'Omar Saleh',    '+971-50-1112222', 'sales@gulfpreform.com', 'Dubai, UAE',          4.50),
 ('SUP-002', 'EastAfrica Label Printers', 'packaging',    'Liban Warfaa',  '+252-61-2223333', 'info@ealabels.so',      'Hargeisa, Somaliland',4.00),
 ('SUP-003', 'ChemPure Water Treatment',  'chemicals',    'Rania Haidar',  '+971-55-3334444', 'orders@chempure.com',   'Sharjah, UAE',        4.20),
 ('SUP-004', 'Hydro Spares & Equipment',  'spare_part',   'Faisal Rahman', '+971-52-4445555', 'parts@hydrospares.com', 'Dubai, UAE',          3.80);

-- ---------------------------------------------------------------------
-- CUSTOMERS
-- ---------------------------------------------------------------------
INSERT INTO customers (code, name, type, phone, email, address, city, credit_limit, payment_terms_days, sales_rep_id) VALUES
 ('CUST-001', 'Al-Amal Retail Shop',       'retail',      '+252-61-5551001', 'alamal@example.com',   'Airport Road',       'Hargeisa', 500,   0,  12),
 ('CUST-002', 'Barwaqo Mini Market',       'retail',      '+252-61-5551002', 'barwaqo@example.com',  'Jigjiga Yar',        'Hargeisa', 500,   0,  12),
 ('CUST-003', 'Towfiiq Wholesale Traders', 'wholesale',   '+252-61-5551003', 'towfiiq@example.com',  'Central Market',     'Hargeisa', 5000,  15, 4),
 ('CUST-004', 'Golis Distribution Co.',    'distributor', '+252-61-5551004', 'golis@example.com',    'Industrial Zone',    'Burao',    15000, 30, 4),
 ('CUST-005', 'Berbera Construction Ltd.', 'tanker',      '+252-61-5551005', 'berberacon@example.com','Port Road',         'Berbera',  10000, 30, 4);

-- ---------------------------------------------------------------------
-- TRUCKS
-- ---------------------------------------------------------------------
INSERT INTO trucks (plate_number, model, capacity, capacity_unit, status, assigned_driver_id) VALUES
 ('SL-1234-A', 'Isuzu NPR',      6000,  'liters',  'active', 10),
 ('SL-5678-B', 'Toyota Dyna',    3000,  'liters',  'active', 11),
 ('SL-9012-C', 'Mitsubishi Fuso',8, 'tons',        'active', NULL);

-- ---------------------------------------------------------------------
-- PRICE LISTS
-- ---------------------------------------------------------------------
INSERT INTO price_lists (product_id, customer_type, unit_price, effective_from) VALUES
 (9,  'retail',      3.50, '2026-01-01'), (9,  'wholesale', 3.10, '2026-01-01'), (9,  'distributor', 2.90, '2026-01-01'),
 (10, 'retail',      4.50, '2026-01-01'), (10, 'wholesale', 4.00, '2026-01-01'), (10, 'distributor', 3.70, '2026-01-01'),
 (14, 'retail',      3.00, '2026-01-01'), (14, 'wholesale', 2.70, '2026-01-01'), (14, 'distributor', 2.50, '2026-01-01'),
 (15, 'retail',      1.20, '2026-01-01'), (15, 'tanker',    1.00, '2026-01-01');

-- ---------------------------------------------------------------------
-- EXPENSE CATEGORIES
-- ---------------------------------------------------------------------
INSERT INTO expense_categories (name, type) VALUES
 ('Fuel',              'logistics'),
 ('Electricity',       'production'),
 ('Salaries',          'admin'),
 ('Equipment Maintenance', 'maintenance'),
 ('Office & Admin',    'admin');

-- ---------------------------------------------------------------------
-- OPENING STOCK (via ADJUSTMENT movements, then stock_levels)
-- ---------------------------------------------------------------------
INSERT INTO stock_movements (product_id, warehouse_id, movement_type, quantity, reference_type, performed_by, notes) VALUES
 (1, 1, 'IN', 40000, 'adjustment', 3, 'Opening balance'),
 (2, 1, 'IN', 30000, 'adjustment', 3, 'Opening balance'),
 (3, 1, 'IN', 80000, 'adjustment', 3, 'Opening balance'),
 (4, 1, 'IN', 25000, 'adjustment', 3, 'Opening balance'),
 (5, 1, 'IN', 20000, 'adjustment', 3, 'Opening balance'),
 (6, 1, 'IN', 300,   'adjustment', 3, 'Opening balance'),
 (7, 1, 'IN', 15000, 'adjustment', 3, 'Opening balance'),
 (8, 1, 'IN', 800,   'adjustment', 3, 'Opening balance'),
 (9, 2, 'IN', 1200,  'adjustment', 3, 'Opening balance'),
 (10,2, 'IN', 900,   'adjustment', 3, 'Opening balance'),
 (11,2, 'IN', 600,   'adjustment', 3, 'Opening balance'),
 (12,2, 'IN', 550,   'adjustment', 3, 'Opening balance'),
 (13,2, 'IN', 300,   'adjustment', 3, 'Opening balance'),
 (14,2, 'IN', 400,   'adjustment', 3, 'Opening balance'),
 (15,2, 'IN', 600,   'adjustment', 3, 'Opening balance'),
 (16,2, 'IN', 500,   'adjustment', 3, 'Opening balance'),
 (17,3, 'IN', 3,     'adjustment', 3, 'Opening balance'),
 (18,3, 'IN', 4,     'adjustment', 3, 'Opening balance'),
 (19,3, 'IN', 6,     'adjustment', 3, 'Opening balance'),
 (20,3, 'IN', 5,     'adjustment', 3, 'Opening balance'),
 (21,3, 'IN', 40,    'adjustment', 3, 'Opening balance');

INSERT INTO stock_levels (product_id, warehouse_id, quantity)
SELECT product_id, warehouse_id, SUM(quantity)
FROM stock_movements
GROUP BY product_id, warehouse_id;

-- ---------------------------------------------------------------------
-- SAMPLE PURCHASE ORDER (received)
-- ---------------------------------------------------------------------
INSERT INTO purchase_orders (po_number, supplier_id, order_date, expected_date, status, total_amount, created_by, notes) VALUES
 ('PO-2026-0001', 1, '2026-06-20', '2026-06-28', 'received', 3300.00, 9, 'Monthly preform restock');

INSERT INTO purchase_items (purchase_order_id, product_id, quantity_ordered, quantity_received, unit_cost, subtotal) VALUES
 (1, 1, 30000, 30000, 0.06, 1800.00),
 (1, 2, 15000, 15000, 0.10, 1500.00);

INSERT INTO goods_receipts (purchase_order_id, received_date, received_by, warehouse_id, notes) VALUES
 (1, '2026-06-28', 6, 1, 'Received in full, good condition');

INSERT INTO goods_receipt_items (goods_receipt_id, purchase_item_id, quantity_received, condition) VALUES
 (1, 1, 30000, 'good'),
 (1, 2, 15000, 'good');

INSERT INTO stock_movements (product_id, warehouse_id, movement_type, quantity, reference_type, reference_id, performed_by, notes) VALUES
 (1, 1, 'IN', 30000, 'purchase', 1, 6, 'GRN against PO-2026-0001'),
 (2, 1, 'IN', 15000, 'purchase', 1, 6, 'GRN against PO-2026-0001');

UPDATE stock_levels SET quantity = quantity + 30000, updated_at = now() WHERE product_id = 1 AND warehouse_id = 1;
UPDATE stock_levels SET quantity = quantity + 15000, updated_at = now() WHERE product_id = 2 AND warehouse_id = 1;

INSERT INTO supplier_performance (supplier_id, purchase_order_id, on_time_delivery, quality_rating, notes, evaluated_by) VALUES
 (1, 1, true, 5, 'Delivered on schedule, excellent quality', 9);

-- ---------------------------------------------------------------------
-- SAMPLE PRODUCTION BATCH (completed) — bottling 500ml
-- ---------------------------------------------------------------------
INSERT INTO production_batches (batch_number, production_type, product_id, machine_id, planned_qty, actual_qty, unit, shift, start_time, end_time, supervisor_id, status, destination_warehouse_id, notes) VALUES
 ('BATCH-2026-0701-01', 'BOTTLING', 10, 2, 900, 880, 'box', 'Morning', '2026-07-01 06:00:00+03', '2026-07-01 13:00:00+03', 2, 'completed', 2, 'Normal run, minor line stoppage');

INSERT INTO production_batch_materials (batch_id, product_id, quantity_used, warehouse_id) VALUES
 (1, 1, 21120, 1),   -- preforms (24 per box * 880)
 (1, 3, 21120, 1),   -- caps
 (1, 4, 21120, 1),   -- labels
 (1, 7, 880,   1);   -- cartons

INSERT INTO stock_movements (product_id, warehouse_id, movement_type, quantity, reference_type, reference_id, performed_by, notes) VALUES
 (1, 1, 'OUT', 21120, 'production', 1, 2, 'Consumed in BATCH-2026-0701-01'),
 (3, 1, 'OUT', 21120, 'production', 1, 2, 'Consumed in BATCH-2026-0701-01'),
 (4, 1, 'OUT', 21120, 'production', 1, 2, 'Consumed in BATCH-2026-0701-01'),
 (7, 1, 'OUT', 880,   'production', 1, 2, 'Consumed in BATCH-2026-0701-01'),
 (10,2, 'IN',  880,   'production', 1, 2, 'Output of BATCH-2026-0701-01');

UPDATE stock_levels SET quantity = quantity - 21120, updated_at = now() WHERE product_id = 1 AND warehouse_id = 1;
UPDATE stock_levels SET quantity = quantity - 21120, updated_at = now() WHERE product_id = 3 AND warehouse_id = 1;
UPDATE stock_levels SET quantity = quantity - 21120, updated_at = now() WHERE product_id = 4 AND warehouse_id = 1;
UPDATE stock_levels SET quantity = quantity - 880,   updated_at = now() WHERE product_id = 7 AND warehouse_id = 1;
UPDATE stock_levels SET quantity = quantity + 880,   updated_at = now() WHERE product_id = 10 AND warehouse_id = 2;

INSERT INTO machine_usage_logs (machine_id, log_date, shift, hours_used, output_quantity, output_unit, operator_id, notes) VALUES
 (2, '2026-07-01', 'Morning', 6.5, 880, 'box', 2, 'Line stoppage 15 min - nozzle jam');

-- ---------------------------------------------------------------------
-- SAMPLE DOWNTIME + MAINTENANCE
-- ---------------------------------------------------------------------
INSERT INTO downtime_logs (machine_id, start_time, end_time, category, reason, reported_by, resolved_by) VALUES
 (2, '2026-07-01 09:15:00+03', '2026-07-01 09:30:00+03', 'breakdown', 'Filling nozzle jam', 2, 8);

INSERT INTO maintenance_logs (machine_id, downtime_id, type, performed_by, log_date, description, cost, status) VALUES
 (2, 1, 'breakdown_repair', 8, '2026-07-01', 'Cleared nozzle jam, replaced worn seal', 25.00, 'completed');

INSERT INTO maintenance_parts_used (maintenance_log_id, product_id, quantity, warehouse_id) VALUES
 (1, 21, 1, 3);

INSERT INTO stock_movements (product_id, warehouse_id, movement_type, quantity, reference_type, reference_id, performed_by, notes) VALUES
 (21, 3, 'OUT', 1, 'maintenance', 1, 8, 'Used in maintenance log #1');

UPDATE stock_levels SET quantity = quantity - 1, updated_at = now() WHERE product_id = 21 AND warehouse_id = 3;

-- ---------------------------------------------------------------------
-- SAMPLE SALES ORDER (delivered, paid) + DELIVERY + PAYMENT
-- ---------------------------------------------------------------------
INSERT INTO sales_orders (order_number, customer_id, order_date, delivery_date, sales_rep_id, status, payment_status, subtotal, discount, tax, total_amount) VALUES
 ('SO-2026-0001', 3, '2026-07-02', '2026-07-03', 4, 'delivered', 'paid', 580.00, 0, 0, 580.00);

INSERT INTO sales_order_items (sales_order_id, product_id, quantity, unit_price, discount, subtotal) VALUES
 (1, 10, 100, 4.00, 0, 400.00),
 (1, 14, 40,  2.70, 0, 108.00),
 (1, 15, 60,  1.20, 0, 72.00);

INSERT INTO stock_movements (product_id, warehouse_id, movement_type, quantity, reference_type, reference_id, performed_by, notes) VALUES
 (10, 2, 'OUT', 100, 'sales', 1, 7, 'Dispatched against SO-2026-0001'),
 (14, 2, 'OUT', 40,  'sales', 1, 7, 'Dispatched against SO-2026-0001'),
 (15, 2, 'OUT', 60,  'sales', 1, 7, 'Dispatched against SO-2026-0001');

UPDATE stock_levels SET quantity = quantity - 100, updated_at = now() WHERE product_id = 10 AND warehouse_id = 2;
UPDATE stock_levels SET quantity = quantity - 40,  updated_at = now() WHERE product_id = 14 AND warehouse_id = 2;
UPDATE stock_levels SET quantity = quantity - 60,  updated_at = now() WHERE product_id = 15 AND warehouse_id = 2;

INSERT INTO deliveries (sales_order_id, truck_id, driver_id, dispatch_time, delivery_time, status, delivery_address, pod_reference) VALUES
 (1, 1, 10, '2026-07-03 07:00:00+03', '2026-07-03 08:10:00+03', 'delivered', 'Central Market, Hargeisa', 'POD-0001.jpg');

INSERT INTO payments (sales_order_id, amount, payment_date, method, reference_number, recorded_by) VALUES
 (1, 580.00, '2026-07-03', 'bank_transfer', 'TXN-88213', 5);

-- ---------------------------------------------------------------------
-- SAMPLE EXPENSES
-- ---------------------------------------------------------------------
INSERT INTO expenses (category_id, amount, expense_date, description, related_reference_type, related_reference_id, recorded_by) VALUES
 (1, 180.00, '2026-07-01', 'Diesel for delivery trucks', 'delivery', 1, 5),
 (2, 950.00, '2026-07-01', 'Monthly electricity bill - production plant', NULL, NULL, 5),
 (4, 25.00,  '2026-07-01', 'Filling line nozzle seal replacement', 'maintenance_log', 1, 5);

-- =======================================================================
-- BULK WATER TANKER OPERATIONS
-- =======================================================================

-- ---------------------------------------------------------------------
-- RO storage warehouse + Bulk Water product (sold by the liter, loaded
-- onto tankers rather than boxed like bottled water)
-- ---------------------------------------------------------------------
INSERT INTO warehouses (code, name, type, location) VALUES
 ('WH-RO-01', 'RO Storage Tank', 'finished_goods', 'Main Plant - RO Output'); -- id 5

INSERT INTO categories (name, product_type) VALUES
 ('Bulk Water', 'finished_good'); -- id 10

INSERT INTO products (sku, name, category_id, product_type, unit, unit_cost, unit_price, reorder_level, reorder_qty) VALUES
 ('FG-BULKWATER', 'Bulk Water (Tanker)', 10, 'finished_good', 'liters', 0.002, 0.01, 5000, 20000); -- id 22

INSERT INTO stock_movements (product_id, warehouse_id, movement_type, quantity, reference_type, performed_by, notes) VALUES
 (22, 5, 'IN', 50000, 'adjustment', 3, 'Opening RO storage balance');

INSERT INTO stock_levels (product_id, warehouse_id, quantity) VALUES (22, 5, 50000);

-- ---------------------------------------------------------------------
-- CUSTOMER TANK — Berbera Construction Ltd. (a tanker-type customer)
-- ---------------------------------------------------------------------
INSERT INTO customer_tanks (tank_code, customer_id, tank_type, capacity_liters, location) VALUES
 ('TANK-BC-01', 5, 'underground_reservoir', 20000, 'Berbera site A'); -- id 1

-- ---------------------------------------------------------------------
-- BILL OF MATERIALS — Bottled Water 500ml (24-pack): 24 preforms, 24
-- caps, 24 labels and 1 carton go into every finished box.
-- ---------------------------------------------------------------------
INSERT INTO bill_of_materials (product_id, name) VALUES (10, '500ml 24-pack BOM'); -- id 1
INSERT INTO bom_items (bom_id, raw_material_product_id, quantity_per_unit) VALUES
 (1, 1, 24), -- PET Preform 12g
 (1, 3, 24), -- Bottle Cap 28mm
 (1, 4, 24), -- Label - 500ml Design
 (1, 7, 1);  -- Carton Box 24-pack

-- ---------------------------------------------------------------------
-- SAMPLE TANKER DELIVERY — a full load → dispatch → confirmed-delivery
-- cycle, invoiced on the actually-confirmed quantity (4,850 L of the
-- 6,000 L loaded), demonstrating the full bulk-water workflow.
-- ---------------------------------------------------------------------
INSERT INTO truck_loads (truck_id, product_id, warehouse_id, quantity_loaded, loaded_by, notes) VALUES
 (1, 22, 5, 6000, 4, NULL); -- id 1

INSERT INTO stock_movements (product_id, warehouse_id, movement_type, quantity, reference_type, reference_id, performed_by, notes) VALUES
 (22, 5, 'OUT', 6000, 'tanker_load', 1, 4, 'Loaded onto truck #1');

UPDATE stock_levels SET quantity = quantity - 6000, updated_at = now() WHERE product_id = 22 AND warehouse_id = 5;

INSERT INTO sales_orders (order_number, customer_id, order_date, sales_rep_id, status, payment_status, subtotal, discount, tax, delivery_fee, total_amount) VALUES
 ('SO-2026-0002', 5, CURRENT_DATE, 4, 'delivered', 'unpaid', 242.50, 0, 0, 20.00, 262.50); -- id 2

INSERT INTO sales_order_items (sales_order_id, product_id, quantity, unit_price, discount, subtotal) VALUES
 (2, 22, 4850, 0.05, 0, 242.50);

INSERT INTO deliveries (sales_order_id, truck_id, driver_id, dispatch_time, delivery_time, status, truck_load_id, customer_tank_id, quantity_delivered, signature_name, confirmed_at) VALUES
 (2, 1, 10, now(), now(), 'delivered', 1, 1, 4850, 'Ali Warsame (site manager)', now());

-- =======================================================================
-- HNO NUMBERING BACKFILL + QAADE SYSTEM
-- Preserves the predecessor desktop system's customer/invoice/transaction
-- numbering and route (qaade) based distribution.
-- =======================================================================

-- Backfill HNOs for the customers/orders/payments already seeded above,
-- in id order, then advance each sequence counter past what was issued —
-- exactly what the app's own backfill migration does against a live DB.
UPDATE customers SET hno = 'HNO-C-' || LPAD(id::text, 5, '0');
UPDATE hno_sequences SET next_value = (SELECT COUNT(*) FROM customers) + 1 WHERE sequence_type = 'customer';

UPDATE sales_orders SET invoice_hno = 'HNO-INV-' || LPAD(id::text, 5, '0');
UPDATE hno_sequences SET next_value = (SELECT COUNT(*) FROM sales_orders) + 1 WHERE sequence_type = 'invoice';

UPDATE payments SET transaction_hno = 'HNO-TXN-' || LPAD(id::text, 5, '0');
UPDATE hno_sequences SET next_value = (SELECT COUNT(*) FROM payments) + 1 WHERE sequence_type = 'transaction';

-- Three sample qaades (routes), each with a collector (driver) and customers
-- grouped by area — the legacy route/collector/area-distribution model.
INSERT INTO qaades (qaade_code, name, area, collector_id, truck_id) VALUES
 ('Q-DOWNTOWN', 'Downtown Route', 'Hargeisa Central', 10, 1), -- id 1
 ('Q-INDUST', 'Industrial Zone Route', 'Hargeisa Industrial Zone', 11, 2), -- id 2
 ('Q-BURAO', 'Burao Distribution Route', 'Burao', 10, NULL); -- id 3

UPDATE customers SET qaade_id = 1 WHERE id = 1; -- Al-Amal Retail Shop
UPDATE customers SET qaade_id = 2 WHERE id IN (2, 3); -- Barwaqo Mini Market, Towfiiq Wholesale Traders
UPDATE customers SET qaade_id = 3 WHERE id = 4; -- Golis Distribution Co.

-- Fresh qaade-attributed orders (order.qaade_id is snapshotted from the customer at
-- creation time, so only NEW orders after the assignments above carry it) —
-- one credit sale, one cash sale, and one partially-collected credit sale, so
-- "sales by qaade" and the debtors report both show real cross-route activity.
INSERT INTO sales_orders (order_number, invoice_hno, customer_id, qaade_id, sale_type, order_date, sales_rep_id, status, payment_status, subtotal, discount, tax, delivery_fee, total_amount) VALUES
 ('SO-2026-0003', 'HNO-INV-00004', 1, 1, 'credit', CURRENT_DATE, 4, 'pending', 'unpaid', 90.00, 0, 0, 0, 90.00),  -- id 3
 ('SO-2026-0004', 'HNO-INV-00005', 3, 2, 'cash',   CURRENT_DATE, 4, 'pending', 'paid',   116.00, 0, 0, 0, 116.00), -- id 4
 ('SO-2026-0005', 'HNO-INV-00006', 4, 3, 'credit', CURRENT_DATE, 4, 'pending', 'unpaid', 82.50, 0, 0, 0, 82.50);  -- id 5

INSERT INTO sales_order_items (sales_order_id, product_id, quantity, unit_price, discount, subtotal) VALUES
 (3, 10, 20, 4.50, 0, 90.00),
 (4, 9,  40, 2.90, 0, 116.00),
 (5, 12, 15, 5.50, 0, 82.50);

INSERT INTO payments (sales_order_id, amount, method, transaction_hno, recorded_by) VALUES
 (4, 116.00, 'cash', 'HNO-TXN-00002', 4), -- the cash sale settles itself immediately
 (3, 50.00,  'cash', 'HNO-TXN-00003', 4); -- a partial collection against the downtown credit sale

UPDATE sales_orders SET payment_status = 'partial' WHERE id = 3;

-- These extra orders/payments were inserted with hand-assigned HNOs (to keep this
-- file deterministic) rather than through the app, so re-sync each counter to
-- past the highest number actually issued above — otherwise the first real
-- order/payment created through the app would collide with one of these.
UPDATE hno_sequences SET next_value = (SELECT COUNT(*) FROM sales_orders) + 1 WHERE sequence_type = 'invoice';
UPDATE hno_sequences SET next_value = (SELECT COUNT(*) FROM payments) + 1 WHERE sequence_type = 'transaction';

-- =======================================================================
-- ACCOUNTING SEED DATA + HISTORICAL BACKFILL (see
-- migrations/006_accounting_seed_backfill.sql for full commentary)
-- =======================================================================

INSERT INTO chart_of_accounts (code, name, account_type, is_system) VALUES
 ('1000', 'Cash on Hand',              'asset',     true),
 ('1010', 'Bank - Main Account',       'asset',     true),
 ('1100', 'Accounts Receivable',       'asset',     true),
 ('1200', 'Inventory - Raw Materials', 'asset',     false),
 ('1210', 'Inventory - Finished Goods','asset',     false),
 ('1220', 'Inventory - Spare Parts',   'asset',     false),
 ('2000', 'Accounts Payable',          'liability', true),
 ('3000', 'Owner''s Capital',          'equity',    false),
 ('3900', 'Retained Earnings',         'equity',    true),
 ('4000', 'Sales Revenue - Water',     'revenue',   true),
 ('4100', 'Delivery Fee Income',       'revenue',   true),
 ('5100', 'Production Expenses',       'expense',   false),
 ('5200', 'Logistics Expenses',        'expense',   false),
 ('5300', 'Admin Expenses',            'expense',   false),
 ('5400', 'Maintenance Expenses',      'expense',   false),
 ('5500', 'Utilities Expenses',        'expense',   false);

INSERT INTO fiscal_years (name, start_date, end_date, status)
SELECT 'FY' || extract(year FROM CURRENT_DATE)::text,
       date_trunc('year', CURRENT_DATE)::date,
       (date_trunc('year', CURRENT_DATE) + interval '1 year - 1 day')::date,
       'open'
WHERE NOT EXISTS (SELECT 1 FROM fiscal_years WHERE name = 'FY' || extract(year FROM CURRENT_DATE)::text);

INSERT INTO bank_accounts (name, bank_name, account_number, coa_account_id, opening_balance)
SELECT 'Main Operating Account', 'Dahabshiil Bank', '000-1122-334', id, 0
FROM chart_of_accounts WHERE code = '1010';

UPDATE expense_categories SET coa_account_id = (SELECT id FROM chart_of_accounts WHERE code = '5200') WHERE type = 'logistics';
UPDATE expense_categories SET coa_account_id = (SELECT id FROM chart_of_accounts WHERE code = '5100') WHERE type = 'production';
UPDATE expense_categories SET coa_account_id = (SELECT id FROM chart_of_accounts WHERE code = '5300') WHERE type = 'admin';
UPDATE expense_categories SET coa_account_id = (SELECT id FROM chart_of_accounts WHERE code = '5400') WHERE type = 'maintenance';
UPDATE expense_categories SET coa_account_id = (SELECT id FROM chart_of_accounts WHERE code = '5500') WHERE type = 'utilities';

DO $$
DECLARE
  cash_acct   INT := (SELECT id FROM chart_of_accounts WHERE code = '1000');
  bank_acct   INT := (SELECT id FROM chart_of_accounts WHERE code = '1010');
  ar_acct     INT := (SELECT id FROM chart_of_accounts WHERE code = '1100');
  ap_acct     INT := (SELECT id FROM chart_of_accounts WHERE code = '2000');
  rev_acct    INT := (SELECT id FROM chart_of_accounts WHERE code = '4000');
  fee_acct    INT := (SELECT id FROM chart_of_accounts WHERE code = '4100');
  fallback_user INT := (SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id WHERE r.name = 'Admin' ORDER BY u.id LIMIT 1);
  r RECORD;
  v_num BIGINT;
  entry_id INT;
  rev_amt NUMERIC;
  fee_amt NUMERIC;
  inv_acct INT;
BEGIN
  FOR r IN SELECT * FROM sales_orders WHERE status != 'cancelled' AND total_amount > 0 ORDER BY id LOOP
    rev_amt := r.subtotal - r.discount + r.tax;
    fee_amt := r.delivery_fee;
    UPDATE je_sequences SET next_value = next_value + 1 RETURNING next_value - 1 INTO v_num;
    INSERT INTO journal_entries (entry_number, entry_date, description, source, reference_type, reference_id, created_by)
    VALUES ('JE-' || lpad(v_num::text, 6, '0'), r.order_date, 'Backfill: sale ' || COALESCE(r.invoice_hno, r.order_number), 'system', 'sales_order', r.id, COALESCE(r.sales_rep_id, fallback_user))
    RETURNING id INTO entry_id;

    IF r.sale_type = 'cash' THEN
      INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit) VALUES (entry_id, cash_acct, r.total_amount, 0);
    ELSE
      INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, customer_id) VALUES (entry_id, ar_acct, r.total_amount, 0, r.customer_id);
    END IF;
    IF rev_amt > 0 THEN
      INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit) VALUES (entry_id, rev_acct, 0, rev_amt);
    END IF;
    IF fee_amt > 0 THEN
      INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit) VALUES (entry_id, fee_acct, 0, fee_amt);
    END IF;
  END LOOP;

  FOR r IN
    SELECT p.*, so.customer_id
    FROM payments p JOIN sales_orders so ON so.id = p.sales_order_id
    WHERE so.sale_type = 'credit'
    ORDER BY p.id
  LOOP
    UPDATE je_sequences SET next_value = next_value + 1 RETURNING next_value - 1 INTO v_num;
    INSERT INTO journal_entries (entry_number, entry_date, description, source, reference_type, reference_id, created_by)
    VALUES ('JE-' || lpad(v_num::text, 6, '0'), r.payment_date, 'Backfill: payment ' || COALESCE(r.transaction_hno, r.id::text), 'system', 'payment', r.id, COALESCE(r.recorded_by, fallback_user))
    RETURNING id INTO entry_id;

    INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit)
    VALUES (entry_id, CASE WHEN r.method = 'cash' THEN cash_acct ELSE bank_acct END, r.amount, 0);
    INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, customer_id)
    VALUES (entry_id, ar_acct, 0, r.amount, r.customer_id);
  END LOOP;

  FOR r IN
    SELECT e.*, ec.coa_account_id AS expense_acct
    FROM expenses e JOIN expense_categories ec ON ec.id = e.category_id
    ORDER BY e.id
  LOOP
    UPDATE je_sequences SET next_value = next_value + 1 RETURNING next_value - 1 INTO v_num;
    INSERT INTO journal_entries (entry_number, entry_date, description, source, reference_type, reference_id, created_by)
    VALUES ('JE-' || lpad(v_num::text, 6, '0'), r.expense_date, 'Backfill: expense - ' || COALESCE(r.description, 'expense #' || r.id), 'system', 'expense', r.id, COALESCE(r.recorded_by, fallback_user))
    RETURNING id INTO entry_id;

    INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit) VALUES (entry_id, r.expense_acct, r.amount, 0);
    INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit)
    VALUES (entry_id, CASE WHEN r.payment_method = 'cash' THEN cash_acct ELSE bank_acct END, 0, r.amount);
  END LOOP;

  FOR r IN
    SELECT gr.purchase_order_id AS po_id, po.order_date, po.supplier_id, po.po_number, po.created_by,
           p.product_type, SUM(gri.quantity_received * pi.unit_cost) AS val
    FROM goods_receipt_items gri
    JOIN purchase_items pi ON pi.id = gri.purchase_item_id
    JOIN products p ON p.id = pi.product_id
    JOIN goods_receipts gr ON gr.id = gri.goods_receipt_id
    JOIN purchase_orders po ON po.id = gr.purchase_order_id
    WHERE gri.condition = 'good'
    GROUP BY gr.purchase_order_id, po.order_date, po.supplier_id, po.po_number, po.created_by, p.product_type
    ORDER BY gr.purchase_order_id
  LOOP
    inv_acct := CASE r.product_type
      WHEN 'raw_material' THEN (SELECT id FROM chart_of_accounts WHERE code = '1200')
      WHEN 'finished_good' THEN (SELECT id FROM chart_of_accounts WHERE code = '1210')
      WHEN 'spare_part' THEN (SELECT id FROM chart_of_accounts WHERE code = '1220')
    END;

    UPDATE je_sequences SET next_value = next_value + 1 RETURNING next_value - 1 INTO v_num;
    INSERT INTO journal_entries (entry_number, entry_date, description, source, reference_type, reference_id, created_by)
    VALUES ('JE-' || lpad(v_num::text, 6, '0'), r.order_date, 'Backfill: goods received - ' || r.po_number, 'system', 'purchase_order', r.po_id, COALESCE(r.created_by, fallback_user))
    RETURNING id INTO entry_id;

    INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit) VALUES (entry_id, inv_acct, r.val, 0);
    INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, supplier_id) VALUES (entry_id, ap_acct, 0, r.val, r.supplier_id);
  END LOOP;
END $$;

-- =======================================================================
-- ENTERPRISE BILLING & COST ACCOUNTING (see migrations/008_billing_cost_accounting.sql)
-- =======================================================================

INSERT INTO cost_centers (code, name, type) VALUES
 ('CC-PROD',  'Production',     'production'),     -- 1
 ('CC-SALES', 'Sales',          'sales'),           -- 2
 ('CC-DEL',   'Delivery',       'delivery'),        -- 3
 ('CC-PROC',  'Procurement',    'procurement'),     -- 4
 ('CC-MAINT', 'Maintenance',    'maintenance'),     -- 5
 ('CC-WH',    'Warehouse',      'warehouse'),       -- 6
 ('CC-HR',    'HR',             'hr'),              -- 7
 ('CC-FIN',   'Finance',        'finance'),         -- 8
 ('CC-ADMIN', 'Administration', 'administration');  -- 9

-- Vehicle/machine expense categories map onto the EXISTING Chart of
-- Accounts (5100-5500) — no new GL accounts are created for this module.
INSERT INTO vehicle_expense_category_accounts (category, coa_account_id) VALUES
 ('fuel',          (SELECT id FROM chart_of_accounts WHERE code = '5200')),
 ('repairs',        (SELECT id FROM chart_of_accounts WHERE code = '5200')),
 ('tires',          (SELECT id FROM chart_of_accounts WHERE code = '5200')),
 ('oil',            (SELECT id FROM chart_of_accounts WHERE code = '5200')),
 ('insurance',       (SELECT id FROM chart_of_accounts WHERE code = '5200')),
 ('parking',        (SELECT id FROM chart_of_accounts WHERE code = '5200')),
 ('license',        (SELECT id FROM chart_of_accounts WHERE code = '5200')),
 ('other',          (SELECT id FROM chart_of_accounts WHERE code = '5200')),
 ('driver_salary',  (SELECT id FROM chart_of_accounts WHERE code = '5300'));

INSERT INTO machine_cost_category_accounts (category, coa_account_id) VALUES
 ('fuel_power', (SELECT id FROM chart_of_accounts WHERE code = '5100')),
 ('parts',      (SELECT id FROM chart_of_accounts WHERE code = '5100')),
 ('labor',      (SELECT id FROM chart_of_accounts WHERE code = '5100')),
 ('other',      (SELECT id FROM chart_of_accounts WHERE code = '5100'));

-- Drivers earn 2.5% commission on collections against their deliveries.
UPDATE users SET commission_rate = 2.50 WHERE id IN (10, 11);

-- Attribute the existing seeded transactions to a cost center, so
-- department/profitability reports have real non-zero data from day one
-- instead of only reflecting brand-new transactions.
UPDATE sales_orders SET cost_center_id = 2 WHERE cost_center_id IS NULL;
UPDATE purchase_orders SET cost_center_id = 4 WHERE cost_center_id IS NULL;
UPDATE maintenance_logs SET cost_center_id = 5 WHERE cost_center_id IS NULL;
UPDATE expenses e SET cost_center_id = CASE ec.type
    WHEN 'logistics'   THEN 3
    WHEN 'production'  THEN 1
    WHEN 'maintenance' THEN 5
    WHEN 'utilities'   THEN 1
    ELSE 9
  END
FROM expense_categories ec WHERE ec.id = e.category_id AND e.cost_center_id IS NULL;

-- Sample projects
INSERT INTO projects (code, name, customer_id, cost_center_id, start_date, end_date, budget_amount, status, notes, created_by) VALUES
 ('PRJ-001', 'Berbera Site Bulk Water Contract', 5, 3, '2026-05-01', '2026-12-31', 15000.00, 'active', 'Ongoing bulk water supply for Berbera Construction site', 4), -- 1
 ('PRJ-002', 'Golis Distribution Expansion',     4, 2, '2026-06-01', NULL,         8000.00,  'active', 'New route rollout for Golis Distribution Co.', 4);           -- 2

-- Tag the existing Berbera tanker sale (SO-2026-0002, id 2) to its project
UPDATE sales_orders SET project_id = 1 WHERE order_number = 'SO-2026-0002';

-- Sample quotations — one still open, one already converted, demonstrating
-- the full Quotation -> Sales Order lifecycle end to end.
INSERT INTO quotations (quote_number, customer_id, quote_date, valid_until, sales_rep_id, status, subtotal, discount, tax, total_amount, cost_center_id, notes, created_by) VALUES
 ('QUO-2026-0001', 3, CURRENT_DATE, CURRENT_DATE + INTERVAL '14 days', 4, 'sent',      450.00, 0, 0, 450.00, 2, 'Bulk order pending customer approval', 4), -- 1
 ('QUO-2026-0002', 4, CURRENT_DATE - INTERVAL '20 days', CURRENT_DATE - INTERVAL '6 days', 4, 'converted', 220.00, 0, 0, 220.00, 2, 'Converted to SO-2026-0001-like order', 4); -- 2

INSERT INTO quotation_items (quotation_id, product_id, quantity, unit_price, discount, subtotal) VALUES
 (1, 10, 100, 4.50, 0, 450.00),
 (2, 9,  80,  2.75, 0, 220.00);

-- Sample vehicle costs (fuel/repairs/tires/etc. on the two active trucks)
INSERT INTO vehicle_expenses (truck_id, category, amount, expense_date, description, cost_center_id, recorded_by) VALUES
 (1, 'fuel',         85.00, CURRENT_DATE - INTERVAL '3 days', 'Diesel refill - downtown route',      3, 5),
 (1, 'repairs',      60.00, CURRENT_DATE - INTERVAL '10 days','Brake pad replacement',                3, 5),
 (1, 'tires',        120.00,CURRENT_DATE - INTERVAL '25 days','Rear tire replacement (2x)',           3, 5),
 (1, 'insurance',    200.00,CURRENT_DATE - INTERVAL '40 days','Quarterly insurance premium',          3, 5),
 (2, 'fuel',         62.00, CURRENT_DATE - INTERVAL '4 days', 'Diesel refill - industrial zone route',3, 5),
 (2, 'oil',          35.00, CURRENT_DATE - INTERVAL '18 days','Engine oil change',                    3, 5),
 (2, 'license',      45.00, CURRENT_DATE - INTERVAL '35 days','Annual vehicle license renewal',       3, 5);

-- Sample machine costs (fuel/power, parts, labor on the two filling lines + RO plant)
INSERT INTO machine_costs (machine_id, category, amount, cost_date, description, cost_center_id, recorded_by) VALUES
 (1, 'fuel_power', 140.00, CURRENT_DATE - INTERVAL '5 days',  'RO plant power draw - monthly allocation', 1, 2),
 (2, 'parts',       30.00, CURRENT_DATE - INTERVAL '12 days', 'Replacement filling nozzle seal kit',      1, 2),
 (2, 'labor',        45.00, CURRENT_DATE - INTERVAL '12 days','Technician labor - nozzle seal job',       1, 2),
 (4, 'fuel_power',  55.00, CURRENT_DATE - INTERVAL '8 days',  'Ice machine power draw - monthly allocation', 1, 2);

-- =======================================================================
-- ORGANIZATIONAL STRUCTURE (see migrations/009_org_structure.sql)
--
-- Exactly one company + one branch, matching today's single-company
-- reality. Every existing row is backfilled so nothing is ever missing
-- the dimension. Not a multi-tenant rewrite.
-- =======================================================================

INSERT INTO companies (code, name) VALUES ('HQ', 'Alnaciim Water Company'); -- id 1
INSERT INTO branches (company_id, code, name) VALUES (1, 'MAIN', 'Main Branch'); -- id 1

-- One department per cost center, under the seeded branch.
INSERT INTO departments (code, name, cost_center_id, branch_id)
SELECT code, name, id, 1 FROM cost_centers ORDER BY id;

UPDATE journal_lines   SET company_id = 1, branch_id = 1 WHERE company_id IS NULL;
UPDATE sales_orders    SET company_id = 1, branch_id = 1 WHERE company_id IS NULL;
UPDATE purchase_orders SET company_id = 1, branch_id = 1 WHERE company_id IS NULL;
UPDATE expenses        SET company_id = 1, branch_id = 1 WHERE company_id IS NULL;
UPDATE users           SET branch_id = 1 WHERE branch_id IS NULL;

-- =======================================================================
-- WATER DISTRIBUTION OPERATING SYSTEM (see migrations/010_route_operations.sql)
--
-- New roles for the route-based delivery platform, reusing the existing
-- roles table (no second permission system), plus mobile-money wallets
-- modeled as ordinary bank_accounts rows so a mobile-money payment posts
-- through the exact same Dr/Cr path a bank transfer already does.
-- =======================================================================

INSERT INTO roles (name, description) VALUES
 ('Data Entry Operator', 'Records deliveries against an assigned route'),
 ('Cashier',              'Collects and reconciles payments in the field'),
 ('Supervisor',           'Oversees operators, dispatch, and daily closing'),
 ('Route Supervisor',     'Plans and dispatches routes, oversees assigned routes');

-- Each mobile-money wallet gets its own Chart of Accounts row — bank_accounts.coa_account_id
-- is unique per account, and each wallet is a distinct pool of funds from the main bank account.
INSERT INTO chart_of_accounts (code, name, account_type) VALUES
 ('1011', 'EVC Plus Wallet', 'asset'),
 ('1012', 'Zaad Wallet',     'asset'),
 ('1013', 'Sahal Wallet',    'asset');

INSERT INTO bank_accounts (name, bank_name, account_number, coa_account_id, opening_balance)
SELECT 'EVC Plus Wallet', 'Hormuud Telecom', 'EVC-0001', id, 0 FROM chart_of_accounts WHERE code = '1011'
UNION ALL
SELECT 'Zaad Wallet', 'Telesom', 'ZAAD-0001', id, 0 FROM chart_of_accounts WHERE code = '1012'
UNION ALL
SELECT 'Sahal Wallet', 'Golis Telecom', 'SAHAL-0001', id, 0 FROM chart_of_accounts WHERE code = '1013';

COMMIT;
