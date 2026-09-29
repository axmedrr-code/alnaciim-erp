import { describe, expect, it } from 'vitest';
import { AssumptionReader, defaultAssumptions } from '../src/shared/assumptions';
import { SEED_PIPE_MATERIALS, seedPipeSizes } from '../src/shared/catalog';
import { hydraulicKw, sizePipe } from '../src/shared/engine';
import { splitStages } from '../src/shared/engine/membrane';
import { frictionFactor } from '../src/shared/engine/pipes';
import { acidDemand, logMeanCF, phSaturation, tcf, waterViscosity } from '../src/shared/engine/water';
import { blankDesign } from '../src/shared/sample';
import { convertFlow, convertPower, convertPressure } from '../src/shared/units';
import { BW30_400, codes, run, sample, SW30 } from './helpers';

const A = new AssumptionReader(defaultAssumptions());

describe('30 m³/h sample project', () => {
  const r = run(sample());

  it('production: permeate, feed, reject and recovery', () => {
    expect(r.production.permeateM3h).toBeCloseTo(30, 6); // 600 m³/day ÷ 20 h
    expect(r.production.feedM3h).toBeCloseTo(40, 6); // 30 ÷ 0.75
    expect(r.production.rejectM3h).toBeCloseTo(10, 6);
    expect(r.summary.recoveryPct).toBe(75);
    expect(r.summary.dailyProductionM3d).toBe(600);
  });

  it('membranes: element count, vessels and flux', () => {
    // N = ceil(30 000 / (22 × 37.2)) = 37 → 7 vessels × 6 = 42 elements
    expect(r.membrane.elementsRequired).toBe(37);
    expect(r.membrane.vessels).toBe(7);
    expect(r.membrane.elements).toBe(42);
    expect(r.membrane.stages).toBe(2);
    expect(r.membrane.arrayLabel.startsWith('5:2')).toBe(true);
    expect(r.membrane.actualFluxLmh).toBeCloseTo((30 * 1000) / (42 * 37.2), 1);
    expect(r.membrane.actualFluxLmh).toBeLessThanOrEqual(r.membrane.maxFluxLmh);
    // stage mass balance
    const s = r.membrane.stageDetail;
    expect(s[0].feedM3h).toBeCloseTo(40, 2);
    expect(s[1].concentrateM3h).toBeCloseTo(10, 1);
    expect(s[0].permeateM3h + s[1].permeateM3h).toBeCloseTo(30, 1);
  });

  it('membranes: feed pressure and permeate quality are physically plausible', () => {
    expect(r.membrane.feedPressureBar!).toBeGreaterThan(8);
    expect(r.membrane.feedPressureBar!).toBeLessThan(18);
    expect(r.membrane.feedPressureBar!).toBeLessThan(BW30_400.maxPressureBar!);
    expect(r.membrane.permeateTdsMgL!).toBeGreaterThan(5);
    expect(r.membrane.permeateTdsMgL!).toBeLessThan(250);
    // concentrate TDS by mass balance ≈ feed / (1 − R)
    expect(r.membrane.concentrateTdsMgL!).toBeGreaterThan(9000);
    expect(r.membrane.concentrateTdsMgL!).toBeLessThan(10300);
  });

  it('HP pump: flow, pressure, head and motor', () => {
    const hp = r.pumps.find((p) => p.id === 'hp')!;
    expect(hp.enabled).toBe(true);
    expect(hp.designFlowM3h).toBeCloseTo(42, 1); // 40 × 1.05
    expect(hp.dischargePressureBar!).toBeGreaterThan(r.membrane.feedPressureBar!);
    // head ↔ pressure consistency (10.19 m/bar)
    expect(hp.designHeadM / hp.designPressureBar).toBeCloseTo(10.19, 1);
    // P = ρgQH/η/1000 : check shaft power
    const shaft = hydraulicKw(hp.designFlowM3h, hp.designHeadM) / (hp.efficiencyPct / 100);
    expect(hp.shaftKw).toBeCloseTo(shaft, 1);
    expect(hp.motorKw).toBeGreaterThanOrEqual(hp.shaftKw * 1.15 - 1e-6);
    expect(A.list('std_motors_kw')).toContain(hp.motorKw);
  });

  it('raw water pump: static head from dynamic level + elevation + tank', () => {
    const raw = r.pumps.find((p) => p.id === 'raw')!;
    expect(raw.designFlowM3h).toBeCloseTo(40 * 1.1 * 1.05, 2);
    const statics = raw.components.filter((c) => /Static lift|Elevation|tank inlet/.test(c.label)).reduce((s, c) => s + c.headM, 0);
    expect(statics).toBeCloseTo(55 + 5 + 4, 3);
    expect(raw.calculatedHeadM).toBeGreaterThan(64);
    expect(raw.designHeadM).toBeCloseTo(raw.calculatedHeadM * 1.1, 0);
  });

  it('feed pump provides HP suction pressure through pretreatment losses', () => {
    const feed = r.pumps.find((p) => p.id === 'feed')!;
    const needBar = 1.5 + r.pretreatment.totalDpBar + 1.0; // suction + filters + cartridge
    expect(feed.calculatedHeadM / 10.19).toBeGreaterThan(needBar);
  });

  it('pretreatment decisions follow the water analysis', () => {
    const inD = (id: string) => r.pretreatment.inDesignIds.includes(id as never);
    expect(inD('mmf')).toBe(true); // SDI 4.2 > 3
    expect(inD('iron_removal')).toBe(true); // Fe 0.25 > 0.1
    expect(inD('acf')).toBe(true); // pre-chlorination used
    expect(inD('cartridge')).toBe(true);
    expect(inD('antiscalant')).toBe(true);
    expect(inD('acid')).toBe(true); // concentrate LSI 2.05 > 1.8 and > 10 m³/h
    expect(inD('softener')).toBe(false);
    expect(r.pretreatment.scaling!.concentrateLsi!).toBeGreaterThan(1.8);
    expect(r.pretreatment.scalingAfterTreatment!.concentrateLsi!).toBeLessThanOrEqual(1.8);
    for (const it of r.pretreatment.items) expect(it.reason.length).toBeGreaterThan(10);
  });

  it('dosing, tanks, electrical, BOM and PFD are generated', () => {
    expect(r.dosing.map((d) => d.id).sort()).toEqual(['acid', 'antiscalant', 'post_chlorination', 'prechlorination']);
    const raw = r.tanks.find((t) => t.id === 'raw')!;
    expect(raw.calculatedM3).toBeCloseTo(40 * 1.1 * 2, 3);
    const perm = r.tanks.find((t) => t.id === 'permeate')!;
    expect(perm.calculatedM3).toBeCloseTo(120, 3);
    expect(perm.recommendedL).toBe(perm.recommendedM3 * 1000);
    expect(r.electrical.connectedKw).toBeGreaterThan(40);
    expect(r.electrical.specificEnergyKwhM3).toBeGreaterThan(0.5);
    const bomIds = r.bom.map((b) => b.id);
    for (const id of ['ro_membranes', 'pressure_vessels', 'pump_hp', 'pump_raw', 'cartridge_housing', 'flow_meters', 'pressure_gauges', 'conductivity_meters', 'ph_meter', 'tds_meter', 'control_panel', 'pressure_switches'])
      expect(bomIds).toContain(id);
    expect(r.bom.find((b) => b.id === 'ro_membranes')!.quantity).toBe(42);
    expect(r.pfd.main[0].id).toBe('source');
    expect(r.pfd.main.at(-1)!.id).toBe('product');
    expect(r.pfd.main.map((n) => n.id)).toEqual(expect.arrayContaining(['raw_pump', 'raw_tank', 'cartridge', 'hp_pump', 'ro', 'permeate_tank']));
  });

  it('has no critical findings', () => {
    expect(codes(r, 'critical')).toEqual([]);
    expect(r.counts.ok).toBeGreaterThan(10);
  });
});

describe('pipe sizing', () => {
  const sizes = seedPipeSizes().map((p, i) => ({ id: i + 1, ...p }));
  it('calculates diameter from flow and velocity, then picks the next catalogue size', () => {
    const r = sizePipe({ flowM3h: 40, material: 'PVC-U PN16', maxVelocity: 1.5, lengthM: 100, elevationM: 0, designPressureBar: 6, temperatureC: 25, fittingsPct: 25 }, sizes, SEED_PIPE_MATERIALS, A);
    const reqId = Math.sqrt((4 * (40 / 3600)) / (Math.PI * 1.5)) * 1000;
    expect(r.requiredIdMm).toBeCloseTo(reqId, 0);
    expect(r.innerDiameterMm!).toBeGreaterThanOrEqual(reqId);
    const smaller = sizes.filter((s) => s.material === 'PVC-U PN16' && s.innerDiameterMm < r.innerDiameterMm!);
    expect(smaller.every((s) => s.innerDiameterMm < reqId)).toBe(true);
    expect(r.velocity).toBeLessThanOrEqual(1.5);
    expect(r.status).toBe('ok');
    expect(r.totalLossM).toBeGreaterThan(r.frictionLossM);
  });

  it('larger flow gives a larger DN (not hard-coded)', () => {
    const a = sizePipe({ flowM3h: 5, material: 'PVC-U PN16', maxVelocity: 1.5, lengthM: 10, elevationM: 0, designPressureBar: 6, temperatureC: 25, fittingsPct: 0 }, sizes, SEED_PIPE_MATERIALS, A);
    const b = sizePipe({ flowM3h: 150, material: 'PVC-U PN16', maxVelocity: 1.5, lengthM: 10, elevationM: 0, designPressureBar: 6, temperatureC: 25, fittingsPct: 0 }, sizes, SEED_PIPE_MATERIALS, A);
    expect(b.dn!).toBeGreaterThan(a.dn!);
  });

  it('Darcy–Weisbach loss matches a hand calculation', () => {
    const r = sizePipe({ flowM3h: 40, material: 'Stainless Steel 316L Sch10S', maxVelocity: 2.5, lengthM: 50, elevationM: 0, designPressureBar: 15, temperatureC: 20, fittingsPct: 0 }, sizes, SEED_PIPE_MATERIALS, A);
    const d = r.innerDiameterMm! / 1000;
    const v = 40 / 3600 / ((Math.PI * d * d) / 4);
    const re = (v * d) / (waterViscosity(20) / 998);
    const f = 0.25 / Math.pow(Math.log10(0.015 / r.innerDiameterMm! / 3.7 + 5.74 / Math.pow(re, 0.9)), 2);
    const hf = f * (50 / d) * (v * v) / (2 * 9.81);
    expect(r.frictionLossM).toBeCloseTo(hf, 2);
  });

  it('flags pressure above the pipe rating and flow above the largest size', () => {
    const hp = sizePipe({ flowM3h: 40, material: 'PVC-U PN16', maxVelocity: 2.5, lengthM: 10, elevationM: 0, designPressureBar: 60, temperatureC: 25, fittingsPct: 0 }, sizes, SEED_PIPE_MATERIALS, A);
    expect(hp.status).toBe('critical');
    const huge = sizePipe({ flowM3h: 5000, material: 'PVC-U PN16', maxVelocity: 1.5, lengthM: 10, elevationM: 0, designPressureBar: 6, temperatureC: 25, fittingsPct: 0 }, sizes, SEED_PIPE_MATERIALS, A);
    expect(huge.status).toBe('critical');
    expect(huge.messages.some((m) => /parallel/.test(m.text))).toBe(true);
  });

  it('friction factor: laminar and turbulent regimes', () => {
    expect(frictionFactor(1000, 0.0015, 50)).toBeCloseTo(0.064, 4);
    const f = frictionFactor(1e5, 0.0015, 100);
    expect(f).toBeGreaterThan(0.015);
    expect(f).toBeLessThan(0.02);
  });
});

describe('pump calculations', () => {
  it('hydraulic power formula ρgQH', () => {
    // 36 m³/h (0.01 m³/s) at 100 m → 9.81 kW
    expect(hydraulicKw(36, 100)).toBeCloseTo(9.81, 3);
  });

  it('missing feed pump gives insufficient HP suction pressure (critical)', () => {
    const d = sample();
    d.hydraulics.feedPumpEnabled = false;
    const r = run(d);
    expect(codes(r, 'critical')).toContain('hp_suction');
    expect(r.hpSuctionAvailableBar!).toBeLessThan(1.5);
  });

  it('unrealistic efficiency is flagged', () => {
    const d = sample();
    d.assumptions.hp_pump_eff = 97;
    expect(codes(run(d), 'review')).toContain('hp_eff');
  });

  it('borehole deeper than pump setting is flagged', () => {
    const d = sample();
    d.water.boreholeDepth = 50;
    expect(codes(run(d), 'critical')).toContain('well_depth');
  });

  it('municipal supply with enough pressure needs no raw water pump', () => {
    const d = sample();
    d.water.source = 'municipal';
    d.water.feedPressureBar = 3;
    const raw = run(d).pumps.find((p) => p.id === 'raw')!;
    expect(raw.enabled).toBe(false);
  });
});

describe('membrane calculations', () => {
  it('temperature correction factor', () => {
    expect(tcf(25, 2640)).toBeCloseTo(1, 6);
    expect(tcf(15, 2640)).toBeLessThan(1);
    expect(tcf(35, 2640)).toBeGreaterThan(1);
  });

  it('colder water needs more feed pressure', () => {
    const d = sample();
    d.water.temperature = 15;
    expect(run(d).membrane.feedPressureBar!).toBeGreaterThan(run(sample()).membrane.feedPressureBar!);
  });

  it('log-mean concentration factor', () => {
    expect(logMeanCF(0.75)).toBeCloseTo(Math.log(4) / 0.75, 6);
  });

  it('stage split tapers 2:1', () => {
    expect(splitStages(7, 2)).toEqual([5, 2]);
    expect(splitStages(6, 2)).toEqual([4, 2]);
    expect(splitStages(7, 3)).toEqual([4, 2, 1]);
    expect(splitStages(1, 2)).toEqual([1]);
  });

  it('excessive flux is critical', () => {
    const d = sample();
    d.membrane.designFluxLmh = 40;
    const r = run(d);
    expect(r.membrane.actualFluxLmh).toBeGreaterThan(28);
    expect(codes(r, 'critical')).toContain('flux_high');
  });

  it('seawater feed with brackish membrane is critical; SW membrane accepted', () => {
    const d = sample();
    d.water = { ...d.water, source: 'seawater_open', tds: 38000, conductivity: 56000, sodium: 11800, chloride: 21000, sulfate: 2900, calcium: 450, magnesium: 1400, hardness: 6900, alkalinity: 140, ph: 8.1, temperature: 25 };
    d.production.recoveryPct = 42;
    const bad = run(d, BW30_400);
    expect(codes(bad, 'critical')).toEqual(expect.arrayContaining(['membrane_type', 'pressure_max']));
    const good = run(d, SW30);
    expect(codes(good, 'critical')).not.toContain('membrane_type');
    expect(good.membrane.feedPressureBar!).toBeGreaterThan(45);
    expect(good.membrane.feedPressureBar!).toBeLessThan(SW30.maxPressureBar!);
  });

  it('missing membrane specifications are critical', () => {
    const r = run(sample(), { ...BW30_400, activeAreaM2: null, testPressureBar: null });
    expect(codes(r, 'critical')).toContain('membrane_specs');
    expect(r.membrane.available).toBe(false);
  });
});

describe('validation of invalid inputs', () => {
  it('impossible recovery', () => {
    for (const rec of [0, 100, 120, -5]) {
      const d = sample();
      d.production.recoveryPct = rec;
      const r = run(d);
      expect(codes(r, 'critical')).toContain('recovery_impossible');
      expect(r.production.valid).toBe(false);
    }
  });

  it('recovery above practical limit', () => {
    const d = sample();
    d.production.recoveryPct = 92;
    expect(codes(run(d), 'critical')).toContain('recovery_limit');
  });

  it('negative values and zero hours', () => {
    const d = sample();
    d.water.iron = -1;
    d.production.operatingHours = 0;
    const r = run(d);
    expect(codes(r, 'critical')).toEqual(expect.arrayContaining(['negative_iron', 'hours']));
  });

  it('negative / zero production', () => {
    const d = sample();
    d.production.dailyProductionM3d = -100;
    expect(codes(run(d), 'critical')).toContain('daily');
  });

  it('unrealistic flow', () => {
    const d = sample();
    d.production.dailyProductionM3d = 200000;
    expect(codes(run(d), 'critical')).toContain('flow_unrealistic');
  });

  it('missing water-quality data → INSUFFICIENT DATA', () => {
    const d = blankDesign(defaultAssumptions(), BW30_400.id);
    const r = run(d);
    expect(codes(r, 'critical')).toEqual(expect.arrayContaining(['tds_missing', 'data_missing']));
    const ins = r.pretreatment.items.filter((i) => i.status === 'insufficient_data').map((i) => i.id);
    expect(ins).toEqual(expect.arrayContaining(['mmf', 'iron_removal', 'manganese_removal', 'antiscalant']));
    expect(r.findings.some((f) => f.message.includes('INSUFFICIENT DATA — LAB ANALYSIS REQUIRED'))).toBe(true);
    // Engine still produces a result (no exception) and does not invent a pressure
    expect(r.membrane.feedPressureBar).toBeNull();
    expect(codes(r, 'critical')).toContain('hp_no_pressure');
  });

  it('no membrane selected', () => {
    const r = run(sample(), null);
    expect(codes(r, 'critical')).toContain('no_membrane');
  });

  it('excessive pipe velocity when user forces a high max velocity', () => {
    const d = sample();
    d.hydraulics.pipes.hp_to_ro = { maxVelocity: 6 };
    const r = run(d);
    expect(r.pipes.find((p) => p.id === 'hp_to_ro')!.status).toBe('critical');
  });

  it('user exclusion of a required item is flagged', () => {
    const d = sample();
    d.pretreatment.overrides.cartridge = 'exclude';
    expect(codes(run(d), 'critical')).toContain('excluded_cartridge');
  });
});

describe('BOM overrides and costing', () => {
  it('applies user edits, removals, custom lines and cost', () => {
    const d = sample();
    d.bomOverrides.ro_membranes = { quantity: 48, unitCost: 500 };
    d.bomOverrides.tds_meter = { removed: true };
    d.customBom.push({ id: 'x1', category: 'Extra', item: 'Container', description: '', specification: '40 ft', quantity: 1, unit: 'pcs', notes: '', unitCost: 8000, costCategory: 'equipment' });
    d.costing = { enabled: true, currency: 'USD', installationPct: 10, engineeringPct: 5, contingencyPct: 10 };
    const r = run(d);
    const mem = r.bom.find((b) => b.id === 'ro_membranes')!;
    expect(mem.quantity).toBe(48);
    expect(mem.total).toBe(24000);
    expect(mem.edited).toBe(true);
    expect(r.bom.find((b) => b.id === 'tds_meter')!.removed).toBe(true);
    expect(r.cost.byCategory.equipment).toBe(32000);
    expect(r.cost.installation).toBeCloseTo(3200, 6);
    expect(r.cost.engineering).toBeCloseTo(1600, 6);
    expect(r.cost.total).toBeCloseTo((32000 + 3200 + 1600) * 1.1, 6);
  });
});

describe('water chemistry & units', () => {
  it('LSI saturation pH', () => {
    // Standard example: TDS 500, 25 °C, Ca 200, Alk 150 (as CaCO3) → pHs ≈ 7.3
    expect(phSaturation(500, 25, 200, 150)).toBeCloseTo(7.3, 0);
  });
  it('acid demand lowers alkalinity', () => {
    const a = acidDemand(7.4, 6.8, 250);
    expect(a.meq).toBeGreaterThan(0);
    expect(a.newAlkAsCaCO3).toBeLessThan(250);
  });
  it('unit conversions', () => {
    expect(convertFlow(1, 'm3/h', 'L/min')).toBeCloseTo(16.6667, 3);
    expect(convertFlow(24, 'm3/day', 'm3/h')).toBeCloseTo(1, 6);
    expect(convertPressure(1, 'bar', 'psi')).toBeCloseTo(14.5038, 3);
    expect(convertPressure(10.194, 'm', 'bar')).toBeCloseTo(1, 3);
    expect(convertPower(1, 'HP', 'kW')).toBeCloseTo(0.7457, 4);
  });
});
