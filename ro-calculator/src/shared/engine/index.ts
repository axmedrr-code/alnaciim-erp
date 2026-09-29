import { AssumptionReader, mergeAssumptions } from '../assumptions';
import type { DesignContext, DesignInput, PipeSectionId, PumpDutyId } from '../types';
import { normalizeDesign } from '../sample';
import { WATER_SOURCE_LABELS } from '../types';
import { applyBomOverrides, BomLine, calcCost, CostResult, generateBom } from './bom';
import { barToM, CalcStep, Finding, Findings, isNum, Level, mToBar, n, round, step } from './common';
import { calcDosing, DosingLine } from './dosing';
import { calcElectrical, ElectricalResult } from './electrical';
import { calcMembrane, MembraneResult } from './membrane';
import { calcPipeSections, PipeSectionResult, SectionFlows } from './pipes';
import { calcPretreatment, PretreatmentResult, ptIn } from './pretreatment';
import { calcProduction, ProductionResult } from './production';
import { buildPump, HeadComponent, PumpResult, vapourHeadM } from './pumps';
import { calcChemistry, ChemistryResult } from './chemistry';
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
  hpRequiredMotorKw: number;
  rawFlowM3h: number;
  rawHeadM: number;
  rawMotorKw: number;
  rawRequiredMotorKw: number;
  osmoticFeedBar: number | null;
  configMode: 'auto' | 'manual';
  connectedKw: number;
  runningKw: number;
  specificEnergyKwhM3: number;
  pipeSizes: { label: string; dn: number | null }[];
}

export interface DesignResult {
  engineVersion: string;
  calculatedAt: string;
  water: WaterAnalysis;
  chemistry: ChemistryResult;
  production: ProductionResult;
  membrane: MembraneResult;
  pretreatment: PretreatmentResult;
  pipes: PipeSectionResult[];
  pumps: PumpResult[];
  hpSuctionAvailableBar: number | null;
  trace: Record<string, CalcStep[]>;
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

export const ENGINE_VERSION = '2.0.0';

export function runDesign(input0: DesignInput, ctx: DesignContext): DesignResult {
  const input = normalizeDesign(input0);
  const assumptions = mergeAssumptions(input.assumptions);
  const A = new AssumptionReader(assumptions);
  const f = new Findings();
  const w = input.water;
  const H = input.hydraulics;

  const water = analyseWater(w, A, f);
  const T = water.temperature;
  const Tv = water.viscosityTemperature;
  const prod = calcProduction(input.production, w.source, A, f);
  const chem = calcChemistry(w, T, prod.valid ? prod.recoveryPct : null, A, f);
  const tdsUsed = chem.tdsUsed;
  const mem = calcMembrane(input.membrane, ctx.membrane, prod, w.source, tdsUsed, T, w.ph, chem.osmoticPerMgL, A, f);
  const pt = calcPretreatment(input.pretreatment, w, w.source, tdsUsed, T, prod, A, f);

  // ------------------------------------------------ Flows through pipe sections
  const flowMargin = 1 + A.n('flow_safety_margin') / 100;
  const pumpFlow = (id: PumpDutyId, base: number) => {
    const o = H.pumps[id]?.flowM3h;
    return isNum(o) && o > 0 ? o : base * flowMargin;
  };
  const rawFlow = prod.feedM3h * A.n('raw_flow_factor');
  const distFlow = isNum(H.distributionFlowM3h) && H.distributionFlowM3h > 0
    ? H.distributionFlowM3h
    : isNum(input.tanks.peakDemandM3h) && input.tanks.peakDemandM3h > 0 ? input.tanks.peakDemandM3h : prod.permeateM3h;
  const isWell = w.source === 'well';
  const dyn = isNum(w.dynamicLevel) ? w.dynamicLevel : isNum(w.staticLevel) ? w.staticLevel : null;
  const lift = isWell ? dyn ?? 0 : 0;
  const riser = isWell ? (dyn ?? 0) + A.n('well_submergence_m') : 0;
  const elevDiff = isNum(w.elevationDifference) ? w.elevationDifference : 0;
  const sf: SectionFlows = {
    flows: {
      borehole_to_raw_tank: pumpFlow('raw', rawFlow),
      raw_tank_to_pretreatment: H.feedPumpEnabled ? pumpFlow('feed', prod.feedM3h) : prod.feedM3h,
      pretreatment_to_cartridge: prod.feedM3h,
      cartridge_to_hp: prod.feedM3h,
      hp_to_ro: pumpFlow('hp', prod.feedM3h),
      permeate_to_tank: prod.permeateM3h,
      reject_to_drain: prod.rejectM3h,
      product_to_distribution: H.productPumpEnabled ? pumpFlow('product', distFlow) : distFlow,
    },
    defaultLengths: { borehole_to_raw_tank: round(riser + (isNum(w.distanceToPlant) ? w.distanceToPlant : 100), 1) },
    defaultElevations: {},
    defaultPressures: {
      borehole_to_raw_tank: 10, raw_tank_to_pretreatment: 6, pretreatment_to_cartridge: 6, cartridge_to_hp: 6,
      hp_to_ro: (mem.feedPressureBar ?? 15) * 1.2, permeate_to_tank: 4, reject_to_drain: 4, product_to_distribution: 6,
    },
  };
  // First pass (losses only – design pressures refined after the pumps are known)
  const pipes1 = calcPipeSections(sf, H.pipes, H.frictionMethod, ctx.pipeSizes, ctx.pipeMaterials, Tv, A, new Findings());
  const pipe = (id: PipeSectionId) => pipes1.find((p) => p.id === id)!;
  const pipeComps = (ids: PipeSectionId[]): HeadComponent[] =>
    ids.flatMap((id) => {
      const p = pipe(id);
      return [
        { category: 'friction' as const, label: `${p.label}: friction`, headM: p.frictionLossM, note: `${p.lengthM} m DN ${p.dn}, ${p.method === 'hazen' ? 'Hazen–Williams' : 'Darcy–Weisbach'}` },
        { category: 'minor' as const, label: `${p.label}: fittings & valves`, headM: p.minorLossM, note: `ΣK ${p.sumK}` },
        ...(p.elevationM ? [{ category: 'static' as const, label: `${p.label}: elevation`, headM: p.elevationM, note: 'section input' }] : []),
      ];
    });
  const extra = (id: PumpDutyId): HeadComponent[] => {
    const x = H.pumps[id]?.extraLossBar;
    return isNum(x) && x !== 0 ? [{ category: 'equipment', label: 'Additional equipment / valve loss', headM: barToM(x), note: `${x} bar (project input)` }] : [];
  };
  const libPump = (id: PumpDutyId) => {
    const pid = H.pumps[id]?.libraryPumpId;
    return pid ? ctx.pumps.find((p) => p.id === pid) ?? null : null;
  };
  const effOv = (id: PumpDutyId) => H.pumps[id]?.efficiencyPct ?? null;
  const flowOv = (id: PumpDutyId) => H.pumps[id]?.flowM3h ?? null;
  const vap = vapourHeadM(Tv);
  const tankNpsha = (suctionPipe: PipeSectionId | null) => {
    const loss = suctionPipe ? Math.min(pipe(suctionPipe).totalLossM, pipe(suctionPipe).totalLossM) : 0;
    return A.n('atm_head_m') + A.n('tank_min_level_m') - loss - vap;
  };

  // ------------------------------------------------ Pumps
  const pumps: PumpResult[] = [];
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
    rawComp.push({ category: 'static', label: 'Dynamic water level (lift to ground)', headM: lift, note: dyn === null ? 'NOT ENTERED' : `${dyn} m below ground` });
  }
  rawComp.push({ category: 'static', label: 'Elevation: plant above wellhead/source', headM: elevDiff, note: isNum(w.elevationDifference) ? 'input' : 'not entered – 0 m' });
  rawComp.push({ category: 'static', label: 'Raw tank inlet height', headM: A.n('raw_tank_inlet_height_m'), note: 'assumption' });
  rawComp.push(...pipeComps(['borehole_to_raw_tank']));
  rawComp.push({ category: 'equipment', label: 'Wellhead strainer / filter', headM: barToM(A.n('wellhead_strainer_loss_bar')), note: `${A.n('wellhead_strainer_loss_bar')} bar` });
  rawComp.push(...extra('raw'));
  if (!isWell && isNum(w.feedPressureBar) && w.feedPressureBar > 0) rawComp.push({ category: 'suction', label: 'Available source pressure', headM: -barToM(w.feedPressureBar), note: `${w.feedPressureBar} bar` });
  const rawHeadSum = rawComp.reduce((s, c) => s + c.headM, 0);
  const rawEnabled = prod.valid && (isWell || rawHeadSum > 0);
  if (!isWell && rawHeadSum <= 0) f.ok('Pumps', 'raw_not_needed', 'Available source pressure is sufficient to fill the raw water tank – no raw water pump required.');
  pumps.push(buildPump({
    id: 'raw', name: isWell ? 'Raw water (borehole) pump' : 'Raw water / intake pump', pumpType: 'borehole', enabled: rawEnabled, processFlowM3h: rawFlow, flowOverrideM3h: flowOv('raw'),
    components: rawComp, effKey: 'raw_pump_eff', efficiencyOverride: effOv('raw'), suctionPressureBar: isWell ? null : 0, selectedPump: libPump('raw'),
    npshAvailableM: null, npshNote: isWell ? 'Submersible pump – NPSH ensured by submergence below dynamic level' : 'Not evaluated',
    notes: isWell ? [`Riser + transfer pipe length ${pipe('borehole_to_raw_tank').lengthM} m = pump setting ${round(riser, 1)} m + distance ${isNum(w.distanceToPlant) ? w.distanceToPlant : '100 (default)'} m.`] : [],
  }, ctx.pumps, A, f));

  // Feed / booster pump
  const feedEnabled = H.feedPumpEnabled && prod.valid;
  const ptItems = pt.items.filter((i) => i.inDesign && i.category === 'Physical' && i.id !== 'cartridge' && i.dpBar > 0);
  const feedComp: HeadComponent[] = [
    { category: 'terminal', label: 'Required HP pump suction pressure', headM: barToM(A.n('hp_min_suction_bar')), note: `${A.n('hp_min_suction_bar')} bar` },
    ...ptItems.map((i) => ({ category: 'equipment' as const, label: i.name, headM: barToM(i.dpBar), note: `${i.dpBar} bar` })),
    { category: 'equipment', label: 'Cartridge filter (dirty)', headM: barToM(cartDpBar), note: `${cartDpBar} bar` },
    ...pipeComps(['raw_tank_to_pretreatment', 'pretreatment_to_cartridge', 'cartridge_to_hp']),
    ...extra('feed'),
  ];
  pumps.push(buildPump({
    id: 'feed', name: 'Feed / booster pump', pumpType: 'feed', enabled: feedEnabled, processFlowM3h: prod.feedM3h, flowOverrideM3h: flowOv('feed'), components: feedComp,
    effKey: 'feed_pump_eff', efficiencyOverride: effOv('feed'), suctionPressureBar: 0, selectedPump: libPump('feed'),
    npshAvailableM: tankNpsha('raw_tank_to_pretreatment'), npshNote: `NPSHa = H_atm ${A.n('atm_head_m')} + min level ${A.n('tank_min_level_m')} − suction line loss − vapour ${round(vap, 2)} m`,
  }, ctx.pumps, A, f));

  // HP suction pressure available
  const lpLoss = (['raw_tank_to_pretreatment', 'pretreatment_to_cartridge', 'cartridge_to_hp'] as PipeSectionId[]).reduce((s, id) => s + pipe(id).totalLossM + pipe(id).elevationM, 0);
  let hpSuction: number;
  if (feedEnabled) hpSuction = A.n('hp_min_suction_bar');
  else {
    hpSuction = round(mToBar(A.n('tank_min_level_m') - lpLoss) - pt.totalDpBar - cartDpBar, 2);
    if (prod.valid && hpSuction < A.n('hp_min_suction_bar'))
      f.critical('Pumps', 'hp_suction', `Feed pressure insufficient at the HP pump suction: ≈ ${hpSuction} bar available vs ${A.n('hp_min_suction_bar')} bar required (pretreatment ${pt.totalDpBar} bar + cartridge ${cartDpBar} bar + piping losses). Enable the feed/booster pump.`);
  }

  // HP pump
  const hpComp: HeadComponent[] = [
    { category: 'terminal', label: 'Required membrane feed pressure', headM: barToM(mem.feedPressureBar ?? 0), note: mem.feedPressureBar != null ? `${mem.feedPressureBar} bar (array solution)` : 'INSUFFICIENT DATA' },
    ...pipeComps(['hp_to_ro']),
    ...extra('hp'),
    { category: 'suction', label: 'Suction pressure', headM: -barToM(Math.max(hpSuction, 0)), note: `${Math.max(hpSuction, 0)} bar` },
  ];
  const hpCanCalc = prod.valid && mem.available && mem.feedPressureBar != null;
  if (mem.available && mem.feedPressureBar == null) f.critical('Pumps', 'hp_no_pressure', 'HP pump pressure cannot be calculated – INSUFFICIENT DATA (membrane feed pressure not available).');
  const hp = buildPump({
    id: 'hp', name: 'High-pressure RO pump', pumpType: 'high_pressure', enabled: hpCanCalc, processFlowM3h: prod.feedM3h, flowOverrideM3h: flowOv('hp'), components: hpComp,
    effKey: 'hp_pump_eff', efficiencyOverride: effOv('hp'), suctionPressureBar: Math.max(hpSuction, 0), selectedPump: libPump('hp'),
    npshAvailableM: A.n('atm_head_m') + barToM(Math.max(hpSuction, 0)) - vap, npshNote: `NPSHa = (P_suction ${Math.max(hpSuction, 0)} bar + atmosphere) as head − vapour ${round(vap, 2)} m`,
    notes: ['Pretreatment losses are overcome by the feed pump; the HP pump raises suction pressure to the membrane feed pressure.', 'Energy recovery device not included.'],
  }, ctx.pumps, A, f);
  pumps.push(hp);
  if (hp.enabled && hp.dischargePressureBar != null && ctx.membrane?.maxPressureBar && hp.dischargePressureBar > ctx.membrane.maxPressureBar)
    f.review('Pumps', 'hp_max', `HP pump design discharge ${hp.dischargePressureBar} bar (incl. head margin) exceeds the membrane maximum ${ctx.membrane.maxPressureBar} bar – limit with VFD / high-pressure switch.`);

  // Product pump
  const hd = H.distributionHeadM;
  if (!isNum(hd) || hd < 0) f.critical('Pumps', 'dist_head', 'Distribution head must be zero or positive.');
  pumps.push(buildPump({
    id: 'product', name: 'Product water / distribution pump', pumpType: 'product', enabled: H.productPumpEnabled && prod.valid, processFlowM3h: distFlow, flowOverrideM3h: flowOv('product'),
    components: [
      { category: 'terminal', label: 'Required head at point of use', headM: isNum(hd) ? Math.max(hd, 0) : 0, note: `${hd} m (project input)` },
      ...pipeComps(['product_to_distribution']),
      ...extra('product'),
    ],
    effKey: 'product_pump_eff', efficiencyOverride: effOv('product'), suctionPressureBar: 0, selectedPump: libPump('product'),
    npshAvailableM: tankNpsha(null), npshNote: `NPSHa = H_atm ${A.n('atm_head_m')} + min level ${A.n('tank_min_level_m')} − vapour ${round(vap, 2)} m (suction line loss neglected)`,
  }, ctx.pumps, A, f));

  // CIP pump
  if (input.pretreatment.cip && mem.available && mem.stageDetail.length) {
    const maxVessels = Math.max(...mem.stageDetail.map((s) => s.vessels));
    pumps.push(buildPump({
      id: 'cip', name: 'CIP (cleaning) pump', pumpType: 'cip', enabled: true, processFlowM3h: maxVessels * A.n('cip_flow_per_vessel') * Math.pow((ctx.membrane?.diameterIn ?? 8) / 8, 2), flowOverrideM3h: flowOv('cip'),
      components: [{ category: 'terminal', label: 'CIP circuit head', headM: A.n('cip_head_m'), note: 'assumption' }, ...extra('cip')], effKey: 'cip_pump_eff', efficiencyOverride: effOv('cip'),
      applyFlowMargin: false, suctionPressureBar: 0, selectedPump: libPump('cip'), npshAvailableM: null, npshNote: 'Not evaluated (intermittent duty)',
      notes: [`${maxVessels} vessels (largest stage) × ${A.n('cip_flow_per_vessel')} m³/h per 8" vessel`],
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
  const pipes = calcPipeSections(sf, H.pipes, H.frictionMethod, ctx.pipeSizes, ctx.pipeMaterials, Tv, A, f);
  if (T === null) f.review('Pipes', 'visc_temp', 'Water temperature not entered – 20 °C used for viscosity in pipe-friction calculations.');

  // ------------------------------------------------ Dosing, tanks, electrical
  const hours = prod.valid ? input.production.operatingHours : 0;
  const dosing = calcDosing(w, prod, pt, input.pretreatment, hours, A, f);
  const tanks = calcTanks(input.tanks, prod, mem, dosing, input.pretreatment.cip, A, f);
  const uvKw = ptIn(pt, 'uv') ? prod.permeateM3h * A.n('uv_kw_per_m3h') : 0;
  const elec = calcElectrical(pumps, dosing, uvKw, hours, prod.dailyProductionM3d, A, f);

  // ------------------------------------------------ BOM & cost
  const baseBom = generateBom({ prod, mem, membraneDiameterIn: ctx.membrane?.diameterIn ?? 8, pt, pumps, pipes, dosing, tanks, elec, hpDischargeBar: hp.dischargePressureBar });
  const bom = applyBomOverrides(baseBom, input.bomOverrides ?? {}, input.customBom ?? []);
  const cost = calcCost(bom, input.costing);

  // ------------------------------------------------ PFD
  const chm = (id: string, name: string) => (ptIn(pt, id as never) ? [name] : []);
  const sourceLabel: Record<string, string> = { well: 'Borehole', surface: 'Surface water intake', municipal: 'Municipal supply', seawater_well: 'Beach well', seawater_open: 'Seawater intake' };
  const main: PfdNode[] = [{ id: 'source', label: sourceLabel[w.source], sub: WATER_SOURCE_LABELS[w.source], kind: 'source', chemicals: [] }];
  if (rawP?.enabled) main.push({ id: 'raw_pump', label: 'Raw Water Pump', sub: `${rawP.designFlowM3h} m³/h @ ${rawP.designHeadM} m`, kind: 'pump', chemicals: chm('prechlorination', 'NaOCl (pre-chlorination)') });
  const rawTank = tanks.find((t) => t.id === 'raw');
  main.push({ id: 'raw_tank', label: 'Raw Water Tank', sub: `${rawTank?.recommendedM3 ?? 0} m³`, kind: 'tank', chemicals: rawP?.enabled ? [] : chm('prechlorination', 'NaOCl (pre-chlorination)') });
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
    chemicals: [...chm('acid', 'HCl (acid)'), ...chm('smbs', 'SMBS'), ...chm('antiscalant', 'Antiscalant')],
  });
  if (hp.enabled) main.push({ id: 'hp_pump', label: 'High Pressure Pump', sub: `${hp.designFlowM3h} m³/h @ ${hp.dischargePressureBar} bar`, kind: 'pump', chemicals: [] });
  main.push({ id: 'ro', label: 'RO Membranes', sub: mem.available ? `${mem.elements} el. / ${mem.vessels} PV, ${mem.arrayLabel.split(' ')[0]}` : 'not designed', kind: 'membrane', chemicals: [] });
  if (ptIn(pt, 'uv')) main.push({ id: 'uv', label: 'UV Steriliser', sub: `${round(prod.permeateM3h, 1)} m³/h`, kind: 'uv', chemicals: [] });
  const permTank = tanks.find((t) => t.id === 'permeate');
  main.push({ id: 'permeate_tank', label: 'Permeate Tank', sub: `${permTank?.recommendedM3 ?? 0} m³`, kind: 'tank', chemicals: chm('post_chlorination', 'NaOCl (post-chlorination)') });
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
    hpPressureBar: hp.enabled ? hp.dischargePressureBar : null,
    hpHeadM: hp.designHeadM,
    hpMotorKw: hp.standardMotorKw,
    hpRequiredMotorKw: hp.requiredMotorKw,
    rawFlowM3h: rawP?.designFlowM3h ?? 0,
    rawHeadM: rawP?.designHeadM ?? 0,
    rawMotorKw: rawP?.standardMotorKw ?? 0,
    rawRequiredMotorKw: rawP?.requiredMotorKw ?? 0,
    osmoticFeedBar: chem.osmoticFeedBar,
    configMode: mem.configMode,
    connectedKw: elec.connectedKw,
    runningKw: elec.runningKw,
    specificEnergyKwhM3: elec.specificEnergyKwhM3,
    pipeSizes: pipes.map((p) => ({ label: p.label, dn: p.flowM3h > 0 ? p.dn : null })),
  };

  // ------------------------------------------------ traceability ("How was this calculated?")
  const hours0 = input.production.operatingHours;
  const trace: Record<string, CalcStep[]> = {
    production: prod.steps,
    daily: [step('Daily production', 'Q_p × operating hours', prod.dailyProductionM3d, 'm³/day', `Q_p ${n(prod.permeateM3h)} m³/h × ${hours0} h`)],
    recovery: [step('Recovery', 'R = Q_p ÷ Q_f × 100', prod.feedM3h > 0 ? (prod.permeateM3h / prod.feedM3h) * 100 : 0, '%', `Q_p ${n(prod.permeateM3h)} m³/h, Q_f ${n(prod.feedM3h)} m³/h`, 'Desired recovery is a project input')],
    feed: [step('Feed flow', 'Q_f = Q_p ÷ R', prod.feedM3h, 'm³/h', `Q_p ${n(prod.permeateM3h)} m³/h, R ${prod.recoveryPct} %`)],
    reject: [step('Reject flow', 'Q_c = Q_f − Q_p', prod.rejectM3h, 'm³/h', `Q_f ${n(prod.feedM3h)}, Q_p ${n(prod.permeateM3h)} m³/h`)],
    membranes: mem.steps.slice(0, 3),
    flux: mem.steps.filter((x) => /flux/i.test(x.label)),
    feedPressure: mem.steps.filter((x) => /pressure|permeability|correction/i.test(x.label)),
    permeateTds: mem.steps.filter((x) => /TDS|rejection|Salt/i.test(x.label)),
    hpPump: hp.steps,
    rawPump: rawP?.steps ?? [],
    electrical: elec.steps,
    pipes: pipes.map((p) => step(p.label, 'd = √(4Q/πv_max) → catalogue DN', p.dn ? `DN ${p.dn}` : '–', '', `Q ${p.flowM3h} m³/h, v_max ${p.maxVelocity} m/s → d ${p.requiredIdMm} mm; v ${p.velocity} m/s`, p.material)),
    osmotic: chem.steps.filter((x) => /osmotic/i.test(x.label)),
  };

  const order: Record<Level, number> = { critical: 0, review: 1, ok: 2 };
  const findings = [...f.items].sort((a, b) => order[a.level] - order[b.level]);
  const counts: Record<Level, number> = { critical: 0, review: 0, ok: 0 };
  for (const x of findings) counts[x.level]++;

  return {
    engineVersion: ENGINE_VERSION,
    calculatedAt: new Date().toISOString(),
    water,
    chemistry: chem,
    production: prod,
    membrane: mem,
    pretreatment: pt,
    pipes,
    pumps,
    hpSuctionAvailableBar: hpSuction,
    trace,
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
export type { PipeSectionResult, PipeCalcResult, FittingLine } from './pipes';
export { PT_STATUS_LABEL, INSUFFICIENT } from './pretreatment';
export type { PretreatmentItem, PretreatmentResult } from './pretreatment';
export type { PumpResult, OperatingPoint, HeadComponent } from './pumps';
export { HEAD_CATEGORY_LABEL, curveHead } from './pumps';
export type { ChemistryResult, Indicator, IonRow } from './chemistry';
export { LAB_REQUIRED } from './chemistry';
export type { MembraneResult, StageResult, ElementResult } from './membrane';
export type { BomLine, CostResult } from './bom';
export type { DosingLine } from './dosing';
export type { TankResult } from './tanks';
export type { ElectricalResult } from './electrical';
