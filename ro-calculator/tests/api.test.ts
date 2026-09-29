import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/server/app';
import { openDb } from '../src/server/db/client';
import { seedIfEmpty } from '../src/server/db/seed';
import type { DesignResult } from '../src/shared/engine';

let dir: string;
let dbFile: string;
let app: ReturnType<typeof createApp>;
let close: () => void;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rocalc-'));
  dbFile = path.join(dir, 'test.db');
  const { db, sqlite } = openDb(dbFile);
  seedIfEmpty(db);
  app = createApp(db, { staticDir: null });
  close = () => sqlite.close();
});
afterAll(() => {
  close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('database & seed', () => {
  it('creates the SQLite file with seeded libraries and the 30 m³/h sample project', async () => {
    expect(fs.existsSync(dbFile)).toBe(true);
    const lib = await request(app).get('/api/library').expect(200);
    expect(lib.body.membranes.length).toBe(5);
    expect(lib.body.pumps.length).toBeGreaterThan(20);
    expect(lib.body.pipeSizes.length).toBeGreaterThan(40);
    const list = await request(app).get('/api/projects').expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].name).toContain('30 m³/h RO System');
  });

  it('seeding twice does not duplicate data', () => {
    const { db, sqlite } = openDb(dbFile);
    expect(seedIfEmpty(db)).toEqual([]);
    sqlite.close();
  });

  it('data persists after re-opening the database file', async () => {
    const { db, sqlite } = openDb(dbFile);
    const app2 = createApp(db, { staticDir: null });
    const list = await request(app2).get('/api/projects').expect(200);
    expect(list.body.length).toBeGreaterThanOrEqual(1);
    sqlite.close();
  });
});

describe('projects: create, save, load, duplicate, export, import, delete', () => {
  let id: number;

  it('creates a blank project and a sample project', async () => {
    const blank = await request(app).post('/api/projects').send({ template: 'blank', name: 'Test blank' }).expect(201);
    expect(blank.body.name).toBe('Test blank');
    expect(blank.body.data.water.tds).toBeNull();
    const s = await request(app).post('/api/projects').send({ template: 'sample' }).expect(201);
    id = s.body.id;
    expect(s.body.data.production.dailyProductionM3d).toBe(600);
  });

  it('saves and reloads edited data', async () => {
    const p = (await request(app).get(`/api/projects/${id}`).expect(200)).body;
    p.data.project.name = 'Edited 30 m³/h';
    p.data.production.recoveryPct = 70;
    p.data.water.silica = 30;
    p.data.bomOverrides.ro_membranes = { quantity: 48 };
    await request(app).put(`/api/projects/${id}`).send({ data: p.data }).expect(200);
    const again = (await request(app).get(`/api/projects/${id}`).expect(200)).body;
    expect(again.name).toBe('Edited 30 m³/h');
    expect(again.data.production.recoveryPct).toBe(70);
    expect(again.data.water.silica).toBe(30);
    expect(again.data.bomOverrides.ro_membranes.quantity).toBe(48);
  });

  it('calculates the saved project on the server', async () => {
    const r = (await request(app).get(`/api/projects/${id}/calculate`).expect(200)).body as DesignResult;
    expect(r.summary.recoveryPct).toBe(70);
    expect(r.summary.feedM3h).toBeCloseTo(30 / 0.7, 1);
    expect(r.bom.find((b) => b.id === 'ro_membranes')!.quantity).toBe(48);
  });

  it('rejects invalid project data with 400', async () => {
    const p = (await request(app).get(`/api/projects/${id}`).expect(200)).body;
    p.data.production.recoveryPct = 'seventy';
    const res = await request(app).put(`/api/projects/${id}`).send({ data: p.data }).expect(400);
    expect(res.body.error).toMatch(/recoveryPct/);
    p.data.production.recoveryPct = 70;
    p.data.project.name = '';
    await request(app).put(`/api/projects/${id}`).send({ data: p.data }).expect(400);
    await request(app).put('/api/projects/99999').send({ data: { ...p.data, project: { ...p.data.project, name: 'x' } } }).expect(404);
    await request(app).get('/api/projects/abc').expect(400);
    await request(app).post('/api/projects/import').set('Content-Type', 'application/json').send('{bad json').expect(400);
  });

  it('duplicates, exports and imports', async () => {
    const dup = (await request(app).post(`/api/projects/${id}/duplicate`).expect(201)).body;
    expect(dup.id).not.toBe(id);
    expect(dup.name).toContain('(copy)');
    const exp = await request(app).get(`/api/projects/${id}/export`).expect(200);
    expect(exp.headers['content-disposition']).toMatch(/attachment/);
    expect(exp.body.format).toBe('ro-calculator-project');
    expect(exp.body.membrane.isDemo).toBe(true);
    const imp = (await request(app).post('/api/projects/import').send(exp.body).expect(201)).body;
    expect(imp.data.production.recoveryPct).toBe(70);
    expect(imp.data.membrane.membraneId).toBe(exp.body.project.membrane.membraneId);
    await request(app).post('/api/projects/import').send({ format: 'something else' }).expect(400);
  });

  it('imports a project saved by version 1 (missing the new fields) and calculates it', async () => {
    const exp = (await request(app).get(`/api/projects/${id}/export`).expect(200)).body;
    delete exp.project.membrane.vesselsPerStage;
    delete exp.project.hydraulics.frictionMethod;
    delete exp.project.hydraulics.pumps;
    delete exp.project.pretreatment.antiscalantDoseMgL;
    const imp = (await request(app).post('/api/projects/import').send(exp).expect(201)).body;
    expect(imp.data.hydraulics.frictionMethod).toBe('darcy');
    expect(imp.data.membrane.vesselsPerStage).toBeNull();
    const r = (await request(app).get(`/api/projects/${imp.id}/calculate`).expect(200)).body;
    expect(r.membrane.simulated).toBe(true);
  });

  it('saves a manual array, pump selection and supplier antiscalant dose', async () => {
    const p = (await request(app).get(`/api/projects/${id}`).expect(200)).body;
    const lib = (await request(app).get('/api/library').expect(200)).body;
    p.data.membrane.vesselsPerStage = [6, 3];
    p.data.hydraulics.pumps = { hp: { libraryPumpId: lib.pumps.find((x: { pumpType: string }) => x.pumpType === 'high_pressure').id, efficiencyPct: 74 } };
    p.data.hydraulics.frictionMethod = 'hazen';
    p.data.hydraulics.pipes = { hp_to_ro: { dn: 80, fittings: { elbow90: 2 } } };
    p.data.pretreatment.antiscalantDoseMgL = 2.5;
    await request(app).put(`/api/projects/${id}`).send({ data: p.data }).expect(200);
    const r = (await request(app).get(`/api/projects/${id}/calculate`).expect(200)).body;
    expect(r.membrane.vesselsPerStage).toEqual([6, 3]);
    expect(r.pipes.find((x: { id: string }) => x.id === 'hp_to_ro').dn).toBe(80);
    expect(r.pipes[0].method).toBe('hazen');
    expect(r.dosing.find((x: { id: string }) => x.id === 'antiscalant').doseStatus).toBe('supplier');
    expect(r.pumps.find((x: { id: string }) => x.id === 'hp').selectedPump).not.toBeNull();
  });

  it('deletes a project', async () => {
    const dup = (await request(app).post(`/api/projects/${id}/duplicate`).expect(201)).body;
    await request(app).delete(`/api/projects/${dup.id}`).expect(204);
    await request(app).get(`/api/projects/${dup.id}`).expect(404);
  });

  it('generates a PDF report', async () => {
    const res = await request(app)
      .get(`/api/projects/${id}/report.pdf`)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    const buf = res.body as Buffer;
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(buf.length).toBeGreaterThan(20000);
    const pages = (buf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length;
    expect(pages).toBeGreaterThanOrEqual(10);
  });
});

describe('DEMO seed data', () => {
  it('all seeded membranes and pumps are marked DEMO with a data-source note', async () => {
    const lib = (await request(app).get('/api/library').expect(200)).body;
    for (const m of lib.membranes.filter((x: { builtin: boolean }) => x.builtin)) {
      expect(m.isDemo).toBe(true);
      expect(m.dataSource).toMatch(/DEMO/);
      expect(m.model).toMatch(/^DEMO/);
    }
    for (const p of lib.pumps.filter((x: { builtin: boolean }) => x.builtin)) {
      expect(p.isDemo).toBe(true);
      expect(p.curve.length).toBeGreaterThan(3);
    }
  });
});

describe('database upgrade from version 1', () => {
  it('applies migration 0001 to a v1 database and marks old seed data as DEMO', async () => {
    const d2 = fs.mkdtempSync(path.join(os.tmpdir(), 'rocalc-v1-'));
    const mig = path.join(d2, 'mig');
    fs.mkdirSync(path.join(mig, 'meta'), { recursive: true });
    const src = path.join(__dirname, '..', 'drizzle');
    fs.copyFileSync(path.join(src, '0000_init.sql'), path.join(mig, '0000_init.sql'));
    const journal = JSON.parse(fs.readFileSync(path.join(src, 'meta', '_journal.json'), 'utf8'));
    journal.entries = journal.entries.slice(0, 1);
    fs.writeFileSync(path.join(mig, 'meta', '_journal.json'), JSON.stringify(journal));
    const file = path.join(d2, 'v1.db');
    const Database = (await import('better-sqlite3')).default;
    const { drizzle } = await import('drizzle-orm/better-sqlite3');
    const { migrate } = await import('drizzle-orm/better-sqlite3/migrator');
    const raw = new Database(file);
    migrate(drizzle(raw), { migrationsFolder: mig });
    raw.prepare("INSERT INTO membranes (manufacturer, model, membrane_type, active_area_m2, nominal_flow_m3d, salt_rejection_pct, max_pressure_bar, test_pressure_bar, test_tds_mg_l, test_recovery_pct, builtin) VALUES ('Old','Old-8040','BWRO',37,40,99.5,41,15.5,2000,15,1)").run();
    raw.prepare("INSERT INTO pumps (pump_type, manufacturer, model, rated_flow_m3h, rated_head_m, min_flow_m3h, max_flow_m3h, shutoff_head_m, motor_kw, efficiency_pct, builtin) VALUES ('feed','Generic','EN-1',10,35,3,13,45,2.2,62,1)").run();
    raw.close();
    const { db, sqlite } = openDb(file);
    seedIfEmpty(db, { sampleProject: false });
    const lib = (await request(createApp(db, { staticDir: null })).get('/api/library').expect(200)).body;
    const old = lib.membranes.find((m: { model: string }) => m.model === 'Old-8040');
    expect(old.isDemo).toBe(true);
    expect(old.dataSource).toMatch(/NOT verified/);
    const pump = lib.pumps.find((p: { model: string }) => p.model === 'EN-1');
    expect(pump.isDemo).toBe(true);
    expect(pump.curve.length).toBeGreaterThan(3);
    sqlite.close();
    fs.rmSync(d2, { recursive: true, force: true });
  });
});

describe('libraries', () => {
  it('membrane CRUD with validation and in-use protection', async () => {
    const m = { manufacturer: 'Test', model: 'T-8040', membraneType: 'BWRO', diameterIn: 8, activeAreaM2: 37, nominalFlowM3d: 40, saltRejectionPct: 99.5, maxPressureBar: 41, maxTempC: 45, phMin: 2, phMax: 11, testPressureBar: 15.5, testTdsMgL: 2000, testRecoveryPct: 15, maxFeedFlowM3h: null, recFluxMaxLmh: 28, dataSource: 'Datasheet rev. A', notes: '' };
    const c = (await request(app).post('/api/membranes').send(m).expect(201)).body;
    expect(c.isDemo).toBe(false);
    expect(c.recFluxMaxLmh).toBe(28);
    await request(app).put(`/api/membranes/${c.id}`).send({ ...m, nominalFlowM3d: 42 }).expect(200);
    await request(app).post('/api/membranes').send({ ...m, model: '' }).expect(400);
    await request(app).delete(`/api/membranes/${c.id}`).expect(204);
    const bw = (await request(app).get('/api/membranes').expect(200)).body[0];
    const sampleProj = (await request(app).get('/api/projects/1').expect(200)).body;
    expect(bw.id).toBeDefined();
    const usedId = sampleProj.data.membrane.membraneId;
    await request(app).delete(`/api/membranes/${usedId}`).expect(409);
  });

  it('pump CRUD with manufacturer curve and validation', async () => {
    const curve = [{ flowM3h: 0, headM: 150, efficiencyPct: 0, npshrM: 1 }, { flowM3h: 10, headM: 120, efficiencyPct: 70, npshrM: 2.5 }, { flowM3h: 13, headM: 100, efficiencyPct: 66, npshrM: 3.5 }];
    const p = { pumpType: 'high_pressure', manufacturer: 'X', model: 'HP-1', ratedFlowM3h: 10, ratedHeadM: 120, minFlowM3h: 3, maxFlowM3h: 13, shutoffHeadM: 150, motorKw: 7.5, efficiencyPct: 70, notes: '', curve };
    const c = (await request(app).post('/api/pumps').send(p).expect(201)).body;
    expect(c.curve).toHaveLength(3);
    expect(c.isDemo).toBe(false);
    await request(app).post('/api/pumps').send({ ...p, curve: [curve[1], curve[0]] }).expect(400);
    await request(app).post('/api/pumps').send({ ...p, shutoffHeadM: 50 }).expect(400);
    await request(app).delete(`/api/pumps/${c.id}`).expect(204);
  });

  it('pipe catalogue add / duplicate protection / delete', async () => {
    const s = { material: 'PVC-U PN16', dn: 999, outerDiameterMm: 1000, wallMm: 20, innerDiameterMm: 960, pressureRatingBar: 10 };
    const c = (await request(app).post('/api/pipe-sizes').send(s).expect(201)).body;
    await request(app).post('/api/pipe-sizes').send(s).expect(409);
    await request(app).post('/api/pipe-sizes').send({ ...s, material: 'Unknown' }).expect(400);
    await request(app).delete(`/api/pipe-sizes/${c.id}`).expect(204);
  });

  it('settings round-trip', async () => {
    const s = (await request(app).get('/api/settings').expect(200)).body;
    s.assumptions.hp_pump_eff = 72;
    s.units.pressure = 'psi';
    const saved = (await request(app).put('/api/settings').send(s).expect(200)).body;
    expect(saved.assumptions.hp_pump_eff).toBe(72);
    expect(saved.units.pressure).toBe('psi');
    // new projects pick up the global assumptions
    const p = (await request(app).post('/api/projects').send({ template: 'blank' }).expect(201)).body;
    expect(p.data.assumptions.hp_pump_eff).toBe(72);
  });
});
