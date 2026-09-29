import type { AssumptionReader } from '../assumptions';
import type { PumpCurvePoint, PumpSpec, PumpType } from '../types';
import { barToM, CalcStep, Findings, hydraulicKw, M_PER_BAR, mToBar, n, nextStandard, round, step } from './common';

export type PumpId = 'raw' | 'feed' | 'hp' | 'product' | 'cip';

export type HeadCategory = 'static' | 'friction' | 'minor' | 'equipment' | 'terminal' | 'suction';

export const HEAD_CATEGORY_LABEL: Record<HeadCategory, string> = {
  static: 'Static head',
  friction: 'Pipe friction loss',
  minor: 'Minor losses (fittings & valves)',
  equipment: 'Equipment pressure loss',
  terminal: 'Required operating pressure',
  suction: 'Less: suction pressure',
};

export interface HeadComponent {
  category: HeadCategory;
  label: string;
  headM: number;
  note: string;
}

export interface OperatingPoint {
  /** natural intersection of pump curve and system curve (no throttling) */
  intersectFlowM3h: number | null;
  intersectHeadM: number | null;
  headAtDesignFlowM: number | null;
  efficiencyAtDesignPct: number | null;
  npshrAtDesignM: number | null;
  powerAtDesignKw: number | null;
  excessHeadPct: number | null;
  bepFlowM3h: number | null;
  bepRatio: number | null;
  curveMinFlow: number;
  curveMaxFlow: number;
  withinCurve: boolean;
  systemCurve: { flowM3h: number; headM: number }[];
  pumpCurve: PumpCurvePoint[];
}

export interface PumpResult {
  id: PumpId;
  name: string;
  pumpType: PumpType;
  enabled: boolean;
  processFlowM3h: number;
  designFlowM3h: number;
  components: HeadComponent[];
  staticHeadM: number;
  frictionHeadM: number;
  minorHeadM: number;
  equipmentHeadM: number;
  terminalHeadM: number;
  suctionCreditM: number;
  calculatedHeadM: number;
  designHeadM: number;
  designPressureBar: number;
  suctionPressureBar: number | null;
  dischargePressureBar: number | null;
  efficiencyPct: number;
  efficiencySource: 'assumption' | 'project input' | 'pump curve';
  motorEfficiencyPct: number;
  safetyFactor: number;
  hydraulicKw: number;
  shaftKw: number;
  requiredMotorKw: number;
  standardMotorKw: number;
  absorbedKw: number;
  /** kept for compatibility: = standardMotorKw */
  motorKw: number;
  npshAvailableM: number | null;
  npshNote: string;
  selectedPump: PumpSpec | null;
  operatingPoint: OperatingPoint | null;
  candidates: { id: number; label: string; headAtFlowM: number; bepRatio: number | null }[];
  steps: CalcStep[];
  notes: string[];
}

// ------------------------------------------------------------------ curve helpers

export function sortedCurve(c: PumpCurvePoint[]) {
  return [...c].filter((p) => isFinite(p.flowM3h) && isFinite(p.headM)).sort((a, b) => a.flowM3h - b.flowM3h);
}

function interp(c: PumpCurvePoint[], q: number, key: 'headM' | 'efficiencyPct' | 'npshrM'): number | null {
  const pts = c.filter((p) => p[key] != null) as (PumpCurvePoint & Record<typeof key, number>)[];
  if (pts.length < 2 || q < pts[0].flowM3h - 1e-9 || q > pts[pts.length - 1].flowM3h + 1e-9) return null;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (q >= a.flowM3h - 1e-9 && q <= b.flowM3h + 1e-9) {
      const t = b.flowM3h === a.flowM3h ? 0 : (q - a.flowM3h) / (b.flowM3h - a.flowM3h);
      return (a[key] as number) + t * ((b[key] as number) - (a[key] as number));
    }
  }
  return null;
}

export function curveHead(c: PumpCurvePoint[], q: number) {
  return interp(sortedCurve(c), q, 'headM');
}

/** Pump operating point vs a system curve H_sys(Q) = H_static + H_dynamic·(Q/Q_design)². */
export function operatingPoint(curve: PumpCurvePoint[], qDesign: number, hStatic: number, hDynamic: number): OperatingPoint {
  const c = sortedCurve(curve);
  const qMin = c[0]?.flowM3h ?? 0;
  const qMax = c[c.length - 1]?.flowM3h ?? 0;
  const sys = (q: number) => hStatic + hDynamic * Math.pow(q / Math.max(qDesign, 1e-9), 2);
  let iq: number | null = null;
  let ih: number | null = null;
  const N = 400;
  let prev: { q: number; d: number } | null = null;
  for (let i = 0; i <= N; i++) {
    const q = qMin + ((qMax - qMin) * i) / N;
    const hp = interp(c, q, 'headM');
    if (hp === null) continue;
    const d = hp - sys(q);
    if (prev && prev.d >= 0 && d <= 0) {
      const t = prev.d === d ? 0 : prev.d / (prev.d - d);
      iq = prev.q + t * (q - prev.q);
      ih = sys(iq);
      break;
    }
    prev = { q, d };
  }
  const effPts = c.filter((p) => p.efficiencyPct != null);
  const bep = effPts.length ? effPts.reduce((a, b) => ((b.efficiencyPct as number) > (a.efficiencyPct as number) ? b : a)) : null;
  const hAt = interp(c, qDesign, 'headM');
  const eAt = interp(c, qDesign, 'efficiencyPct');
  const req = sys(qDesign);
  const sysCurve = Array.from({ length: 11 }, (_, i) => {
    const q = (Math.max(qMax, qDesign * 1.3) * i) / 10;
    return { flowM3h: round(q, 2), headM: round(sys(q), 2) };
  });
  return {
    intersectFlowM3h: iq === null ? null : round(iq, 2),
    intersectHeadM: ih === null ? null : round(ih, 2),
    headAtDesignFlowM: hAt === null ? null : round(hAt, 2),
    efficiencyAtDesignPct: eAt === null ? null : round(eAt, 1),
    npshrAtDesignM: (() => {
      const v = interp(c, qDesign, 'npshrM');
      return v === null ? null : round(v, 2);
    })(),
    powerAtDesignKw: hAt !== null && eAt ? round(hydraulicKw(qDesign, hAt) / (eAt / 100), 2) : null,
    excessHeadPct: hAt !== null && req > 0 ? round(((hAt - req) / req) * 100, 1) : null,
    bepFlowM3h: bep ? bep.flowM3h : null,
    bepRatio: bep && bep.flowM3h > 0 ? round(qDesign / bep.flowM3h, 3) : null,
    curveMinFlow: qMin,
    curveMaxFlow: qMax,
    withinCurve: qDesign >= qMin - 1e-9 && qDesign <= qMax + 1e-9,
    systemCurve: sysCurve,
    pumpCurve: c,
  };
}

/** Water vapour pressure head (m) – Antoine equation, 1–100 °C. */
export function vapourHeadM(tempC: number) {
  const pMmHg = Math.pow(10, 8.07131 - 1730.63 / (233.426 + tempC));
  return (pMmHg * 133.322) / (1000 * 9.81);
}

// ------------------------------------------------------------------ build

export interface PumpBuildInput {
  id: PumpId;
  name: string;
  pumpType: PumpType;
  enabled: boolean;
  processFlowM3h: number;
  flowOverrideM3h?: number | null;
  components: HeadComponent[];
  effKey: string;
  efficiencyOverride?: number | null;
  suctionPressureBar?: number | null;
  applyFlowMargin?: boolean;
  /** NPSH available (m) or null when not applicable (e.g. submersible) */
  npshAvailableM?: number | null;
  npshNote?: string;
  selectedPump?: PumpSpec | null;
  notes?: string[];
}

export function buildPump(b: PumpBuildInput, lib: PumpSpec[], A: AssumptionReader, f: Findings): PumpResult {
  const S = 'Pumps';
  const motEff = A.n('motor_eff');
  const sf = A.n('motor_service_factor');
  const flowMargin = b.applyFlowMargin === false ? 0 : A.n('flow_safety_margin');
  const override = b.flowOverrideM3h != null && b.flowOverrideM3h > 0;
  const designFlow = override ? (b.flowOverrideM3h as number) : b.processFlowM3h * (1 + flowMargin / 100);
  if (b.enabled && override && (b.flowOverrideM3h as number) < b.processFlowM3h) f.critical(S, `${b.id}_flow_low`, `${b.name}: flow override ${b.flowOverrideM3h} m³/h is below the process requirement ${round(b.processFlowM3h, 2)} m³/h.`);
  const sum = (c: HeadCategory) => b.components.filter((x) => x.category === c).reduce((s, x) => s + x.headM, 0);
  const staticH = sum('static');
  const frictionH = sum('friction');
  const minorH = sum('minor');
  const equipH = sum('equipment');
  const termH = sum('terminal');
  const suctionH = -sum('suction');
  const calcHead = staticH + frictionH + minorH + equipH + termH - suctionH;
  const headMargin = A.n('head_safety_margin');
  const designHead = Math.max(0, calcHead) * (1 + headMargin / 100);
  const hyd = hydraulicKw(designFlow, designHead);

  // efficiency: selected pump curve at duty > project input > assumption
  const sel = b.selectedPump ?? null;
  let op: OperatingPoint | null = null;
  if (b.enabled && sel && sel.curve.length >= 2) {
    const hDyn = frictionH + minorH + equipH;
    op = operatingPoint(sel.curve, designFlow, designHead - hDyn * (1 + headMargin / 100), hDyn * (1 + headMargin / 100));
  }
  let eff = A.n(b.effKey);
  let effSource: PumpResult['efficiencySource'] = 'assumption';
  if (b.efficiencyOverride != null && b.efficiencyOverride > 0) {
    eff = b.efficiencyOverride;
    effSource = 'project input';
  }
  if (op?.efficiencyAtDesignPct) {
    eff = op.efficiencyAtDesignPct;
    effSource = 'pump curve';
  }
  const effOk = eff > 0 && eff <= 100;
  const shaft = effOk ? hyd / (eff / 100) : 0;
  const reqMotor = shaft * sf;
  const absorbed = motEff > 0 ? shaft / (motEff / 100) : 0;
  let stdMotor = b.enabled && shaft > 0 ? nextStandard(reqMotor, A.list('std_motors_kw')) : 0;
  if (stdMotor === null) {
    f.critical(S, `${b.id}_motor`, `${b.name}: required motor ${round(reqMotor, 1)} kW exceeds the largest standard motor – split into parallel pumps.`);
    stdMotor = round(reqMotor, 1);
  }

  const notes = [...(b.notes ?? [])];
  if (b.enabled) {
    if (!effOk) f.critical(S, `${b.id}_eff`, `${b.name}: pump efficiency ${eff} % is not valid.`);
    else if (eff < A.n('pump_eff_min_reasonable') || eff > A.n('pump_eff_max_reasonable'))
      f.review(S, `${b.id}_eff`, `${b.name}: efficiency ${eff} % (${effSource}) is outside the reasonable range ${A.n('pump_eff_min_reasonable')}–${A.n('pump_eff_max_reasonable')} %.`);
    if (calcHead < 0) f.review(S, `${b.id}_head_neg`, `${b.name}: calculated head is negative – pump may not be required.`);
    if (designFlow <= 0) f.critical(S, `${b.id}_flow`, `${b.name}: design flow is zero.`);
  }

  // ---- curve / selection checks
  if (b.enabled && designFlow > 0) {
    if (!sel) f.review(S, `${b.id}_opconfirm`, `${b.name}: pump operating point requires confirmation – select a pump with its manufacturer curve in the Pump Library.`);
    else if (sel.curve.length < 2) f.review(S, `${b.id}_opconfirm`, `${b.name}: selected pump "${sel.model}" has no curve – enter the manufacturer curve (flow, head, efficiency, NPSHr) to confirm the operating point.`);
    else if (op) {
      const tag = `${b.name} (${sel.model}${sel.isDemo ? ', DEMO curve' : ''})`;
      if (sel.isDemo) f.review(S, `${b.id}_democurve`, `${tag}: DEMO pump curve – replace with the manufacturer curve before selection.`);
      if (!op.withinCurve) f.critical(S, `${b.id}_outside`, `${tag}: design flow ${round(designFlow, 1)} m³/h is outside the pump curve range ${op.curveMinFlow}–${op.curveMaxFlow} m³/h.`);
      else if (op.headAtDesignFlowM !== null && op.headAtDesignFlowM < designHead * 0.995)
        f.critical(S, `${b.id}_insufficient`, `${tag}: insufficient pressure – pump delivers ${op.headAtDesignFlowM} m (${round(mToBar(op.headAtDesignFlowM), 2)} bar) at ${round(designFlow, 1)} m³/h but ${round(designHead, 1)} m (${round(mToBar(designHead), 2)} bar) is required.`);
      else if (op.excessHeadPct !== null && op.excessHeadPct > A.n('pump_excess_head_pct'))
        f.review(S, `${b.id}_excess`, `${tag}: ${op.excessHeadPct} % excess head at design flow – throttling or VFD required (energy loss). Consider fewer stages / smaller impeller.`);
      else f.ok(S, `${b.id}_curve`, `${tag}: head at design flow ${op.headAtDesignFlowM} m meets requirement ${round(designHead, 1)} m.`);
      if (op.bepRatio !== null && (op.bepRatio < A.n('pump_bep_min_ratio') || op.bepRatio > A.n('pump_bep_max_ratio')))
        f.review(S, `${b.id}_bep`, `${tag}: duty at ${Math.round(op.bepRatio * 100)} % of best-efficiency flow – outside ${Math.round(A.n('pump_bep_min_ratio') * 100)}–${Math.round(A.n('pump_bep_max_ratio') * 100)} %.`);
      if (op.efficiencyAtDesignPct === null) f.review(S, `${b.id}_nocurveeff`, `${tag}: curve has no efficiency data – assumed efficiency used.`);
      if (op.powerAtDesignKw !== null && op.powerAtDesignKw > sel.motorKw) f.critical(S, `${b.id}_overload`, `${tag}: absorbed power ${op.powerAtDesignKw} kW at duty exceeds the pump motor ${sel.motorKw} kW.`);
      if (b.npshAvailableM != null) {
        if (op.npshrAtDesignM === null) f.review(S, `${b.id}_npshr`, `${tag}: NPSHr not given in the curve – cavitation margin not verified.`);
        else if (b.npshAvailableM < op.npshrAtDesignM + A.n('npsh_margin_m'))
          f.critical(S, `${b.id}_npsh`, `${tag}: NPSH available ${round(b.npshAvailableM, 1)} m < NPSHr ${op.npshrAtDesignM} m + ${A.n('npsh_margin_m')} m margin – cavitation risk.`);
        else f.ok(S, `${b.id}_npsh`, `${tag}: NPSHa ${round(b.npshAvailableM, 1)} m ≥ NPSHr ${op.npshrAtDesignM} m + margin.`);
      }
    }
  }

  const candidates = b.enabled && designFlow > 0
    ? lib
        .filter((p) => p.pumpType === b.pumpType && p.curve.length >= 2)
        .map((p) => {
          const o = operatingPoint(p.curve, designFlow, designHead, 0);
          return { p, o };
        })
        .filter(({ o }) => o.withinCurve && o.headAtDesignFlowM !== null && o.headAtDesignFlowM >= designHead)
        .sort((x, y) => Math.abs((x.o.bepRatio ?? 1) - 1) - Math.abs((y.o.bepRatio ?? 1) - 1) || (x.o.headAtDesignFlowM as number) - (y.o.headAtDesignFlowM as number))
        .slice(0, 3)
        .map(({ p, o }) => ({ id: p.id, label: `${p.manufacturer} ${p.model}${p.isDemo ? ' (DEMO)' : ''}`, headAtFlowM: o.headAtDesignFlowM as number, bepRatio: o.bepRatio }))
    : [];

  const inputsQH = `Q ${n(designFlow)} m³/h = ${n(designFlow / 3600, 5)} m³/s, H ${n(designHead, 1)} m`;
  const steps: CalcStep[] = [
    step('Design flow', override ? 'Q = user override' : `Q = process flow × (1 + ${flowMargin} % margin)`, designFlow, 'm³/h', `process flow ${n(b.processFlowM3h)} m³/h`),
    step('Static head', 'Σ static elevation components', staticH, 'm', b.components.filter((c) => c.category === 'static').map((c) => `${c.label} ${n(c.headM)} m`).join(', ') || '0'),
    step('Pipe friction loss', 'Σ h_f (Darcy–Weisbach / Hazen–Williams)', frictionH, 'm'),
    step('Minor losses', 'Σ K·v²/2g', minorH, 'm'),
    step('Equipment pressure loss', 'Σ equipment ΔP × 10.19 m/bar', equipH, 'm', b.components.filter((c) => c.category === 'equipment').map((c) => `${c.label} ${c.note}`).join(', ') || '0'),
    step('Required operating pressure', 'terminal pressure × 10.19 m/bar', termH, 'm', b.components.filter((c) => c.category === 'terminal').map((c) => `${c.label} ${c.note}`).join(', ') || '0'),
    step('Suction pressure credit', 'P_suction × 10.19 m/bar', -suctionH, 'm'),
    step('Total Dynamic Head', 'TDH = static + friction + minor + equipment + operating − suction', calcHead, 'm'),
    step('Design TDH', `TDH_d = TDH × (1 + ${headMargin} % head margin)`, designHead, 'm', undefined, 'head design margin (assumption)'),
    step('Hydraulic power', 'P_h = ρ · g · Q · H', hyd, 'kW', `ρ 1000 kg/m³, g 9.81 m/s², ${inputsQH}`),
    step('Pump shaft power', 'P_s = P_h ÷ η_pump', shaft, 'kW', `η_pump ${eff} % (${effSource})`),
    step('Required motor power (calculated)', 'P_m = P_s × safety factor', reqMotor, 'kW', `SF ${sf}`, 'motor safety factor (assumption)'),
    step('Recommended standard motor', 'next IEC standard size ≥ P_m', stdMotor ?? 0, 'kW', undefined, 'IEC standard list (assumption)'),
    step('Electrical input at duty', 'P_e = P_s ÷ η_motor', absorbed, 'kW', `η_motor ${motEff} %`),
  ];
  if (b.npshAvailableM != null) steps.push(step('NPSH available', b.npshNote ?? 'NPSHa', b.npshAvailableM, 'm'));

  return {
    id: b.id, name: b.name, pumpType: b.pumpType, enabled: b.enabled,
    processFlowM3h: round(b.processFlowM3h, 3), designFlowM3h: round(designFlow, 2),
    components: b.components.map((c) => ({ ...c, headM: round(c.headM, 3) })),
    staticHeadM: round(staticH, 2), frictionHeadM: round(frictionH, 3), minorHeadM: round(minorH, 3), equipmentHeadM: round(equipH, 2), terminalHeadM: round(termH, 2), suctionCreditM: round(suctionH, 2),
    calculatedHeadM: round(calcHead, 2), designHeadM: round(designHead, 2), designPressureBar: round(mToBar(designHead), 3),
    suctionPressureBar: b.suctionPressureBar ?? null,
    dischargePressureBar: b.suctionPressureBar != null ? round(b.suctionPressureBar + mToBar(designHead), 2) : null,
    efficiencyPct: round(eff, 1), efficiencySource: effSource, motorEfficiencyPct: motEff, safetyFactor: sf,
    hydraulicKw: round(hyd, 3), shaftKw: round(shaft, 3), requiredMotorKw: b.enabled ? round(reqMotor, 2) : 0, standardMotorKw: b.enabled ? stdMotor ?? 0 : 0,
    absorbedKw: b.enabled ? round(absorbed, 3) : 0, motorKw: b.enabled ? stdMotor ?? 0 : 0,
    npshAvailableM: b.npshAvailableM == null ? null : round(b.npshAvailableM, 2), npshNote: b.npshNote ?? 'Not applicable',
    selectedPump: sel, operatingPoint: op, candidates, steps, notes,
  };
}

export { barToM, M_PER_BAR };
