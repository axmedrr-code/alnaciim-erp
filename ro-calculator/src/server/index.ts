import 'dotenv/config';
import { createApp } from './app';
import { openDb } from './db/client';
import { seedIfEmpty } from './db/seed';

const PORT = Number(process.env.PORT || 3000);
// Bind to the local machine only by default – the application is local/offline by design.
const HOST = process.env.HOST || '127.0.0.1';

const { db, file } = openDb();
const seeded = seedIfEmpty(db, { sampleProject: process.env.SEED_SAMPLE !== 'false' });
console.log(`[db] ${file}`);
if (seeded.length) console.log(`[db] seeded: ${seeded.join(', ')}`);

const app = createApp(db);
app.listen(PORT, HOST, () => {
  console.log(`\n  RO System Engineering Calculator running at http://localhost:${PORT}\n`);
});
