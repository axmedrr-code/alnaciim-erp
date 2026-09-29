import type { AssumptionReader } from '../assumptions';
import type { RawWaterInput } from '../types';
import { CalcStep, Findings, isNum, n, round, step } from './common';
import { phSaturation, scaling } from './water';

export const LAB_REQUIRED = 'LABORATORY DATA REQUIRED';

export interface IonRow {
  key: keyof RawWaterInput | 'bicarbonate';
  ion: string;
  kind: 'cation' | 'anion' | 'neutral';
  mgL: number | null;
  molarMass: number;
  charge: number;
  mmolL: number | null;
  meqL: number | null;
  major: boolean;
}

export interface Indicator {
  name: string;
  feed: number | null;
  concentrate: number | null;
  unit: string;
  status: 'ok' | 'review' | 'critical' | 'insufficient';
  interpretation: string;
  dataRequired: string[];
}

export interface ChemistryResult {
  ions: IonRow[];
  majorIonsComplete: boolean;
  missingMajorIons: string[];
  cationsMeqL: number | null;
  anionsMeqL: number | null;
  balanceErrorPct: number | null;
  tdsMeasured: number | null;
  tdsFromIons: number | null;
  tdsFromConductivity: number | null;
  tdsUsed: number | null;
  tdsBasis: 'measured' | 'conductivity estimate' | 'sum of ions' | 'none';
  osmoticFeedBar: number | null;
  /** bar per mg/L TDS at the design temperature, used by the membrane model */
  osmoticPerMgL: number | null;
  osmoticMethod: 'van’t Hoff (ions)' | 'coefficient (fallback)' | 'none';
  indicators: Indicator[];
  steps: CalcStep[];
}

// Molar masses (g/mol) and charges
const IONS: { key: IonRow['key']; ion: string; kind: IonRow['kind']; mm: number; z: number; major: boolean }[] = [
  { key: 'calcium', ion: 'Ca²⁺', kind: 'cation', mm: 40.08, z: 2, major: true },
  { key: 'magnesium', ion: 'Mg²⁺', kind: 'cation', mm: 24.305, z: 2, major: true },
  { key: 'sodium', ion: 'Na⁺', kind: 'cation', mm: 22.99, z: 1, major: true },
  { key: 'potassium', ion: 'K⁺', kind: 'cation', mm: 39.098, z: 1, major: false },
  { key: 'barium', ion: 'Ba²⁺', kind: 'cation', mm: 137.33, z: 2, major: false },
  { key: 'strontium', ion: 'Sr²⁺', kind: 'cation', mm: 87.62, z: 2, major: false },
  { key: 'iron', ion: 'Fe²⁺', kind: 'cation', mm: 55.845, z: 2, major: false },
  { key: 'manganese', ion: 'Mn²⁺', kind: 'cation', mm: 54.938, z: 2, major: false },
  { key: 'chloride', ion: 'Cl⁻', kind: 'anion', mm: 35.45, z: 1, major: true },
  { key: 'sulfate', ion: 'SO₄²⁻', kind: 'anion', mm: 96.06, z: 2, major: true },
  { key: 'bicarbonate', ion: 'HCO₃⁻ (from alkalinity)', kind: 'anion', mm: 61.02, z: 1, major: true },
  { key: 'nitrate', ion: 'NO₃⁻', kind: 'anion', mm: 62.0, z: 1, major: false },
  { key: 'fluoride', ion: 'F⁻', kind: 'anion', mm: 19.0, z: 1, major: false },
  { key: 'silica', ion: 'SiO₂ (neutral)', kind: 'neutral', mm: 60.08, z: 0, major: false },
];

const R_BAR = 0.083145; // L·bar/(mol·K)

export function calcChemistry(w: RawWaterInput, tempC: number | null, recoveryPct: number | null, A: AssumptionReader, f: Findings): ChemistryResult {
  const S = 'Water Chemistry';
  const Q = 'Water Quality';
  const steps: CalcStep[] = [];

  // ------------------------------------------------ ion table
  const ions: IonRow[] = IONS.map((d) => {
    let mg: number | null = null;
    if (d.key === 'bicarbonate') mg = isNum(w.alkalinity) ? w.alkalinity * 1.2193 : null; // mg/L as CaCO3 → HCO3 (pH < 8.3)
    else {
      const v = w[d.key as keyof RawWaterInput];
      mg = isNum(v) ? v : null;
    }
    const mmol = mg === null ? null : mg / d.mm;
    return { key: d.key, ion: d.ion, kind: d.kind, mgL: mg, molarMass: d.mm, charge: d.z, mmolL: mmol === null ? null : round(mmol, 4), meqL: mmol === null ? null : round(mmol * d.z, 4), major: d.major };
  });
  const missingMajorIons = ions.filter((i) => i.major && i.mgL === null).map((i) => i.ion);
  const majorIonsComplete = missingMajorIons.length === 0;

  let cat: number | null = null;
  let an: number | null = null;
  let bal: number | null = null;
  if (majorIonsComplete) {
    cat = ions.filter((i) => i.kind === 'cation').reduce((s, i) => s + (i.meqL ?? 0), 0);
    an = ions.filter((i) => i.kind === 'anion').reduce((s, i) => s + (i.meqL ?? 0), 0);
    bal = (Math.abs(cat - an) / (cat + an)) * 100;
    steps.push(step('Ionic balance error', '|Σcations − Σanions| ÷ (Σcations + Σanions) × 100', bal, '%', `Σcations ${n(cat, 2)} meq/L, Σanions ${n(an, 2)} meq/L`, `Tolerance ${A.n('ion_balance_tolerance')} %; HCO₃⁻ = alkalinity × 1.219`));
    if (bal > A.n('ion_balance_tolerance')) f.review(S, 'ion_balance', `Ionic balance error ${round(bal, 1)} % exceeds ${A.n('ion_balance_tolerance')} % – the analysis is incomplete or inconsistent. Request a complete lab analysis.`);
    else f.ok(S, 'ion_balance', `Ionic balance error ${round(bal, 1)} % – analysis is consistent.`);
  } else {
    f.review(S, 'ion_balance_na', `Ionic balance not possible – ${LAB_REQUIRED}: ${missingMajorIons.join(', ')}.`);
  }

  // ------------------------------------------------ TDS
  const tdsMeasured = isNum(w.tds) && w.tds >= 0 ? w.tds : null;
  const tdsFromIons = majorIonsComplete ? ions.reduce((s, i) => s + (i.key === 'bicarbonate' ? (i.mgL ?? 0) * 0.4917 : i.mgL ?? 0), 0) : null;
  const tdsFromConductivity = isNum(w.conductivity) && w.conductivity > 0 ? w.conductivity * A.n('tds_ec_factor') : null;
  let tdsUsed: number | null = tdsMeasured;
  let tdsBasis: ChemistryResult['tdsBasis'] = tdsMeasured !== null ? 'measured' : 'none';
  if (tdsUsed === null && tdsFromConductivity !== null) {
    tdsUsed = tdsFromConductivity;
    tdsBasis = 'conductivity estimate';
  }
  if (tdsFromIons !== null) {
    steps.push(step('TDS – sum of analysed ions', 'Σ ions (mg/L) with HCO₃⁻ × 0.4917 (residue on evaporation)', tdsFromIons, 'mg/L', ions.filter((i) => i.mgL !== null).map((i) => `${i.ion.split(' ')[0]} ${n(i.mgL, 1)}`).join(', ')));
    if (tdsMeasured !== null && tdsMeasured > 0) {
      const diff = (Math.abs(tdsFromIons - tdsMeasured) / tdsMeasured) * 100;
      if (diff > A.n('tds_balance_tolerance')) f.review(S, 'tds_check', `Measured TDS ${tdsMeasured} mg/L differs from the sum of ions ${round(tdsFromIons, 0)} mg/L by ${round(diff, 0)} % – verify the analysis.`);
      else f.ok(S, 'tds_check', `Measured TDS agrees with the sum of analysed ions (${round(diff, 1)} % difference).`);
    }
  }
  if (tdsFromConductivity !== null) steps.push(step('TDS – from conductivity', 'TDS ≈ EC × factor', tdsFromConductivity, 'mg/L', `EC ${w.conductivity} µS/cm`, `factor ${A.n('tds_ec_factor')} (mg/L)/(µS/cm)`));

  // ------------------------------------------------ Osmotic pressure
  let osmoticFeedBar: number | null = null;
  let osmoticPerMgL: number | null = null;
  let osmoticMethod: ChemistryResult['osmoticMethod'] = 'none';
  if (tempC === null || tdsUsed === null || tdsUsed <= 0) {
    f.critical(S, 'osmotic_na', `Osmotic pressure cannot be calculated – ${LAB_REQUIRED}${tempC === null ? ' (temperature)' : ''}${tdsUsed === null ? ' (TDS / ions)' : ''}.`);
  } else if (majorIonsComplete) {
    const sumMol = ions.reduce((s, i) => s + (i.mmolL ?? 0), 0) / 1000;
    const phi = A.n('osmotic_phi');
    osmoticFeedBar = phi * R_BAR * (tempC + 273.15) * sumMol;
    // scale to the TDS basis used by the membrane model (bar per mg/L)
    const ref = tdsFromIons && tdsFromIons > 0 ? tdsFromIons : tdsUsed;
    osmoticPerMgL = osmoticFeedBar / ref;
    osmoticMethod = 'van’t Hoff (ions)';
    steps.push(step('Feed osmotic pressure', 'π = φ · R · T · Σcᵢ', osmoticFeedBar, 'bar', `Σcᵢ = ${n(sumMol * 1000, 2)} mmol/L, T = ${tempC} °C`, `φ = ${phi}, R = 0.083145 L·bar/(mol·K)`));
  } else {
    osmoticPerMgL = (A.n('osmotic_coeff') / 1000) * ((tempC + 273.15) / 298.15);
    osmoticFeedBar = osmoticPerMgL * tdsUsed;
    osmoticMethod = 'coefficient (fallback)';
    steps.push(step('Feed osmotic pressure (fallback)', 'π = k_osm × TDS × (T/298.15)', osmoticFeedBar, 'bar', `TDS ${n(tdsUsed, 0)} mg/L, T = ${tempC} °C`, `k_osm = ${A.n('osmotic_coeff')} bar per 1000 mg/L (NaCl equivalent)`));
    f.review(S, 'osmotic_fallback', `Osmotic pressure estimated from TDS with a NaCl-equivalent coefficient because the major-ion analysis is incomplete (${missingMajorIons.join(', ')}). Provide a complete analysis for a better estimate.`);
  }

  // ------------------------------------------------ Scaling indicators
  const r = recoveryPct !== null && recoveryPct > 0 && recoveryPct < 100 ? recoveryPct / 100 : null;
  const feedSc = scaling(w, tdsUsed, tempC, 0, A);
  const concSc = r !== null ? scaling(w, tdsUsed, tempC, r, A) : null;
  const indicators: Indicator[] = [];
  const need = (arr: [unknown, string][]) => arr.filter(([v]) => !isNum(v)).map(([, l]) => l);

  const lsiNeed = need([[w.ph, 'pH'], [w.calcium, 'Calcium'], [w.alkalinity, 'Alkalinity'], [tdsUsed, 'TDS'], [tempC, 'Temperature']]);
  if (lsiNeed.length) indicators.push({ name: 'Langelier Saturation Index (LSI)', feed: null, concentrate: null, unit: '–', status: 'insufficient', interpretation: LAB_REQUIRED, dataRequired: lsiNeed });
  else {
    const lsiC = concSc?.concentrateLsi ?? null;
    indicators.push({
      name: 'Langelier Saturation Index (LSI)', feed: feedSc.feedLsi, concentrate: lsiC, unit: '–',
      status: lsiC === null ? 'ok' : lsiC > A.n('lsi_limit_antiscalant') ? 'critical' : lsiC > 0 ? 'review' : 'ok',
      interpretation: `CaCO₃ ${(feedSc.feedLsi ?? 0) > 0 ? 'scale-forming' : 'non-scaling'} in feed; concentrate ${lsiC === null ? '–' : lsiC > A.n('lsi_limit_antiscalant') ? `exceeds antiscalant limit ${A.n('lsi_limit_antiscalant')} – acid or softening needed` : lsiC > 0 ? 'supersaturated – antiscalant required' : 'undersaturated'}.${(tdsUsed ?? 0) > 10000 ? ' LSI is not reliable above 10 000 mg/L TDS (Stiff & Davis index should be used – not implemented).' : ''}`,
      dataRequired: [],
    });
    const pHs = phSaturation(tdsUsed as number, tempC as number, (w.calcium as number) * 2.497, w.alkalinity as number);
    const rsi = 2 * pHs - (w.ph as number);
    indicators.push({ name: 'Ryznar Stability Index (RSI), feed', feed: round(rsi, 2), concentrate: null, unit: '–', status: rsi < 6 ? 'review' : 'ok', interpretation: rsi < 6 ? 'RSI < 6: CaCO₃ scale-forming tendency.' : rsi > 7 ? 'RSI > 7: corrosive / non-scaling.' : 'RSI 6–7: near equilibrium.', dataRequired: [] });
    if ((tdsUsed ?? 0) > 10000) f.review(S, 'lsi_sdsi', 'Feed TDS > 10 000 mg/L: LSI is not reliable; the Stiff & Davis index is required (not implemented) – verify with antiscalant supplier software.');
    steps.push(step('Saturation pH (pHs)', 'pHs = (9.3 + A + B) − (C + D)', pHs, '–', `TDS ${n(tdsUsed, 0)}, T ${tempC} °C, Ca ${n((w.calcium as number) * 2.497, 0)} mg/L CaCO₃, Alk ${w.alkalinity} mg/L CaCO₃`, 'A=(log TDS−1)/10, B=−13.12 log(T+273)+34.55, C=log Ca−0.4, D=log Alk'));
  }

  const so4Need = need([[w.calcium, 'Calcium'], [w.sulfate, 'Sulfate'], [tdsUsed, 'TDS']]);
  if (so4Need.length) indicators.push({ name: 'Calcium sulfate saturation', feed: null, concentrate: null, unit: '%', status: 'insufficient', interpretation: LAB_REQUIRED, dataRequired: so4Need });
  else {
    const c = concSc?.caso4SatPct ?? null;
    indicators.push({ name: 'Calcium sulfate saturation', feed: feedSc.caso4SatPct, concentrate: c, unit: '%', status: c === null ? 'ok' : c > A.n('caso4_limit_pct') ? 'critical' : c > 100 ? 'review' : 'ok', interpretation: c === null ? '' : c > A.n('caso4_limit_pct') ? 'Exceeds antiscalant limit – sulfate scaling expected.' : c > 100 ? 'Supersaturated in concentrate – antiscalant required.' : 'Undersaturated.', dataRequired: [] });
  }
  for (const [name, key, lim] of [['Barium sulfate saturation', 'barium', 'baso4_limit_pct'], ['Strontium sulfate saturation', 'strontium', null]] as const) {
    const nd = need([[w[key], key === 'barium' ? 'Barium' : 'Strontium'], [w.sulfate, 'Sulfate'], [tdsUsed, 'TDS']]);
    if (nd.length) indicators.push({ name, feed: null, concentrate: null, unit: '%', status: 'insufficient', interpretation: LAB_REQUIRED, dataRequired: nd });
    else {
      const c = key === 'barium' ? concSc?.baso4SatPct ?? null : concSc?.srso4SatPct ?? null;
      const fd = key === 'barium' ? feedSc.baso4SatPct : feedSc.srso4SatPct;
      const limit = lim ? A.n(lim) : 800;
      indicators.push({ name, feed: fd, concentrate: c, unit: '%', status: c === null ? 'ok' : c > limit ? 'critical' : c > 100 ? 'review' : 'ok', interpretation: c !== null && c > 100 ? 'Supersaturated in concentrate – antiscalant required (confirm with supplier).' : 'Undersaturated.', dataRequired: [] });
    }
  }
  const siNeed = need([[w.silica, 'Silica'], [tempC, 'Temperature']]);
  if (siNeed.length) indicators.push({ name: 'Silica saturation', feed: null, concentrate: null, unit: '%', status: 'insufficient', interpretation: LAB_REQUIRED, dataRequired: siNeed });
  else {
    const c = concSc?.silicaSatPct ?? null;
    indicators.push({
      name: 'Silica saturation', feed: feedSc.silicaSatPct, concentrate: c, unit: '%',
      status: c === null ? 'ok' : c > 2 * A.n('silica_limit_pct') ? 'critical' : c > A.n('silica_limit_pct') ? 'review' : 'ok',
      interpretation: `Solubility ≈ ${feedSc.silicaSolubilityMgL} mg/L at ${tempC} °C.${concSc?.maxRecoveryBySilicaPct != null ? ` Max recovery by silica ≈ ${concSc.maxRecoveryBySilicaPct} %.` : ''} pH effects not modelled.`,
      dataRequired: [],
    });
  }

  // ------------------------------------------------ Water-quality risk warnings
  const hard = isNum(w.hardness) ? w.hardness : isNum(w.calcium) && isNum(w.magnesium) ? w.calcium * 2.497 + w.magnesium * 4.118 : null;
  if (hard === null) f.review(Q, 'hardness_na', `Hardness – ${LAB_REQUIRED}.`);
  else if (hard > A.n('hardness_high')) f.review(Q, 'hardness_high', `High hardness ${round(hard, 0)} mg/L as CaCO₃ – CaCO₃/CaSO₄ scaling risk. Scale control (antiscalant, acid or softening) required.`);
  if (isNum(w.silica) && w.silica > A.n('silica_high')) f.review(Q, 'silica_high', `High silica ${w.silica} mg/L – silica scaling risk; limits achievable recovery.`);
  if (isNum(w.iron)) {
    if (w.iron > A.n('iron_critical')) f.critical(Q, 'iron_high', `Very high iron ${w.iron} mg/L – severe iron fouling risk. Dedicated iron removal (aeration/oxidation + filtration) required and must be verified by pilot/lab test.`);
    else if (w.iron > A.n('iron_limit')) f.review(Q, 'iron_high', `Iron ${w.iron} mg/L > ${A.n('iron_limit')} mg/L – iron fouling risk. Iron removal required.`);
  }
  if (isNum(w.manganese) && w.manganese > A.n('manganese_limit')) f.review(Q, 'mn_high', `Manganese ${w.manganese} mg/L > ${A.n('manganese_limit')} mg/L – manganese fouling risk. Manganese removal required.`);
  if (isNum(w.turbidity) && w.turbidity > A.n('turbidity_limit_mmf')) f.review(Q, 'turbidity_high', `Turbidity ${w.turbidity} NTU > ${A.n('turbidity_limit_mmf')} NTU – particle/colloid pretreatment required.`);
  if (isNum(w.sdi)) {
    if (w.sdi > A.n('sdi_max_ro')) f.critical(Q, 'sdi_high', `SDI ${w.sdi} > ${A.n('sdi_max_ro')} – additional pretreatment required; RO must not be operated until SDI < 3–5 is demonstrated.`);
    else if (w.sdi > A.n('sdi_limit_mmf')) f.review(Q, 'sdi_high', `SDI ${w.sdi} > ${A.n('sdi_limit_mmf')} – additional pretreatment required (media filtration).`);
  }
  if (isNum(w.freeChlorine) && w.freeChlorine > A.n('chlorine_limit')) f.critical(Q, 'chlorine', `Free chlorine ${w.freeChlorine} mg/L – MEMBRANE DAMAGE RISK. Polyamide membranes are destroyed by chlorine; dechlorination (carbon filter and/or SMBS) is mandatory.`);

  return {
    ions, majorIonsComplete, missingMajorIons,
    cationsMeqL: cat === null ? null : round(cat, 3), anionsMeqL: an === null ? null : round(an, 3), balanceErrorPct: bal === null ? null : round(bal, 2),
    tdsMeasured, tdsFromIons: tdsFromIons === null ? null : round(tdsFromIons, 0), tdsFromConductivity: tdsFromConductivity === null ? null : round(tdsFromConductivity, 0),
    tdsUsed: tdsUsed === null ? null : round(tdsUsed, 0), tdsBasis,
    osmoticFeedBar: osmoticFeedBar === null ? null : round(osmoticFeedBar, 3), osmoticPerMgL, osmoticMethod, indicators, steps,
  };
}
