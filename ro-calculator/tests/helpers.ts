import { defaultAssumptions } from '../src/shared/assumptions';
import { SEED_MEMBRANES, SEED_PIPE_MATERIALS, SEED_PUMPS, seedPipeSizes } from '../src/shared/catalog';
import { runDesign } from '../src/shared/engine';
import { sample30m3h } from '../src/shared/sample';
import type { DesignContext, DesignInput, MembraneSpec } from '../src/shared/types';

export const MEMBRANES: MembraneSpec[] = SEED_MEMBRANES.map((m, i) => ({ id: i + 1, ...m }));
/** DEMO brackish 8" membrane (first seed record) */
export const BW30_400 = MEMBRANES[0];
export const SW30 = MEMBRANES.find((m) => m.membraneType === 'SWRO')!;
export const PUMPS = SEED_PUMPS.map((p, i) => ({ id: i + 1, ...p }));

export function ctx(membrane: MembraneSpec | null = BW30_400): DesignContext {
  return {
    membrane,
    pumps: PUMPS,
    pipeSizes: seedPipeSizes().map((p, i) => ({ id: i + 1, ...p })),
    pipeMaterials: SEED_PIPE_MATERIALS,
  };
}

export function sample(): DesignInput {
  return sample30m3h(defaultAssumptions(), BW30_400.id);
}

export function run(d: DesignInput, membrane: MembraneSpec | null = BW30_400) {
  return runDesign(d, ctx(membrane));
}

export function codes(r: ReturnType<typeof run>, level?: 'ok' | 'review' | 'critical') {
  return r.findings.filter((f) => !level || f.level === level).map((f) => f.code);
}

/** Same sample water/site, different production (m³/h at 20 h/day). */
export function sampleFlow(permeateM3h: number): DesignInput {
  const d = sample();
  d.production.dailyProductionM3d = permeateM3h * 20;
  d.project.name = `Sample ${permeateM3h} m³/h`;
  return d;
}
