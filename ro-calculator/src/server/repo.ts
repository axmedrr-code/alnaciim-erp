import { and, asc, desc, eq } from 'drizzle-orm';
import { mergeAssumptions, type Assumptions } from '../shared/assumptions';
import { normalizeDesign } from '../shared/sample';
import type { DesignContext, DesignInput, MembraneSpec, PipeMaterial, PipeSize, PumpSpec } from '../shared/types';
import { DEFAULT_UNITS, type DisplayUnits } from '../shared/units';
import type { Db } from './db/client';
import { membranes, pipeMaterials, pipeSizes, projects, pumps, settings } from './db/schema';

export interface ProjectRow {
  id: number;
  name: string;
  customer: string;
  location: string;
  reference: string;
  createdAt: string;
  updatedAt: string;
}

export interface CompanyInfo {
  name: string;
  address: string;
  phone: string;
  email: string;
}

export class Repo {
  constructor(readonly db: Db) {}

  // ---------------------------------------------------------------- projects
  listProjects(): ProjectRow[] {
    return this.db
      .select({ id: projects.id, name: projects.name, customer: projects.customer, location: projects.location, reference: projects.reference, createdAt: projects.createdAt, updatedAt: projects.updatedAt })
      .from(projects)
      .orderBy(desc(projects.updatedAt))
      .all();
  }

  getProject(id: number): (ProjectRow & { data: DesignInput }) | null {
    const r = this.db.select().from(projects).where(eq(projects.id, id)).get();
    if (!r) return null;
    const data = normalizeDesign(JSON.parse(r.data) as DesignInput);
    data.assumptions = mergeAssumptions(data.assumptions);
    return { ...r, data };
  }

  createProject(data: DesignInput) {
    const now = new Date().toISOString();
    const r = this.db
      .insert(projects)
      .values({ name: data.project.name, customer: data.project.customer, location: data.project.location, reference: data.project.reference, data: JSON.stringify(data), createdAt: now, updatedAt: now })
      .returning({ id: projects.id })
      .get();
    return this.getProject(r.id)!;
  }

  updateProject(id: number, data: DesignInput) {
    const now = new Date().toISOString();
    const res = this.db
      .update(projects)
      .set({ name: data.project.name, customer: data.project.customer, location: data.project.location, reference: data.project.reference, data: JSON.stringify(data), updatedAt: now })
      .where(eq(projects.id, id))
      .run();
    return res.changes > 0 ? this.getProject(id) : null;
  }

  deleteProject(id: number) {
    return this.db.delete(projects).where(eq(projects.id, id)).run().changes > 0;
  }

  duplicateProject(id: number) {
    const p = this.getProject(id);
    if (!p) return null;
    const data = structuredClone(p.data);
    data.project.name = `${data.project.name} (copy)`;
    return this.createProject(data);
  }

  // ---------------------------------------------------------------- membranes
  listMembranes(): (MembraneSpec & { builtin: boolean })[] {
    return this.db.select().from(membranes).orderBy(asc(membranes.manufacturer), asc(membranes.model)).all();
  }
  getMembrane(id: number | null | undefined): MembraneSpec | null {
    if (id == null) return null;
    return this.db.select().from(membranes).where(eq(membranes.id, id)).get() ?? null;
  }
  findMembrane(manufacturer: string, model: string) {
    return this.db.select().from(membranes).where(and(eq(membranes.manufacturer, manufacturer), eq(membranes.model, model))).get() ?? null;
  }
  createMembrane(m: Omit<MembraneSpec, 'id'>) {
    return this.db.insert(membranes).values({ ...m, builtin: false }).returning().get();
  }
  updateMembrane(id: number, m: Omit<MembraneSpec, 'id'>) {
    return this.db.update(membranes).set(m).where(eq(membranes.id, id)).returning().get() ?? null;
  }
  deleteMembrane(id: number) {
    return this.db.delete(membranes).where(eq(membranes.id, id)).run().changes > 0;
  }

  // ---------------------------------------------------------------- pumps
  listPumps(): (PumpSpec & { builtin: boolean })[] {
    return this.db.select().from(pumps).orderBy(asc(pumps.pumpType), asc(pumps.ratedFlowM3h)).all() as (PumpSpec & { builtin: boolean })[];
  }
  createPump(p: Omit<PumpSpec, 'id'>) {
    return this.db.insert(pumps).values({ ...p, builtin: false }).returning().get();
  }
  updatePump(id: number, p: Omit<PumpSpec, 'id'>) {
    return this.db.update(pumps).set(p).where(eq(pumps.id, id)).returning().get() ?? null;
  }
  deletePump(id: number) {
    return this.db.delete(pumps).where(eq(pumps.id, id)).run().changes > 0;
  }

  // ---------------------------------------------------------------- pipes
  listPipeMaterials(): PipeMaterial[] {
    return this.db.select().from(pipeMaterials).orderBy(asc(pipeMaterials.name)).all();
  }
  upsertPipeMaterial(m: PipeMaterial) {
    return this.db.insert(pipeMaterials).values(m).onConflictDoUpdate({ target: pipeMaterials.name, set: { roughnessMm: m.roughnessMm, hazenC: m.hazenC, description: m.description } }).returning().get();
  }
  deletePipeMaterial(name: string) {
    this.db.delete(pipeSizes).where(eq(pipeSizes.material, name)).run();
    return this.db.delete(pipeMaterials).where(eq(pipeMaterials.name, name)).run().changes > 0;
  }
  listPipeSizes(): PipeSize[] {
    return this.db.select().from(pipeSizes).orderBy(asc(pipeSizes.material), asc(pipeSizes.dn)).all();
  }
  createPipeSize(p: Omit<PipeSize, 'id'>) {
    return this.db.insert(pipeSizes).values(p).returning().get();
  }
  updatePipeSize(id: number, p: Omit<PipeSize, 'id'>) {
    return this.db.update(pipeSizes).set(p).where(eq(pipeSizes.id, id)).returning().get() ?? null;
  }
  deletePipeSize(id: number) {
    return this.db.delete(pipeSizes).where(eq(pipeSizes.id, id)).run().changes > 0;
  }

  // ---------------------------------------------------------------- settings
  getSetting<T>(key: string, fallback: T): T {
    const r = this.db.select().from(settings).where(eq(settings.key, key)).get();
    if (!r) return fallback;
    try {
      return JSON.parse(r.value) as T;
    } catch {
      return fallback;
    }
  }
  setSetting(key: string, value: unknown) {
    this.db.insert(settings).values({ key, value: JSON.stringify(value) }).onConflictDoUpdate({ target: settings.key, set: { value: JSON.stringify(value) } }).run();
  }
  getSettings(): { assumptions: Assumptions; units: DisplayUnits; company: CompanyInfo } {
    return {
      assumptions: mergeAssumptions(this.getSetting<Assumptions | null>('assumptions', null)),
      units: { ...DEFAULT_UNITS, ...this.getSetting<Partial<DisplayUnits>>('units', {}) },
      company: this.getSetting<CompanyInfo>('company', { name: '', address: '', phone: '', email: '' }),
    };
  }

  /** Library data the calculation engine needs for a given design. */
  context(data: DesignInput): DesignContext {
    return { membrane: this.getMembrane(data.membrane.membraneId), pipeSizes: this.listPipeSizes(), pipeMaterials: this.listPipeMaterials(), pumps: this.listPumps() };
  }
}
