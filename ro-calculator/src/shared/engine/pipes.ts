import type { AssumptionReader } from '../assumptions';
import type { FittingType, PipeMaterial, PipeSectionId, PipeSectionOverride, PipeSize } from '../types';
import { FITTING_LABELS } from '../types';
import { CalcStep, Findings, isNum, mToBar, n, round, step } from './common';
import { kinematicViscosity } from './water';

export type FrictionMethod = 'darcy' | 'hazen';

export interface PipeSectionDef {
  id: PipeSectionId;
  label: string;
  velocityKey: string;
  defaultMaterial: string;
  defaultLengthM: number;
  defaultFittings: Partial<Record<FittingType, number>>;
}

export const PIPE_SECTIONS: PipeSectionDef[] = [
  { id: 'borehole_to_raw_tank', label: 'Borehole → Raw Water Tank', velocityKey: 'vel_borehole', defaultMaterial: 'HDPE PE100 SDR11 (PN16)', defaultLengthM: 100, defaultFittings: { elbow90: 4, check_valve: 1, gate_valve: 1, exit: 1 } },
  { id: 'raw_tank_to_pretreatment', label: 'Raw Water Tank → Pretreatment', velocityKey: 'vel_raw_to_pt', defaultMaterial: 'PVC-U PN16', defaultLengthM: 10, defaultFittings: { entrance: 1, elbow90: 4, butterfly_valve: 2, check_valve: 1, strainer: 1, tee_branch: 1 } },
  { id: 'pretreatment_to_cartridge', label: 'Pretreatment → Cartridge Filter', velocityKey: 'vel_pt_to_cf', defaultMaterial: 'PVC-U PN16', defaultLengthM: 15, defaultFittings: { elbow90: 6, butterfly_valve: 2, tee_line: 2 } },
  { id: 'cartridge_to_hp', label: 'Cartridge Filter → HP Pump', velocityKey: 'vel_cf_to_hp', defaultMaterial: 'PVC-U PN16', defaultLengthM: 5, defaultFittings: { elbow90: 3, butterfly_valve: 1 } },
  { id: 'hp_to_ro', label: 'HP Pump → RO', velocityKey: 'vel_hp_to_ro', defaultMaterial: 'Stainless Steel 316L Sch10S', defaultLengthM: 10, defaultFittings: { elbow90: 4, check_valve: 1, ball_valve: 1, tee_branch: 1 } },
  { id: 'permeate_to_tank', label: 'RO Permeate → Product Tank', velocityKey: 'vel_permeate', defaultMaterial: 'PVC-U PN16', defaultLengthM: 20, defaultFittings: { elbow90: 6, ball_valve: 2, check_valve: 1, tee_line: 2, exit: 1 } },
  { id: 'reject_to_drain', label: 'RO Reject → Drain / Recovery', velocityKey: 'vel_reject', defaultMaterial: 'PVC-U PN16', defaultLengthM: 30, defaultFittings: { elbow90: 4, ball_valve: 1, exit: 1 } },
  { id: 'product_to_distribution', label: 'Product Tank → Distribution', velocityKey: 'vel_distribution', defaultMaterial: 'HDPE PE100 SDR11 (PN16)', defaultLengthM: 100, defaultFittings: { entrance: 1, elbow90: 6, gate_valve: 2, check_valve: 1, tee_line: 2, exit: 1 } },
];

export interface PipeCalcInput {
  flowM3h: number;
  material: string;
  maxVelocity: number;
  lengthM: number;
  elevationM: number;
  designPressureBar: number;
  temperatureC: number;
  fittings: Partial<Record<FittingType, number>>;
  method: FrictionMethod;
  dnOverride?: number | null;
}

export interface FittingLine {
  type: FittingType;
  label: string;
  count: number;
  k: number;
}

export interface PipeCalcResult {
  flowM3h: number;
  material: string;
  maxVelocity: number;
  lengthM: number;
  elevationM: number;
  designPressureBar: number;
  method: FrictionMethod;
  dnForced: boolean;
  requiredIdMm: number;
  dn: number | null;
  outerDiameterMm: number | null;
  innerDiameterMm: number | null;
  pressureRatingBar: number | null;
  velocity: number;
  velocityHeadM: number;
  reynolds: number;
  frictionFactor: number;
  hazenC: number | null;
  darcyLossM: number;
  hazenLossM: number | null;
  frictionLossM: number;
  lossPer100m: number;
  fittings: FittingLine[];
  sumK: number;
  minorLossM: number;
  totalLossM: number;
  totalLossBar: number;
  staticHeadM: number;
  status: 'ok' | 'review' | 'critical';
  messages: { level: 'review' | 'critical'; text: string }[];
  steps: CalcStep[];
}

/** Darcy friction factor – laminar 64/Re, turbulent Swamee–Jain explicit approximation of Colebrook–White. */
export function frictionFactor(re: number, roughnessMm: number, idMm: number) {
  if (re <= 0) return 0;
  if (re < 2300) return 64 / re;
  const e = roughnessMm / idMm;
  const sj = (r: number) => 0.25 / Math.pow(Math.log10(e / 3.7 + 5.74 / Math.pow(r, 0.9)), 2);
  if (re < 4000) {
    const fl = 64 / 2300;
    return fl + ((sj(4000) - fl) * (re - 2300)) / 1700;
  }
  return sj(re);
}

/** Hazen–Williams head loss (SI): h = 10.67·L·Q^1.852 ÷ (C^1.852·d^4.87), Q in m³/s, d in m. */
export function hazenWilliamsLoss(flowM3h: number, idMm: number, lengthM: number, c: number) {
  const q = flowM3h / 3600;
  const d = idMm / 1000;
  if (q <= 0 || d <= 0 || c <= 0) return 0;
  return (10.67 * lengthM * Math.pow(q, 1.852)) / (Math.pow(c, 1.852) * Math.pow(d, 4.87));
}

export function pipeHydraulics(flowM3h: number, idMm: number, lengthM: number, roughnessMm: number, tempC: number) {
  const q = flowM3h / 3600;
  const d = idMm / 1000;
  const area = (Math.PI * d * d) / 4;
  const v = area > 0 ? q / area : 0;
  const nu = kinematicViscosity(tempC);
  const re = (v * d) / nu;
  const f = frictionFactor(re, roughnessMm, idMm);
  const hf = d > 0 ? f * (lengthM / d) * ((v * v) / (2 * 9.81)) : 0;
  return { velocity: v, reynolds: re, frictionFactor: f, frictionLossM: hf, velocityHead: (v * v) / (2 * 9.81), nu };
}

export function fittingK(type: FittingType, A: AssumptionReader | null) {
  const defaults: Record<FittingType, number> = { elbow90: 0.5, elbow45: 0.3, tee_line: 0.3, tee_branch: 1, gate_valve: 0.15, ball_valve: 0.05, butterfly_valve: 0.5, globe_valve: 6, check_valve: 2, strainer: 2, entrance: 0.5, exit: 1 };
  return A ? A.n(`k_${type}`) : defaults[type];
}

/**
 * Size a pipe: required ID from continuity d = √(4Q/(π·v_max)), then the smallest catalogue
 * size of the chosen material whose ID ≥ d (or a user-forced DN). Friction by Darcy–Weisbach
 * (Swamee–Jain) or Hazen–Williams; minor losses by K-values: h_m = ΣK·v²/2g.
 */
export function sizePipe(inp: PipeCalcInput, catalog: PipeSize[], materials: PipeMaterial[], A: AssumptionReader | null): PipeCalcResult {
  const messages: PipeCalcResult['messages'] = [];
  let status: 'ok' | 'review' | 'critical' = 'ok';
  const bump = (s: 'review' | 'critical', m: string) => {
    messages.push({ level: s, text: m });
    if (s === 'critical' || status === 'ok') status = s;
  };
  const vMax = inp.maxVelocity > 0 ? inp.maxVelocity : 1.5;
  if (inp.maxVelocity <= 0) bump('critical', 'Max velocity must be positive – 1.5 m/s used.');
  const q = Math.max(inp.flowM3h, 0) / 3600;
  const reqId = q > 0 ? Math.sqrt((4 * q) / (Math.PI * vMax)) * 1000 : 0;
  const mat = materials.find((m) => m.name === inp.material);
  const rough = mat?.roughnessMm ?? 0.05;
  const hazenC = mat?.hazenC ?? null;
  if (!mat) bump('review', `Material "${inp.material}" not in material list – roughness 0.05 mm assumed.`);
  const sizes = catalog.filter((c) => c.material === inp.material).sort((a, b) => a.innerDiameterMm - b.innerDiameterMm);
  let sel: PipeSize | null = null;
  let forced = false;
  if (sizes.length === 0) bump('critical', `No catalogue sizes for material "${inp.material}". Add sizes in the Pipe Calculator → catalogue.`);
  else if (isNum(inp.dnOverride) && inp.dnOverride > 0) {
    sel = sizes.find((s) => s.dn === inp.dnOverride) ?? null;
    forced = true;
    if (!sel) {
      bump('critical', `DN ${inp.dnOverride} is not in the ${inp.material} catalogue – calculated size used instead.`);
      forced = false;
    }
  }
  if (sizes.length && !sel) {
    sel = sizes.find((s) => s.innerDiameterMm >= reqId - 1e-6) ?? null;
    if (!sel) {
      sel = sizes[sizes.length - 1];
      bump('critical', `Required ID ${round(reqId, 0)} mm exceeds the largest catalogue size (DN ${sel.dn}). Use parallel pipes or add larger sizes.`);
    }
  }
  const id = sel ? sel.innerDiameterMm : reqId;
  const t = inp.temperatureC;
  const h = inp.flowM3h > 0 && id > 0 ? pipeHydraulics(inp.flowM3h, id, inp.lengthM, rough, t) : { velocity: 0, reynolds: 0, frictionFactor: 0, frictionLossM: 0, velocityHead: 0, nu: kinematicViscosity(t) };
  const hw = hazenC && inp.flowM3h > 0 && id > 0 ? hazenWilliamsLoss(inp.flowM3h, id, inp.lengthM, hazenC) : null;
  let method = inp.method;
  if (method === 'hazen') {
    if (hw === null) {
      bump('review', 'Hazen–Williams C not available for this material – Darcy–Weisbach used.');
      method = 'darcy';
    } else {
      if (id < (A ? A.n('hazen_min_dn') : 50)) bump('review', `Hazen–Williams is outside its validity for ID < ${A ? A.n('hazen_min_dn') : 50} mm – Darcy–Weisbach recommended.`);
      if (h.velocity > 3) bump('review', 'Hazen–Williams is not reliable above 3 m/s.');
      if (t < 5 || t > 30) bump('review', 'Hazen–Williams assumes water at ~5–30 °C.');
    }
  }
  const friction = method === 'hazen' && hw !== null ? hw : h.frictionLossM;
  const fittings: FittingLine[] = (Object.entries(inp.fittings) as [FittingType, number][])
    .filter(([, c]) => c > 0)
    .map(([type, count]) => ({ type, label: FITTING_LABELS[type] ?? type, count, k: fittingK(type, A) }));
  const sumK = fittings.reduce((s, x) => s + x.k * x.count, 0);
  const minor = sumK * h.velocityHead;
  const total = friction + minor;

  const vCrit = A ? A.n('vel_critical') : 3;
  const vMin = A ? A.n('vel_min') : 0.3;
  if (inp.flowM3h <= 0) bump('review', 'No flow in this section.');
  else if (h.velocity > vCrit) bump('critical', `Pipe velocity ${round(h.velocity, 2)} m/s is excessive – exceeds the critical limit ${vCrit} m/s.`);
  else if (h.velocity > vMax + 1e-6) bump(forced ? 'critical' : 'review', `Velocity ${round(h.velocity, 2)} m/s exceeds the design maximum ${vMax} m/s${forced ? ' (forced DN)' : ''}.`);
  else if (h.velocity < vMin) bump('review', `Velocity ${round(h.velocity, 2)} m/s is below ${vMin} m/s – pipe oversized for this flow.`);
  if (sel && inp.designPressureBar > sel.pressureRatingBar) bump('critical', `Design pressure ${round(inp.designPressureBar, 1)} bar exceeds the ${inp.material} DN ${sel.dn} rating of ${sel.pressureRatingBar} bar – select a higher-rated material.`);
  if (inp.lengthM < 0) bump('critical', 'Pipe length cannot be negative.');

  const Q = `Q ${n(inp.flowM3h)} m³/h`;
  const steps: CalcStep[] = [
    step('Required internal diameter', 'd = √(4·Q ÷ (π·v_max))', reqId, 'mm', `${Q}, v_max ${vMax} m/s`),
    step('Selected pipe', forced ? 'user-forced DN' : 'smallest catalogue ID ≥ d', sel ? `DN ${sel.dn} (OD ${sel.outerDiameterMm}, ID ${round(sel.innerDiameterMm, 1)} mm)` : '–', '', inp.material),
    step('Velocity', 'v = Q ÷ (π·ID²/4)', h.velocity, 'm/s', `${Q}, ID ${n(id, 1)} mm`),
    step('Reynolds number', 'Re = v·ID ÷ ν(T)', h.reynolds, '–', `ν = ${h.nu.toExponential(3)} m²/s at ${t} °C`),
    step('Friction factor', 'Swamee–Jain: f = 0.25 ÷ [log10(ε/3.7D + 5.74/Re^0.9)]²', h.frictionFactor, '–', `ε ${rough} mm, D ${n(id, 1)} mm`),
    step('Friction loss (Darcy–Weisbach)', 'h_f = f·(L/D)·v²/2g', h.frictionLossM, 'm', `L ${inp.lengthM} m`),
  ];
  if (hw !== null) steps.push(step('Friction loss (Hazen–Williams)', 'h_f = 10.67·L·Q^1.852 ÷ (C^1.852·d^4.87)', hw, 'm', `C = ${hazenC}, L ${inp.lengthM} m`, method === 'hazen' ? 'selected method' : 'cross-check only'));
  steps.push(
    step('Minor losses', 'h_m = ΣK · v²/2g', minor, 'm', fittings.length ? fittings.map((x) => `${x.count}× ${x.label} (K ${x.k})`).join(', ') : 'no fittings', `ΣK = ${round(sumK, 2)}`),
    step('Total pipe loss', `h = h_f (${method === 'hazen' ? 'Hazen–Williams' : 'Darcy–Weisbach'}) + h_m`, total, 'm', undefined, `= ${n(mToBar(total), 3)} bar`),
  );

  return {
    flowM3h: round(inp.flowM3h, 3), material: inp.material, maxVelocity: vMax, lengthM: inp.lengthM, elevationM: inp.elevationM, designPressureBar: round(inp.designPressureBar, 1),
    method, dnForced: forced, requiredIdMm: round(reqId, 1), dn: sel?.dn ?? null, outerDiameterMm: sel?.outerDiameterMm ?? null, innerDiameterMm: sel ? round(sel.innerDiameterMm, 1) : null,
    pressureRatingBar: sel?.pressureRatingBar ?? null, velocity: round(h.velocity, 3), velocityHeadM: round(h.velocityHead, 4), reynolds: round(h.reynolds, 0), frictionFactor: round(h.frictionFactor, 5),
    hazenC, darcyLossM: round(h.frictionLossM, 3), hazenLossM: hw === null ? null : round(hw, 3), frictionLossM: round(friction, 3),
    lossPer100m: inp.lengthM > 0 ? round((friction / inp.lengthM) * 100, 3) : 0, fittings, sumK: round(sumK, 2), minorLossM: round(minor, 3), totalLossM: round(total, 3),
    totalLossBar: round(mToBar(total), 4), staticHeadM: inp.elevationM, status, messages, steps,
  };
}

export interface PipeSectionResult extends PipeCalcResult {
  id: PipeSectionId;
  label: string;
}

export interface SectionFlows {
  flows: Record<PipeSectionId, number>;
  defaultLengths: Partial<Record<PipeSectionId, number>>;
  defaultElevations: Partial<Record<PipeSectionId, number>>;
  defaultPressures: Record<PipeSectionId, number>;
}

export function calcPipeSections(
  sf: SectionFlows,
  overrides: Partial<Record<PipeSectionId, PipeSectionOverride>>,
  method: FrictionMethod,
  catalog: PipeSize[],
  materials: PipeMaterial[],
  tempC: number,
  A: AssumptionReader,
  f: Findings,
): PipeSectionResult[] {
  return PIPE_SECTIONS.map((def) => {
    const o = overrides[def.id] ?? {};
    const res = sizePipe(
      {
        flowM3h: sf.flows[def.id],
        material: o.material || def.defaultMaterial,
        maxVelocity: isNum(o.maxVelocity) ? o.maxVelocity : A.n(def.velocityKey),
        lengthM: isNum(o.lengthM) ? o.lengthM : sf.defaultLengths[def.id] ?? def.defaultLengthM,
        elevationM: isNum(o.elevationM) ? o.elevationM : sf.defaultElevations[def.id] ?? 0,
        designPressureBar: isNum(o.designPressureBar) ? o.designPressureBar : sf.defaultPressures[def.id],
        temperatureC: tempC,
        fittings: o.fittings ?? def.defaultFittings,
        method,
        dnOverride: o.dn ?? null,
      },
      catalog,
      materials,
      A,
    );
    for (const m of res.messages) f.add(m.level, 'Pipes', `pipe_${def.id}`, `${def.label}: ${m.text}`);
    if (res.messages.length === 0) f.ok('Pipes', `pipe_${def.id}`, `${def.label}: DN ${res.dn}, ${res.velocity} m/s – within limits.`);
    return { ...res, id: def.id, label: def.label };
  });
}
