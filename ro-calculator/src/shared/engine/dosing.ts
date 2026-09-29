import type { AssumptionReader } from '../assumptions';
import type { PretreatmentInput, RawWaterInput } from '../types';
import { CalcStep, Findings, isNum, nextStandard, round } from './common';
import type { PretreatmentResult } from './pretreatment';
import { ptIn } from './pretreatment';
import type { ProductionResult } from './production';

export interface DosingLine {
  id: 'antiscalant' | 'acid' | 'smbs' | 'prechlorination' | 'post_chlorination';
  chemical: string;
  dosingPoint: string;
  treatedFlowM3h: number;
  doseMgL: number;
  doseBasis: string;
  productKgH: number;
  productKgDay: number;
  solutionLh: number;
  pumpCapacityLh: number;
  tankVolumeL: number;
  tankSelectedL: number;
  /** calculated = from water analysis / design basis; supplier = dose from supplier projection; indicative = typical value, NOT a prescription */
  doseStatus: 'calculated' | 'supplier' | 'indicative';
  steps: CalcStep[];
  notes: string[];
}

export function calcDosing(w: RawWaterInput, prod: ProductionResult, pt: PretreatmentResult, ptInput: PretreatmentInput, hours: number, A: AssumptionReader, f: Findings): DosingLine[] {
  const lines: DosingLine[] = [];
  const days = A.n('chemical_autonomy_days');
  const margin = A.n('dosing_pump_margin');

  const line = (
    id: DosingLine['id'], chemical: string, point: string, flow: number, dose: number, basis: string,
    kind: { type: 'liquid'; strengthPct: number; density: number; dilutionPct: number } | { type: 'powder'; purityPct: number; solutionPct: number },
    notes: string[],
    doseStatus: DosingLine['doseStatus'] = 'calculated',
  ) => {
    const activeKgH = (dose * flow) / 1000;
    let productKgH: number;
    let solutionLh: number;
    if (kind.type === 'liquid') {
      productKgH = activeKgH / (kind.strengthPct / 100);
      const productLh = productKgH / kind.density;
      solutionLh = productLh / (kind.dilutionPct / 100);
    } else {
      productKgH = activeKgH / (kind.purityPct / 100);
      solutionLh = productKgH / (kind.solutionPct / 100); // % w/v → kg per L = pct/100
    }
    const pump = nextStandard(solutionLh * margin, A.list('std_dosing_pumps_lh'));
    const tankL = solutionLh * hours * days * (1 + A.n('tank_freeboard') / 100);
    const tankSel = nextStandard(tankL, A.list('std_chemical_tanks_l'));
    if (pump === null) f.review('Dosing', `${id}_pump`, `${chemical}: required dosing capacity ${round(solutionLh * margin, 1)} L/h exceeds the standard pump list – use a larger metering pump or stronger solution.`);
    if (tankSel === null) f.review('Dosing', `${id}_tank`, `${chemical}: tank ${round(tankL, 0)} L exceeds standard sizes – use bulk storage with a day tank.`);
    const steps: CalcStep[] = [
      { label: 'Active chemical', formula: 'm = dose (mg/L) × Q (m³/h) ÷ 1000', value: round(activeKgH, 4), unit: 'kg/h' },
      kind.type === 'liquid'
        ? { label: 'Commercial product', formula: `m_p = m ÷ ${kind.strengthPct} %`, value: round(productKgH, 4), unit: 'kg/h' }
        : { label: 'Powder product', formula: `m_p = m ÷ ${kind.purityPct} % purity`, value: round(productKgH, 4), unit: 'kg/h' },
      kind.type === 'liquid'
        ? { label: 'Dosing solution', formula: `V = m_p ÷ ρ (${kind.density} kg/L) ÷ ${kind.dilutionPct} % dilution`, value: round(solutionLh, 2), unit: 'L/h' }
        : { label: 'Dosing solution', formula: `V = m_p ÷ ${kind.solutionPct} % w/v solution`, value: round(solutionLh, 2), unit: 'L/h' },
      { label: 'Dosing pump capacity', formula: `next standard ≥ V × ${margin}`, value: pump ?? round(solutionLh * margin, 1), unit: 'L/h' },
      { label: 'Tank volume', formula: `V × ${hours} h/day × ${days} days × (1 + ${A.n('tank_freeboard')} %)`, value: round(tankL, 0), unit: 'L' },
    ];
    lines.push({
      id, chemical, dosingPoint: point, treatedFlowM3h: round(flow, 2), doseMgL: round(dose, 2), doseBasis: basis,
      productKgH: round(productKgH, 4), productKgDay: round(productKgH * hours, 2), solutionLh: round(solutionLh, 2),
      pumpCapacityLh: pump ?? round(solutionLh * margin, 1), tankVolumeL: round(tankL, 0), tankSelectedL: tankSel ?? round(tankL, 0), doseStatus, steps, notes,
    });
  };

  const feed = prod.feedM3h;
  if (feed <= 0) return lines;
  const liquid = (s: string, d: string, dil: string) => ({ type: 'liquid' as const, strengthPct: A.n(s), density: A.n(d), dilutionPct: A.n(dil) });

  if (ptIn(pt, 'prechlorination')) {
    const fe = isNum(w.iron) ? w.iron : 0;
    const mn = isNum(w.manganese) ? w.manganese : 0;
    const dose = 0.63 * fe + 0.77 * mn + A.n('prechlor_residual');
    line('prechlorination', `Sodium hypochlorite ${A.n('naocl_strength')} % (pre-chlorination)`, 'Raw water line before iron/manganese filter', feed * A.n('raw_flow_factor'), dose,
      `0.63 × Fe (${fe}) + 0.77 × Mn (${mn}) + ${A.n('prechlor_residual')} mg/L residual (as Cl2)`, liquid('naocl_strength', 'naocl_density', 'naocl_dilution'),
      ['Chlorine must be completely removed before the RO (carbon filter and/or SMBS).']);
  }
  if (ptIn(pt, 'acid') && pt.acidDoseMeqL && pt.acidDoseMeqL > 0) {
    const dose = pt.acidDoseMeqL * 36.46;
    line('acid', `Hydrochloric acid ${A.n('acid_strength')} %`, 'RO feed, upstream of cartridge filter (with static mixer)', feed, dose,
      `${pt.acidDoseMeqL} meq/L × 36.46 mg/meq to lower pH to ≈ ${pt.acidTargetPh}`, liquid('acid_strength', 'acid_density', 'acid_dilution'),
      ['Install pH controller with high/low alarms. Acid-resistant (PVDF/PTFE) dosing pump head.']);
  }
  if (ptIn(pt, 'smbs')) {
    const cl = isNum(w.freeChlorine) ? w.freeChlorine : 0;
    const prechlor = ptIn(pt, 'prechlorination') ? A.n('prechlor_residual') : 0;
    const clTotal = Math.max(cl, prechlor);
    const dose = A.n('smbs_ratio') * clTotal + A.n('smbs_margin');
    line('smbs', 'Sodium metabisulfite (SMBS)', 'RO feed, upstream of cartridge filter', feed, dose, `${A.n('smbs_ratio')} × ${clTotal} mg/L Cl2 + ${A.n('smbs_margin')} mg/L`,
      { type: 'powder', purityPct: A.n('smbs_purity'), solutionPct: A.n('smbs_solution') }, ['Prepare fresh solution weekly (oxidises in air). Verify with ORP < 200 mV.']);
  }
  if (ptIn(pt, 'antiscalant')) {
    const sup = ptInput.antiscalantDoseMgL;
    const hasSup = typeof sup === 'number' && isFinite(sup) && sup > 0;
    const dose = hasSup ? (sup as number) : A.n('antiscalant_dose');
    if (!hasSup)
      f.review('Dosing', 'antiscalant_supplier', `Antiscalant dose requires supplier confirmation – ${dose} mg/L is an INDICATIVE typical value used only to size the dosing pump and tank. Enter the supplier's projected dose.`);
    line('antiscalant', 'Antiscalant', 'RO feed, upstream of cartridge filter', feed, dose,
      hasSup ? `${dose} mg/L as product (supplier projection – project input)` : `${dose} mg/L – INDICATIVE only (typical range 2–5 mg/L), supplier projection required`,
      { type: 'liquid', strengthPct: 100, density: A.n('antiscalant_density'), dilutionPct: A.n('antiscalant_dilution') },
      ['Antiscalant product and dose must come from the supplier projection for this water analysis and recovery.'], hasSup ? 'supplier' : 'indicative');
  }
  if (ptIn(pt, 'post_chlorination')) {
    line('post_chlorination', `Sodium hypochlorite ${A.n('naocl_strength')} % (post-chlorination)`, 'Permeate line to product tank', prod.permeateM3h, A.n('postchlor_dose'), `${A.n('postchlor_dose')} mg/L residual`,
      liquid('naocl_strength', 'naocl_density', 'naocl_dilution'), ['Dose after the RO only – never upstream of the membranes.']);
  }
  return lines;
}
