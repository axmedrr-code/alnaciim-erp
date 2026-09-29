import type { AssumptionReader } from '../assumptions';
import type { PumpSpec, PumpType } from '../types';
import { barToM, CalcStep, Findings, hydraulicKw, M_PER_BAR, mToBar, nextStandard, round } from './common';

export type PumpId = 'raw' | 'feed' | 'hp' | 'product' | 'cip';

export interface HeadComponent {
  label: string;
  headM: number;
  note: string;
}

export interface LibraryMatch {
  pump: PumpSpec;
  flowRatio: number;
  headAtFlowM: number;
  withinRange: boolean;
}

export interface PumpResult {
  id: PumpId;
  name: string;
  pumpType: PumpType;
  enabled: boolean;
  processFlowM3h: number;
  designFlowM3h: number;
  components: HeadComponent[];
  calculatedHeadM: number;
  designHeadM: number;
  designPressureBar: number;
  suctionPressureBar: number | null;
  dischargePressureBar: number | null;
  efficiencyPct: number;
  motorEfficiencyPct: number;
  hydraulicKw: number;
  shaftKw: number;
  absorbedKw: number;
  motorKw: number;
  steps: CalcStep[];
  libraryMatch: LibraryMatch | null;
  libraryNote: string;
  notes: string[];
}

export function headAtFlow(p: PumpSpec, q: number) {
  // Simple parabolic curve through shut-off head and rated point
  const k = (p.shutoffHeadM - p.ratedHeadM) / Math.pow(p.ratedFlowM3h, 2);
  return p.shutoffHeadM - k * q * q;
}

export function matchLibraryPump(type: PumpType, q: number, h: number, lib: PumpSpec[], A: AssumptionReader): LibraryMatch | null {
  const cands = lib
    .filter((p) => p.pumpType === type && p.ratedFlowM3h > 0 && q >= p.minFlowM3h && q <= p.maxFlowM3h)
    .map((p) => {
      const hq = headAtFlow(p, q);
      const ratio = q / p.ratedFlowM3h;
      return { pump: p, flowRatio: round(ratio, 2), headAtFlowM: round(hq, 1), withinRange: ratio >= A.n('pump_bep_min_ratio') && ratio <= A.n('pump_bep_max_ratio') };
    })
    .filter((c) => c.headAtFlowM >= h);
  if (!cands.length) return null;
  // Prefer in-range pumps closest to BEP, then with the least excess head
  cands.sort((a, b) => Number(b.withinRange) - Number(a.withinRange) || Math.abs(a.flowRatio - 1) - Math.abs(b.flowRatio - 1) || a.headAtFlowM - b.headAtFlowM);
  return cands[0];
}

export interface PumpBuildInput {
  id: PumpId;
  name: string;
  pumpType: PumpType;
  enabled: boolean;
  processFlowM3h: number;
  components: HeadComponent[];
  effKey: string;
  suctionPressureBar?: number | null;
  applyFlowMargin?: boolean;
  notes?: string[];
}

export function buildPump(b: PumpBuildInput, lib: PumpSpec[], A: AssumptionReader, f: Findings): PumpResult {
  const S = 'Pumps';
  const eff = A.n(b.effKey);
  const motEff = A.n('motor_eff');
  const flowMargin = b.applyFlowMargin === false ? 0 : A.n('flow_safety_margin');
  const designFlow = b.processFlowM3h * (1 + flowMargin / 100);
  const calcHead = b.components.reduce((s, c) => s + c.headM, 0);
  const designHead = Math.max(0, calcHead) * (1 + A.n('head_safety_margin') / 100);
  const hyd = hydraulicKw(designFlow, designHead);
  const effOk = eff > 0 && eff <= 100;
  const shaft = effOk ? hyd / (eff / 100) : 0;
  const absorbed = motEff > 0 ? shaft / (motEff / 100) : 0;
  const motors = A.list('std_motors_kw');
  const motorReq = shaft * A.n('motor_service_factor');
  let motor = b.enabled && shaft > 0 ? nextStandard(motorReq, motors) : 0;
  const notes = [...(b.notes ?? [])];
  if (motor === null) {
    motor = round(motorReq, 1);
    f.critical(S, `${b.id}_motor`, `${b.name}: required motor ${round(motorReq, 1)} kW exceeds the largest standard motor – split into parallel pumps.`);
  }
  if (b.enabled) {
    if (!effOk) f.critical(S, `${b.id}_eff`, `${b.name}: pump efficiency ${eff} % is not valid.`);
    else if (eff < A.n('pump_eff_min_reasonable') || eff > A.n('pump_eff_max_reasonable'))
      f.review(S, `${b.id}_eff`, `${b.name}: assumed efficiency ${eff} % is outside the reasonable range ${A.n('pump_eff_min_reasonable')}–${A.n('pump_eff_max_reasonable')} %.`);
    if (calcHead < 0) f.review(S, `${b.id}_head_neg`, `${b.name}: calculated head is negative (source pressure exceeds requirement) – pump may not be required.`);
  }

  const match = b.enabled && designFlow > 0 ? matchLibraryPump(b.pumpType, designFlow, designHead, lib, A) : null;
  let libraryNote = '';
  if (!b.enabled) libraryNote = 'Pump not included in this configuration.';
  else if (!match) {
    libraryNote = 'No pump in the local Pump Library covers this duty point – select from manufacturer curves and add it to the library.';
    f.review(S, `${b.id}_library`, `${b.name}: ${libraryNote}`);
  } else {
    libraryNote = `${match.pump.manufacturer} ${match.pump.model}: duty ${round(designFlow, 1)} m³/h = ${Math.round(match.flowRatio * 100)} % of rated flow, head available ≈ ${match.headAtFlowM} m (simplified curve – verify with the published curve).`;
    if (!match.withinRange) f.review(S, `${b.id}_range`, `${b.name}: closest library pump ${match.pump.model} operates at ${Math.round(match.flowRatio * 100)} % of rated flow – outside the reasonable range ${Math.round(A.n('pump_bep_min_ratio') * 100)}–${Math.round(A.n('pump_bep_max_ratio') * 100)} %.`);
    else f.ok(S, `${b.id}_range`, `${b.name}: library pump ${match.pump.model} operates near its best efficiency point (${Math.round(match.flowRatio * 100)} % of rated flow).`);
    if (match.pump.motorKw < motorReq * 0.95) f.review(S, `${b.id}_lib_motor`, `${b.name}: library pump motor ${match.pump.motorKw} kW is smaller than the calculated requirement ${round(motorReq, 1)} kW.`);
  }

  const steps: CalcStep[] = [
    { label: 'Design flow', formula: `Q = process flow × (1 + ${flowMargin} %)`, value: round(designFlow, 2), unit: 'm³/h' },
    { label: 'Calculated head', formula: 'H = Σ head components', value: round(calcHead, 1), unit: 'm' },
    { label: 'Design head', formula: `H_d = H × (1 + ${A.n('head_safety_margin')} % margin)`, value: round(designHead, 1), unit: 'm' },
    { label: 'Hydraulic power', formula: 'P_h = ρ·g·Q·H ÷ 3.6×10⁶  (Q m³/h, H m)', value: round(hyd, 2), unit: 'kW' },
    { label: 'Shaft power', formula: `P_s = P_h ÷ η_pump (${eff} %)`, value: round(shaft, 2), unit: 'kW' },
    { label: 'Electrical input', formula: `P_e = P_s ÷ η_motor (${motEff} %)`, value: round(absorbed, 2), unit: 'kW' },
    { label: 'Motor rating', formula: `next standard ≥ P_s × ${A.n('motor_service_factor')}`, value: motor ?? 0, unit: 'kW' },
  ];

  return {
    id: b.id,
    name: b.name,
    pumpType: b.pumpType,
    enabled: b.enabled,
    processFlowM3h: round(b.processFlowM3h, 2),
    designFlowM3h: round(designFlow, 2),
    components: b.components.map((c) => ({ ...c, headM: round(c.headM, 2) })),
    calculatedHeadM: round(calcHead, 1),
    designHeadM: round(designHead, 1),
    designPressureBar: round(mToBar(designHead), 2),
    suctionPressureBar: b.suctionPressureBar ?? null,
    dischargePressureBar: b.suctionPressureBar != null ? round(b.suctionPressureBar + mToBar(designHead), 2) : null,
    efficiencyPct: eff,
    motorEfficiencyPct: motEff,
    hydraulicKw: round(hyd, 2),
    shaftKw: round(shaft, 2),
    absorbedKw: b.enabled ? round(absorbed, 2) : 0,
    motorKw: b.enabled ? motor ?? 0 : 0,
    steps,
    libraryMatch: match,
    libraryNote,
    notes,
  };
}

export { barToM, M_PER_BAR };
