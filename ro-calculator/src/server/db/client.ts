import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from './schema';

export type Db = BetterSQLite3Database<typeof schema>;

const here = path.dirname(fileURLToPath(import.meta.url));
/** Project root (…/ro-calculator) */
export const ROOT = path.resolve(here, '../../..');
export const MIGRATIONS_DIR = path.join(ROOT, 'drizzle');

export function resolveDbPath(p?: string) {
  const target = p || process.env.DATABASE_PATH || './data/ro-calculator.db';
  return target === ':memory:' ? target : path.resolve(ROOT, target);
}

/** Open (or create) the local SQLite database file and apply pending migrations. */
export function openDb(dbPath?: string): { db: Db; sqlite: Database.Database; file: string } {
  const file = resolveDbPath(dbPath);
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return { db, sqlite, file };
}
