-- =====================================================================
-- BILLING & COLLECTIONS
--
-- A dedicated Finance module on top of the ERP's existing customers/
-- sales_orders/payments tables — reuses them as the single source of truth
-- (a payment here is exactly the same payments row Sales already uses;
-- outstanding balance is exactly the same total_amount - SUM(payments)
-- calculation already used elsewhere) rather than shadowing them with a
-- second ledger. Only genuinely new concepts get new columns/tables:
--   - customers.collector_id: who's responsible for chasing this account
--     (distinct from payments.recorded_by, which is whoever actually took
--     a given payment — usually the same person, not always).
--   - payments.notes: free-text collector note per payment.
--   - follow_ups: the Call/SMS/WhatsApp/Visit/Promise-to-Pay/Reminder log.
-- payments.transaction_hno (already existed, unique, auto-numbered) is this
-- module's Receipt Number — never a second identifier.
-- =====================================================================

INSERT INTO roles (name, description)
SELECT 'Collector', 'Records payments against assigned customer accounts'
WHERE NOT EXISTS (SELECT 1 FROM roles WHERE name = 'Collector');

ALTER TABLE customers ADD COLUMN collector_id INT REFERENCES users(id);

ALTER TABLE payments ADD COLUMN notes TEXT;

ALTER TABLE payments DROP CONSTRAINT payments_method_check;
ALTER TABLE payments ADD CONSTRAINT payments_method_check
  CHECK (method IN ('cash', 'bank_transfer', 'mobile_money', 'cheque', 'credit'));

CREATE TABLE follow_ups (
    id                  SERIAL PRIMARY KEY,
    customer_id         INT NOT NULL REFERENCES customers(id),
    action_type         VARCHAR(20) NOT NULL CHECK (action_type IN
                           ('call', 'sms', 'whatsapp', 'visit', 'promise_to_pay', 'reminder')),
    notes               TEXT,
    promise_amount      NUMERIC(12,2),
    promise_date        DATE,
    next_followup_date  DATE,
    completed_at        TIMESTAMPTZ,
    created_by          INT NOT NULL REFERENCES users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_follow_ups_customer ON follow_ups(customer_id, created_at);
CREATE INDEX idx_follow_ups_next ON follow_ups(next_followup_date) WHERE next_followup_date IS NOT NULL;
