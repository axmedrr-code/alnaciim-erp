-- =====================================================================
-- FULL DOUBLE-ENTRY ACCOUNTING SYSTEM
--
-- Replaces the "Finance (light)" expenses-only tracking with a real
-- Chart of Accounts + Journal Entries ledger. Every money-moving event
-- elsewhere in the ERP (cash/credit sale, payment received, goods
-- received, supplier payment, expense) posts a balanced journal entry
-- in the SAME transaction as the business event, so books never drift
-- out of sync with operations. Manual entries (Journal Entries, Cash
-- Receipt, Cash Payment screens) use the identical posting path.
-- =====================================================================

CREATE TABLE chart_of_accounts (
    id             SERIAL PRIMARY KEY,
    code           VARCHAR(20) UNIQUE NOT NULL,
    name           VARCHAR(150) NOT NULL,
    account_type   VARCHAR(20) NOT NULL CHECK (account_type IN ('asset','liability','equity','revenue','expense')),
    parent_id      INT REFERENCES chart_of_accounts(id),
    is_system      BOOLEAN NOT NULL DEFAULT false, -- protected accounts the auto-posting logic depends on; cannot be deleted
    is_active      BOOLEAN NOT NULL DEFAULT true,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_coa_type ON chart_of_accounts(account_type);

CREATE TABLE fiscal_years (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(50) UNIQUE NOT NULL,
    start_date  DATE NOT NULL,
    end_date    DATE NOT NULL,
    status      VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
    closed_by   INT REFERENCES users(id),
    closed_at   TIMESTAMPTZ
);

CREATE TABLE bank_accounts (
    id               SERIAL PRIMARY KEY,
    name             VARCHAR(100) NOT NULL,
    bank_name        VARCHAR(100),
    account_number   VARCHAR(60),
    coa_account_id   INT NOT NULL UNIQUE REFERENCES chart_of_accounts(id), -- each bank account is backed by its own asset GL account
    opening_balance  NUMERIC(14,2) NOT NULL DEFAULT 0,
    is_active        BOOLEAN NOT NULL DEFAULT true,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE je_sequences (
    id          SERIAL PRIMARY KEY,
    next_value  BIGINT NOT NULL DEFAULT 1
);
INSERT INTO je_sequences (next_value) VALUES (1);

CREATE TABLE journal_entries (
    id              SERIAL PRIMARY KEY,
    entry_number    VARCHAR(30) UNIQUE NOT NULL,
    entry_date      DATE NOT NULL DEFAULT CURRENT_DATE,
    description     TEXT,
    source          VARCHAR(20) NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','system')),
    reference_type  VARCHAR(30), -- 'sales_order','payment','purchase_order','supplier_payment','expense','cash_receipt','cash_payment','closing', etc.
    reference_id    INT,
    status          VARCHAR(20) NOT NULL DEFAULT 'posted' CHECK (status IN ('posted','void')),
    created_by      INT NOT NULL REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_journal_entries_date ON journal_entries(entry_date);
CREATE INDEX idx_journal_entries_reference ON journal_entries(reference_type, reference_id);

CREATE TABLE journal_lines (
    id                 BIGSERIAL PRIMARY KEY,
    journal_entry_id   INT NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
    account_id         INT NOT NULL REFERENCES chart_of_accounts(id),
    debit              NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
    credit             NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
    description        TEXT,
    customer_id        INT REFERENCES customers(id),   -- populated on AR lines, for the AR subledger
    supplier_id        INT REFERENCES suppliers(id),   -- populated on AP lines, for the AP subledger
    CHECK ((debit = 0 AND credit > 0) OR (debit > 0 AND credit = 0))
);

CREATE INDEX idx_journal_lines_entry ON journal_lines(journal_entry_id);
CREATE INDEX idx_journal_lines_account ON journal_lines(account_id);
CREATE INDEX idx_journal_lines_customer ON journal_lines(customer_id);
CREATE INDEX idx_journal_lines_supplier ON journal_lines(supplier_id);

CREATE TABLE budgets (
    id             SERIAL PRIMARY KEY,
    account_id     INT NOT NULL REFERENCES chart_of_accounts(id),
    fiscal_year_id INT NOT NULL REFERENCES fiscal_years(id),
    period_month   INT NOT NULL CHECK (period_month BETWEEN 1 AND 12),
    budgeted_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
    UNIQUE (account_id, fiscal_year_id, period_month)
);

-- Accounts Payable subledger needs a supplier-side "payment against a PO" table,
-- mirroring the customer-side `payments` table that already exists for AR.
CREATE TABLE supplier_payments (
    id                SERIAL PRIMARY KEY,
    purchase_order_id INT NOT NULL REFERENCES purchase_orders(id),
    amount            NUMERIC(12,2) NOT NULL,
    payment_date      DATE NOT NULL DEFAULT CURRENT_DATE,
    method            VARCHAR(20) NOT NULL CHECK (method IN ('cash','bank_transfer','cheque')),
    bank_account_id   INT REFERENCES bank_accounts(id),
    reference_number  VARCHAR(60),
    recorded_by       INT NOT NULL REFERENCES users(id),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_supplier_payments_po ON supplier_payments(purchase_order_id);

-- Payments (AR) and expenses need a bank_account_id so non-cash postings hit the
-- correct GL asset account instead of a generic "Cash" account.
ALTER TABLE payments ADD COLUMN bank_account_id INT REFERENCES bank_accounts(id);
ALTER TABLE expenses ADD COLUMN payment_method VARCHAR(20) NOT NULL DEFAULT 'cash' CHECK (payment_method IN ('cash','bank_transfer','cheque'));
ALTER TABLE expenses ADD COLUMN bank_account_id INT REFERENCES bank_accounts(id);

-- Each expense category maps to a specific GL expense account so expense postings
-- know which account to debit.
ALTER TABLE expense_categories ADD COLUMN coa_account_id INT REFERENCES chart_of_accounts(id);
