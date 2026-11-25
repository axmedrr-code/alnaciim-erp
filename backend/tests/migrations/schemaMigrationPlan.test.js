const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { discoverMigrations, pendingMigrations, assertEmptyBootstrapTarget, assertInitializedSchema, stripStandaloneTransactionCommands } = require('../../src/services/schemaMigrationPlan');

test('migration files are numbered, sorted, and reject duplicate versions', () => {
  const rows = discoverMigrations(['034_last.sql', 'README.md', '032_middle.sql', '033_next.sql']);
  assert.deepEqual(rows.map((r) => r.version), [32, 33, 34]);
  assert.throws(() => discoverMigrations(['034_first.sql', '034_duplicate.sql']), /Duplicate migration version/);
});

test('repository migration sequence includes accounting integrity guards', () => {
  const rows = discoverMigrations(['033_logistics.sql', '034_exceptions.sql', '035_unique_journal_reversal.sql', '036_chart_of_accounts_integrity.sql']);
  assert.deepEqual(rows.map((r) => r.version), [33, 34, 35, 36]);
  assert.equal(rows.at(-1).name, '036_chart_of_accounts_integrity.sql');
});

test('journal reversal guard is present in migration and fresh bootstrap schema', () => {
  const migration = fs.readFileSync(path.join(__dirname, '../../../database/migrations/035_unique_journal_reversal.sql'), 'utf8');
  const schema = fs.readFileSync(path.join(__dirname, '../../../database/schema.sql'), 'utf8');
  assert.match(migration, /GROUP BY reverses_entry_id[\s\S]*HAVING COUNT\(\*\) > 1/);
  assert.match(migration, /CREATE UNIQUE INDEX uq_journal_entries_single_reversal/);
  assert.match(migration, /WHERE reverses_entry_id IS NOT NULL/);
  assert.match(schema, /CREATE UNIQUE INDEX uq_journal_entries_single_reversal/);
});

test('chart-of-accounts constraints exist in migration and fresh bootstrap schema', () => {
  const migration = fs.readFileSync(path.join(__dirname, '../../../database/migrations/036_chart_of_accounts_integrity.sql'), 'utf8');
  const schema = fs.readFileSync(path.join(__dirname, '../../../database/schema.sql'), 'utf8');
  for (const sql of [migration, schema]) {
    assert.match(sql, /CREATE TRIGGER trg_chart_account_parent_cycle/);
    assert.match(sql, /CREATE TRIGGER trg_protect_system_account_active/);
    assert.match(sql, /pg_advisory_xact_lock\(704301, 36\)/);
  }
});

test('pending migrations use the repository filename tracker and require a contiguous history', () => {
  const rows = discoverMigrations(['030_a.sql', '031_b.sql', '032_c.sql', '034_d.sql']);
  assert.deepEqual(pendingMigrations(rows, ['030_a.sql', '031_b.sql']).map((r) => r.name), ['032_c.sql', '034_d.sql']);
  assert.throws(() => pendingMigrations(rows, ['034_d.sql']), /not a contiguous repository prefix/);
  assert.throws(() => pendingMigrations(rows, ['099_unknown.sql']), /not present in this repository/);
  assert.throws(() => pendingMigrations(rows, null), /explicit list/);
});

test('fresh bootstrap refuses non-empty schemas or existing/unsupported history', () => {
  assert.equal(assertEmptyBootstrapTarget({ relations: [], trackingExists: false, appliedCount: 0, trackerHasName: false }), true);
  assert.throws(() => assertEmptyBootstrapTarget({ relations: [{ relname: 'customers' }], trackingExists: false, appliedCount: 0, trackerHasName: false }), /not empty/);
  assert.throws(() => assertEmptyBootstrapTarget({ relations: [], trackingExists: true, appliedCount: 1, trackerHasName: true }), /history already exists/);
  assert.throws(() => assertEmptyBootstrapTarget({ relations: [], trackingExists: true, appliedCount: 0, trackerHasName: false }), /format is unsupported/);
  assert.throws(() => assertInitializedSchema([]), /No initialized ERP schema/);
  assert.equal(assertInitializedSchema([{ relname: 'customers' }]), true);
});

test('all standalone transaction markers can be removed for an atomic schema snapshot', () => {
  const sql = '-- initial comment\nBEGIN;\nCREATE TABLE x(id INT);\nCOMMIT;\nSELECT 1;';
  assert.equal(stripStandaloneTransactionCommands(sql, { all: true }), '-- initial comment\nCREATE TABLE x(id INT);\nSELECT 1;');
});

test('migration wrappers strip only an outer begin and commit, preserving inner blocks', () => {
  const sql = '-- header\nBEGIN;\nDO $$\nBEGIN\n  PERFORM 1;\nEND $$;\nCOMMIT;\n';
  const normalized = stripStandaloneTransactionCommands(sql);
  assert.match(normalized, /DO \$\$\nBEGIN\n/);
  assert.doesNotMatch(normalized, /^BEGIN;$/m);
  assert.doesNotMatch(normalized, /^COMMIT;$/m);
});

test('every repository migration has a safely normalizable outer transaction wrapper', () => {
  const migrationDir = path.join(__dirname, '../../../database/migrations');
  const files = fs.readdirSync(migrationDir).filter((name) => /^\d+_[a-z0-9_-]+\.sql$/i.test(name));
  assert.equal(files.length, 35);
  for (const name of files) {
    const sql = fs.readFileSync(path.join(migrationDir, name), 'utf8');
    const executable = sql.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('--'));
    const hasOuterBegin = /^BEGIN;?$/i.test(executable[0] || '');
    const hasOuterEnd = /^(COMMIT|ROLLBACK);?$/i.test(executable.at(-1) || '');
    assert.equal(hasOuterBegin, hasOuterEnd, `${name} must not have an unmatched outer transaction marker`);
    const normalized = stripStandaloneTransactionCommands(sql);
    if (hasOuterBegin) {
      assert.notEqual(normalized, sql, `${name} outer transaction wrapper should be stripped by the migration runner`);
      assert.doesNotMatch(normalized, /^BEGIN;?\s*$/im);
    }
  }
});
