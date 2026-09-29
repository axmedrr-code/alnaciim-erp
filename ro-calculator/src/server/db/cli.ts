import 'dotenv/config';
import fs from 'node:fs';
import { openDb, resolveDbPath } from './client';
import { seedIfEmpty } from './seed';

const cmd = process.argv[2];
if (cmd === 'reset') {
  const file = resolveDbPath();
  for (const f of [file, `${file}-wal`, `${file}-shm`]) if (fs.existsSync(f)) fs.rmSync(f);
  console.log(`Deleted ${file}`);
}
const { file, sqlite, db } = openDb();
console.log(`Database: ${file} (migrations applied)`);
if (cmd === 'seed' || cmd === 'reset') {
  const r = seedIfEmpty(db);
  console.log(r.length ? `Seeded: ${r.join(', ')}` : 'Nothing to seed – tables already contain data.');
}
sqlite.close();
