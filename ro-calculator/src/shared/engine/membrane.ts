import type { AssumptionReader } from '../assumptions';
import type { MembraneDesignInput, MembraneSpec, WaterSource } from '../types';
import { CalcStep, Findings, isNum, round } from './common';
import type { ProductionResult } from './production';
import { isSeawater } from './production';
import { logMeanCF, tcf } from './water';

export interface StageResult {
  stage: number;
  vessels: number;
  elements: number;
  feedM3h: number;
  permeateM3h: number;
  concentrateM3h: number;
  feedPerVesselM3h: number;
  concentratePerVesselM3h: number;
  recoveryPct: number;
}

export interface MembraneResult {
  available: boolean;
  membraneLabel: string;
  designFluxTargetLmh: number;
  maxFluxLmh: number;
  elementsRequired: number;
  elementsPerVessel: number;
  vessels: number;
  elements: number;
  stages: number;
  arrayLabel: string;
  stageDetail: StageResult[];
  actualFluxLmh: number;
  capacityAtTargetFluxM3h: number;
  nominalCapacityM3h: number;
  averageElementRecoveryPct: number;
  tcf: number;
  permeabilityLmhBar: number | null;
  avgOsmoticBar: number | null;
  ndpBar: number | null;
  arrayDpBar: number;
  feedPressureBar: number | null;
  concentratePressureBar: number | null;
  saltPassagePct: number | null;
  permeateTdsMgL: number | null;
  concentrateTdsMgL: number | null;
  steps: CalcStep[];
  assumptions: string[];
}

function fluxTargets(source: WaterSource, A: AssumptionReader) {
  const key = source === 'seawater_open' ? 'seawater_open' : source === 'seawater_well' ? 'seawater_well' : source;
  return { design: A.n(`flux_${key}_design`), max: A.n(`flux_${key}_max`) };
}

export function autoStages(recoveryPct: number, A: AssumptionReader) {
  if (recoveryPct <= A.n('recovery_max_1stage')) return 1;
  if (recoveryPct <= A.n('recovery_max_2stage')) return 2;
  return 3;
}

/** Split vessels into stages with a ~2:1 taper (4:2:1 for three stages). */
export function splitStages(vessels: number, stages: number): number[] {
  if (stages <= 1 || vessels < 2) return [vessels];
  if (stages === 2 || vessels < 3) {
    const s1 = Math.max(1, Math.min(vessels - 1, Math.round((vessels * 2) / 3)));
    return [s1, vessels - s1];
  }
  let s1 = Math.max(1, Math.round((vessels * 4) / 7));
  let s2 = Math.max(1, Math.round((vessels * 2) / 7));
  if (s1 + s2 >= vessels) {
    s1 = Math.max(1, vessels - 2);
    s2 = 1;
  }
  return [s1, s2, vessels - s1 - s2];
}

export function membraneMissingFields(m: MembraneSpec): string[] {
  const req: [keyof MembraneSpec, string][] = [
    ['activeAreaM2', 'active area'], ['nominalFlowM3d', 'nominal permeate flow'], ['saltRejectionPct', 'salt rejection'],
    ['maxPressureBar', 'max pressure'], ['testPressureBar', 'test pressure'], ['testTdsMgL', 'test TDS'],
  ];
  return req.filter(([k]) => !isNum(m[k]) || (m[k] as number) <= 0).map(([, l]) => l);
}

export function calcMembrane(
  input: MembraneDesignInput,
  spec: MembraneSpec | null,
  prod: ProductionResult,
  source: WaterSource,
  tds: number | null,
  tempC: number,
  ph: number | null,
  A: AssumptionReader,
  f: Findings,
): MembraneResult {
  const S = 'Membranes';
  const targets = fluxTargets(source, A);
  const fluxTarget = isNum(input.designFluxLmh) && input.designFluxLmh > 0 ? input.designFluxLmh : targets.design;
  if (isNum(input.designFluxLmh) && input.designFluxLmh <= 0) f.critical(S, 'flux_input', 'Design flux must be positive – assumption value used.');
  const epvIn = input.elementsPerVessel ?? A.n('elements_per_vessel');
  const epv = Math.max(1, Math.min(8, Math.round(epvIn)));
  if (epv !== epvIn) f.review(S, 'epv', `Elements per vessel adjusted to ${epv} (allowed 1–8).`);
  const assumptions = [
    `Design flux target ${fluxTarget} LMH (${isNum(input.designFluxLmh) ? 'project input' : 'assumption for this water source'}); maximum ${targets.max} LMH.`,
    `Temperature correction TCF = exp(${A.n('tcf_constant')}·(1/298.15 − 1/(273.15+T))).`,
    `Fouling factor ${A.n('fouling_factor')}, concentration polarisation β = ${A.n('concentration_polarization')}.`,
    `Osmotic pressure ≈ ${A.n('osmotic_coeff')} bar per 1000 mg/L TDS (NaCl equivalent).`,
    `Pressure drop ${A.n('element_dp_bar')} bar per element in series; permeate back-pressure ${A.n('permeate_backpressure_bar')} bar.`,
    'Salt passage scaled from nominal rejection by flux, temperature and concentration factor (screening estimate).',
    'THIS IS A SIMPLIFIED ENGINEERING ESTIMATE – NOT A MANUFACTURER-CERTIFIED PROJECTION. Verify with the manufacturer design software (e.g. WAVE, IMSDesign, TorayDS).',
  ];

  const empty: MembraneResult = {
    available: false, membraneLabel: spec ? `${spec.manufacturer} ${spec.model}` : 'No membrane selected', designFluxTargetLmh: fluxTarget, maxFluxLmh: targets.max,
    elementsRequired: 0, elementsPerVessel: epv, vessels: 0, elements: 0, stages: 0, arrayLabel: '–', stageDetail: [], actualFluxLmh: 0,
    capacityAtTargetFluxM3h: 0, nominalCapacityM3h: 0, averageElementRecoveryPct: 0, tcf: tcf(tempC, A.n('tcf_constant')), permeabilityLmhBar: null,
    avgOsmoticBar: null, ndpBar: null, arrayDpBar: 0, feedPressureBar: null, concentratePressureBar: null, saltPassagePct: null,
    permeateTdsMgL: null, concentrateTdsMgL: null, steps: [], assumptions,
  };

  if (!spec) {
    f.critical(S, 'no_membrane', 'No membrane model selected – select a membrane from the Membrane Library.');
    return empty;
  }
  const missing = membraneMissingFields(spec);
  if (missing.length) {
    f.critical(S, 'membrane_specs', `Missing membrane specifications for ${spec.manufacturer} ${spec.model}: ${missing.join(', ')}. Complete them in the Membrane Library.`);
    return empty;
  }
  if (!prod.valid || prod.permeateM3h <= 0) return empty;

  const area = spec.activeAreaM2 as number;
  const Qp = prod.permeateM3h;
  const R = prod.recoveryPct / 100;
  const nReq = Math.ceil((Qp * 1000) / (fluxTarget * area) - 1e-9);
  const vessels = Math.max(1, Math.ceil(nReq / epv - 1e-9));
  const elements = vessels * epv;
  let stages = input.stages && input.stages >= 1 ? Math.min(3, Math.round(input.stages)) : autoStages(prod.recoveryPct, A);
  if (stages > vessels) {
    f.review(S, 'stages_reduced', `Only ${vessels} vessel(s) – array reduced from ${stages} to ${vessels} stage(s). Consider fewer elements per vessel to allow staging.`);
    stages = vessels;
  }
  const split = splitStages(vessels, stages);
  stages = split.length;

  // Stage flows – equal average flux per element assumed
  const stageDetail: StageResult[] = [];
  let stageFeed = prod.feedM3h;
  split.forEach((v, i) => {
    const el = v * epv;
    const qp = (Qp * el) / elements;
    const conc = stageFeed - qp;
    stageDetail.push({
      stage: i + 1, vessels: v, elements: el, feedM3h: round(stageFeed, 2), permeateM3h: round(qp, 2), concentrateM3h: round(conc, 2),
      feedPerVesselM3h: round(stageFeed / v, 2), concentratePerVesselM3h: round(conc / v, 2), recoveryPct: round((qp / stageFeed) * 100, 1),
    });
    stageFeed = conc;
  });

  const flux = (Qp * 1000) / (elements * area);
  const elementsInSeries = epv * stages;
  const elementRecovery = (1 - Math.pow(1 - R, 1 / elementsInSeries)) * 100;
  const T = tcf(tempC, A.n('tcf_constant'));
  const beta = A.n('concentration_polarization');
  const osm = A.n('osmotic_coeff') / 1000;

  // Permeability from datasheet test conditions
  const testR = isNum(spec.testRecoveryPct) && spec.testRecoveryPct > 0 ? spec.testRecoveryPct / 100 : 0.15;
  const jTest = ((spec.nominalFlowM3d as number) * 1000) / 24 / area;
  const piTest = osm * (spec.testTdsMgL as number) * logMeanCF(testR) * beta;
  const ndpTest = (spec.testPressureBar as number) - A.n('test_element_dp_bar') / 2 - piTest;
  const Aperm = ndpTest > 0 ? jTest / ndpTest : null;
  if (Aperm === null) f.critical(S, 'test_conditions', 'Membrane test conditions give a non-positive net driving pressure – check test pressure / test TDS.');

  const arrayDp = A.n('element_dp_bar') * elementsInSeries;
  let avgOsm: number | null = null;
  let ndp: number | null = null;
  let feedP: number | null = null;
  let concP: number | null = null;
  let sp: number | null = null;
  let permTds: number | null = null;
  let concTds: number | null = null;
  const cfLm = logMeanCF(R);
  if (tds !== null && Aperm !== null) {
    avgOsm = osm * tds * cfLm * beta;
    ndp = flux / (Aperm * T * A.n('fouling_factor'));
    const testCfLm = logMeanCF(testR);
    sp = (1 - (spec.saltRejectionPct as number) / 100) * (jTest / flux) * T * (cfLm / testCfLm) * A.n('salt_passage_aging_factor');
    permTds = tds * sp;
    const permOsm = osm * permTds;
    feedP = ndp + avgOsm - permOsm + arrayDp / 2 + A.n('permeate_backpressure_bar');
    concP = feedP - arrayDp;
    concTds = (tds * prod.feedM3h - permTds * Qp) / prod.rejectM3h;
  }

  // -------- Checks
  if (flux > targets.max) f.critical(S, 'flux_high', `Average flux ${round(flux, 1)} LMH exceeds the maximum ${targets.max} LMH for this water source – excessive fouling risk. Add elements.`);
  else if (flux > fluxTarget * 1.05) f.review(S, 'flux_above_target', `Average flux ${round(flux, 1)} LMH is above the design target ${fluxTarget} LMH.`);
  else f.ok(S, 'flux_ok', `Average flux ${round(flux, 1)} LMH is within the design limit (target ${fluxTarget}, max ${targets.max} LMH).`);
  if (flux < fluxTarget * 0.6) f.review(S, 'flux_low', `Average flux ${round(flux, 1)} LMH is much lower than the target – membranes are over-sized.`);

  const maxFeed = isNum(spec.maxFeedFlowM3h) && spec.maxFeedFlowM3h > 0 ? spec.maxFeedFlowM3h : A.n('max_feed_per_vessel');
  const minConc = A.n('min_concentrate_per_vessel') * (spec.diameterIn === 4 ? 0.25 : 1);
  for (const s of stageDetail) {
    if (s.feedPerVesselM3h > maxFeed) f.critical(S, `vessel_feed_${s.stage}`, `Stage ${s.stage}: feed per vessel ${s.feedPerVesselM3h} m³/h exceeds ${maxFeed} m³/h – excessive pressure drop / element damage. Add vessels.`);
    if (s.concentratePerVesselM3h < minConc) f.critical(S, `vessel_conc_${s.stage}`, `Stage ${s.stage}: concentrate per vessel ${s.concentratePerVesselM3h} m³/h is below ${minConc} m³/h – concentration polarisation and scaling risk. Reduce vessels in this stage, add a stage, or use concentrate recirculation.`);
  }
  if (stageDetail.length && stageDetail.every((s) => s.feedPerVesselM3h <= maxFeed && s.concentratePerVesselM3h >= minConc))
    f.ok(S, 'vessel_flows', 'Feed and concentrate flows per vessel are within the guideline limits.');
  if (elementRecovery > A.n('max_element_recovery')) f.review(S, 'element_recovery', `Average element recovery ${round(elementRecovery, 1)} % exceeds ${A.n('max_element_recovery')} % – add elements in series (more stages or longer vessels).`);

  if (feedP !== null && isNum(spec.maxPressureBar)) {
    if (feedP > spec.maxPressureBar) f.critical(S, 'pressure_max', `Estimated feed pressure ${round(feedP, 1)} bar exceeds the membrane maximum ${spec.maxPressureBar} bar. Select a seawater/high-pressure membrane or reduce recovery.`);
    else if (feedP > spec.maxPressureBar * 0.9) f.review(S, 'pressure_near_max', `Estimated feed pressure ${round(feedP, 1)} bar is within 10 % of the membrane maximum ${spec.maxPressureBar} bar.`);
    else f.ok(S, 'pressure_ok', `Estimated feed pressure ${round(feedP, 1)} bar is below the membrane maximum ${spec.maxPressureBar} bar.`);
  }
  if (isNum(spec.maxTempC) && tempC > spec.maxTempC) f.critical(S, 'temp_max', `Feed temperature ${tempC} °C exceeds membrane maximum ${spec.maxTempC} °C.`);
  if (isNum(ph) && isNum(spec.phMin) && isNum(spec.phMax) && (ph < spec.phMin || ph > spec.phMax))
    f.critical(S, 'ph_membrane', `Feed pH ${ph} is outside the membrane continuous operating range ${spec.phMin}–${spec.phMax}.`);
  const isSwMembrane = /sw|sea/i.test(spec.membraneType);
  if (tds !== null && tds > 10000 && !isSwMembrane) f.critical(S, 'membrane_type', `Feed TDS ${tds} mg/L requires a seawater (SW) membrane; ${spec.model} is ${spec.membraneType}.`);
  if (tds !== null && tds < 5000 && isSwMembrane) f.review(S, 'membrane_type_sw', `A seawater membrane is selected for brackish feed (TDS ${tds} mg/L) – higher energy than necessary.`);
  if (isSeawater(source) && !isSwMembrane) f.critical(S, 'membrane_type_source', 'Water source is seawater but the selected membrane is not a seawater type.');

  const steps: CalcStep[] = [
    { label: 'Elements required', formula: 'N = ceil(Q_p × 1000 ÷ (J_target × A_element))', value: nReq, unit: 'pcs' },
    { label: 'Pressure vessels', formula: `V = ceil(N ÷ ${epv} elements per vessel)`, value: vessels, unit: 'pcs' },
    { label: 'Installed elements', formula: 'N_installed = V × elements per vessel', value: elements, unit: 'pcs' },
    { label: 'Average flux', formula: 'J = Q_p × 1000 ÷ (N_installed × A_element)', value: round(flux, 1), unit: 'LMH' },
    { label: 'Average element recovery', formula: 'r_e = 1 − (1 − R)^(1 ÷ elements in series)', value: round(elementRecovery, 1), unit: '%' },
    { label: 'Temperature correction factor', formula: 'TCF = exp(K·(1/298.15 − 1/(273.15+T)))', value: round(T, 3), unit: '–' },
  ];
  if (Aperm !== null) steps.push({ label: 'Water permeability (datasheet)', formula: 'A = J_test ÷ (P_test − ΔP_test/2 − π_test)', value: round(Aperm, 3), unit: 'LMH/bar' });
  if (avgOsm !== null && ndp !== null && feedP !== null) {
    steps.push(
      { label: 'Average feed-side osmotic pressure', formula: 'π_avg = k_osm × TDS × ln(1/(1−R))/R × β', value: round(avgOsm, 2), unit: 'bar' },
      { label: 'Net driving pressure', formula: 'NDP = J ÷ (A × TCF × fouling factor)', value: round(ndp, 2), unit: 'bar' },
      { label: 'Array pressure drop', formula: 'ΔP = ΔP_element × elements in series', value: round(arrayDp, 2), unit: 'bar' },
      { label: 'Required feed pressure', formula: 'P_f = NDP + π_avg − π_p + ΔP/2 + P_permeate', value: round(feedP, 1), unit: 'bar' },
    );
  }

  return {
    available: true,
    membraneLabel: `${spec.manufacturer} ${spec.model}`,
    designFluxTargetLmh: fluxTarget,
    maxFluxLmh: targets.max,
    elementsRequired: nReq,
    elementsPerVessel: epv,
    vessels,
    elements,
    stages,
    arrayLabel: `${split.join(':')} (${stages}-stage, ${epv} el./vessel)`,
    stageDetail,
    actualFluxLmh: round(flux, 2),
    capacityAtTargetFluxM3h: round((elements * area * fluxTarget) / 1000, 2),
    nominalCapacityM3h: round((elements * (spec.nominalFlowM3d as number)) / 24, 2),
    averageElementRecoveryPct: round(elementRecovery, 1),
    tcf: round(T, 3),
    permeabilityLmhBar: Aperm === null ? null : round(Aperm, 3),
    avgOsmoticBar: avgOsm === null ? null : round(avgOsm, 2),
    ndpBar: ndp === null ? null : round(ndp, 2),
    arrayDpBar: round(arrayDp, 2),
    feedPressureBar: feedP === null ? null : round(feedP, 2),
    concentratePressureBar: concP === null ? null : round(concP, 2),
    saltPassagePct: sp === null ? null : round(sp * 100, 2),
    permeateTdsMgL: permTds === null ? null : round(permTds, 0),
    concentrateTdsMgL: concTds === null ? null : round(concTds, 0),
    steps,
    assumptions,
  };
}
