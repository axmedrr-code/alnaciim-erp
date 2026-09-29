import { eq, sql } from 'drizzle-orm';
import { defaultAssumptions } from '../../shared/assumptions';
import { SEED_MEMBRANES, SEED_PIPE_MATERIALS, SEED_PUMPS, seedPipeSizes } from '../../shared/catalog';
import { sample30m3h } from '../../shared/sample';
import { DEFAULT_UNITS } from '../../shared/units';
import type { Db } from './client';
import { membranes, pipeMaterials, pipeSizes, projects, pumps, settings } from './schema';

function count(db: Db, table: typeof membranes | typeof pumps | typeof pipeMaterials | typeof pipeSizes | typeof projects | typeof settings) {
  return db.select({ n: sql<number>`count(*)` }).from(table).get()?.n ?? 0;
}

/** Insert library data, default settings and the 30 m³/h sample project when the tables are empty. */
export function seedIfEmpty(db: Db, opts: { sampleProject?: boolean } = {}) {
  const now = new Date().toISOString();
  const report: string[] = [];
  db.transaction((tx) => {
    const t = tx as unknown as Db;
    if (count(t, membranes) === 0) {
      for (const m of SEED_MEMBRANES) t.insert(membranes).values({ ...m, builtin: true }).run();
      report.push(`${SEED_MEMBRANES.length} membranes`);
    }
    if (count(t, pumps) === 0) {
      for (const p of SEED_PUMPS) t.insert(pumps).values({ ...p, builtin: true }).run();
      report.push(`${SEED_PUMPS.length} pumps`);
    }
    if (count(t, pipeMaterials) === 0) {
      for (const m of SEED_PIPE_MATERIALS) t.insert(pipeMaterials).values(m).run();
      report.push(`${SEED_PIPE_MATERIALS.length} pipe materials`);
    }
    if (count(t, pipeSizes) === 0) {
      const sizes = seedPipeSizes();
      for (const s of sizes) t.insert(pipeSizes).values(s).run();
      report.push(`${sizes.length} pipe sizes`);
    }
    const defaults: Record<string, unknown> = {
      assumptions: defaultAssumptions(),
      units: DEFAULT_UNITS,
      company: { name: 'Your Engineering Company', address: '', phone: '', email: '' },
    };
    for (const [key, value] of Object.entries(defaults)) {
      if (!t.select().from(settings).where(eq(settings.key, key)).get()) {
        t.insert(settings).values({ key, value: JSON.stringify(value) }).run();
        report.push(`setting ${key}`);
      }
    }
    if (opts.sampleProject !== false && count(t, projects) === 0) {
      const bw = t.select().from(membranes).where(eq(membranes.model, 'BW30-400')).get();
      const d = sample30m3h(defaultAssumptions(), bw?.id ?? null);
      t.insert(projects).values({ name: d.project.name, customer: d.project.customer, location: d.project.location, reference: d.project.reference, data: JSON.stringify(d), createdAt: now, updatedAt: now }).run();
      report.push('sample project "30 m³/h RO System"');
    }
  });
  return report;
}
