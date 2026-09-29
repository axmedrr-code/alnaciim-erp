import type { AssumptionReader } from '../assumptions';
import type { TankInput } from '../types';
import { ceilTo, Findings, isNum, nextStandard, round } from './common';
import type { DosingLine } from './dosing';
import type { MembraneResult } from './membrane';
import type { ProductionResult } from './production';

export interface TankResult {
  id: string;
  name: string;
  basis: string;
  formula: string;
  calculatedM3: number;
  recommendedM3: number;
  recommendedL: number;
  notes: string[];
}

export function calcTanks(t: TankInput, prod: ProductionResult, mem: MembraneResult, dosing: DosingLine[], cip: boolean, A: AssumptionReader, f: Findings): TankResult[] {
  const S = 'Tanks';
  const out: TankResult[] = [];
  const fb = 1 + A.n('tank_freeboard') / 100;
  const step = A.n('tank_round_step_m3');
  const hrs = (v: number | null, key: string, label: string) => {
    if (isNum(v)) {
      if (v < 0) {
        f.critical(S, `${key}_neg`, `${label} storage hours cannot be negative – default used.`);
        return A.n(key);
      }
      return v;
    }
    return A.n(key);
  };
  const water = (id: string, name: string, calc: number, basis: string, formula: string, notes: string[] = []) => {
    const rec = calc > 0 ? ceilTo(calc * fb, step) : 0;
    out.push({ id, name, basis, formula: `${formula}; recommended = ceil(V × ${fb.toFixed(2)} freeboard, ${step} m³)`, calculatedM3: round(calc, 2), recommendedM3: round(rec, 2), recommendedL: Math.round(rec * 1000), notes });
  };

  const rawH = hrs(t.rawStorageHours, 'raw_storage_hours', 'Raw water tank');
  const rawFlow = prod.feedM3h * A.n('raw_flow_factor');
  water('raw', 'Raw water tank', rawFlow * rawH, `${round(rawFlow, 2)} m³/h raw water × ${rawH} h`, 'V = Q_raw × storage hours');
  if (rawH < 0.5) f.review(S, 'raw_small', `Raw water storage ${rawH} h is very small – pump cycling and backwash supply problems likely.`);

  const pH = hrs(t.permeateStorageHours, 'permeate_storage_hours', 'Product tank');
  const byStorage = prod.permeateM3h * pH;
  let byPeak = 0;
  const notes: string[] = [];
  if (isNum(t.peakDemandM3h)) {
    if (t.peakDemandM3h < 0) f.critical(S, 'peak_neg', 'Peak demand cannot be negative.');
    else if (t.peakDemandM3h > prod.permeateM3h) {
      byPeak = (t.peakDemandM3h - prod.permeateM3h) * Math.max(t.peakDurationH, 0);
      notes.push(`Peak deficit: (${t.peakDemandM3h} − ${round(prod.permeateM3h, 2)}) m³/h × ${t.peakDurationH} h = ${round(byPeak, 1)} m³.`);
      if (t.peakDurationH <= 0) f.review(S, 'peak_duration', 'Peak demand is higher than production but peak duration is 0 h.');
    }
  }
  water('permeate', 'RO permeate / product water tank', Math.max(byStorage, byPeak), `max(${round(prod.permeateM3h, 2)} m³/h × ${pH} h, peak deficit)`, 'V = max(Q_p × storage hours, (Q_peak − Q_p) × peak duration)', notes);

  if (t.rejectRecovery) {
    const rH = hrs(t.rejectStorageHours, 'reject_storage_hours', 'Reject tank');
    water('reject', 'Reject (concentrate) tank', prod.rejectM3h * rH, `${round(prod.rejectM3h, 2)} m³/h × ${rH} h`, 'V = Q_c × storage hours', ['For reuse (washing, irrigation, backwash) – check local discharge regulations.']);
  }

  if (cip && mem.available) {
    const maxStage = Math.max(...mem.stageDetail.map((s) => s.elements), 0);
    const calcL = maxStage * A.n('cip_volume_per_element') * (1 + A.n('cip_piping_allowance') / 100);
    const sel = nextStandard(calcL, A.list('std_chemical_tanks_l')) ?? calcL;
    out.push({
      id: 'cip', name: 'CIP (clean-in-place) tank', basis: `${maxStage} elements in largest stage × ${A.n('cip_volume_per_element')} L × (1 + ${A.n('cip_piping_allowance')} %)`,
      formula: 'V = elements × L/element × (1 + piping allowance); next standard size', calculatedM3: round(calcL / 1000, 3), recommendedM3: round(sel / 1000, 3), recommendedL: Math.round(sel), notes: ['With heater and cartridge filter (5 µm) for cleaning solution.'],
    });
  }

  for (const d of dosing) {
    out.push({
      id: `chem_${d.id}`, name: `${d.chemical} dosing tank`, basis: `${d.solutionLh} L/h × ${A.n('chemical_autonomy_days')} days autonomy`, formula: 'V = solution L/h × h/day × days × (1 + freeboard)',
      calculatedM3: round(d.tankVolumeL / 1000, 3), recommendedM3: round(d.tankSelectedL / 1000, 3), recommendedL: d.tankSelectedL, notes: ['PE tank with lid, level switch (low-level alarm) and mixer where applicable.'],
    });
  }
  return out;
}
