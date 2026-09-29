/**
 * Engineering numerical-validation tests (phase 2).
 * These check physical consistency (mass balances, formulas, conversions) – they do not
 * compare against hard-coded "expected" design answers.
 */
import { describe, expect, it } from 'vitest';
import { AssumptionReader, defaultAssumptions } from '../src/shared/assumptions';
import { SEED_PIPE_MATERIALS, seedPipeSizes } from '../src/shared/catalog';
import { runDesign } from '../src/shared/engine';
import { calcChemistry } from '../src/shared/engine/chemistry';
import { Findings, hydraulicKw, M_PER_BAR } from '../src/shared/engine/common';
import { solveElement, type ElementModel } from '../src/shared/engine/membrane';
import { hazenWilliamsLoss, sizePipe } from '../src/shared/engine/pipes';
import { curveHead, operatingPoint } from '../src/shared/engine/pumps';
import { tcf } from '../src/shared/engine/water';
import { convertFlow, convertPower, convertPressure, M_HEAD_PER_BAR } from '../src/shared/units';
import { BW30_400, codes, PUMPS, run, sample, sampleFlow } from './helpers';

const A = new AssumptionReader(defaultAssumptions());
const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-9);
const sizes = seedPipeSizes().map((p, i) => ({ id: i + 1, ...p }));

function checkBalances(permeate: number) {
  const r = run(sampleFlow(permeate));
  const p = r.production;
  // Feed = Permeate + Reject ; Recovery = Permeate / Feed
  expect(p.feedM3h).toBeCloseTo(p.permeateM3h + p.rejectM3h, 9);
  expect((p.permeateM3h / p.feedM3h) * 100).toBeCloseTo(p.recoveryPct, 9);
  expect(p.permeateM3h).toBeCloseTo(permeate, 9);
  const m = r.membrane;
  expect(m.simulated).toBe(true);
  // membrane count
  expect(m.elementsRequired).toBe(Math.ceil((permeate * 1000) / (m.designFluxTargetLmh * BW30_400.activeAreaM2!) - 1e-9));
  expect(m.elements).toBe(m.vessels * m.elementsPerVessel);
  expect(m.vesselsPerStage.reduce((a, b) => a + b, 0)).toBe(m.vessels);
  // stage balances
  const st = m.stageDetail;
  expect(st[0].feedM3h).toBeCloseTo(p.feedM3h, 2);
  let permSum = 0;
  st.forEach((s, i) => {
    expect(rel(s.feedM3h, s.permeateM3h + s.concentrateM3h)).toBeLessThan(1e-3);
    expect(s.elements).toBe(s.vessels * s.elementsPerVessel);
    if (i > 0) expect(s.feedM3h).toBeCloseTo(st[i - 1].concentrateM3h, 2);
    permSum += s.permeateM3h;
    // element balances inside the representative vessel
    let q = s.feedPerVesselM3h;
    for (const e of s.elementsDetail) {
      expect(e.feedM3h).toBeCloseTo(q, 2);
      expect(rel(e.feedM3h, e.permeateM3h + e.concentrateM3h)).toBeLessThan(1e-3);
      expect(e.recoveryPct).toBeCloseTo((e.permeateM3h / e.feedM3h) * 100, 1);
      expect(e.fluxLmh).toBeCloseTo((e.permeateM3h * 1000) / BW30_400.activeAreaM2!, 0);
      expect(e.ndpBar).toBeGreaterThan(0);
      expect(e.permeateTds).toBeLessThan(e.feedTds);
      q = e.concentrateM3h;
    }
    expect(s.concentratePerVesselM3h).toBeCloseTo(q, 2);
  });
  // solved array delivers the required permeate and reject
  expect(rel(permSum, permeate)).toBeLessThan(2e-3);
  expect(rel(st[st.length - 1].concentrateM3h, p.rejectM3h)).toBeLessThan(2e-3);
  // salt mass balance: C_f·Q_f = C_p·Q_p + C_c·Q_c (1 %)
  const salt = m.permeateTdsMgL! * p.permeateM3h + m.concentrateTdsMgL! * p.rejectM3h;
  expect(rel(salt, r.chemistry.tdsUsed! * p.feedM3h)).toBeLessThan(0.01);
  // the automatic array must satisfy its own vessel-flow limits and flux limit
  expect(codes(r, 'critical').filter((c) => c.startsWith('vessel_') || c === 'flux_high' || c.startsWith('el_dp'))).toEqual([]);
  expect(codes(r, 'critical')).toEqual([]);
  return r;
}

describe('flow, stage and element balances', () => {
  it('30 m³/h example', () => {
    const r = checkBalances(30);
    expect(r.production.feedM3h).toBeCloseTo(40, 9);
    expect(r.production.rejectM3h).toBeCloseTo(10, 9);
  });
  it('10 m³/h example', () => {
    const r = checkBalances(10);
    expect(r.membrane.vessels).toBeGreaterThanOrEqual(2);
  });
  it('50 m³/h example', () => {
    const r = checkBalances(50);
    expect(r.membrane.elements).toBeGreaterThan(checkBalances(30).membrane.elements);
  });
  it('larger plants need proportionally more membranes', () => {
    const e10 = run(sampleFlow(10)).membrane.elementsRequired;
    const e50 = run(sampleFlow(50)).membrane.elementsRequired;
    expect(e50 / e10).toBeGreaterThan(4);
    expect(e50 / e10).toBeLessThan(6);
  });
});

describe('membrane element model', () => {
  it('reproduces the datasheet test point (nominal flow and rejection) with the derived A and B', () => {
    const r = run(sample());
    const m: ElementModel = {
      area: BW30_400.activeAreaM2!, A25: r.membrane.permeabilityLmhBar!, B25: r.membrane.saltPermeabilityLmh!, tcfA: 1, tcfB: 1, ff: 1, aging: 1,
      kOsm: A.n('osmotic_coeff') / 1000, kCp: A.n('cp_coefficient'), dpRef: A.n('element_dp_ref_bar'), qRef: A.n('element_dp_ref_flow'), dpExp: A.n('element_dp_exponent'), permeatePressure: 0,
    };
    const qp = BW30_400.nominalFlowM3d! / 24;
    const e = solveElement(m, qp / (BW30_400.testRecoveryPct! / 100), BW30_400.testTdsMgL!, BW30_400.testPressureBar!);
    expect(rel(e.permeateM3h, qp)).toBeLessThan(0.01);
    expect(e.rejectionPct).toBeCloseTo(BW30_400.saltRejectionPct!, 1);
  });

  it('higher feed pressure gives more permeate; higher TDS gives less', () => {
    const r = run(sample());
    const m: ElementModel = { area: 37.2, A25: r.membrane.permeabilityLmhBar!, B25: r.membrane.saltPermeabilityLmh!, tcfA: 1, tcfB: 1, ff: 0.85, aging: 1, kOsm: 0.00077, kCp: 0.7, dpRef: 0.25, qRef: 10, dpExp: 1.7, permeatePressure: 0 };
    expect(solveElement(m, 8, 2000, 12).permeateM3h).toBeGreaterThan(solveElement(m, 8, 2000, 10).permeateM3h);
    expect(solveElement(m, 8, 4000, 12).permeateM3h).toBeLessThan(solveElement(m, 8, 2000, 12).permeateM3h);
  });

  it('temperature correction: TCF(25 °C) = 1, colder water → higher pressure and better rejection', () => {
    expect(tcf(25, 2640)).toBeCloseTo(1, 12);
    expect(tcf(15, 2640)).toBeCloseTo(Math.exp(2640 * (1 / 298.15 - 1 / 288.15)), 12);
    const warm = run(sample());
    const d = sample();
    d.water.temperature = 12;
    const cold = run(d);
    expect(cold.membrane.feedPressureBar!).toBeGreaterThan(warm.membrane.feedPressureBar!);
    expect(cold.membrane.permeateTdsMgL!).toBeLessThan(warm.membrane.permeateTdsMgL!);
  });

  it('manual arrays 2:1, 3:1, 4:2, 5:2, 6:3 are honoured and balanced', () => {
    for (const [arr, perm] of [[[2, 1], 10], [[3, 1], 12], [[4, 2], 25], [[5, 2], 30], [[6, 3], 40]] as [number[], number][]) {
      const d = sampleFlow(perm);
      d.membrane.vesselsPerStage = arr;
      const r = run(d);
      expect(r.membrane.configMode).toBe('manual');
      expect(r.membrane.stageDetail.map((s) => s.vessels)).toEqual(arr);
      expect(r.membrane.elements).toBe(arr.reduce((a, b) => a + b, 0) * 6);
      const permSum = r.membrane.stageDetail.reduce((a, s) => a + s.permeateM3h, 0);
      expect(rel(permSum, perm)).toBeLessThan(2e-3);
    }
  });

  it('stage example from the specification: 5 vessels × 6 + 2 vessels × 6 = 42 membranes', () => {
    const d = sample();
    d.membrane.vesselsPerStage = [5, 2];
    const r = run(d);
    expect(r.membrane.stageDetail[0].elements).toBe(30);
    expect(r.membrane.stageDetail[1].elements).toBe(12);
    expect(r.membrane.elements).toBe(42);
  });

  it('missing temperature → INSUFFICIENT DATA, no invented pressure', () => {
    const d = sample();
    d.water.temperature = null;
    const r = run(d);
    expect(r.membrane.feedPressureBar).toBeNull();
    expect(r.membrane.simulated).toBe(false);
    expect(codes(r, 'critical')).toEqual(expect.arrayContaining(['temp_missing', 'membrane_insufficient']));
    expect(r.pumps.find((p) => p.id === 'hp')!.enabled).toBe(false);
  });

  it('impossible osmotic duty is reported as infeasible, not solved', () => {
    const d = sample();
    d.water = { ...d.water, tds: 60000, conductivity: 90000, sodium: 18000, chloride: 33000 };
    d.production.recoveryPct = 80;
    d.assumptions.recovery_limit_brackish = 95;
    const r = run(d);
    expect(codes(r, 'critical')).toContain('infeasible');
    expect(r.membrane.feedPressureBar).toBeNull();
  });
});

describe('pipe hydraulics', () => {
  const base = { material: 'PVC-U PN16', maxVelocity: 1.5, lengthM: 100, elevationM: 0, designPressureBar: 6, temperatureC: 20, fittings: {}, method: 'darcy' as const };
  it('velocity = Q / (π·ID²/4) and loss per 100 m', () => {
    const r = sizePipe({ ...base, flowM3h: 40 }, sizes, SEED_PIPE_MATERIALS, A);
    const d = r.innerDiameterMm! / 1000;
    expect(r.velocity).toBeCloseTo(40 / 3600 / ((Math.PI * d * d) / 4), 3);
    expect(r.lossPer100m).toBeCloseTo((r.frictionLossM / 100) * 100, 3);
    expect(r.reynolds).toBeGreaterThan(4000);
    expect(r.frictionFactor).toBeGreaterThan(0.01);
  });
  it('Hazen–Williams matches the SI formula and is close to Darcy–Weisbach for PVC', () => {
    const r = sizePipe({ ...base, flowM3h: 40, method: 'hazen' }, sizes, SEED_PIPE_MATERIALS, A);
    const d = r.innerDiameterMm! / 1000;
    const hand = (10.67 * 100 * Math.pow(40 / 3600, 1.852)) / (Math.pow(150, 1.852) * Math.pow(d, 4.87));
    expect(r.hazenLossM!).toBeCloseTo(hand, 3);
    expect(hazenWilliamsLoss(40, r.innerDiameterMm!, 100, 150)).toBeCloseTo(hand, 6);
    expect(r.frictionLossM).toBeCloseTo(r.hazenLossM!, 6); // method honoured
    expect(rel(r.hazenLossM!, r.darcyLossM)).toBeLessThan(0.25);
  });
  it('minor losses: h_m = ΣK·v²/2g', () => {
    const r = sizePipe({ ...base, flowM3h: 40, fittings: { elbow90: 4, check_valve: 1 } }, sizes, SEED_PIPE_MATERIALS, A);
    const sumK = 4 * A.n('k_elbow90') + A.n('k_check_valve');
    expect(r.sumK).toBeCloseTo(sumK, 6);
    expect(r.minorLossM).toBeCloseTo((sumK * r.velocity * r.velocity) / (2 * 9.81), 2);
  });
  it('velocity limits: user max velocity honoured, forced small DN flagged critical', () => {
    for (const v of [0.8, 1.5, 2.5]) {
      const r = sizePipe({ ...base, flowM3h: 40, maxVelocity: v }, sizes, SEED_PIPE_MATERIALS, A);
      expect(r.velocity).toBeLessThanOrEqual(v + 1e-9);
    }
    const forced = sizePipe({ ...base, flowM3h: 40, dnOverride: 50 }, sizes, SEED_PIPE_MATERIALS, A);
    expect(forced.dn).toBe(50);
    expect(forced.status).toBe('critical');
    expect(forced.messages.some((m) => /excessive|exceeds/.test(m.text))).toBe(true);
  });
  it('project-level: forcing a small DN on the HP line is a red warning', () => {
    const d = sample();
    d.hydraulics.pipes.hp_to_ro = { dn: 40 };
    expect(codes(run(d), 'critical')).toContain('pipe_hp_to_ro');
  });
});

describe('pump calculations', () => {
  it('hydraulic power P = ρ·g·Q·H, motor = P/η × SF, standard size ≥ requirement', () => {
    const r = run(sample());
    for (const p of r.pumps.filter((x) => x.enabled)) {
      const ph = (1000 * 9.81 * (p.designFlowM3h / 3600) * p.designHeadM) / 1000;
      expect(p.hydraulicKw).toBeCloseTo(ph, 2);
      expect(p.shaftKw).toBeCloseTo(ph / (p.efficiencyPct / 100), 2);
      expect(p.requiredMotorKw).toBeCloseTo(p.shaftKw * p.safetyFactor, 1);
      expect(p.standardMotorKw).toBeGreaterThanOrEqual(p.requiredMotorKw);
      expect(A.list('std_motors_kw')).toContain(p.standardMotorKw);
      // TDH is the sum of its components
      const sum = p.staticHeadM + p.frictionHeadM + p.minorHeadM + p.equipmentHeadM + p.terminalHeadM - p.suctionCreditM;
      expect(p.calculatedHeadM).toBeCloseTo(sum, 1);
    }
    expect(hydraulicKw(36, 100)).toBeCloseTo(9.81, 6);
  });
  it('raw water pump: static + friction + minor + equipment', () => {
    const r = run(sample());
    const raw = r.pumps.find((p) => p.id === 'raw')!;
    expect(raw.staticHeadM).toBeCloseTo(55 + 5 + 4, 6);
    expect(raw.frictionHeadM).toBeGreaterThan(0);
    expect(raw.minorHeadM).toBeGreaterThan(0);
    expect(raw.equipmentHeadM).toBeCloseTo(A.n('wellhead_strainer_loss_bar') * M_PER_BAR, 2);
    const d = sample();
    d.hydraulics.pumps.raw = { extraLossBar: 0.5, efficiencyPct: 70 };
    const raw2 = run(d).pumps.find((p) => p.id === 'raw')!;
    expect(raw2.equipmentHeadM - raw.equipmentHeadM).toBeCloseTo(0.5 * M_PER_BAR, 1);
    expect(raw2.efficiencyPct).toBe(70);
    expect(raw2.efficiencySource).toBe('project input');
  });
  it('pump curve interpolation and operating point', () => {
    const curve = [
      { flowM3h: 0, headM: 100, efficiencyPct: 0, npshrM: 1 },
      { flowM3h: 20, headM: 90, efficiencyPct: 60, npshrM: 2 },
      { flowM3h: 40, headM: 70, efficiencyPct: 75, npshrM: 3 },
      { flowM3h: 60, headM: 40, efficiencyPct: 65, npshrM: 5 },
    ];
    expect(curveHead(curve, 30)).toBeCloseTo(80, 9);
    const op = operatingPoint(curve, 40, 30, 30); // system: 30 + 30·(Q/40)²  → 60 m at 40 m³/h
    expect(op.headAtDesignFlowM).toBeCloseTo(70, 6);
    expect(op.excessHeadPct).toBeCloseTo(((70 - 60) / 60) * 100, 1);
    expect(op.bepFlowM3h).toBe(40);
    expect(op.intersectFlowM3h!).toBeGreaterThan(40);
    const hPump = curveHead(curve, op.intersectFlowM3h!)!;
    expect(hPump).toBeCloseTo(30 + 30 * Math.pow(op.intersectFlowM3h! / 40, 2), 0);
  });
  it('selected pump: suitable curve passes, too-small pump → insufficient pressure (red), outside curve (red)', () => {
    const good = sample();
    good.hydraulics.pumps.hp = { libraryPumpId: PUMPS.find((p) => p.model === 'DEMO-VMS-45/130')!.id };
    const r1 = run(good);
    const hp1 = r1.pumps.find((p) => p.id === 'hp')!;
    expect(hp1.operatingPoint).not.toBeNull();
    expect(hp1.efficiencySource).toBe('pump curve');
    expect(codes(r1, 'critical')).not.toContain('hp_insufficient');
    const weak = sample();
    weak.hydraulics.pumps.hp = { libraryPumpId: PUMPS.find((p) => p.model === 'DEMO-EN-45/50')!.id };
    expect(codes(run(weak), 'critical')).toContain('hp_insufficient');
    const small = sample();
    small.hydraulics.pumps.hp = { libraryPumpId: PUMPS.find((p) => p.model === 'DEMO-VMS-10/160')!.id };
    expect(codes(run(small), 'critical')).toContain('hp_outside');
  });
  it('NPSH: high NPSHr in the curve gives a cavitation warning', () => {
    const d = sample();
    const pumps = PUMPS.map((p) => (p.model === 'DEMO-EN-45/50' ? { ...p, curve: p.curve.map((c) => ({ ...c, npshrM: 12 })) } : p));
    d.hydraulics.pumps.feed = { libraryPumpId: pumps.find((p) => p.model === 'DEMO-EN-45/50')!.id };
    const r = runDesign(d, { membrane: BW30_400, pumps, pipeSizes: sizes, pipeMaterials: SEED_PIPE_MATERIALS });
    expect(r.findings.filter((x: { level: string }) => x.level === 'critical').map((x: { code: string }) => x.code)).toContain('feed_npsh');
  });
  it('no pump selected → operating point requires confirmation (yellow)', () => {
    expect(codes(run(sample()), 'review')).toContain('hp_opconfirm');
  });
});

describe('water chemistry', () => {
  it('ionic balance, TDS from ions and osmotic pressure (van ’t Hoff)', () => {
    const f = new Findings();
    const c = calcChemistry(sample().water, 25, 75, A, f);
    expect(c.majorIonsComplete).toBe(true);
    expect(c.balanceErrorPct!).toBeLessThan(5);
    const sumMol = c.ions.reduce((s, i) => s + (i.mmolL ?? 0), 0) / 1000;
    expect(c.osmoticFeedBar!).toBeCloseTo(0.93 * 0.083145 * 298.15 * sumMol, 2);
    expect(c.osmoticMethod).toBe('van’t Hoff (ions)');
  });
  it('NaCl 1000 mg/L gives ≈ 0.78 bar (sanity check of the osmotic model)', () => {
    const w = { ...sample().water, calcium: 0, magnesium: 0, sodium: 393.4, chloride: 606.6, sulfate: 0, alkalinity: 0, potassium: 0, nitrate: 0, fluoride: 0, silica: 0, iron: 0, manganese: 0, barium: 0, strontium: 0, tds: 1000 };
    const c = calcChemistry(w, 25, 50, A, new Findings());
    expect(c.osmoticFeedBar!).toBeGreaterThan(0.72);
    expect(c.osmoticFeedBar!).toBeLessThan(0.82);
  });
  it('invalid / inconsistent chemistry is flagged', () => {
    const d = sample();
    d.water.sodium = 100; // breaks the ion balance
    d.water.ph = 14;
    d.water.silica = -3;
    const r = run(d);
    expect(codes(r, 'review')).toContain('ion_balance');
    expect(codes(r, 'critical')).toEqual(expect.arrayContaining(['ph_range', 'negative_silica']));
  });
  it('incomplete analysis → LABORATORY DATA REQUIRED indicators and fallback osmotic method flagged', () => {
    const d = sample();
    d.water.calcium = null;
    d.water.sodium = null;
    const r = run(d);
    const lsi = r.chemistry.indicators.find((i) => i.name.startsWith('Langelier'))!;
    expect(lsi.status).toBe('insufficient');
    expect(lsi.interpretation).toBe('LABORATORY DATA REQUIRED');
    expect(r.chemistry.osmoticMethod).toBe('coefficient (fallback)');
    expect(codes(r, 'review')).toContain('osmotic_fallback');
  });
  it('water-quality risk warnings', () => {
    const d = sample();
    d.water.freeChlorine = 0.5;
    d.water.sdi = 6;
    d.water.iron = 2;
    const r = run(d);
    expect(codes(r, 'critical')).toEqual(expect.arrayContaining(['chlorine', 'sdi_high', 'iron_high']));
    expect(codes(run(sample()), 'review')).toEqual(expect.arrayContaining(['hardness_high', 'silica_high', 'turbidity_high', 'mn_high']));
  });
});

describe('design warnings', () => {
  it('recovery above the configured safe limit is red', () => {
    const d = sample();
    d.production.recoveryPct = 90;
    expect(codes(run(d), 'critical')).toContain('recovery_limit');
  });
  it('insufficient feed pressure (no booster pump) is red', () => {
    const d = sample();
    d.hydraulics.feedPumpEnabled = false;
    expect(codes(run(d), 'critical')).toContain('hp_suction');
  });
  it('antiscalant dose needs supplier confirmation unless a supplier dose is entered', () => {
    const r1 = run(sample());
    expect(codes(r1, 'review')).toContain('antiscalant_supplier');
    expect(r1.dosing.find((x) => x.id === 'antiscalant')!.doseStatus).toBe('indicative');
    const d = sample();
    d.pretreatment.antiscalantDoseMgL = 2.4;
    const r2 = run(d);
    expect(codes(r2, 'review')).not.toContain('antiscalant_supplier');
    const as = r2.dosing.find((x) => x.id === 'antiscalant')!;
    expect(as.doseStatus).toBe('supplier');
    expect(as.doseMgL).toBe(2.4);
  });
  it('DEMO membrane data and manufacturer verification are flagged yellow', () => {
    expect(codes(run(sample()), 'review')).toEqual(expect.arrayContaining(['demo_membrane', 'manufacturer_verification']));
  });
});

describe('unit conversions', () => {
  it('flow', () => {
    expect(convertFlow(30, 'm3/h', 'm3/day')).toBeCloseTo(720, 9);
    expect(convertFlow(30, 'm3/h', 'L/h')).toBeCloseTo(30000, 9);
    expect(convertFlow(30, 'm3/h', 'L/min')).toBeCloseTo(500, 9);
    expect(convertFlow(convertFlow(12.3, 'gpm', 'm3/h'), 'm3/h', 'gpm')).toBeCloseTo(12.3, 9);
  });
  it('pressure / head', () => {
    expect(convertPressure(1, 'bar', 'psi')).toBeCloseTo(14.5038, 3);
    expect(convertPressure(1, 'bar', 'kPa')).toBeCloseTo(100, 9);
    expect(convertPressure(1, 'bar', 'm')).toBeCloseTo(100000 / (1000 * 9.81), 9);
    expect(M_HEAD_PER_BAR).toBeCloseTo(M_PER_BAR, 12);
    expect(convertPressure(convertPressure(7.3, 'bar', 'm'), 'm', 'bar')).toBeCloseTo(7.3, 12);
  });
  it('power', () => {
    expect(convertPower(22, 'kW', 'HP')).toBeCloseTo(29.5024, 3);
    expect(convertPower(convertPower(5.5, 'kW', 'HP'), 'HP', 'kW')).toBeCloseTo(5.5, 12);
  });
});

describe('traceability', () => {
  it('key results carry "How was this calculated?" steps with inputs and formulas', () => {
    const r = run(sample());
    for (const key of ['production', 'feed', 'reject', 'recovery', 'membranes', 'feedPressure', 'hpPump', 'rawPump', 'electrical', 'pipes', 'osmotic']) {
      expect(r.trace[key]?.length, key).toBeGreaterThan(0);
      for (const s of r.trace[key]) expect(s.formula.length).toBeGreaterThan(2);
    }
    expect(r.trace.hpPump.some((s) => s.inputs && /ρ/.test(s.inputs))).toBe(true);
  });
});
