import { defaultAssumptions } from '../src/shared/assumptions';
import { SEED_MEMBRANES, SEED_PIPE_MATERIALS, SEED_PUMPS, seedPipeSizes } from '../src/shared/catalog';
import { runDesign } from '../src/shared/engine';
import { sample30m3h } from '../src/shared/sample';
import type { DesignContext, DesignInput, MembraneSpec } from '../src/shared/types';

export const MEMBRANES: MembraneSpec[] = SEED_MEMBRANES.map((m, i) => ({ id: i + 1, ...m }));
export const BW30_400 = MEMBRANES.find((m) => m.model === 'BW30-400')!;
export const SW30 = MEMBRANES.find((m) => m.model === 'SW30HRLE-440i')!;

export function ctx(membrane: MembraneSpec | null = BW30_400): DesignContext {
  return {
    membrane,
    pumps: SEED_PUMPS.map((p, i) => ({ id: i + 1, ...p })),
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
