import type { BomOverride, CostCategory, CostingInput, CustomBomLine } from '../types';
import { nextStandard, round } from './common';
import type { DosingLine } from './dosing';
import type { ElectricalResult } from './electrical';
import type { MembraneResult } from './membrane';
import type { PipeSectionResult } from './pipes';
import type { CartridgeSizing, FilterSizing, PretreatmentResult, SoftenerSizing } from './pretreatment';
import type { ProductionResult } from './production';
import type { PumpResult } from './pumps';
import type { TankResult } from './tanks';

export interface BomLine {
  id: string;
  category: string;
  item: string;
  description: string;
  specification: string;
  quantity: number;
  unit: string;
  notes: string;
  costCategory: CostCategory;
  unitCost: number;
  total: number;
  custom: boolean;
  edited: boolean;
  removed: boolean;
}

/** Standard pressure-vessel ratings (bar) ≈ 300, 450, 600, 1000, 1200 psi. */
const PV_CLASSES = [20.7, 31.0, 41.4, 69.0, 82.7];
const PV_PSI: Record<number, number> = { 20.7: 300, 31.0: 450, 41.4: 600, 69.0: 1000, 82.7: 1200 };

export interface BomSources {
  prod: ProductionResult;
  mem: MembraneResult;
  membraneDiameterIn: number;
  pt: PretreatmentResult;
  pumps: PumpResult[];
  pipes: PipeSectionResult[];
  dosing: DosingLine[];
  tanks: TankResult[];
  elec: ElectricalResult;
  hpDischargeBar: number | null;
}

export function generateBom(src: BomSources): Omit<BomLine, 'unitCost' | 'total' | 'custom' | 'edited' | 'removed'>[] {
  const L: Omit<BomLine, 'unitCost' | 'total' | 'custom' | 'edited' | 'removed'>[] = [];
  const add = (id: string, category: string, item: string, description: string, specification: string, quantity: number, unit: string, notes: string, costCategory: CostCategory = 'equipment') => {
    if (quantity > 0) L.push({ id, category, item, description, specification, quantity: round(quantity, 2), unit, notes, costCategory });
  };
  const { mem, pt, pumps, pipes, dosing, tanks, elec } = src;
  const inD = (id: string) => pt.inDesignIds.includes(id as never);

  // --------------------------- Membranes & vessels
  if (mem.available) {
    add('ro_membranes', 'RO Membranes & Vessels', 'RO membrane elements', mem.membraneLabel, `${src.membraneDiameterIn}" element, design flux ${mem.actualFluxLmh} LMH`, mem.elements, 'pcs', 'Verify selection with manufacturer projection software.');
    const pv = mem.feedPressureBar != null ? nextStandard(Math.max(mem.feedPressureBar, src.hpDischargeBar ?? 0) * 1.1, PV_CLASSES) : null;
    add('pressure_vessels', 'RO Membranes & Vessels', 'Pressure vessels', `FRP pressure vessel ${src.membraneDiameterIn}" for ${mem.elementsPerVessel} elements`, pv ? `${PV_PSI[pv]} psi (${pv} bar) rated, side ports` : 'Pressure rating to be confirmed', mem.vessels, 'pcs', `Array ${mem.arrayLabel}`);
    add('ro_skid', 'RO Membranes & Vessels', 'RO skid frame', 'Structural frame for vessels, HP pump and instruments', 'Epoxy-coated carbon steel or SS304, with vessel straps', 1, 'lot', '');
  }

  // --------------------------- Pumps
  for (const p of pumps) {
    if (!p.enabled) continue;
    const typ: Record<string, string> = { raw: 'Submersible borehole pump with motor', feed: 'Horizontal/vertical centrifugal feed pump', hp: 'Vertical multistage high-pressure pump, SS316', product: 'Centrifugal transfer/booster pump', cip: 'Centrifugal CIP pump, SS316 / PP' };
    add(`pump_${p.id}`, 'Pumps', p.name, typ[p.id] ?? p.name, `${p.designFlowM3h} m³/h @ ${p.designHeadM} m TDH (${p.designPressureBar} bar); required motor ${p.requiredMotorKw} kW → standard motor ${p.standardMotorKw} kW`, 1, 'pcs', p.selectedPump ? `Selected: ${p.selectedPump.manufacturer} ${p.selectedPump.model}${p.selectedPump.isDemo ? ' (DEMO – replace with real pump)' : ''}` : 'Select from manufacturer curves; consider 1 standby unit.');
  }

  // --------------------------- Pretreatment
  const filterIds: [string, string][] = [['sand_filter', 'Sand filter'], ['iron_removal', 'Iron/manganese filter'], ['manganese_removal', 'Manganese filter'], ['mmf', 'Multimedia filter'], ['acf', 'Activated carbon filter']];
  for (const [id, name] of filterIds) {
    const it = pt.items.find((i) => i.id === id);
    if (!it || !it.inDesign || !it.sizing || it.sizing.kind !== 'filter') continue;
    const s = it.sizing as FilterSizing;
    add(`${id}_vessel`, 'Pretreatment', `${name} vessel`, `${name} pressure vessel (FRP or epoxy-lined steel)`, `Ø${s.diameterMm} mm, ${s.actualRateMh} m/h at ${s.flowM3h} m³/h, ≥ 6 bar`, s.vessels, 'pcs', s.backwashFlowM3h ? `Backwash ${s.backwashFlowM3h} m³/h per vessel` : '');
    add(`${id}_valve`, 'Pretreatment', `${name} control valve`, 'Automatic backwash multiport valve or butterfly-valve nest', 'Timer/ΔP initiated backwash', s.vessels, 'set', '');
    s.media.forEach((m, i) => add(`${id}_media_${i}`, 'Filter Media', m.name, `Media for ${name.toLowerCase()}`, `${m.depthM} m bed, ${m.volumeL} L`, m.massKg, 'kg', ''));
  }
  const soft = pt.items.find((i) => i.id === 'softener');
  if (soft?.inDesign && soft.sizing?.kind === 'softener') {
    const s = soft.sizing as SoftenerSizing;
    add('softener_vessel', 'Pretreatment', 'Softener vessel', 'FRP softener vessel', `Ø${s.diameterMm} mm, ${s.serviceRateMh} m/h`, s.vessels, 'pcs', 'Duplex alternating');
    add('softener_resin', 'Filter Media', 'Cation exchange resin', 'Strong-acid cation resin, Na form', `${s.resinPerVesselL} L per vessel`, s.resinPerVesselL * s.vessels, 'L', '');
    add('softener_valve', 'Pretreatment', 'Softener control valve', 'Volumetric duplex control valve', '', 1, 'set', '');
    add('brine_tank', 'Pretreatment', 'Brine tank', 'PE brine tank with salt grid', `${s.saltPerRegenKg} kg salt per regeneration`, 1, 'pcs', '');
  }
  const cart = pt.items.find((i) => i.id === 'cartridge');
  if (cart?.inDesign && cart.sizing?.kind === 'cartridge') {
    const c = cart.sizing as CartridgeSizing;
    add('cartridge_housing', 'Pretreatment', 'Cartridge filter housing', 'SS316 multi-round cartridge housing', `${c.roundsPerHousing} × 40" rounds, ${c.micron} µm, ${c.flowM3h} m³/h`, c.housings, 'pcs', '');
    add('cartridge_elements', 'Pretreatment', 'Cartridge filter elements', `${c.micron} µm melt-blown PP, 40" × 2.5"`, 'Initial fill + 1 spare set', c.elements40in * 2, 'pcs', 'Replace at design ΔP');
  }
  if (inD('uv')) add('uv_unit', 'Post-treatment', 'UV steriliser', 'Low-pressure UV reactor with intensity sensor', `${round(src.prod.permeateM3h, 1)} m³/h at 40 mJ/cm²`, 1, 'pcs', '');

  // --------------------------- Dosing
  for (const d of dosing) {
    add(`dosing_pump_${d.id}`, 'Chemical Dosing', `${d.chemical} dosing pump`, 'Electronic diaphragm metering pump', `${d.pumpCapacityLh} L/h (required ${d.solutionLh} L/h), dose ${d.doseMgL} mg/L`, 1, 'pcs', d.dosingPoint);
    add(`dosing_tank_${d.id}`, 'Chemical Dosing', `${d.chemical} tank`, 'PE chemical tank with lid and low-level switch', `${d.tankSelectedL} L`, 1, 'pcs', '');
    add(`injection_${d.id}`, 'Chemical Dosing', `${d.chemical} injection quill`, 'Injection valve + foot valve + tubing', '', 1, 'set', '');
  }

  // --------------------------- Tanks
  for (const t of tanks.filter((x) => !x.id.startsWith('chem_'))) {
    add(`tank_${t.id}`, 'Tanks', t.name, t.id === 'cip' ? 'PE/PP CIP tank with heater' : 'GRP / PE / steel water storage tank', `${t.recommendedM3} m³ (${t.recommendedL.toLocaleString('en-US')} L)`, 1, 'pcs', t.basis);
  }

  // --------------------------- Instrumentation
  const filtersInDesign = pt.items.filter((i) => i.inDesign && (i.sizing?.kind === 'filter' || i.sizing?.kind === 'softener') && !(i.id === 'manganese_removal' && inD('iron_removal'))).length;
  const stages = mem.stages || 1;
  const gauges = filtersInDesign * 2 + 2 /*cartridge*/ + 2 /*HP*/ + (stages + 1) + 1 /*permeate*/ + pumps.filter((p) => p.enabled && p.id !== 'hp').length;
  add('pressure_gauges', 'Instrumentation', 'Pressure gauges', 'Glycerine-filled SS pressure gauge, 100 mm dial', 'Ranges to suit (0–10 bar LP, 0–25/40/100 bar HP)', gauges, 'pcs', 'Filter in/out, cartridge in/out, HP suction/discharge, stage & concentrate, permeate, pump discharges');
  add('pressure_switches', 'Instrumentation', 'Pressure switches', 'HP pump low-suction and high-discharge pressure switches', 'Adjustable, SS wetted parts', 2, 'pcs', 'Pump protection interlocks');
  add('pressure_transmitters', 'Instrumentation', 'Pressure transmitters', '4–20 mA pressure transmitters', 'HP discharge and concentrate', 2, 'pcs', 'For normalisation/trending');
  add('flow_meters', 'Instrumentation', 'Flow meters', 'Electromagnetic or rotameter flow meters', 'Raw water, RO feed, permeate, concentrate', 4, 'pcs', 'Permeate & concentrate mandatory for recovery control');
  add('conductivity_meters', 'Instrumentation', 'Conductivity meters', 'Online conductivity analyser with cell', 'Feed and permeate', 2, 'pcs', 'Permeate high-conductivity alarm / divert');
  add('ph_meter', 'Instrumentation', 'pH meter', inD('acid') ? 'Online pH controller (acid dosing control)' : 'Online pH analyser', 'RO feed', 1, 'pcs', '');
  if (inD('smbs') || inD('prechlorination') || inD('acf')) add('orp_meter', 'Instrumentation', 'ORP meter', 'Online ORP analyser', 'RO feed – chlorine breakthrough alarm', 1, 'pcs', '');
  add('tds_meter', 'Instrumentation', 'TDS meter', 'Portable TDS/conductivity meter', 'Handheld, 0–20 000 µS/cm', 1, 'pcs', 'Field verification');
  add('level_instruments', 'Instrumentation', 'Level switches / transmitters', 'Tank level control', 'Raw and product tank (pump run/stop, dry-run protection)', 2 + dosing.length, 'pcs', '');
  for (const l of L) if (l.category === 'Instrumentation') l.costCategory = 'instrumentation';

  // --------------------------- Valves
  add('valve_concentrate', 'Valves', 'Concentrate control valve', 'SS316 needle/globe valve', `Rated ≥ ${src.hpDischargeBar != null ? Math.ceil(src.hpDischargeBar * 1.1) : '–'} bar`, 1, 'pcs', 'Sets recovery');
  add('valve_hp_throttle', 'Valves', 'HP discharge throttling valve', 'SS316 globe/ball valve (or VFD control)', '', 1, 'pcs', 'Soft start / flow control');
  add('valve_check', 'Valves', 'Check valves', 'Non-return valves on pump discharges', 'Material to suit line', pumps.filter((p) => p.enabled).length, 'pcs', '');
  const activePipes = pipes.filter((p) => p.flowM3h > 0 && p.dn != null);
  add('valve_isolation', 'Valves', 'Isolation valves', 'Butterfly/ball valves (PVC/SS)', `Sizes per pipe schedule (DN ${[...new Set(activePipes.map((p) => p.dn))].join(', DN ')})`, activePipes.length * 2, 'pcs', 'Estimate: 2 per pipe section');
  add('valve_sample', 'Valves', 'Sample valves', 'SS316 sample valves', 'Each vessel permeate + feed/permeate/concentrate', (mem.vessels || 0) + 3, 'pcs', '');
  add('valve_flush', 'Valves', 'Automatic flush valve', 'Motorised/solenoid valve', 'Low-pressure permeate flush at shutdown', 1, 'pcs', '');
  add('valve_divert', 'Valves', 'Permeate divert valve', 'Motorised 3-way valve', 'Off-spec permeate to drain', 1, 'pcs', '');
  add('valve_relief', 'Valves', 'Permeate relief / burst protection', 'Pressure relief valve on permeate line', 'Prevents permeate back-pressure damage', 1, 'pcs', '');

  // --------------------------- Piping
  for (const p of activePipes) {
    add(`pipe_${p.id}`, 'Piping', `Pipe – ${p.label}`, p.material, `DN ${p.dn} (OD ${p.outerDiameterMm} / ID ${p.innerDiameterMm} mm), ${p.flowM3h} m³/h @ ${p.velocity} m/s`, Math.ceil(p.lengthM * 1.1), 'm', '+10 % allowance', 'piping');
    add(`fittings_${p.id}`, 'Piping', `Fittings – ${p.label}`, `Elbows, tees, reducers, flanges, supports for DN ${p.dn}`, p.material, 1, 'lot', '', 'piping');
  }

  // --------------------------- Electrical
  add('control_panel', 'Electrical', 'Control panel', 'MCC + PLC + HMI control panel, IP55', `Connected load ${elec.connectedKw} kW, ${elec.fullLoadCurrentA} A FLC`, 1, 'pcs', 'Auto start/stop on tank levels, alarms and interlocks', 'electrical');
  const hp = pumps.find((p) => p.id === 'hp');
  if (hp?.enabled) add('vfd_hp', 'Electrical', 'VFD for HP pump', 'Variable frequency drive', `${hp.motorKw} kW`, 1, 'pcs', 'Soft start and constant flow control', 'electrical');
  const otherMotors = pumps.filter((p) => p.enabled && p.id !== 'hp');
  add('starters', 'Electrical', 'Motor starters', 'DOL / soft starters with overload protection', otherMotors.map((p) => `${p.motorKw} kW`).join(', '), otherMotors.length, 'pcs', '', 'electrical');
  add('main_breaker', 'Electrical', 'Main incomer breaker', 'MCCB main incomer', elec.incomerA ? `${elec.incomerA} A, ${'3-phase'}` : 'Size to be confirmed', 1, 'pcs', '', 'electrical');
  add('power_cables', 'Electrical', 'Power cabling', 'Armoured power cables to all motors', 'Size per motor & run length', 1, 'lot', '', 'electrical');
  add('instrument_cables', 'Electrical', 'Instrument cabling', 'Shielded instrument/signal cables', '', 1, 'lot', '', 'electrical');
  add('earthing', 'Electrical', 'Earthing & lightning protection', 'Earthing system', '', 1, 'lot', '', 'electrical');

  return L;
}

export function applyBomOverrides(base: ReturnType<typeof generateBom>, overrides: Record<string, BomOverride>, custom: CustomBomLine[]): BomLine[] {
  const lines: BomLine[] = base.map((b) => {
    const o = overrides[b.id];
    const merged = {
      ...b,
      description: o?.description ?? b.description,
      specification: o?.specification ?? b.specification,
      quantity: o?.quantity ?? b.quantity,
      unit: o?.unit ?? b.unit,
      notes: o?.notes ?? b.notes,
    };
    const unitCost = o?.unitCost ?? 0;
    const edited = !!o && (['description', 'specification', 'quantity', 'unit', 'notes'] as const).some((k) => o[k] !== undefined);
    return { ...merged, unitCost, total: round(unitCost * merged.quantity, 2), custom: false, edited, removed: !!o?.removed };
  });
  for (const c of custom) lines.push({ ...c, total: round(c.unitCost * c.quantity, 2), custom: true, edited: false, removed: false });
  return lines;
}

export interface CostResult {
  enabled: boolean;
  currency: string;
  byCategory: Record<CostCategory, number>;
  subtotal: number;
  installation: number;
  engineering: number;
  contingency: number;
  total: number;
  linesWithoutCost: number;
}

export function calcCost(lines: BomLine[], c: CostingInput): CostResult {
  const active = lines.filter((l) => !l.removed);
  const byCategory: Record<CostCategory, number> = { equipment: 0, piping: 0, electrical: 0, instrumentation: 0 };
  for (const l of active) byCategory[l.costCategory] += l.total;
  const subtotal = Object.values(byCategory).reduce((a, b) => a + b, 0);
  const installation = (subtotal * Math.max(0, c.installationPct)) / 100;
  const engineering = (subtotal * Math.max(0, c.engineeringPct)) / 100;
  const contingency = ((subtotal + installation + engineering) * Math.max(0, c.contingencyPct)) / 100;
  return {
    enabled: c.enabled,
    currency: c.currency || 'USD',
    byCategory: Object.fromEntries(Object.entries(byCategory).map(([k, v]) => [k, round(v, 2)])) as Record<CostCategory, number>,
    subtotal: round(subtotal, 2),
    installation: round(installation, 2),
    engineering: round(engineering, 2),
    contingency: round(contingency, 2),
    total: round(subtotal + installation + engineering + contingency, 2),
    linesWithoutCost: active.filter((l) => !(l.unitCost > 0)).length,
  };
}
