import type { AssumptionReader } from '../assumptions';
import type { MembraneDesignInput, MembraneSpec, WaterSource } from '../types';
import { CalcStep, Findings, isNum, n, round, step } from './common';
import type { ProductionResult } from './production';
import { isSeawater } from './production';
import { tcf } from './water';

/**
 * Element-by-element RO array model (solution–diffusion):
 *   Jw = A·TCF_A·FF·NDP,  NDP = P_avg − P_p − (π_m − π_p),  π_m = k·β·C_avg
 *   Cp = B·TCF_B·C_m ÷ (Jw + B·TCF_B),  β = exp(k_cp · r_element)
 *   ΔP_element = ΔP_ref · (Q_avg / Q_ref)^n
 * A and B are derived from the membrane datasheet test point with the same model.
 * The feed pressure is solved (bisection) so that the array produces the required permeate
 * flow at the required recovery. NOT a manufacturer-certified projection.
 */

export interface ElementResult {
  position: number;
  feedM3h: number;
  permeateM3h: number;
  concentrateM3h: number;
  recoveryPct: number;
  fluxLmh: number;
  feedPressureBar: number;
  avgPressureBar: number;
  concentratePressureBar: number;
  dpBar: number;
  feedTds: number;
  concentrateTds: number;
  permeateTds: number;
  osmoticFeedBar: number;
  osmoticMembraneBar: number;
  osmoticPermeateBar: number;
  ndpBar: number;
  beta: number;
  rejectionPct: number;
  tcf: number;
  pressureCorrection: number;
}

export interface StageResult {
  stage: number;
  vessels: number;
  elementsPerVessel: number;
  elements: number;
  feedM3h: number;
  permeateM3h: number;
  concentrateM3h: number;
  feedPerVesselM3h: number;
  concentratePerVesselM3h: number;
  recoveryPct: number;
  feedPressureBar: number | null;
  concentratePressureBar: number | null;
  dpBar: number | null;
  feedTds: number | null;
  concentrateTds: number | null;
  permeateTds: number | null;
  avgFluxLmh: number;
  elementsDetail: ElementResult[];
}

export interface MembraneResult {
  available: boolean;
  simulated: boolean;
  simulationMessage: string;
  isDemoData: boolean;
  membraneLabel: string;
  configMode: 'auto' | 'manual';
  designFluxTargetLmh: number;
  maxFluxLmh: number;
  minFluxLmh: number | null;
  elementsRequired: number;
  elementsPerVessel: number;
  vessels: number;
  elements: number;
  stages: number;
  vesselsPerStage: number[];
  arrayLabel: string;
  stageDetail: StageResult[];
  actualFluxLmh: number;
  capacityAtTargetFluxM3h: number;
  nominalCapacityM3h: number;
  averageElementRecoveryPct: number;
  tcf: number | null;
  tcfSalt: number | null;
  permeabilityLmhBar: number | null;
  saltPermeabilityLmh: number | null;
  osmoticFeedBar: number | null;
  osmoticConcentrateBar: number | null;
  avgOsmoticBar: number | null;
  ndpBar: number | null;
  arrayDpBar: number | null;
  feedPressureBar: number | null;
  concentratePressureBar: number | null;
  saltPassagePct: number | null;
  rejectionPct: number | null;
  permeateTdsMgL: number | null;
  concentrateTdsMgL: number | null;
  steps: CalcStep[];
  assumptions: string[];
}

function fluxTargets(source: WaterSource, A: AssumptionReader) {
  return { design: A.n(`flux_${source}_design`), max: A.n(`flux_${source}_max`) };
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
    ['maxPressureBar', 'max pressure'], ['testPressureBar', 'test pressure'], ['testTdsMgL', 'test TDS'], ['testRecoveryPct', 'test recovery'],
  ];
  return req.filter(([k]) => !isNum(m[k]) || (m[k] as number) <= 0).map(([, l]) => l);
}

export interface ElementModel {
  area: number;
  A25: number; // LMH/bar
  B25: number; // LMH
  tcfA: number;
  tcfB: number;
  ff: number;
  aging: number;
  kOsm: number; // bar per mg/L
  kCp: number;
  dpRef: number;
  qRef: number;
  dpExp: number;
  permeatePressure: number;
}

/**
 * Solve one element for given feed flow (m³/h), feed TDS (mg/L) and feed pressure (bar).
 * For a trial flux J the element state is explicit (r, C_c, β, C_m, C_p, ΔP, NDP); the residual
 * g(J) = J − A·NDP(J) is strictly increasing in J, so the unique root is found by bisection.
 */
export function solveElement(m: ElementModel, qf: number, cf: number, pf: number, position = 1): ElementResult {
  const Aeff = m.A25 * m.tcfA * m.ff;
  const Beff = m.B25 * m.tcfB * m.aging;
  const state = (J: number) => {
    const qp = (J * m.area) / 1000;
    const r = qp / qf;
    const cp = (Beff * cf) / Math.max(J + Beff, 1e-12); // first estimate with C_m ≈ C_f
    // two passes to make C_p consistent with C_m
    let cpi = cp;
    let cm = cf;
    let cc = cf;
    let beta = 1;
    for (let k = 0; k < 4; k++) {
      cc = Math.max((qf * cf - qp * cpi) / Math.max(qf - qp, 1e-12), cf);
      beta = Math.exp(m.kCp * r);
      cm = beta * ((cf + cc) / 2);
      cpi = (Beff * cm) / Math.max(J + Beff, 1e-12);
    }
    const qc = qf - qp;
    const dp = m.dpRef * Math.pow((qf + qc) / 2 / m.qRef, m.dpExp);
    const pavg = pf - dp / 2;
    const piM = m.kOsm * cm;
    const piP = m.kOsm * cpi;
    const ndp = pavg - m.permeatePressure - (piM - piP);
    return { J, qp, qc, r, cc, cm, cp: cpi, beta, dp, pavg, piM, piP, ndp };
  };
  const jMax = ((0.95 * qf) * 1000) / m.area;
  let lo = 0;
  let hi = jMax;
  const g = (J: number) => J - Aeff * Math.max(state(J).ndp, 0);
  if (g(hi) < 0) lo = hi; // capped (extreme conditions)
  else
    for (let i = 0; i < 80; i++) {
      const mid = (lo + hi) / 2;
      if (g(mid) < 0) lo = mid;
      else hi = mid;
    }
  const st = state(lo === hi ? hi : (lo + hi) / 2);
  return {
    position, feedM3h: qf, permeateM3h: st.qp, concentrateM3h: st.qc, recoveryPct: st.r * 100, fluxLmh: st.J, feedPressureBar: pf, avgPressureBar: st.pavg,
    concentratePressureBar: pf - st.dp, dpBar: st.dp, feedTds: cf, concentrateTds: st.cc, permeateTds: st.cp, osmoticFeedBar: m.kOsm * cf, osmoticMembraneBar: st.piM,
    osmoticPermeateBar: st.piP, ndpBar: st.ndp, beta: st.beta, rejectionPct: (1 - st.cp / cf) * 100, tcf: m.tcfA, pressureCorrection: 0,
  };
}

interface ArraySim {
  stages: StageResult[];
  permeateM3h: number;
  permeateTds: number;
  concentrateTds: number;
  concentratePressure: number;
}

function simulateArray(m: ElementModel, vesselsPerStage: number[], epv: number, qFeed: number, cFeed: number, pFeed: number): ArraySim {
  const stages: StageResult[] = [];
  let q = qFeed;
  let c = cFeed;
  let p = pFeed;
  let totPerm = 0;
  let totSalt = 0;
  vesselsPerStage.forEach((v, si) => {
    const qv = q / v;
    const els: ElementResult[] = [];
    let qe = qv;
    let ce = c;
    let pe = p;
    for (let e = 0; e < epv; e++) {
      const r = solveElement(m, qe, ce, pe, e + 1);
      els.push(r);
      qe = r.concentrateM3h;
      ce = r.concentrateTds;
      pe = r.concentratePressureBar;
    }
    const permV = els.reduce((s, x) => s + x.permeateM3h, 0);
    const saltV = els.reduce((s, x) => s + x.permeateM3h * x.permeateTds, 0);
    stages.push({
      stage: si + 1, vessels: v, elementsPerVessel: epv, elements: v * epv, feedM3h: q, permeateM3h: permV * v, concentrateM3h: qe * v, feedPerVesselM3h: qv,
      concentratePerVesselM3h: qe, recoveryPct: (permV / qv) * 100, feedPressureBar: p, concentratePressureBar: pe, dpBar: p - pe, feedTds: c, concentrateTds: ce,
      permeateTds: permV > 0 ? saltV / permV : 0, avgFluxLmh: (permV * 1000) / (epv * m.area), elementsDetail: els,
    });
    totPerm += permV * v;
    totSalt += saltV * v;
    q = qe * v;
    c = ce;
    p = pe;
  });
  return { stages, permeateM3h: totPerm, permeateTds: totPerm > 0 ? totSalt / totPerm : 0, concentrateTds: c, concentratePressure: p };
}

interface DerivedModel {
  model: ElementModel;
  ndpT: number;
  jT: number;
  cpT: number;
  cmT: number;
}

/** Build the element model and derive A25/B25 from the datasheet test point (NaCl, 25 °C, clean element). */
export function deriveModel(spec: MembraneSpec, T: number, osmPerMgL: number, A: AssumptionReader): DerivedModel | null {
  const areaM2 = spec.activeAreaM2 as number;
  const diam = spec.diameterIn || 8;
  const qRef = A.n('element_dp_ref_flow') * Math.pow(diam / 8, 2);
  const kOsm25 = A.n('osmotic_coeff') / 1000;
  const model: ElementModel = {
    area: areaM2, A25: 1, B25: 0.01, tcfA: tcf(T, A.n('tcf_constant')), tcfB: tcf(T, A.n('tcf_salt_constant')), ff: A.n('fouling_factor'), aging: A.n('salt_passage_aging_factor'),
    kOsm: osmPerMgL, kCp: A.n('cp_coefficient'), dpRef: A.n('element_dp_ref_bar'), qRef, dpExp: A.n('element_dp_exponent'), permeatePressure: A.n('permeate_backpressure_bar'),
  };
  const qpT = (spec.nominalFlowM3d as number) / 24;
  const rT = (spec.testRecoveryPct as number) / 100;
  const qfT = qpT / rT;
  const cT = spec.testTdsMgL as number;
  const cpT = (1 - (spec.saltRejectionPct as number) / 100) * cT;
  const qcT = qfT - qpT;
  const ccT = (qfT * cT - qpT * cpT) / qcT;
  const cmT = Math.exp(model.kCp * rT) * ((cT + ccT) / 2);
  const dpT = model.dpRef * Math.pow((qfT + qcT) / 2 / qRef, model.dpExp);
  const ndpT = (spec.testPressureBar as number) - dpT / 2 - kOsm25 * (cmT - cpT);
  const jT = (qpT * 1000) / areaM2;
  if (!(ndpT > 0) || !(cmT > cpT)) return null;
  model.A25 = jT / ndpT;
  model.B25 = (jT * cpT) / (cmT - cpT);
  return { model, ndpT, jT, cpT, cmT };
}

/** Solve the feed pressure that makes the array produce Q_p. null = not achievable below the search limit. */
export function solveArray(model: ElementModel, vps: number[], epv: number, qf: number, cf: number, qp: number, pMax: number, iterations = 60): { Pf: number; sim: ArraySim } | null {
  const perm = (P: number) => simulateArray(model, vps, epv, qf, cf, P).permeateM3h;
  if (perm(pMax) < qp) return null;
  let lo = 0;
  let up = pMax;
  for (let i = 0; i < iterations; i++) {
    const mid = (lo + up) / 2;
    if (perm(mid) < qp) lo = mid;
    else up = mid;
  }
  return { Pf: up, sim: simulateArray(model, vps, epv, qf, cf, up) };
}

export function vesselLimits(spec: MembraneSpec, A: AssumptionReader) {
  const diam = spec.diameterIn || 8;
  return {
    maxFeedV: isNum(spec.maxFeedFlowM3h) && spec.maxFeedFlowM3h > 0 ? spec.maxFeedFlowM3h : A.n('max_feed_per_vessel') * Math.pow(diam / 8, 2),
    minConc: isNum(spec.minConcentrateM3h) && spec.minConcentrateM3h > 0 ? spec.minConcentrateM3h : A.n('min_concentrate_per_vessel') * Math.pow(diam / 8, 2),
    maxElDp: isNum(spec.maxElementDpBar) && spec.maxElementDpBar > 0 ? spec.maxElementDpBar : A.n('max_element_dp_bar'),
  };
}

function hydraulicsPass(sim: ArraySim, lim: ReturnType<typeof vesselLimits>) {
  return sim.stages.every((st) => st.feedPerVesselM3h <= lim.maxFeedV + 1e-9 && st.concentratePerVesselM3h >= lim.minConc - 1e-9 && st.elementsDetail.every((e) => e.dpBar <= lim.maxElDp));
}

/** All non-increasing splits of V vessels into s stages (each ≥ 1). */
function splits(V: number, s: number, max = V): number[][] {
  if (s === 1) return V <= max && V >= 1 ? [[V]] : [];
  const out: number[][] = [];
  for (let a = Math.min(max, V - (s - 1)); a >= 1; a--) for (const rest of splits(V - a, s - 1, a)) out.push([a, ...rest]);
  return out;
}

export function calcMembrane(
  input: MembraneDesignInput,
  spec: MembraneSpec | null,
  prod: ProductionResult,
  source: WaterSource,
  tds: number | null,
  tempC: number | null,
  ph: number | null,
  osmPerMgL: number | null,
  A: AssumptionReader,
  f: Findings,
): MembraneResult {
  const S = 'Membranes';
  const targets = fluxTargets(source, A);
  const maxFlux = spec && isNum(spec.recFluxMaxLmh) && spec.recFluxMaxLmh > 0 ? Math.min(targets.max, spec.recFluxMaxLmh) : targets.max;
  const minFlux = spec && isNum(spec.recFluxMinLmh) && spec.recFluxMinLmh > 0 ? spec.recFluxMinLmh : null;
  const fluxTarget = isNum(input.designFluxLmh) && input.designFluxLmh > 0 ? input.designFluxLmh : Math.min(targets.design, maxFlux);
  if (isNum(input.designFluxLmh) && input.designFluxLmh <= 0) f.critical(S, 'flux_input', 'Design flux must be positive – assumption value used.');
  const epvIn = input.elementsPerVessel ?? A.n('elements_per_vessel');
  const epv = Math.max(1, Math.min(8, Math.round(epvIn)));
  if (epv !== epvIn) f.review(S, 'epv', `Elements per vessel adjusted to ${epv} (allowed 1–8).`);
  const assumptions = [
    `Design flux target ${fluxTarget} LMH (${isNum(input.designFluxLmh) ? 'project input' : 'assumption for this water source'}); maximum average flux ${maxFlux} LMH${minFlux ? `, recommended minimum ${minFlux} LMH` : ''}.`,
    'Element model: solution–diffusion, Jw = A·TCF·FF·NDP; Cp = B·Cm/(Jw + B); β = exp(k·r); ΔP = ΔP_ref·(Q_avg/Q_ref)^n.',
    'A and B derived from the datasheet test point (test solution NaCl, 25 °C) with the same model.',
    `TCF_A = exp(${A.n('tcf_constant')}·(1/298.15 − 1/T)), TCF_B = exp(${A.n('tcf_salt_constant')}·(1/298.15 − 1/T)); fouling factor ${A.n('fouling_factor')}; salt-passage ageing ×${A.n('salt_passage_aging_factor')}.`,
    `Concentration polarisation k = ${A.n('cp_coefficient')}; element ΔP ${A.n('element_dp_ref_bar')} bar at ${A.n('element_dp_ref_flow')} m³/h (8"), exponent ${A.n('element_dp_exponent')}; permeate pressure ${A.n('permeate_backpressure_bar')} bar.`,
    'All vessels in a stage are identical; no interstage booster; no permeate throttling; single temperature.',
    'THIS IS NOT A MANUFACTURER-CERTIFIED PROJECTION. Verify with the membrane manufacturer design software and datasheet.',
  ];

  // ---------------------------------------------------------------- array configuration
  const manual = Array.isArray(input.vesselsPerStage) && input.vesselsPerStage.length > 0;
  let vps: number[] = [];
  let nReq = 0;
  const area = spec && isNum(spec.activeAreaM2) ? spec.activeAreaM2 : null;
  if (area && prod.permeateM3h > 0) nReq = Math.ceil((prod.permeateM3h * 1000) / (fluxTarget * area) - 1e-9);
  if (manual) {
    vps = (input.vesselsPerStage as number[]).map((v) => Math.round(v));
    if (vps.some((v) => !isFinite(v) || v < 1)) {
      f.critical(S, 'array_input', 'Vessels per stage must be whole numbers ≥ 1 – automatic array used instead.');
      vps = [];
    } else if (vps.length > 4) {
      f.critical(S, 'array_input', 'More than 4 stages is not supported – automatic array used instead.');
      vps = [];
    } else if (vps.some((v, i) => i > 0 && v > vps[i - 1])) f.review(S, 'array_taper', `Array ${vps.join(':')} is not tapered – later stages normally have fewer vessels to keep concentrate velocity.`);
  }
  const configMode: 'auto' | 'manual' = vps.length ? 'manual' : 'auto';
  if (!vps.length) {
    const vessels = Math.max(1, Math.ceil(Math.max(nReq, 1) / epv - 1e-9));
    let stages = input.stages && input.stages >= 1 ? Math.min(3, Math.round(input.stages)) : autoStages(prod.recoveryPct || 75, A);
    if (stages > vessels) {
      f.review(S, 'stages_reduced', `Only ${vessels} vessel(s) – array reduced from ${stages} to ${vessels} stage(s). Consider fewer elements per vessel to allow staging.`);
      stages = vessels;
    }
    vps = splitStages(vessels, stages);
    // Automatic array: if the default split violates vessel hydraulic limits in the element-by-element
    // solution, search nearby arrays (vessel count and staging) and take the closest one that passes.
    if (spec && area && prod.valid && prod.permeateM3h > 0 && tds !== null && tempC !== null && osmPerMgL !== null && membraneMissingFields(spec).length === 0) {
      const dm = deriveModel(spec, tempC, osmPerMgL, A);
      const lim = vesselLimits(spec, A);
      if (dm) {
        const pMax = A.n('max_feed_pressure_search_bar');
        const test = (c: number[]) => {
          const r = solveArray(dm.model, c, epv, prod.feedM3h, tds, prod.permeateM3h, pMax, 40);
          return r !== null && hydraulicsPass(r.sim, lim);
        };
        if (!test(vps)) {
          const vMin = Math.max(1, Math.ceil((prod.permeateM3h * 1000) / (maxFlux * area * epv) - 1e-9));
          const cands: number[][] = [];
          for (let V = vMin; V <= Math.min(vessels + 3, 60); V++)
            for (const st of [stages, stages - 1, stages + 1].filter((x) => x >= 1 && x <= 3 && x <= V)) for (const c of splits(V, st)) cands.push(c);
          const taper = (c: number[]) => c.slice(1).reduce((a, v, i) => a + Math.abs(c[i] / v - 2), 0);
          cands.sort((a, b) => Math.abs(a.reduce((x, y) => x + y, 0) - vessels) - Math.abs(b.reduce((x, y) => x + y, 0) - vessels) || Math.abs(a.length - stages) - Math.abs(b.length - stages) || taper(a) - taper(b));
          const found = cands.find(test);
          if (found) {
            f.ok(S, 'array_auto', `Automatic array ${found.join(':')} selected: the default ${vps.join(':')} violated a vessel flow limit (feed ≤ ${round(lim.maxFeedV, 1)}, concentrate ≥ ${round(lim.minConc, 1)} m³/h per vessel) in the element-by-element solution.`);
            vps = found;
          } else f.review(S, 'array_auto_none', `No automatic array within ±3 vessels satisfies all vessel flow limits – review elements per vessel, recovery or use concentrate recirculation.`);
        }
      }
    }
  }
  const vessels = vps.reduce((a, b) => a + b, 0);
  const elements = vessels * epv;
  const arrayLabel = `${vps.join(':')} (${vps.length}-stage, ${epv} el./vessel${configMode === 'manual' ? ', manual' : ''})`;

  const base: MembraneResult = {
    available: false, simulated: false, simulationMessage: '', isDemoData: !!spec?.isDemo, membraneLabel: spec ? `${spec.manufacturer} ${spec.model}` : 'No membrane selected',
    configMode, designFluxTargetLmh: fluxTarget, maxFluxLmh: maxFlux, minFluxLmh: minFlux, elementsRequired: nReq, elementsPerVessel: epv, vessels, elements, stages: vps.length,
    vesselsPerStage: vps, arrayLabel, stageDetail: [], actualFluxLmh: 0, capacityAtTargetFluxM3h: 0, nominalCapacityM3h: 0, averageElementRecoveryPct: 0, tcf: null, tcfSalt: null,
    permeabilityLmhBar: null, saltPermeabilityLmh: null, osmoticFeedBar: null, osmoticConcentrateBar: null, avgOsmoticBar: null, ndpBar: null, arrayDpBar: null,
    feedPressureBar: null, concentratePressureBar: null, saltPassagePct: null, rejectionPct: null, permeateTdsMgL: null, concentrateTdsMgL: null, steps: [], assumptions,
  };

  if (!spec) {
    f.critical(S, 'no_membrane', 'No membrane model selected – select a membrane from the Membrane Library.');
    return base;
  }
  const missing = membraneMissingFields(spec);
  if (missing.length) {
    f.critical(S, 'membrane_specs', `Missing membrane specifications for ${spec.manufacturer} ${spec.model}: ${missing.join(', ')}. Enter the manufacturer datasheet values in the Membrane Library.`);
    return base;
  }
  if (spec.isDemo) f.review(S, 'demo_membrane', `Membrane "${spec.model}" uses DEMO data – manufacturer verification required. Enter the actual manufacturer datasheet values before using this design.`);
  f.review(S, 'manufacturer_verification', 'Manufacturer verification required: membrane results are an engineering estimate, not a manufacturer-certified projection. Confirm with the manufacturer design software.');
  if (!prod.valid || prod.permeateM3h <= 0) return base;

  const Qp = prod.permeateM3h;
  const Qf = prod.feedM3h;
  const R = prod.recoveryPct / 100;
  const areaM2 = area as number;
  const flux = (Qp * 1000) / (elements * areaM2);
  const elementsInSeries = epv * vps.length;
  const avgElementRecovery = (1 - Math.pow(1 - R, 1 / elementsInSeries)) * 100;

  // flows by equal-flux estimate (used when the simulation cannot run)
  const flowOnlyStages = (): StageResult[] => {
    const out: StageResult[] = [];
    let qin = Qf;
    vps.forEach((v, i) => {
      const qp = (Qp * v * epv) / elements;
      out.push({ stage: i + 1, vessels: v, elementsPerVessel: epv, elements: v * epv, feedM3h: qin, permeateM3h: qp, concentrateM3h: qin - qp, feedPerVesselM3h: qin / v, concentratePerVesselM3h: (qin - qp) / v, recoveryPct: (qp / qin) * 100, feedPressureBar: null, concentratePressureBar: null, dpBar: null, feedTds: null, concentrateTds: null, permeateTds: null, avgFluxLmh: flux, elementsDetail: [] });
      qin -= qp;
    });
    return out;
  };

  const steps: CalcStep[] = [
    step('Elements required', 'N = ceil(Q_p × 1000 ÷ (J_target × A_element))', nReq, 'pcs', `Q_p ${n(Qp)} m³/h, J_target ${fluxTarget} LMH, A ${areaM2} m²`),
    step('Array', configMode === 'manual' ? 'user-defined vessels per stage' : 'V = ceil(N ÷ elements/vessel), 2:1 taper', `${vps.join(':')} = ${vessels} vessels × ${epv} = ${elements} elements`, '', `${epv} elements per vessel`, configMode === 'auto' ? `Stages from recovery: ≤ ${A.n('recovery_max_1stage')} % → 1, ≤ ${A.n('recovery_max_2stage')} % → 2, else 3` : undefined),
    step('Average flux', 'J = Q_p × 1000 ÷ (N_installed × A_element)', flux, 'LMH', `Q_p ${n(Qp)} m³/h, N ${elements}, A ${areaM2} m²`),
  ];

  const base2: MembraneResult = {
    ...base, available: true, actualFluxLmh: round(flux, 2), capacityAtTargetFluxM3h: round((elements * areaM2 * fluxTarget) / 1000, 2),
    nominalCapacityM3h: round((elements * (spec.nominalFlowM3d as number)) / 24, 2), averageElementRecoveryPct: round(avgElementRecovery, 1),
  };

  // flux checks (independent of the simulation)
  if (flux > maxFlux) f.critical(S, 'flux_high', `Average flux ${round(flux, 1)} LMH exceeds the configured limit ${maxFlux} LMH – excessive fouling risk. Add elements.`);
  else if (flux > fluxTarget * 1.05) f.review(S, 'flux_above_target', `Average flux ${round(flux, 1)} LMH is above the design target ${fluxTarget} LMH.`);
  else f.ok(S, 'flux_ok', `Average flux ${round(flux, 1)} LMH within limit (target ${fluxTarget}, max ${maxFlux} LMH).`);
  if (minFlux && flux < minFlux) f.review(S, 'flux_low', `Average flux ${round(flux, 1)} LMH is below the recommended minimum ${minFlux} LMH – membranes over-sized, poorer permeate quality.`);
  else if (flux < fluxTarget * 0.6) f.review(S, 'flux_low', `Average flux ${round(flux, 1)} LMH is much lower than the target – membranes are over-sized.`);
  if (configMode === 'manual' && nReq > elements) f.review(S, 'array_small', `Manual array has ${elements} elements; ${nReq} are needed for the target flux.`);

  const isSw = /sw|sea/i.test(spec.membraneType);
  if (tds !== null && tds > 10000 && !isSw) f.critical(S, 'membrane_type', `Feed TDS ${tds} mg/L requires a seawater (SW) membrane; ${spec.model} is ${spec.membraneType}.`);
  if (tds !== null && tds < 5000 && isSw) f.review(S, 'membrane_type_sw', `A seawater membrane is selected for brackish feed (TDS ${tds} mg/L) – higher energy than necessary.`);
  if (isSeawater(source) && !isSw) f.critical(S, 'membrane_type_source', 'Water source is seawater but the selected membrane is not a seawater type.');
  if (tempC !== null && isNum(spec.maxTempC) && tempC > spec.maxTempC) f.critical(S, 'temp_max', `Feed temperature ${tempC} °C exceeds membrane maximum ${spec.maxTempC} °C.`);
  if (isNum(ph) && isNum(spec.phMin) && isNum(spec.phMax) && (ph < spec.phMin || ph > spec.phMax)) f.critical(S, 'ph_membrane', `Feed pH ${ph} is outside the membrane operating range ${spec.phMin}–${spec.phMax}.`);

  // ---------------------------------------------------------------- simulation
  const missingData: string[] = [];
  if (tds === null) missingData.push('TDS');
  if (tempC === null) missingData.push('temperature');
  if (osmPerMgL === null) missingData.push('osmotic pressure');
  if (missingData.length) {
    const msg = `INSUFFICIENT DATA — pressure, NDP and permeate quality not calculated (${missingData.join(', ')} missing). Flows shown assume equal flux per element.`;
    f.critical(S, 'membrane_insufficient', msg);
    return { ...base2, simulationMessage: msg, stageDetail: flowOnlyStages(), steps };
  }

  const T = tempC as number;
  const dm = deriveModel(spec, T, osmPerMgL as number, A);
  if (!dm) {
    const msg = 'Datasheet test conditions give a non-positive driving pressure – check test pressure / test TDS in the Membrane Library.';
    f.critical(S, 'test_conditions', msg);
    return { ...base2, simulationMessage: msg, stageDetail: flowOnlyStages(), steps };
  }
  const { model, ndpT, jT, cpT, cmT } = dm;
  const cT = spec.testTdsMgL as number;
  void cpT;
  steps.push(
    step('Water permeability A (25 °C)', 'A = J_test ÷ (P_test − ΔP_test/2 − π_m,test + π_p,test)', model.A25, 'LMH/bar', `J_test ${n(jT)} LMH, P_test ${spec.testPressureBar} bar, NaCl ${cT} mg/L, r_test ${spec.testRecoveryPct} %`, `NaCl osmotic ${A.n('osmotic_coeff')} bar/1000 mg/L`),
    step('Salt permeability B (25 °C)', 'B = J_test × C_p ÷ (C_m − C_p),  C_p = (1 − SR) × C_test', model.B25, 'LMH', `SR ${spec.saltRejectionPct} %, C_m ${n(cmT, 0)} mg/L`),
    step('Temperature correction (water)', 'TCF_A = exp(K·(1/298.15 − 1/(273.15+T)))', model.tcfA, '–', `T = ${T} °C`, `K = ${A.n('tcf_constant')}`),
    step('Temperature correction (salt)', 'TCF_B = exp(K_B·(1/298.15 − 1/(273.15+T)))', model.tcfB, '–', `T = ${T} °C`, `K_B = ${A.n('tcf_salt_constant')}`),
  );

  const cFeed = tds as number;
  const hi = A.n('max_feed_pressure_search_bar');
  const solved = solveArray(model, vps, epv, Qf, cFeed, Qp, hi);
  if (!solved) {
    const msg = `Required permeate ${round(Qp, 2)} m³/h cannot be produced at ${round(R * 100, 1)} % recovery even at ${hi} bar – osmotic pressure limit / array too small. Reduce recovery or add elements.`;
    f.critical(S, 'infeasible', msg);
    return { ...base2, simulationMessage: msg, stageDetail: flowOnlyStages(), steps };
  }
  const { Pf, sim } = solved;
  // normalise stage/element numbers and add pressure-correction factor
  const stageDetail = sim.stages.map((s) => ({
    ...s,
    feedM3h: round(s.feedM3h, 3), permeateM3h: round(s.permeateM3h, 3), concentrateM3h: round(s.concentrateM3h, 3), feedPerVesselM3h: round(s.feedPerVesselM3h, 3),
    concentratePerVesselM3h: round(s.concentratePerVesselM3h, 3), recoveryPct: round(s.recoveryPct, 2), feedPressureBar: round(s.feedPressureBar as number, 2),
    concentratePressureBar: round(s.concentratePressureBar as number, 2), dpBar: round(s.dpBar as number, 3), feedTds: round(s.feedTds as number, 0),
    concentrateTds: round(s.concentrateTds as number, 0), permeateTds: round(s.permeateTds as number, 1), avgFluxLmh: round(s.avgFluxLmh, 2),
    elementsDetail: s.elementsDetail.map((e) => ({
      position: e.position, feedM3h: round(e.feedM3h, 3), permeateM3h: round(e.permeateM3h, 3), concentrateM3h: round(e.concentrateM3h, 3), recoveryPct: round(e.recoveryPct, 2),
      fluxLmh: round(e.fluxLmh, 2), feedPressureBar: round(e.feedPressureBar, 2), avgPressureBar: round(e.avgPressureBar, 2), concentratePressureBar: round(e.concentratePressureBar, 2),
      dpBar: round(e.dpBar, 3), feedTds: round(e.feedTds, 0), concentrateTds: round(e.concentrateTds, 0), permeateTds: round(e.permeateTds, 1), osmoticFeedBar: round(e.osmoticFeedBar, 3),
      osmoticMembraneBar: round(e.osmoticMembraneBar, 3), osmoticPermeateBar: round(e.osmoticPermeateBar, 4), ndpBar: round(e.ndpBar, 3), beta: round(e.beta, 3),
      rejectionPct: round(e.rejectionPct, 3), tcf: round(e.tcf, 4), pressureCorrection: round(e.ndpBar / ndpT, 3),
    })),
  }));
  const allEls = sim.stages.flatMap((s) => s.elementsDetail);
  const avgNdp = allEls.reduce((a, e) => a + e.ndpBar, 0) / allEls.length;
  const avgPiM = allEls.reduce((a, e) => a + e.osmoticMembraneBar, 0) / allEls.length;
  const arrayDp = Pf - sim.concentratePressure;
  const permTds = sim.permeateTds;
  const concTds = sim.concentrateTds;
  steps.push(
    step('Required feed pressure (solved)', 'find P_f such that Σ element permeate = Q_p (bisection)', Pf, 'bar', `Q_f ${n(Qf)} m³/h, Q_p ${n(Qp)} m³/h, TDS ${n(cFeed, 0)} mg/L, T ${T} °C`, `k_osm ${n((osmPerMgL as number) * 1000, 3)} bar per 1000 mg/L`),
    step('Array pressure drop', 'ΔP = Σ element ΔP along the flow path', arrayDp, 'bar', stageDetail.map((s) => `stage ${s.stage}: ${s.dpBar} bar`).join(', ')),
    step('Average NDP', 'mean of element NDP', avgNdp, 'bar'),
    step('Average membrane-wall osmotic pressure', 'mean of k_osm·β·C_avg', avgPiM, 'bar'),
    step('Permeate TDS (blended)', 'Σ(Q_p,i·C_p,i) ÷ Σ Q_p,i', permTds, 'mg/L'),
    step('Concentrate TDS', 'mass balance through the array', concTds, 'mg/L'),
    step('System salt rejection', '(1 − C_p ÷ C_f) × 100', (1 - permTds / cFeed) * 100, '%'),
  );

  // ---------------------------------------------------------------- checks
  const { maxFeedV, minConc } = vesselLimits(spec, A);
  const maxElRec = isNum(spec.maxElementRecoveryPct) && spec.maxElementRecoveryPct > 0 ? spec.maxElementRecoveryPct : A.n('max_element_recovery');
  const maxElDp = vesselLimits(spec, A).maxElDp;
  let vesselOk = true;
  for (const s of stageDetail) {
    if (s.feedPerVesselM3h > maxFeedV) {
      vesselOk = false;
      f.critical(S, `vessel_feed_${s.stage}`, `Stage ${s.stage}: feed per vessel ${round(s.feedPerVesselM3h, 2)} m³/h exceeds ${maxFeedV} m³/h. Add vessels.`);
    }
    if (s.concentratePerVesselM3h < minConc) {
      vesselOk = false;
      f.critical(S, `vessel_conc_${s.stage}`, `Stage ${s.stage}: concentrate per vessel ${round(s.concentratePerVesselM3h, 2)} m³/h is below ${minConc} m³/h – polarisation/scaling risk. Reduce vessels in this stage or change the array.`);
    }
    const lead = s.elementsDetail[0];
    const tail = s.elementsDetail[s.elementsDetail.length - 1];
    if (lead && lead.fluxLmh > maxFlux * A.n('lead_element_flux_factor')) f.review(S, `lead_flux_${s.stage}`, `Stage ${s.stage}: lead-element flux ${lead.fluxLmh} LMH exceeds ${round(maxFlux * A.n('lead_element_flux_factor'), 1)} LMH – fouling risk on first elements.`);
    const worstRec = Math.max(...s.elementsDetail.map((e) => e.recoveryPct));
    if (worstRec > maxElRec) f.review(S, `el_recovery_${s.stage}`, `Stage ${s.stage}: element recovery up to ${round(worstRec, 1)} % exceeds ${maxElRec} %.`);
    const worstBeta = Math.max(...s.elementsDetail.map((e) => e.beta));
    if (worstBeta > A.n('max_beta')) f.review(S, `beta_${s.stage}`, `Stage ${s.stage}: concentration polarisation β = ${worstBeta} exceeds ${A.n('max_beta')}.`);
    const worstDp = Math.max(...s.elementsDetail.map((e) => e.dpBar));
    if (worstDp > maxElDp) f.critical(S, `el_dp_${s.stage}`, `Stage ${s.stage}: element pressure drop ${round(worstDp, 2)} bar exceeds ${maxElDp} bar.`);
    if (tail && tail.ndpBar < A.n('min_tail_ndp_bar')) f.review(S, `tail_ndp_${s.stage}`, `Stage ${s.stage}: last element NDP ${round(tail.ndpBar, 2)} bar < ${A.n('min_tail_ndp_bar')} bar – little driving pressure at the tail (poor permeate quality). Consider an interstage booster or lower recovery.`);
  }
  if (vesselOk) f.ok(S, 'vessel_flows', 'Feed and concentrate flows per vessel are within limits.');
  if (stageDetail.length > 1 && stageDetail[stageDetail.length - 1].avgFluxLmh < 0.5 * stageDetail[0].avgFluxLmh)
    f.review(S, 'flux_imbalance', `Last-stage flux ${stageDetail[stageDetail.length - 1].avgFluxLmh} LMH is less than half of stage 1 (${stageDetail[0].avgFluxLmh} LMH) – consider an interstage booster pump or permeate back-pressure on stage 1.`);
  if (isNum(spec.maxPressureBar)) {
    if (Pf > spec.maxPressureBar) f.critical(S, 'pressure_max', `Required feed pressure ${round(Pf, 1)} bar exceeds the membrane maximum ${spec.maxPressureBar} bar.`);
    else if (Pf > spec.maxPressureBar * 0.9) f.review(S, 'pressure_near_max', `Required feed pressure ${round(Pf, 1)} bar is within 10 % of the membrane maximum ${spec.maxPressureBar} bar.`);
    else f.ok(S, 'pressure_ok', `Required feed pressure ${round(Pf, 1)} bar is below the membrane maximum ${spec.maxPressureBar} bar.`);
  }

  return {
    ...base2,
    simulated: true,
    simulationMessage: 'Element-by-element solution converged.',
    stageDetail,
    tcf: round(model.tcfA, 4),
    tcfSalt: round(model.tcfB, 4),
    permeabilityLmhBar: round(model.A25, 4),
    saltPermeabilityLmh: round(model.B25, 5),
    osmoticFeedBar: round((osmPerMgL as number) * cFeed, 3),
    osmoticConcentrateBar: round((osmPerMgL as number) * concTds, 3),
    avgOsmoticBar: round(avgPiM, 3),
    ndpBar: round(avgNdp, 3),
    arrayDpBar: round(arrayDp, 3),
    feedPressureBar: round(Pf, 2),
    concentratePressureBar: round(sim.concentratePressure, 2),
    saltPassagePct: round((permTds / cFeed) * 100, 3),
    rejectionPct: round((1 - permTds / cFeed) * 100, 3),
    permeateTdsMgL: round(permTds, 1),
    concentrateTdsMgL: round(concTds, 0),
    steps,
  };
}
