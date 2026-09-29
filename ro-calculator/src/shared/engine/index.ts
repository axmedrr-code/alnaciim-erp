import { AssumptionReader, mergeAssumptions } from '../assumptions';
import type { DesignContext, DesignInput, PipeSectionId } from '../types';
import { WATER_SOURCE_LABELS } from '../types';
import { applyBomOverrides, BomLine, calcCost, CostResult, generateBom } from './bom';
import { barToM, Finding, Findings, isNum, Level, mToBar, round } from './common';
import { calcDosing, DosingLine } from './dosing';
import { calcElectrical, ElectricalResult } from './electrical';
import { calcMembrane, MembraneResult } from './membrane';
import { calcPipeSections, PipeSectionResult, SectionFlows } from './pipes';
import { calcPretreatment, PretreatmentResult, ptIn } from './pretreatment';
import { calcProduction, ProductionResult } from './production';
import { buildPump, HeadComponent, PumpResult } from './pumps';
import { calcTanks, TankResult } from './tanks';
import { analyseWater, WaterAnalysis } from './water';

export interface PfdNode {
  id: string;
  label: string;
  sub: string;
  kind: 'source' | 'pump' | 'tank' | 'filter' | 'membrane' | 'uv' | 'product' | 'drain';
  chemicals: string[];
}

export interface DesignSummary {
  permeateM3h: number;
  dailyProductionM3d: number;
  recoveryPct: number;
  feedM3h: number;
  rejectM3h: number;
  membrane: string;
  membranes: number;
  vessels: number;
  array: string;
  fluxLmh: number;
  feedPressureBar: number | null;
  permeateTdsMgL: number | null;
  hpFlowM3h: number;
  hpPressureBar: number | null;
  hpHeadM: number;
  hpMotorKw: number;
  rawFlowM3h: number;
  rawHeadM: number;
  rawMotorKw: number;
  connectedKw: number;
  runningKw: number;
  specificEnergyKwhM3: number;
  pipeSizes: { label: string; dn: number | null }[];
}

export interface DesignResult {
  engineVersion: string;
  calculatedAt: string;
  water: WaterAnalysis;
  production: ProductionResult;
  membrane: MembraneResult;
  pretreatment: PretreatmentResult;
  pipes: PipeSectionResult[];
  pumps: PumpResult[];
  hpSuctionAvailableBar: number | null;
  dosing: DosingLine[];
  tanks: TankResult[];
  electrical: ElectricalResult;
  bom: BomLine[];
  cost: CostResult;
  pfd: { main: PfdNode[]; reject: PfdNode };
  summary: DesignSummary;
  findings: Finding[];
  counts: Record<Level, number>;
  assumptionsUsed: Record<string, number | number[]>;
}

export const ENGINE_VERSION = '1.0.0';
/** Level of water in the raw tank above the feed-pump suction, used when no feed pump is installed. */
const RAW_TANK_LEVEL_M = 2;

export function runDesign(input: DesignInput, ctx: DesignContext): DesignResult {
  const assumptions = mergeAssumptions(input.assumptions);
  const A = new AssumptionReader(assumptions);
  const f = new Findings();
  const w = input.water;

  const water = analyseWater(w, A, f);
  const T = water.temperature;
  const prod = calcProduction(input.production, w.source, A, f);
  const mem = calcMembrane(input.membrane, ctx.membrane, prod, w.source, water.tds, T, w.ph, A, f);
  const pt = calcPretreatment(input.pretreatment, w, w.source, water.tds, T, prod, A, f);

  // ------------------------------------------------ Flows through pipe sections
  const flowMargin = 1 + A.n('flow_safety_margin') / 100;
  const rawFlow = prod.feedM3h * A.n('raw_flow_factor');
  const distFlow = isNum(input.hydraulics.distributionFlowM3h) && input.hydraulics.distributionFlowM3h > 0
    ? input.hydraulics.distributionFlowM3h
    : isNum(input.tanks.peakDemandM3h) && input.tanks.peakDemandM3h > 0 ? input.tanks.peakDemandM3h : prod.permeateM3h;
  const isWell = w.source === 'well';
  const dyn = isNum(w.dynamicLevel) ? w.dynamicLevel : isNum(w.staticLevel) ? w.staticLevel : null;
  const lift = isWell ? dyn ?? 0 : 0;
  const riser = isWell ? (dyn ?? 0) + A.n('well_submergence_m') : 0;
  const sf: SectionFlows = {
    flows: {
      borehole_to_raw_tank: rawFlow * flowMargin,
      raw_tank_to_pretreatment: input.hydraulics.feedPumpEnabled ? prod.feedM3h * flowMargin : prod.feedM3h,
      pretreatment_to_cartridge: prod.feedM3h,
      cartridge_to_hp: prod.feedM3h,
      hp_to_ro: prod.feedM3h,
      permeate_to_tank: prod.permeateM3h,
      reject_to_drain: prod.rejectM3h,
      product_to_distribution: input.hydraulics.productPumpEnabled ? distFlow * flowMargin : distFlow,
    },
    defaultLengths: { borehole_to_raw_tank: round(riser + (isNum(w.distanceToPlant) ? w.distanceToPlant : 100), 1) },
    defaultElevations: { borehole_to_raw_tank: round(lift + (isNum(w.elevationDifference) ? w.elevationDifference : 0) + A.n('raw_tank_inlet_height_m'), 1) },
    defaultPressures: {
      borehole_to_raw_tank: 10, raw_tank_to_pretreatment: 6, pretreatment_to_cartridge: 6, cartridge_to_hp: 6,
      hp_to_ro: (mem.feedPressureBar ?? 15) * 1.2, permeate_to_tank: 4, reject_to_drain: 4, product_to_distribution: 6,
    },
  };
  // First pass (losses only – design pressures refined after the pumps are known)
  const pipes1 = calcPipeSections(sf, input.hydraulics.pipes, ctx.pipeSizes, ctx.pipeMaterials, T, A, new Findings());
  const pipe = (id: PipeSectionId) => pipes1.find((p) => p.id === id)!;

  // ------------------------------------------------ Pumps
  const pumps: PumpResult[] = [];
  const ptDpBar = pt.totalDpBar;
  const cartDpBar = A.n('cartridge_dp_bar');

  // Raw water pump
  const rawComp: HeadComponent[] = [];
  if (isWell) {
    if (!isNum(w.dynamicLevel)) {
      if (isNum(w.staticLevel)) f.review('Pumps', 'dyn_missing', `Dynamic water level missing – static level ${w.staticLevel} m used. Pump test data is required; drawdown will increase the required head.`);
      else f.critical('Pumps', 'dyn_missing', 'Borehole dynamic and static water levels missing – INSUFFICIENT DATA for raw water pump head. A borehole pump test is required.');
    }
    if (isNum(w.dynamicLevel) && isNum(w.staticLevel) && w.dynamicLevel < w.staticLevel) f.critical('Raw Water', 'levels', 'Dynamic water level is above the static level – check borehole data.');
    if (isNum(w.boreholeDepth) && dyn !== null && dyn + A.n('well_submergence_m') > w.boreholeDepth)
      f.critical('Pumps', 'well_depth', `Pump setting depth ${dyn + A.n('well_submergence_m')} m (dynamic level + submergence) exceeds the borehole depth ${w.boreholeDepth} m.`);
    rawComp.push({ label: 'Static lift (dynamic water level)', headM: lift, note: dyn === null ? 'not entered' : `${dyn} m below ground` });
  }
  rawComp.push({ label: 'Elevation: plant above wellhead/source', headM: isNum(w.elevationDifference) ? w.elevationDifference : 0, note: isNum(w.elevationDifference) ? '' : 'not entered – 0 m' });
  rawComp.push({ label: 'Raw tank inlet height', headM: A.n('raw_tank_inlet_height_m'), note: 'assumption' });
  rawComp.push({ label: 'Pipe friction + fittings', headM: pipe('borehole_to_raw_tank').totalLossM, note: `${pipe('borehole_to_raw_tank').lengthM} m, DN ${pipe('borehole_to_raw_tank').dn}` });
  rawComp.push({ label: 'Filter / strainer loss', headM: barToM(A.n('wellhead_strainer_loss_bar')), note: `${A.n('wellhead_strainer_loss_bar')} bar` });
  if (!isWell && isNum(w.feedPressureBar) && w.feedPressureBar > 0) rawComp.push({ label: 'Available source pressure', headM: -barToM(w.feedPressureBar), note: `${w.feedPressureBar} bar` });
  const rawHeadSum = rawComp.reduce((s, c) => s + c.headM, 0);
  const rawEnabled = prod.valid && (isWell || rawHeadSum > 0);
  if (!isWell && rawHeadSum <= 0) f.ok('Pumps', 'raw_not_needed', 'Available source pressure is sufficient to fill the raw water tank – no raw water pump required.');
  pumps.push(buildPump({ id: 'raw', name: isWell ? 'Raw water (borehole) pump' : 'Raw water / intake pump', pumpType: 'borehole', enabled: rawEnabled, processFlowM3h: rawFlow, components: rawComp, effKey: 'raw_pump_eff', suctionPressureBar: isWell ? null : 0 }, ctx.pumps, A, f));

  // Feed / booster pump
  const lpPipes = (['raw_tank_to_pretreatment', 'pretreatment_to_cartridge', 'cartridge_to_hp'] as PipeSectionId[]).map(pipe);
  const lpFriction = lpPipes.reduce((s, p) => s + p.totalLossM, 0);
  const lpElev = lpPipes.reduce((s, p) => s + p.elevationM, 0);
  const feedEnabled = input.hydraulics.feedPumpEnabled && prod.valid;
  const feedComp: HeadComponent[] = [
    { label: 'Required HP pump suction pressure', headM: barToM(A.n('hp_min_suction_bar')), note: `${A.n('hp_min_suction_bar')} bar` },
    { label: 'Pretreatment filters pressure loss', headM: barToM(ptDpBar), note: `${ptDpBar} bar` },
    { label: 'Cartridge filter pressure loss', headM: barToM(cartDpBar), note: `${cartDpBar} bar (dirty)` },
    { label: 'Pipe friction + fittings', headM: lpFriction, note: 'Raw tank → HP suction' },
    { label: 'Static elevation', headM: lpElev, note: '' },
  ];
  pumps.push(buildPump({ id: 'feed', name: 'Feed / booster pump', pumpType: 'feed', enabled: feedEnabled, processFlowM3h: prod.feedM3h, components: feedComp, effKey: 'feed_pump_eff', suctionPressureBar: 0 }, ctx.pumps, A, f));

  // HP suction pressure available
  let hpSuction: number | null;
  if (feedEnabled) hpSuction = A.n('hp_min_suction_bar');
  else {
    hpSuction = round(mToBar(RAW_TANK_LEVEL_M - lpFriction - lpElev) - ptDpBar - cartDpBar, 2);
    if (prod.valid && hpSuction < A.n('hp_min_suction_bar'))
      f.critical('Pumps', 'hp_suction', `Insufficient feed pressure at the HP pump suction: ≈ ${hpSuction} bar available vs ${A.n('hp_min_suction_bar')} bar required (pretreatment ${ptDpBar} bar + cartridge ${cartDpBar} bar losses). Enable the feed/booster pump.`);
  }

  // HP pump
  const hpPipe = pipe('hp_to_ro');
  const hpComp: HeadComponent[] = [
    { label: 'Required membrane feed pressure', headM: barToM(mem.feedPressureBar ?? 0), note: mem.feedPressureBar != null ? `${mem.feedPressureBar} bar` : 'NOT AVAILABLE' },
    { label: 'HP → RO pipe friction + fittings', headM: hpPipe.totalLossM, note: `DN ${hpPipe.dn}` },
    { label: 'HP → RO static elevation', headM: hpPipe.elevationM, note: '' },
    { label: 'Less: suction pressure', headM: -barToM(Math.max(hpSuction ?? 0, 0)), note: `${Math.max(hpSuction ?? 0, 0)} bar` },
  ];
  if (mem.available && mem.feedPressureBar == null) f.critical('Pumps', 'hp_no_pressure', 'HP pump pressure cannot be calculated: feed TDS is missing. INSUFFICIENT DATA — LAB ANALYSIS REQUIRED.');
  const hp = buildPump({
    id: 'hp', name: 'High-pressure RO pump', pumpType: 'high_pressure', enabled: prod.valid && mem.available, processFlowM3h: prod.feedM3h, components: hpComp, effKey: 'hp_pump_eff',
    suctionPressureBar: Math.max(hpSuction ?? 0, 0),
    notes: ['Pretreatment pressure loss is overcome by the feed pump; the HP pump provides membrane feed pressure minus suction pressure.', 'Energy recovery device not included (brackish design).'],
  }, ctx.pumps, A, f);
  pumps.push(hp);
  if (hp.enabled && hp.dischargePressureBar != null && ctx.membrane?.maxPressureBar && hp.dischargePressureBar > ctx.membrane.maxPressureBar)
    f.review('Pumps', 'hp_max', `HP pump design discharge ${hp.dischargePressureBar} bar (incl. safety margin) exceeds the membrane maximum ${ctx.membrane.maxPressureBar} bar – limit with VFD/pressure switch.`);

  // Product pump
  const pdPipe = pipe('product_to_distribution');
  const hd = input.hydraulics.distributionHeadM;
  if (!isNum(hd) || hd < 0) f.critical('Pumps', 'dist_head', 'Distribution head must be zero or positive.');
  pumps.push(buildPump({
    id: 'product', name: 'Product water / distribution pump', pumpType: 'product', enabled: input.hydraulics.productPumpEnabled && prod.valid, processFlowM3h: distFlow,
    components: [
      { label: 'Required distribution head', headM: isNum(hd) ? Math.max(hd, 0) : 0, note: 'project input' },
      { label: 'Pipe friction + fittings', headM: pdPipe.totalLossM, note: `${pdPipe.lengthM} m, DN ${pdPipe.dn}` },
      { label: 'Static elevation', headM: pdPipe.elevationM, note: '' },
    ],
    effKey: 'product_pump_eff', suctionPressureBar: 0,
  }, ctx.pumps, A, f));

  // CIP pump
  if (input.pretreatment.cip && mem.available) {
    const maxVessels = Math.max(...mem.stageDetail.map((s) => s.vessels));
    pumps.push(buildPump({
      id: 'cip', name: 'CIP (cleaning) pump', pumpType: 'cip', enabled: true, processFlowM3h: maxVessels * A.n('cip_flow_per_vessel'),
      components: [{ label: 'CIP circuit head', headM: A.n('cip_head_m'), note: 'assumption' }], effKey: 'cip_pump_eff', applyFlowMargin: false, suctionPressureBar: 0,
      notes: [`${maxVessels} vessels (largest stage) × ${A.n('cip_flow_per_vessel')} m³/h`],
    }, ctx.pumps, A, f));
  }

  // ------------------------------------------------ Pipes – second pass with real design pressures
  const pr = (id: string) => pumps.find((p) => p.id === id);
  const rawP = pr('raw');
  const feedP = pr('feed');
  const lpPressure = feedP?.enabled ? feedP.dischargePressureBar ?? 6 : 3;
  sf.defaultPressures = {
    borehole_to_raw_tank: rawP?.enabled ? round(rawP.designPressureBar, 1) : isNum(w.feedPressureBar) ? w.feedPressureBar : 6,
    raw_tank_to_pretreatment: lpPressure,
    pretreatment_to_cartridge: lpPressure,
    cartridge_to_hp: lpPressure,
    hp_to_ro: hp.dischargePressureBar ?? sf.defaultPressures.hp_to_ro,
    permeate_to_tank: Math.max(A.n('permeate_backpressure_bar') + 1, 2),
    reject_to_drain: 4,
    product_to_distribution: pr('product')?.enabled ? pr('product')!.designPressureBar : 4,
  };
  const pipes = calcPipeSections(sf, input.hydraulics.pipes, ctx.pipeSizes, ctx.pipeMaterials, T, A, f);

  // ------------------------------------------------ Dosing, tanks, electrical
  const hours = prod.valid ? input.production.operatingHours : 0;
  const dosing = calcDosing(w, prod, pt, hours, A, f);
  const tanks = calcTanks(input.tanks, prod, mem, dosing, input.pretreatment.cip, A, f);
  const uvKw = ptIn(pt, 'uv') ? prod.permeateM3h * A.n('uv_kw_per_m3h') : 0;
  const elec = calcElectrical(pumps, dosing, uvKw, hours, prod.dailyProductionM3d, A, f);

  // ------------------------------------------------ BOM & cost
  const baseBom = generateBom({ prod, mem, membraneDiameterIn: ctx.membrane?.diameterIn ?? 8, pt, pumps, pipes, dosing, tanks, elec, hpDischargeBar: hp.dischargePressureBar });
  const bom = applyBomOverrides(baseBom, input.bomOverrides ?? {}, input.customBom ?? []);
  const cost = calcCost(bom, input.costing);

  // ------------------------------------------------ PFD
  const chem = (id: string, name: string) => (ptIn(pt, id as never) ? [name] : []);
  const sourceLabel: Record<string, string> = { well: 'Borehole', surface: 'Surface water intake', municipal: 'Municipal supply', seawater_well: 'Beach well', seawater_open: 'Seawater intake' };
  const main: PfdNode[] = [{ id: 'source', label: sourceLabel[w.source], sub: WATER_SOURCE_LABELS[w.source], kind: 'source', chemicals: [] }];
  if (rawP?.enabled) main.push({ id: 'raw_pump', label: 'Raw Water Pump', sub: `${rawP.designFlowM3h} m³/h @ ${rawP.designHeadM} m`, kind: 'pump', chemicals: chem('prechlorination', 'NaOCl (pre-chlorination)') });
  const rawTank = tanks.find((t) => t.id === 'raw');
  main.push({ id: 'raw_tank', label: 'Raw Water Tank', sub: `${rawTank?.recommendedM3 ?? 0} m³`, kind: 'tank', chemicals: rawP?.enabled ? [] : chem('prechlorination', 'NaOCl (pre-chlorination)') });
  if (feedP?.enabled) main.push({ id: 'feed_pump', label: 'Feed Pump', sub: `${feedP.designFlowM3h} m³/h @ ${feedP.designHeadM} m`, kind: 'pump', chemicals: [] });
  const filterOrder: [string, string][] = [['sand_filter', 'Sand Filter'], ['iron_removal', 'Iron/Mn Filter'], ['manganese_removal', 'Manganese Filter'], ['mmf', 'Multimedia Filter'], ['acf', 'Carbon Filter'], ['softener', 'Softener']];
  for (const [id, label] of filterOrder) {
    const it = pt.items.find((i) => i.id === id);
    if (!it?.inDesign) continue;
    if (id === 'manganese_removal' && ptIn(pt, 'iron_removal')) continue;
    const s = it.sizing;
    const sub = s?.kind === 'filter' ? `${s.vessels} × Ø${s.diameterMm} mm` : s?.kind === 'softener' ? `${s.vessels} × Ø${s.diameterMm} mm` : '';
    main.push({ id, label, sub, kind: 'filter', chemicals: [] });
  }
  const cartItem = pt.items.find((i) => i.id === 'cartridge');
  main.push({
    id: 'cartridge', label: 'Cartridge Filter', sub: cartItem?.sizing?.kind === 'cartridge' ? `${cartItem.sizing.micron} µm, ${cartItem.sizing.housings} × ${cartItem.sizing.roundsPerHousing} × 40"` : '', kind: 'filter',
    chemicals: [...chem('acid', 'HCl (acid)'), ...chem('smbs', 'SMBS'), ...chem('antiscalant', 'Antiscalant')],
  });
  if (hp.enabled) main.push({ id: 'hp_pump', label: 'High Pressure Pump', sub: `${hp.designFlowM3h} m³/h @ ${hp.dischargePressureBar} bar`, kind: 'pump', chemicals: [] });
  main.push({ id: 'ro', label: 'RO Membranes', sub: mem.available ? `${mem.elements} el. / ${mem.vessels} PV, ${mem.arrayLabel.split(' ')[0]}` : 'not designed', kind: 'membrane', chemicals: [] });
  if (ptIn(pt, 'uv')) main.push({ id: 'uv', label: 'UV Steriliser', sub: `${round(prod.permeateM3h, 1)} m³/h`, kind: 'uv', chemicals: [] });
  const permTank = tanks.find((t) => t.id === 'permeate');
  main.push({ id: 'permeate_tank', label: 'Permeate Tank', sub: `${permTank?.recommendedM3 ?? 0} m³`, kind: 'tank', chemicals: chem('post_chlorination', 'NaOCl (post-chlorination)') });
  const prodP = pr('product');
  if (prodP?.enabled) main.push({ id: 'product_pump', label: 'Product Pump', sub: `${prodP.designFlowM3h} m³/h @ ${prodP.designHeadM} m`, kind: 'pump', chemicals: [] });
  main.push({ id: 'product', label: 'Product Water', sub: `${round(prod.permeateM3h, 2)} m³/h, ${mem.permeateTdsMgL ?? '–'} mg/L`, kind: 'product', chemicals: [] });
  const reject: PfdNode = {
    id: 'reject', label: input.tanks.rejectRecovery ? 'Reject Tank / Recovery' : 'Reject to Drain', sub: `${round(prod.rejectM3h, 2)} m³/h, ${mem.concentrateTdsMgL ?? '–'} mg/L`, kind: 'drain', chemicals: [],
  };

  // ------------------------------------------------ Summary & findings
  const summary: DesignSummary = {
    permeateM3h: round(prod.permeateM3h, 2),
    dailyProductionM3d: round(prod.dailyProductionM3d, 1),
    recoveryPct: prod.recoveryPct,
    feedM3h: round(prod.feedM3h, 2),
    rejectM3h: round(prod.rejectM3h, 2),
    membrane: mem.membraneLabel,
    membranes: mem.elements,
    vessels: mem.vessels,
    array: mem.arrayLabel,
    fluxLmh: mem.actualFluxLmh,
    feedPressureBar: mem.feedPressureBar,
    permeateTdsMgL: mem.permeateTdsMgL,
    hpFlowM3h: hp.designFlowM3h,
    hpPressureBar: hp.dischargePressureBar,
    hpHeadM: hp.designHeadM,
    hpMotorKw: hp.motorKw,
    rawFlowM3h: rawP?.designFlowM3h ?? 0,
    rawHeadM: rawP?.designHeadM ?? 0,
    rawMotorKw: rawP?.motorKw ?? 0,
    connectedKw: elec.connectedKw,
    runningKw: elec.runningKw,
    specificEnergyKwhM3: elec.specificEnergyKwhM3,
    pipeSizes: pipes.map((p) => ({ label: p.label, dn: p.flowM3h > 0 ? p.dn : null })),
  };

  const order: Record<Level, number> = { critical: 0, review: 1, ok: 2 };
  const findings = [...f.items].sort((a, b) => order[a.level] - order[b.level]);
  const counts: Record<Level, number> = { critical: 0, review: 0, ok: 0 };
  for (const x of findings) counts[x.level]++;

  return {
    engineVersion: ENGINE_VERSION,
    calculatedAt: new Date().toISOString(),
    water,
    production: prod,
    membrane: mem,
    pretreatment: pt,
    pipes,
    pumps,
    hpSuctionAvailableBar: hpSuction,
    dosing,
    tanks,
    electrical: elec,
    bom,
    cost,
    pfd: { main, reject },
    summary,
    findings,
    counts,
    assumptionsUsed: assumptions,
  };
}

export * from './common';
export { sizePipe, PIPE_SECTIONS } from './pipes';
export type { PipeSectionResult, PipeCalcResult } from './pipes';
export { PT_STATUS_LABEL, INSUFFICIENT } from './pretreatment';
export type { PretreatmentItem, PretreatmentResult } from './pretreatment';
export type { PumpResult } from './pumps';
export type { MembraneResult } from './membrane';
export type { BomLine, CostResult } from './bom';
export type { DosingLine } from './dosing';
export type { TankResult } from './tanks';
export type { ElectricalResult } from './electrical';
