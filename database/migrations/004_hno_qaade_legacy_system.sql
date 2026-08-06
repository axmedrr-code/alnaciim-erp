-- =====================================================================
-- Migration 004 — HNO numbering system, Qaade (route/collector) system,
-- cash/credit sale distinction, and legacy-status customer fields.
--
-- Preserves business concepts from the predecessor desktop customer
-- management system: HNO-based customer/invoice/transaction numbering,
-- Qaade-based route/collector/area distribution, and open-balance
-- (debtor) tracking — modernized onto the existing ERP schema rather
-- than replacing it.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- HNO NUMBERING SYSTEM — a single reusable running-number generator,
-- parameterized by document type, matching how the legacy system
-- issued one continuous numbered series per document class.
-- ---------------------------------------------------------------------

CREATE TABLE hno_sequences (
    id            SERIAL PRIMARY KEY,
    sequence_type VARCHAR(30) UNIQUE NOT NULL CHECK (sequence_type IN ('customer', 'invoice', 'transaction', 'qaade')),
    prefix        VARCHAR(20) NOT NULL,
    next_value    BIGINT NOT NULL DEFAULT 1,
    padding       INT NOT NULL DEFAULT 5
);

INSERT INTO hno_sequences (sequence_type, prefix, next_value, padding) VALUES
 ('customer', 'HNO-C-', 1, 5),
 ('invoice', 'HNO-INV-', 1, 5),
 ('transaction', 'HNO-TXN-', 1, 5),
 ('qaade', 'Q-', 1, 3);

-- ---------------------------------------------------------------------
-- QAADE SYSTEM — delivery route / sales route / collector / area.
-- Customers and orders are grouped by qaade for route-based reporting.
-- ---------------------------------------------------------------------

CREATE TABLE qaades (
    id           SERIAL PRIMARY KEY,
    qaade_code   VARCHAR(20) UNIQUE NOT NULL,
    name         VARCHAR(100) NOT NULL,
    area         VARCHAR(150),
    collector_id INT REFERENCES users(id),
    truck_id     INT REFERENCES trucks(id),
    status       VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    notes        TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_qaades_collector ON qaades(collector_id);

ALTER TABLE customers
    ADD COLUMN hno      VARCHAR(30) UNIQUE,
    ADD COLUMN qaade_id INT REFERENCES qaades(id),
    ADD COLUMN status   VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'suspended', 'closed'));

CREATE INDEX idx_customers_qaade ON customers(qaade_id);
CREATE INDEX idx_customers_hno ON customers(hno);

-- ---------------------------------------------------------------------
-- CASH / CREDIT SALES + INVOICE HNO + QAADE-SCOPED ORDERS
-- ---------------------------------------------------------------------

ALTER TABLE sales_orders
    ADD COLUMN invoice_hno VARCHAR(30) UNIQUE,
    ADD COLUMN qaade_id    INT REFERENCES qaades(id),
    ADD COLUMN sale_type   VARCHAR(20) NOT NULL DEFAULT 'credit' CHECK (sale_type IN ('cash', 'credit'));

CREATE INDEX idx_sales_orders_qaade ON sales_orders(qaade_id);
CREATE INDEX idx_sales_orders_invoice_hno ON sales_orders(invoice_hno);
CREATE INDEX idx_sales_orders_sale_type ON sales_orders(sale_type);

-- ---------------------------------------------------------------------
-- TRANSACTION HNO for payments (the legacy "receipt number")
-- ---------------------------------------------------------------------

ALTER TABLE payments
    ADD COLUMN transaction_hno VARCHAR(30) UNIQUE;

COMMIT;
