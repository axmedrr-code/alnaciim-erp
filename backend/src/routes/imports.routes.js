// Bulk Customer Import — this ERP's customer registration is HNO-based: HNO
// is the one permanent, unique identifier a customer is looked up by
// everywhere (POS included), matching the predecessor system's account
// numbering.
//
// QuickBooks-Desktop-style behavior: one upload does the whole import in one
// pass. Every row that's individually valid gets written — a bad row never
// blocks or rolls back the good ones around it, because with a 26,000-row
// legacy file, thousands of imperfect rows are expected and the operator
// needs the clean 24,000 in today, not after a full data-cleanup pass. Each
// row is written with its own statement (not one all-or-nothing
// transaction), and every row that couldn't be written is collected into an
// error report the operator downloads and fixes separately.
//
// Uses the `xlsx` (SheetJS) npm package to parse both .xlsx and .csv. Note:
// that package has known unfixed advisories (prototype pollution / ReDoS —
// GHSA-4r6h-8v6p-xvw6, GHSA-5pgg-2g8v-p4x9). This endpoint is gated to
// Admin/Sales Manager only, matching every other write-path in this ERP.
const { Router } = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const { pool } = require('../config/db');
const { asyncHandler, ApiError } = require('../utils/asyncHandler');
const { requireRole } = require('../middleware/auth');
const { logAudit } = require('../services/auditService');

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// Exact column order the template ships with and the import expects.
const TEMPLATE_COLUMNS = ['HNO', 'Name', 'Customer Phone', 'Guarantor Name', 'Tel', 'Status'];
const VALID_STATUSES = ['active', 'inactive', 'suspended', 'closed'];
const ERROR_REPORT_COLUMNS = ['Excel Row Number', 'HNO', 'Customer Name', 'Error Reason', 'Suggested Fix'];

// Header matching is case/whitespace-tolerant — "hno", " HNO ", "Hno" all
// resolve to the same field, since real-world spreadsheets are never
// perfectly consistent.
function normalizeHeader(h) {
  return String(h || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

const FIELD_MAP = {
  'hno': 'hno', 'name': 'name', 'customer phone': 'customer_phone',
  'guarantor name': 'guarantor_name', 'tel': 'guarantor_phone', 'status': 'status'
};

// HNO is a plain tank number (7739) — never stored or matched with a
// thousands separator. Excel renders a numeric-formatted HNO cell with its
// display grouping (e.g. "14,054"), so every comma and stray space is
// stripped right here, at the only place HNO ever enters the system.
function normalizeHno(value) {
  return String(value == null ? '' : value).replace(/[,\s]/g, '');
}

function parseWorkbook(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) throw new ApiError(400, 'The uploaded file has no readable sheet');
  const raw = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
  return raw.map((row, i) => {
    const mapped = { _row: i + 2 }; // +2: header row + 1-based
    for (const [key, value] of Object.entries(row)) {
      const field = FIELD_MAP[normalizeHeader(key)];
      if (field) mapped[field] = typeof value === 'string' ? value.trim() : value;
    }
    if (mapped.hno !== undefined) mapped.hno = normalizeHno(mapped.hno);
    return mapped;
  });
}

// Status never fails the import — blank or unrecognized text both fall back
// to Active, since that's the correct default for legacy rows either way.
function normalizeStatus(value) {
  const s = String(value || '').trim().toLowerCase();
  return VALID_STATUSES.includes(s) ? s : 'active';
}

// Only two things can ever skip a row: missing HNO, or missing Name. Phone
// numbers are never validated strictly enough to reject a row — bad or
// missing phone data just gets stored as-is or blank.
function validateRow(row) {
  if (!row.hno) return { reason: 'Missing HNO', fix: 'Enter a unique HNO value for this row' };
  if (!row.name) return { reason: 'Empty customer name', fix: 'Enter the customer\'s name for this row' };
  return null;
}

function errorRow(row, reason, fix) {
  return { row: row._row, hno: row.hno || null, name: row.name || null, reason, fix };
}

// One-shot import: parse, validate, and write in the same request. HNO is the
// permanent physical tank number stamped on the drum — set once, at INSERT,
// from the file's own value, and NEVER auto-generated or reassigned
// afterward. A row whose HNO already exists is not an error: it's an update
// to that customer's Name/Phone/Guarantor/Status, exactly like re-registering
// the same drum with corrected details. Two rows in the same file sharing an
// HNO behave the same way — the first inserts, the second updates the row
// just inserted — so no separate in-file duplicate tracking is needed. A bad
// row never blocks or rolls back the good ones around it.
router.post('/customers/import', requireRole('Admin', 'Sales Manager'), upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) throw new ApiError(400, 'No file uploaded');
  const rows = parseWorkbook(req.file.buffer);
  if (!rows.length) throw new ApiError(400, 'The file has no data rows');

  const errors = [];
  const candidates = [];

  for (const row of rows) {
    const invalid = validateRow(row);
    if (invalid) { errors.push(errorRow(row, invalid.reason, invalid.fix)); continue; }
    candidates.push(row);
  }

  let imported = 0, updated = 0;

  // Each row is its own statement/round-trip (no shared transaction) so a
  // failure on one row — a stray DB constraint, a bad value — can't roll back
  // every good row already written before it.
  for (const row of candidates) {
    const status = normalizeStatus(row.status);
    try {
      const { rows: existingRows } = await pool.query(`SELECT id FROM customers WHERE hno = $1`, [row.hno]);
      const existing = existingRows[0];

      if (existing) {
        // HNO itself is never part of this UPDATE's SET list — it cannot change.
        await pool.query(
          `UPDATE customers SET name = $1, phone = $2, guarantor_name = $3, guarantor_phone = $4, status = $5 WHERE id = $6`,
          [row.name, row.customer_phone || null, row.guarantor_name || null, row.guarantor_phone || null, status, existing.id]
        );
        updated++;
        continue;
      }

      const { rows: newCust } = await pool.query(
        `INSERT INTO customers (code, hno, name, type, phone, guarantor_name, guarantor_phone, status)
         VALUES ($1,$2,$3,'retail',$4,$5,$6,$7) RETURNING id`,
        [row.hno, row.hno, row.name, row.customer_phone || null, row.guarantor_name || null, row.guarantor_phone || null, status]
      );
      const customerId = newCust[0].id;
      await pool.query(`UPDATE customers SET code = $1 WHERE id = $2`, [`CUST-${String(customerId).padStart(4, '0')}`, customerId]);
      imported++;
    } catch (err) {
      errors.push(errorRow(row, 'Database error', err.message));
    }
  }

  await logAudit(pool, {
    userId: req.user.id, action: 'CREATE', entityType: 'bulk_import', entityId: null,
    newValue: { total: rows.length, imported, updated, errors: errors.length }
  });

  res.status(201).json({
    data: {
      total: rows.length, imported, updated, skipped: errors.length,
      errors_count: errors.length,
      errors
    },
    error: null
  });
}));

// Error Report download — takes back exactly the error rows the import
// response returned (nothing is persisted server-side) and renders them as an
// .xlsx the operator can filter/fix and re-import.
router.post('/customers/error-report', requireRole('Admin', 'Sales Manager'), asyncHandler(async (req, res) => {
  const { errors } = req.body;
  if (!Array.isArray(errors)) throw new ApiError(400, 'errors is required');

  const aoa = [ERROR_REPORT_COLUMNS, ...errors.map((e) => [e.row, e.hno || '', e.name || '', e.reason, e.fix || ''])];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Import Errors');
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="customer-import-errors.xlsx"');
  res.send(buffer);
}));

// Downloadable starter template — header row + one worked example, matching
// exactly the columns this endpoint parses.
router.get('/customers/template', requireRole('Admin', 'Sales Manager'), asyncHandler(async (req, res) => {
  const example = ['HNO-1001', 'Jane Customer', '+252-61-2345678', '', '', 'Active'];
  const ws = XLSX.utils.aoa_to_sheet([TEMPLATE_COLUMNS, example]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Customers');
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="customer-import-template.xlsx"');
  res.send(buffer);
}));

module.exports = router;
