/**
 * Seed data for the local libraries. Membrane and pump records are DEMO data
 * (clearly labelled, not manufacturer data); pipe data are standard dimensions. They are stored in the local SQLite database
 * and can be edited by the user – they are NOT hard-coded into the calculations.
 */
import type { MembraneSpec, PipeMaterial, PipeSize, PumpCurvePoint, PumpSpec, PumpType } from './types';

export const DEMO_SOURCE = 'DEMO sample values for testing the software – NOT a manufacturer datasheet. Replace with the actual manufacturer datasheet values before design use.';

type M = Omit<MembraneSpec, 'id'>;
const demo = (m: Omit<M, 'isDemo' | 'dataSource' | 'notes' | 'manufacturer'> & { notes?: string }): M => ({ manufacturer: 'DEMO', isDemo: true, dataSource: DEMO_SOURCE, ...m, notes: m.notes ?? '' });

/**
 * DEMO membrane records. They are generic, clearly-labelled sample values (not copied from, and not
 * claimed to represent, any manufacturer's product). Enter real datasheet values in the Membrane Library.
 */
export const SEED_MEMBRANES: M[] = [
  demo({ model: 'DEMO-BW-8040-400 (brackish, standard)', membraneType: 'BWRO', diameterIn: 8, activeAreaM2: 37.2, nominalFlowM3d: 40, saltRejectionPct: 99.5, maxPressureBar: 41, maxTempC: 45, phMin: 2, phMax: 11, testPressureBar: 15.5, testTdsMgL: 2000, testRecoveryPct: 15, maxFeedFlowM3h: 16, recFluxMinLmh: 12, recFluxMaxLmh: 30, maxElementRecoveryPct: 18, minConcentrateM3h: 3.0, maxElementDpBar: 1.0 }),
  demo({ model: 'DEMO-BW-8040-440 (brackish, high area)', membraneType: 'BWRO', diameterIn: 8, activeAreaM2: 40.9, nominalFlowM3d: 44, saltRejectionPct: 99.6, maxPressureBar: 41, maxTempC: 45, phMin: 2, phMax: 11, testPressureBar: 15.5, testTdsMgL: 2000, testRecoveryPct: 15, maxFeedFlowM3h: 16, recFluxMinLmh: 12, recFluxMaxLmh: 30, maxElementRecoveryPct: 18, minConcentrateM3h: 3.0, maxElementDpBar: 1.0 }),
  demo({ model: 'DEMO-LE-8040-400 (low energy)', membraneType: 'BWRO-LE', diameterIn: 8, activeAreaM2: 37.2, nominalFlowM3d: 42, saltRejectionPct: 99.3, maxPressureBar: 41, maxTempC: 45, phMin: 2, phMax: 11, testPressureBar: 10.3, testTdsMgL: 1500, testRecoveryPct: 15, maxFeedFlowM3h: 16, recFluxMinLmh: 12, recFluxMaxLmh: 30, maxElementRecoveryPct: 18, minConcentrateM3h: 3.0, maxElementDpBar: 1.0 }),
  demo({ model: 'DEMO-SW-8040-400 (seawater)', membraneType: 'SWRO', diameterIn: 8, activeAreaM2: 37.2, nominalFlowM3d: 28, saltRejectionPct: 99.75, maxPressureBar: 83, maxTempC: 45, phMin: 2, phMax: 11, testPressureBar: 55.2, testTdsMgL: 32000, testRecoveryPct: 8, maxFeedFlowM3h: 14, recFluxMinLmh: 8, recFluxMaxLmh: 17, maxElementRecoveryPct: 15, minConcentrateM3h: 3.0, maxElementDpBar: 1.0 }),
  demo({ model: 'DEMO-BW-4040 (brackish, 4 inch)', membraneType: 'BWRO', diameterIn: 4, activeAreaM2: 7.9, nominalFlowM3d: 9.0, saltRejectionPct: 99.5, maxPressureBar: 41, maxTempC: 45, phMin: 2, phMax: 11, testPressureBar: 15.5, testTdsMgL: 2000, testRecoveryPct: 15, maxFeedFlowM3h: 3.6, recFluxMinLmh: 12, recFluxMaxLmh: 30, maxElementRecoveryPct: 18, minConcentrateM3h: 0.7, maxElementDpBar: 1.0 }),
];

/** DEMO pump curve: H(Q) parabola through shut-off and rated point, efficiency peaking at rated flow, NPSHr rising with flow. */
export function demoCurve(q: number, h: number, h0: number, eff: number, npshAtBep: number | null): PumpCurvePoint[] {
  const pts: PumpCurvePoint[] = [];
  for (const x of [0, 0.3, 0.5, 0.7, 0.85, 1, 1.15, 1.3]) {
    const flow = Math.round(q * x * 100) / 100;
    const head = Math.round((h0 - (h0 - h) * x * x) * 10) / 10;
    const e = x === 0 ? 0 : Math.round(eff * (2 * x - x * x) * 10) / 10;
    const npshr = npshAtBep === null ? null : Math.round((npshAtBep * (0.5 + 0.5 * x * x)) * 10) / 10;
    pts.push({ flowM3h: flow, headM: head, efficiencyPct: e, npshrM: npshr });
  }
  return pts;
}

function pumpSeries(type: PumpType, prefix: string, rows: [number, number, number, number, number][], note: string, npsh: number | null): Omit<PumpSpec, 'id'>[] {
  return rows.map(([q, h, h0, kw, eff]) => ({
    pumpType: type, manufacturer: 'DEMO', model: `DEMO-${prefix}-${q}/${h}`, ratedFlowM3h: q, ratedHeadM: h, minFlowM3h: Math.round(q * 0.3 * 10) / 10, maxFlowM3h: Math.round(q * 1.3 * 10) / 10,
    shutoffHeadM: h0, motorKw: kw, efficiencyPct: eff, curve: demoCurve(q, h, h0, eff, npsh), isDemo: true, notes: `${note} ${DEMO_SOURCE}`,
  }));
}

export const SEED_PUMPS: Omit<PumpSpec, 'id'>[] = [
  ...pumpSeries('borehole', 'SUB', [[5, 100, 150, 3, 60], [10, 100, 150, 5.5, 65], [17, 100, 150, 7.5, 68], [30, 100, 150, 15, 72], [46, 100, 150, 22, 74], [60, 100, 150, 30, 75], [77, 110, 160, 37, 76], [95, 120, 170, 45, 77]], 'Submersible borehole pump.', null),
  ...pumpSeries('feed', 'EN', [[5, 30, 40, 1.1, 55], [10, 35, 45, 2.2, 62], [20, 35, 45, 3, 68], [30, 35, 45, 5.5, 70], [45, 50, 62, 11, 72], [60, 40, 52, 11, 74], [90, 40, 52, 15, 76], [150, 45, 55, 30, 78]], 'End-suction centrifugal pump.', 3),
  ...pumpSeries('high_pressure', 'VMS', [[5, 150, 190, 4, 62], [10, 160, 200, 7.5, 67], [16, 170, 210, 11, 70], [20, 180, 220, 15, 72], [32, 120, 150, 15, 74], [32, 180, 220, 22, 74], [45, 130, 165, 22, 76], [45, 180, 225, 37, 76], [64, 190, 235, 55, 77], [90, 200, 245, 75, 78], [125, 200, 245, 110, 79]], 'Vertical multistage pump.', 4),
  ...pumpSeries('product', 'TR', [[5, 40, 50, 1.1, 55], [10, 40, 52, 2.2, 62], [20, 45, 57, 4, 66], [30, 45, 57, 5.5, 70], [45, 50, 62, 11, 72], [60, 50, 62, 15, 74]], 'Transfer/booster pump.', 3),
  ...pumpSeries('cip', 'CIP', [[10, 40, 50, 2.2, 58], [20, 40, 50, 4, 62], [30, 40, 52, 5.5, 65], [45, 40, 52, 7.5, 68], [60, 40, 52, 11, 70], [80, 40, 52, 15, 72]], 'CIP pump.', 3),
];

export const SEED_PIPE_MATERIALS: PipeMaterial[] = [
  { name: 'PVC-U PN16', roughnessMm: 0.0015, hazenC: 150, description: 'Unplasticised PVC, SDR 13.6, metric OD (ISO 1452). Low-pressure lines.' },
  { name: 'HDPE PE100 SDR11 (PN16)', roughnessMm: 0.007, hazenC: 150, description: 'Polyethylene PE100, SDR 11 (ISO 4427). Borehole risers, buried transfer lines.' },
  { name: 'Stainless Steel 316L Sch10S', roughnessMm: 0.015, hazenC: 140, description: 'ASME B36.19 Sch10S. High-pressure brackish RO lines.' },
  { name: 'Stainless Steel 316L Sch40S', roughnessMm: 0.015, hazenC: 140, description: 'ASME B36.19 Sch40S. Seawater/high-pressure RO lines.' },
];

const PLASTIC_OD: [number, number][] = [[20, 15], [25, 20], [32, 25], [40, 32], [50, 40], [63, 50], [75, 65], [90, 80], [110, 100], [140, 125], [160, 150], [225, 200], [280, 250], [315, 300], [400, 400]];
// [DN, OD, wall Sch10S, wall Sch40S]
const SS_PIPE: [number, number, number, number][] = [
  [15, 21.34, 2.11, 2.77], [20, 26.67, 2.11, 2.87], [25, 33.4, 2.77, 3.38], [32, 42.16, 2.77, 3.56], [40, 48.26, 2.77, 3.68], [50, 60.33, 2.77, 3.91],
  [65, 73.03, 3.05, 5.16], [80, 88.9, 3.05, 5.49], [100, 114.3, 3.05, 6.02], [125, 141.3, 3.4, 6.55], [150, 168.28, 3.4, 7.11], [200, 219.08, 3.76, 8.18],
  [250, 273.05, 4.19, 9.27], [300, 323.85, 4.57, 9.53],
];

/**
 * Pipe catalogue. Plastic walls from SDR (wall = OD/SDR); stainless pressure rating
 * from Barlow: P = 2·S·t·0.875/OD with S = 115 MPa (316L allowable, ambient) and 12.5 % mill tolerance.
 */
export function seedPipeSizes(): Omit<PipeSize, 'id'>[] {
  const out: Omit<PipeSize, 'id'>[] = [];
  const r1 = (v: number) => Math.round(v * 10) / 10;
  for (const [od, dn] of PLASTIC_OD) {
    const wPvc = Math.max(1.5, r1(od / 13.6));
    out.push({ material: 'PVC-U PN16', dn, outerDiameterMm: od, wallMm: wPvc, innerDiameterMm: r1(od - 2 * wPvc), pressureRatingBar: 16 });
    const wPe = Math.max(2.0, r1(od / 11));
    out.push({ material: 'HDPE PE100 SDR11 (PN16)', dn, outerDiameterMm: od, wallMm: wPe, innerDiameterMm: r1(od - 2 * wPe), pressureRatingBar: 16 });
  }
  for (const [dn, od, w10, w40] of SS_PIPE) {
    const rating = (t: number) => Math.floor(((2 * 115 * t * 0.875) / od) * 10);
    out.push({ material: 'Stainless Steel 316L Sch10S', dn, outerDiameterMm: od, wallMm: w10, innerDiameterMm: r1(od - 2 * w10), pressureRatingBar: rating(w10) });
    out.push({ material: 'Stainless Steel 316L Sch40S', dn, outerDiameterMm: od, wallMm: w40, innerDiameterMm: r1(od - 2 * w40), pressureRatingBar: rating(w40) });
  }
  return out;
}
