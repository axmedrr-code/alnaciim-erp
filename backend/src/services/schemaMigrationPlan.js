const MIGRATION_NAME = /^(\d+)_([a-z0-9_-]+)\.sql$/i;

function discoverMigrations(fileNames) {
  const rows = fileNames.map((name) => {
    const match = MIGRATION_NAME.exec(name);
    return match ? { version: Number(match[1]), name } : null;
  }).filter(Boolean).sort((a, b) => a.version - b.version);
  const seen = new Set();
  for (const row of rows) {
    if (seen.has(row.version)) throw new Error(`Duplicate migration version ${row.version}`);
    seen.add(row.version);
  }
  return rows;
}

function pendingMigrations(migrations, appliedNames) {
  if (!migrations.length) throw new Error('No numbered SQL migrations were found');
  if (!Array.isArray(appliedNames)) throw new Error('Migration history must be an explicit list of applied file names');
  const known = new Set(migrations.map((migration) => migration.name));
  for (const name of appliedNames) {
    if (!known.has(name)) throw new Error(`Applied migration ${name} is not present in this repository`);
  }
  const applied = new Set(appliedNames);
  let foundPending = false;
  const pending = [];
  for (const migration of migrations) {
    if (applied.has(migration.name)) {
      if (foundPending) throw new Error(`Migration history is not a contiguous repository prefix at ${migration.name}`);
    } else {
      foundPending = true;
      pending.push(migration);
    }
  }
  return pending;
}

function assertEmptyBootstrapTarget({ relations, trackingExists, appliedCount, trackerHasName }) {
  if (!Array.isArray(relations)) throw new Error('Database relation inventory is required');
  if (relations.length) throw new Error('Database is not empty; refusing schema bootstrap');
  if (Number(appliedCount || 0) > 0) throw new Error('Migration history already exists; refusing schema bootstrap');
  if (trackingExists && !trackerHasName) throw new Error('Migration tracker format is unsupported');
  return true;
}

function assertInitializedSchema(relations) {
  if (!Array.isArray(relations) || !relations.length)
    throw new Error('No initialized ERP schema was found; incremental migration is not allowed');
  return true;
}

function stripStandaloneTransactionCommands(sql, { all = false } = {}) {
  const lines = sql.split(/\r?\n/);
  const executable = lines.map((line, index) => ({ line: line.trim(), index }))
    .filter(({ line }) => line && !line.startsWith('--'));
  const remove = new Set();
  if (all) {
    for (const { line, index } of executable) if (/^(BEGIN|COMMIT|ROLLBACK);?$/i.test(line)) remove.add(index);
  } else {
    const first = executable[0];
    const last = executable[executable.length - 1];
    if (first && /^BEGIN;?$/i.test(first.line)) remove.add(first.index);
    if (last && /^(COMMIT|ROLLBACK);?$/i.test(last.line)) remove.add(last.index);
  }
  return lines.filter((_, index) => !remove.has(index)).join('\n');
}

module.exports = { discoverMigrations, pendingMigrations, assertEmptyBootstrapTarget, assertInitializedSchema, stripStandaloneTransactionCommands };
