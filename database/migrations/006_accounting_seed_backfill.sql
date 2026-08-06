-- =====================================================================
-- ACCOUNTING SEED DATA + HISTORICAL BACKFILL
--
-- Run once, immediately after migrations/005_accounting_system.sql, on
-- ANY database (fresh or already carrying operational history). Seeds a
-- default Chart of Accounts, one bank account, and maps expense
-- categories to their GL account — then walks every sales order,
-- payment, expense, and received purchase order that already exists and
-- posts the balanced journal entry it should have produced, so the
-- ledger ties out with everything the business already did instead of
-- starting the books empty on cutover day.
-- =====================================================================

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

-- ---------------------------------------------------------------------
-- HISTORICAL BACKFILL — one balanced journal entry per pre-existing
-- business event, dated on the event's original date so period reports
-- (P&L, trial balance) reflect when the money actually moved.
-- ---------------------------------------------------------------------
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
  -- Sales orders: cash sales post one Dr Cash / Cr Revenue(+Fee) entry;
  -- credit sales post Dr AR (tagged to the customer) / Cr Revenue(+Fee).
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

  -- Payments received against CREDIT sales only — a cash sale's payment is
  -- already fully represented by the single entry posted above, so posting
  -- it again here would double-count the revenue.
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

  -- Expenses: Dr the mapped expense account, Cr Cash/Bank.
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

  -- Received purchase orders: Dr Inventory (split by the received product's
  -- category type), Cr Accounts Payable tagged to the supplier. Damaged
  -- units never entered stock, so they're excluded from the value received.
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

    -- One journal entry per (PO, product_type) group keeps this loop simple
    -- and each entry trivially balanced (exactly one debit, one credit).
    UPDATE je_sequences SET next_value = next_value + 1 RETURNING next_value - 1 INTO v_num;
    INSERT INTO journal_entries (entry_number, entry_date, description, source, reference_type, reference_id, created_by)
    VALUES ('JE-' || lpad(v_num::text, 6, '0'), r.order_date, 'Backfill: goods received - ' || r.po_number, 'system', 'purchase_order', r.po_id, COALESCE(r.created_by, fallback_user))
    RETURNING id INTO entry_id;

    INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit) VALUES (entry_id, inv_acct, r.val, 0);
    INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, supplier_id) VALUES (entry_id, ap_acct, 0, r.val, r.supplier_id);
  END LOOP;
END $$;
