import type { AssumptionReader } from '../assumptions';
import type { PipeMaterial, PipeSectionId, PipeSectionOverride, PipeSize } from '../types';
import { CalcStep, Findings, isNum, mToBar, round } from './common';
import { kinematicViscosity } from './water';

export interface PipeSectionDef {
  id: PipeSectionId;
  label: string;
  velocityKey: string;
  defaultMaterial: string;
  defaultLengthM: number;
}

export const PIPE_SECTIONS: PipeSectionDef[] = [
  { id: 'borehole_to_raw_tank', label: 'Borehole → Raw Water Tank', velocityKey: 'vel_borehole', defaultMaterial: 'HDPE PE100 SDR11 (PN16)', defaultLengthM: 100 },
  { id: 'raw_tank_to_pretreatment', label: 'Raw Water Tank → Pretreatment', velocityKey: 'vel_raw_to_pt', defaultMaterial: 'PVC-U PN16', defaultLengthM: 10 },
  { id: 'pretreatment_to_cartridge', label: 'Pretreatment → Cartridge Filter', velocityKey: 'vel_pt_to_cf', defaultMaterial: 'PVC-U PN16', defaultLengthM: 15 },
  { id: 'cartridge_to_hp', label: 'Cartridge Filter → HP Pump', velocityKey: 'vel_cf_to_hp', defaultMaterial: 'PVC-U PN16', defaultLengthM: 5 },
  { id: 'hp_to_ro', label: 'HP Pump → RO', velocityKey: 'vel_hp_to_ro', defaultMaterial: 'Stainless Steel 316L Sch10S', defaultLengthM: 10 },
  { id: 'permeate_to_tank', label: 'RO Permeate → Product Tank', velocityKey: 'vel_permeate', defaultMaterial: 'PVC-U PN16', defaultLengthM: 20 },
  { id: 'reject_to_drain', label: 'RO Reject → Drain / Recovery', velocityKey: 'vel_reject', defaultMaterial: 'PVC-U PN16', defaultLengthM: 30 },
  { id: 'product_to_distribution', label: 'Product Tank → Distribution', velocityKey: 'vel_distribution', defaultMaterial: 'HDPE PE100 SDR11 (PN16)', defaultLengthM: 100 },
];

export interface PipeCalcInput {
  flowM3h: number;
  material: string;
  maxVelocity: number;
  lengthM: number;
  elevationM: number;
  designPressureBar: number;
  temperatureC: number;
  fittingsPct: number;
}

export interface PipeCalcResult {
  flowM3h: number;
  material: string;
  maxVelocity: number;
  lengthM: number;
  elevationM: number;
  designPressureBar: number;
  requiredIdMm: number;
  dn: number | null;
  outerDiameterMm: number | null;
  innerDiameterMm: number | null;
  pressureRatingBar: number | null;
  velocity: number;
  reynolds: number;
  frictionFactor: number;
  frictionLossM: number;
  fittingsLossM: number;
  totalLossM: number;
  totalLossBar: number;
  lossPer100m: number;
  staticHeadM: number;
  status: 'ok' | 'review' | 'critical';
  messages: { level: 'review' | 'critical'; text: string }[];
  steps: CalcStep[];
}

/** Darcy friction factor – laminar 64/Re, turbulent Swamee–Jain explicit approximation of Colebrook. */
export function frictionFactor(re: number, roughnessMm: number, idMm: number) {
  if (re <= 0) return 0;
  if (re < 2300) return 64 / re;
  const e = roughnessMm / idMm;
  const f = 0.25 / Math.pow(Math.log10(e / 3.7 + 5.74 / Math.pow(re, 0.9)), 2);
  if (re < 4000) {
    // transitional – interpolate between laminar and turbulent for continuity
    const fl = 64 / 2300;
    const ft = 0.25 / Math.pow(Math.log10(e / 3.7 + 5.74 / Math.pow(4000, 0.9)), 2);
    return fl + ((ft - fl) * (re - 2300)) / 1700;
  }
  return f;
}

/** Hydraulic evaluation of a given internal diameter. */
export function pipeHydraulics(flowM3h: number, idMm: number, lengthM: number, roughnessMm: number, tempC: number, fittingsPct: number) {
  const q = flowM3h / 3600;
  const d = idMm / 1000;
  const area = (Math.PI * d * d) / 4;
  const v = area > 0 ? q / area : 0;
  const nu = kinematicViscosity(tempC);
  const re = (v * d) / nu;
  const f = frictionFactor(re, roughnessMm, idMm);
  const hf = d > 0 ? f * (lengthM / d) * ((v * v) / (2 * 9.81)) : 0;
  const hm = hf * (fittingsPct / 100);
  return { velocity: v, reynolds: re, frictionFactor: f, frictionLossM: hf, fittingsLossM: hm, totalLossM: hf + hm };
}

/**
 * Size a pipe: required ID from continuity (d = √(4Q/(π·v_max))), then the smallest
 * catalogue size of the chosen material whose internal diameter ≥ required ID.
 * The catalogue (DN, OD, wall, ID) is editable data in the local database.
 */
export function sizePipe(inp: PipeCalcInput, catalog: PipeSize[], materials: PipeMaterial[], A: AssumptionReader | null, sectionLabel = 'Pipe'): PipeCalcResult {
  const messages: { level: 'review' | 'critical'; text: string }[] = [];
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
  if (!mat) bump('review', `Material "${inp.material}" not in material list – roughness 0.05 mm assumed.`);
  const sizes = catalog.filter((c) => c.material === inp.material).sort((a, b) => a.innerDiameterMm - b.innerDiameterMm);
  let sel: PipeSize | null = null;
  if (sizes.length === 0) bump('critical', `No catalogue sizes for material "${inp.material}". Add sizes in Settings → Pipe catalogue.`);
  else {
    sel = sizes.find((s) => s.innerDiameterMm >= reqId - 1e-6) ?? null;
    if (!sel) {
      sel = sizes[sizes.length - 1];
      bump('critical', `Required ID ${round(reqId, 0)} mm exceeds the largest catalogue size (DN ${sel.dn}). Use parallel pipes or add larger sizes.`);
    }
  }
  const id = sel ? sel.innerDiameterMm : reqId;
  const h = inp.flowM3h > 0 && id > 0 ? pipeHydraulics(inp.flowM3h, id, inp.lengthM, rough, inp.temperatureC, inp.fittingsPct) : { velocity: 0, reynolds: 0, frictionFactor: 0, frictionLossM: 0, fittingsLossM: 0, totalLossM: 0 };

  const vCrit = A ? A.n('vel_critical') : 3;
  const vMin = A ? A.n('vel_min') : 0.3;
  if (inp.flowM3h <= 0) bump('review', 'No flow in this section.');
  else if (h.velocity > vCrit) bump('critical', `Velocity ${round(h.velocity, 2)} m/s exceeds the critical limit ${vCrit} m/s.`);
  else if (h.velocity > vMax + 1e-6) bump('review', `Velocity ${round(h.velocity, 2)} m/s exceeds the design maximum ${vMax} m/s.`);
  else if (h.velocity < vMin) bump('review', `Velocity ${round(h.velocity, 2)} m/s is below ${vMin} m/s – pipe is oversized for this flow (smallest catalogue size may be too large).`);
  if (sel && inp.designPressureBar > sel.pressureRatingBar) bump('critical', `Design pressure ${round(inp.designPressureBar, 1)} bar exceeds the ${inp.material} DN ${sel.dn} rating of ${sel.pressureRatingBar} bar – select a higher-rated material.`);
  if (inp.lengthM < 0) bump('critical', 'Pipe length cannot be negative.');
  void sectionLabel;

  const steps: CalcStep[] = [
    { label: 'Required internal diameter', formula: 'd = √(4·Q ÷ (π·v_max))', value: round(reqId, 1), unit: 'mm' },
    { label: 'Selected pipe', formula: 'smallest catalogue ID ≥ d', value: sel ? `DN ${sel.dn} (ID ${round(sel.innerDiameterMm, 1)} mm)` : '–', unit: '' },
    { label: 'Velocity', formula: 'v = Q ÷ (π·ID²/4)', value: round(h.velocity, 2), unit: 'm/s' },
    { label: 'Reynolds number', formula: 'Re = v·ID ÷ ν(T)', value: round(h.reynolds, 0), unit: '–' },
    { label: 'Friction factor', formula: 'Swamee–Jain: f = 0.25 ÷ [log10(ε/3.7D + 5.74/Re^0.9)]²', value: round(h.frictionFactor, 4), unit: '–' },
    { label: 'Friction loss', formula: 'h_f = f·(L/D)·v²/2g', value: round(h.frictionLossM, 2), unit: 'm' },
    { label: 'Fittings & valves', formula: `h_m = h_f × ${inp.fittingsPct} %`, value: round(h.fittingsLossM, 2), unit: 'm' },
  ];

  return {
    flowM3h: round(inp.flowM3h, 2),
    material: inp.material,
    maxVelocity: vMax,
    lengthM: inp.lengthM,
    elevationM: inp.elevationM,
    designPressureBar: round(inp.designPressureBar, 1),
    requiredIdMm: round(reqId, 1),
    dn: sel?.dn ?? null,
    outerDiameterMm: sel?.outerDiameterMm ?? null,
    innerDiameterMm: sel ? round(sel.innerDiameterMm, 1) : null,
    pressureRatingBar: sel?.pressureRatingBar ?? null,
    velocity: round(h.velocity, 2),
    reynolds: round(h.reynolds, 0),
    frictionFactor: round(h.frictionFactor, 4),
    frictionLossM: round(h.frictionLossM, 2),
    fittingsLossM: round(h.fittingsLossM, 2),
    totalLossM: round(h.totalLossM, 2),
    totalLossBar: round(mToBar(h.totalLossM), 3),
    lossPer100m: inp.lengthM > 0 ? round((h.frictionLossM / inp.lengthM) * 100, 2) : 0,
    staticHeadM: inp.elevationM,
    status,
    messages,
    steps,
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
        fittingsPct: A.n('fittings_allowance'),
      },
      catalog,
      materials,
      A,
      def.label,
    );
    for (const m of res.messages) f.add(m.level, 'Pipes', `pipe_${def.id}`, `${def.label}: ${m.text}`);
    if (res.messages.length === 0) f.ok('Pipes', `pipe_${def.id}`, `${def.label}: DN ${res.dn}, ${res.velocity} m/s – within limits.`);
    return { ...res, id: def.id, label: def.label };
  });
}
