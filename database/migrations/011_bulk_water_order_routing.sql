-- =====================================================================
-- BULK WATER ORDER-DRIVEN ROUTING
--
-- Route Planning must pull from real, already-approved sales orders for
-- the Bulk Water product line — not a free customer picker. This adds
-- the two fields a bulk-water order needs that a generic sales order
-- doesn't: which tank it's for, and its dispatch priority. Additive,
-- nullable — no existing order or query is affected.
-- =====================================================================

ALTER TABLE sales_orders ADD COLUMN customer_tank_id INT REFERENCES customer_tanks(id);
ALTER TABLE sales_orders ADD COLUMN priority VARCHAR(10) NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low','normal','high','urgent'));

CREATE INDEX idx_sales_orders_tank ON sales_orders(customer_tank_id);
