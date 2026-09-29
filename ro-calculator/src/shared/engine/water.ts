import type { AssumptionReader } from '../assumptions';
import type { RawWaterInput } from '../types';
import { Findings, isNum, round } from './common';

/** Dynamic viscosity of water in Pa·s (Vogel equation, valid 0–100 °C). */
export function waterViscosity(tempC: number) {
  return 2.414e-5 * Math.pow(10, 247.8 / (tempC + 273.15 - 140));
}

/** Kinematic viscosity m²/s. */
export function kinematicViscosity(tempC: number) {
  return waterViscosity(tempC) / 998;
}

/** Temperature correction factor for membrane permeability relative to 25 °C. */
export function tcf(tempC: number, k: number) {
  return Math.exp(k * (1 / 298.15 - 1 / (273.15 + tempC)));
}

/** Log-mean concentration factor along a membrane array at recovery r (0..1). */
export function logMeanCF(r: number) {
  if (r <= 0) return 1;
  return Math.log(1 / (1 - r)) / r;
}

export interface WaterAnalysis {
  tds: number | null;
  tdsEstimated: boolean;
  temperature: number;
  temperatureAssumed: boolean;
  missingRequired: string[];
  missingRecommended: string[];
  ionBalance: { cationsMeq: number; anionsMeq: number; errorPct: number } | null;
}

export const REQUIRED_KEYS: (keyof RawWaterInput)[] = [
  'tds', 'temperature', 'ph', 'hardness', 'alkalinity', 'calcium', 'magnesium', 'chloride', 'sulfate', 'silica', 'iron', 'manganese', 'turbidity', 'sdi',
];
export const RECOMMENDED_KEYS: (keyof RawWaterInput)[] = ['conductivity', 'sodium', 'barium', 'strontium', 'freeChlorine', 'toc'];

export const PARAM_LABEL: Partial<Record<keyof RawWaterInput, string>> = {
  tds: 'TDS', temperature: 'Temperature', ph: 'pH', hardness: 'Hardness', alkalinity: 'Alkalinity', calcium: 'Calcium',
  magnesium: 'Magnesium', chloride: 'Chloride', sulfate: 'Sulfate', silica: 'Silica', iron: 'Iron', manganese: 'Manganese',
  turbidity: 'Turbidity', sdi: 'SDI', conductivity: 'Conductivity', sodium: 'Sodium', barium: 'Barium', strontium: 'Strontium',
  freeChlorine: 'Free chlorine', toc: 'TOC',
};

export function analyseWater(w: RawWaterInput, A: AssumptionReader, f: Findings): WaterAnalysis {
  const S = 'Raw Water';
  const missingRequired = REQUIRED_KEYS.filter((k) => !isNum(w[k])).map((k) => PARAM_LABEL[k] ?? k);
  const missingRecommended = RECOMMENDED_KEYS.filter((k) => !isNum(w[k])).map((k) => PARAM_LABEL[k] ?? k);

  // Negative values are physically impossible for all concentration fields
  const nonNegative: (keyof RawWaterInput)[] = [
    'tds', 'hardness', 'alkalinity', 'calcium', 'magnesium', 'sodium', 'potassium', 'chloride', 'sulfate', 'nitrate', 'fluoride',
    'silica', 'iron', 'manganese', 'barium', 'strontium', 'turbidity', 'sdi', 'conductivity', 'freeChlorine', 'toc',
    'boreholeDepth', 'staticLevel', 'dynamicLevel', 'distanceToPlant',
  ];
  for (const k of nonNegative) {
    const v = w[k];
    if (isNum(v) && v < 0) f.critical(S, `negative_${k}`, `${PARAM_LABEL[k] ?? k} is negative (${v}). Negative values are not physically possible.`);
  }

  let tds: number | null = isNum(w.tds) && w.tds >= 0 ? w.tds : null;
  let tdsEstimated = false;
  if (tds === null && isNum(w.conductivity) && w.conductivity > 0) {
    tds = round(w.conductivity * A.n('tds_ec_factor'), 0);
    tdsEstimated = true;
    f.review(S, 'tds_estimated', `TDS not entered – estimated as ${tds} mg/L from conductivity × ${A.n('tds_ec_factor')}. Lab TDS is required for a reliable design.`);
  }
  if (tds === null) f.critical(S, 'tds_missing', 'TDS (or conductivity) is missing – INSUFFICIENT DATA — LAB ANALYSIS REQUIRED. Osmotic pressure, HP pump pressure and permeate quality cannot be estimated.');

  if (isNum(w.tds) && isNum(w.conductivity) && w.conductivity > 0 && w.tds > 0) {
    const ratio = w.tds / w.conductivity;
    if (ratio < 0.5 || ratio > 0.8) f.review(S, 'tds_ec_ratio', `TDS/conductivity ratio is ${round(ratio, 2)} (normal 0.55–0.75). Check the water analysis.`);
  }

  let temperature = 25;
  let temperatureAssumed = true;
  if (isNum(w.temperature)) {
    temperature = w.temperature;
    temperatureAssumed = false;
    if (w.temperature < 1 || w.temperature > 45) f.critical(S, 'temp_range', `Feed temperature ${w.temperature} °C is outside the normal RO operating range (1–45 °C).`);
  } else {
    f.review(S, 'temp_missing', 'Temperature missing – 25 °C assumed. Design pressure is sensitive to temperature; enter the minimum expected temperature.');
  }

  if (isNum(w.ph) && (w.ph < 2 || w.ph > 12)) f.critical(S, 'ph_range', `pH ${w.ph} is outside the plausible range 2–12.`);

  if (isNum(w.hardness) && isNum(w.calcium) && isNum(w.magnesium)) {
    const calc = w.calcium * 2.497 + w.magnesium * 4.118;
    if (w.hardness > 0 && Math.abs(calc - w.hardness) / w.hardness > 0.15)
      f.review(S, 'hardness_check', `Total hardness ${w.hardness} mg/L differs from Ca×2.497 + Mg×4.118 = ${round(calc, 0)} mg/L as CaCO3 by more than 15 %. Check the analysis.`);
  }

  // Ion balance (only when major ions are available)
  let ionBalance: WaterAnalysis['ionBalance'] = null;
  if ([w.calcium, w.magnesium, w.sodium, w.chloride, w.sulfate, w.alkalinity].every(isNum)) {
    const cat = (w.calcium as number) / 20.04 + (w.magnesium as number) / 12.15 + (w.sodium as number) / 22.99 + (w.potassium ?? 0) / 39.1 + (w.barium ?? 0) / 68.67 + (w.strontium ?? 0) / 43.81;
    const an = (w.chloride as number) / 35.45 + (w.sulfate as number) / 48.03 + (w.alkalinity as number) / 50.04 + (w.nitrate ?? 0) / 62.0 + (w.fluoride ?? 0) / 19.0;
    const err = (Math.abs(cat - an) / (cat + an)) * 100;
    ionBalance = { cationsMeq: round(cat, 2), anionsMeq: round(an, 2), errorPct: round(err, 1) };
    if (err > A.n('ion_balance_tolerance'))
      f.review(S, 'ion_balance', `Ion balance error ${round(err, 1)} % (cations ${round(cat, 2)} meq/L vs anions ${round(an, 2)} meq/L). The analysis may be incomplete or wrong.`);
    else f.ok(S, 'ion_balance', `Ion balance error ${round(err, 1)} % – analysis is consistent.`);
  }

  if (missingRequired.length === 0) f.ok(S, 'data_complete', 'All water-quality parameters required for a reliable design are entered.');
  else f.critical(S, 'data_missing', `Missing water-quality data: ${missingRequired.join(', ')}. INSUFFICIENT DATA — LAB ANALYSIS REQUIRED for a reliable design.`);

  return { tds, tdsEstimated, temperature, temperatureAssumed, missingRequired, missingRecommended, ionBalance };
}

// ------------------------------------------------------------------ Scaling

export interface ScalingResult {
  concentrationFactor: number;
  feedLsi: number | null;
  concentrateLsi: number | null;
  concentratePh: number | null;
  caso4SatPct: number | null;
  silicaConcMgL: number | null;
  silicaSolubilityMgL: number | null;
  silicaSatPct: number | null;
  baso4SatPct: number | null;
  srso4SatPct: number | null;
  maxRecoveryBySilicaPct: number | null;
  notes: string[];
}

/** pHs for Langelier index. ca & alk in mg/L as CaCO3. */
export function phSaturation(tds: number, tempC: number, caAsCaCO3: number, alkAsCaCO3: number) {
  const A = (Math.log10(Math.max(tds, 1)) - 1) / 10;
  const B = -13.12 * Math.log10(tempC + 273.15) + 34.55;
  const C = Math.log10(Math.max(caAsCaCO3, 0.01)) - 0.4;
  const D = Math.log10(Math.max(alkAsCaCO3, 0.01));
  return 9.3 + A + B - (C + D);
}

/** Davies activity coefficient for an ion with charge z at ionic strength I (mol/L). */
function davies(z: number, I: number) {
  const s = Math.sqrt(I);
  return Math.pow(10, -0.51 * z * z * (s / (1 + s) - 0.3 * I));
}

/** Sparingly soluble sulfate saturation (%), Ksp in (mol/L)². */
function sulfateSat(cationMgL: number, cationMw: number, so4MgL: number, tds: number, ksp: number) {
  const I = 2.5e-5 * tds; // Langelier approximation of ionic strength
  const g = davies(2, I);
  const ip = g * (cationMgL / 1000 / cationMw) * g * (so4MgL / 1000 / 96.06);
  return (ip / ksp) * 100;
}

/**
 * Estimate concentrate scaling at recovery r using simplified methods:
 * - Concentration factor CF = 1/(1−r) (full salt rejection assumed – conservative)
 * - Concentrate pH ≈ feed pH + log10(CF) (CO2 passes the membrane)
 * - LSI (Langelier), Davies activities for sulfates, linear silica solubility.
 * These are screening estimates – NOT a substitute for antiscalant supplier software.
 */
export function scaling(w: RawWaterInput, tds: number | null, tempC: number, r: number, A: AssumptionReader, phOverride?: number, alkOverride?: number): ScalingResult {
  const cf = 1 / (1 - r);
  const notes: string[] = [];
  const ph = phOverride ?? w.ph;
  const alk = alkOverride ?? w.alkalinity;
  let feedLsi: number | null = null;
  let concentrateLsi: number | null = null;
  let concentratePh: number | null = null;
  if (isNum(ph) && isNum(w.calcium) && isNum(alk) && tds !== null) {
    const caC = w.calcium * 2.497;
    feedLsi = ph - phSaturation(tds, tempC, caC, alk);
    concentratePh = Math.min(ph + Math.log10(cf), 9.5);
    concentrateLsi = concentratePh - phSaturation(tds * cf, tempC, caC * cf, alk * cf);
  } else notes.push('LSI not calculated: pH, calcium, alkalinity and TDS are required.');

  let caso4SatPct: number | null = null;
  if (isNum(w.calcium) && isNum(w.sulfate) && tds !== null) {
    caso4SatPct = sulfateSat(w.calcium * cf, 40.08, w.sulfate * cf, tds * cf, 4.93e-5);
  } else notes.push('CaSO4 saturation not calculated: calcium, sulfate and TDS are required.');

  let baso4SatPct: number | null = null;
  if (isNum(w.barium) && isNum(w.sulfate) && tds !== null && w.barium > 0) baso4SatPct = sulfateSat(w.barium * cf, 137.33, w.sulfate * cf, tds * cf, 1.08e-10);
  else if (!isNum(w.barium)) notes.push('BaSO4 not checked: barium not analysed.');
  let srso4SatPct: number | null = null;
  if (isNum(w.strontium) && isNum(w.sulfate) && tds !== null && w.strontium > 0) srso4SatPct = sulfateSat(w.strontium * cf, 87.62, w.sulfate * cf, tds * cf, 3.44e-7);
  else if (!isNum(w.strontium)) notes.push('SrSO4 not checked: strontium not analysed.');

  let silicaConcMgL: number | null = null;
  let silicaSolubilityMgL: number | null = null;
  let silicaSatPct: number | null = null;
  let maxRecoveryBySilicaPct: number | null = null;
  if (isNum(w.silica)) {
    silicaConcMgL = w.silica * cf;
    silicaSolubilityMgL = Math.max(A.n('silica_solubility_25c') + 2.4 * (tempC - 25), 40);
    const limit = silicaSolubilityMgL * (A.n('silica_limit_pct') / 100);
    silicaSatPct = (silicaConcMgL / silicaSolubilityMgL) * 100;
    maxRecoveryBySilicaPct = w.silica > 0 ? Math.min(99, Math.max(0, (1 - w.silica / limit) * 100)) : 99;
  } else notes.push('Silica saturation not calculated: silica not analysed.');

  return {
    concentrationFactor: cf,
    feedLsi: feedLsi === null ? null : round(feedLsi, 2),
    concentrateLsi: concentrateLsi === null ? null : round(concentrateLsi, 2),
    concentratePh: concentratePh === null ? null : round(concentratePh, 2),
    caso4SatPct: caso4SatPct === null ? null : round(caso4SatPct, 0),
    silicaConcMgL: silicaConcMgL === null ? null : round(silicaConcMgL, 1),
    silicaSolubilityMgL: silicaSolubilityMgL === null ? null : round(silicaSolubilityMgL, 0),
    silicaSatPct: silicaSatPct === null ? null : round(silicaSatPct, 0),
    baso4SatPct: baso4SatPct === null ? null : round(baso4SatPct, 0),
    srso4SatPct: srso4SatPct === null ? null : round(srso4SatPct, 0),
    maxRecoveryBySilicaPct: maxRecoveryBySilicaPct === null ? null : round(maxRecoveryBySilicaPct, 1),
    notes,
  };
}

/**
 * Acid needed to lower feed pH from ph0 to ph1 using carbonate equilibrium (pKa1 = 6.35).
 * alk in mg/L as CaCO3 (≈ HCO3 alkalinity). Returns meq/L of acid and new alkalinity.
 */
export function acidDemand(ph0: number, ph1: number, alkAsCaCO3: number) {
  const pKa1 = 6.35;
  const hco3 = alkAsCaCO3 / 50.04; // meq/L
  const ct = hco3 * (1 + Math.pow(10, pKa1 - ph0));
  const hco3New = ct / (1 + Math.pow(10, pKa1 - ph1));
  const meq = Math.max(0, hco3 - hco3New);
  return { meq, newAlkAsCaCO3: hco3New * 50.04 };
}
