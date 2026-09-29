import type { AssumptionReader } from '../assumptions';
import type { ProductionInput, WaterSource } from '../types';
import { CalcStep, Findings, isNum, round } from './common';

export interface ProductionResult {
  averagePermeateM3h: number;
  permeateM3h: number;
  permeateOverridden: boolean;
  dailyProductionM3d: number;
  recoveryPct: number;
  feedM3h: number;
  rejectM3h: number;
  steps: CalcStep[];
  valid: boolean;
}

export function isSeawater(s: WaterSource) {
  return s === 'seawater_open' || s === 'seawater_well';
}

export function calcProduction(p: ProductionInput, source: WaterSource, A: AssumptionReader, f: Findings): ProductionResult {
  const S = 'Production';
  let valid = true;
  const hours = p.operatingHours;
  if (!isNum(hours) || hours <= 0 || hours > 24) {
    f.critical(S, 'hours', `Operating hours/day must be between 0 and 24 (entered ${hours}).`);
    valid = false;
  } else if (hours < 8) f.review(S, 'hours_low', `Only ${hours} h/day operation – the plant is oversized for the daily volume and membranes will stand idle; consider flushing/preservation.`);

  if (!isNum(p.dailyProductionM3d) || p.dailyProductionM3d <= 0) {
    f.critical(S, 'daily', `Required production must be greater than zero (entered ${p.dailyProductionM3d} m³/day).`);
    valid = false;
  }
  const peak = isNum(p.peakFactor) && p.peakFactor > 0 ? p.peakFactor : 1;
  if (!isNum(p.peakFactor) || p.peakFactor <= 0) f.critical(S, 'peak', 'Peak factor must be greater than zero – 1.0 used.');
  else if (p.peakFactor < 1) f.review(S, 'peak_low', `Peak factor ${p.peakFactor} is below 1.0 – the plant will be designed below the average requirement.`);
  else if (p.peakFactor > 2) f.review(S, 'peak_high', `Peak factor ${p.peakFactor} is unusually high – consider storage instead of oversizing the RO.`);

  const recPct = p.recoveryPct;
  const rLimit = isSeawater(source) ? A.n('recovery_limit_seawater') : A.n('recovery_limit_brackish');
  if (!isNum(recPct) || recPct <= 0 || recPct >= 100) {
    f.critical(S, 'recovery_impossible', `Recovery ${recPct} % is impossible – it must be between 0 and 100 %.`);
    valid = false;
  } else if (recPct > rLimit) {
    f.critical(S, 'recovery_limit', `Recovery ${recPct} % exceeds the practical limit of ${rLimit} % for this water source (scaling / osmotic pressure).`);
  } else if (isSeawater(source) && recPct > 45) {
    f.review(S, 'recovery_sw', `Seawater recovery ${recPct} % is high – typical SWRO recovery is 35–45 %.`);
  } else if (!isSeawater(source) && recPct < 50) {
    f.review(S, 'recovery_low', `Recovery ${recPct} % is low for brackish/fresh water (typical 65–80 %) – more raw water is wasted than necessary.`);
  } else f.ok(S, 'recovery_ok', `Recovery ${recPct} % is within the normal range for this water source.`);

  const avg = valid ? p.dailyProductionM3d / hours : 0;
  let permeate = avg * peak;
  const overridden = isNum(p.permeateFlowOverrideM3h) && p.permeateFlowOverrideM3h > 0;
  if (isNum(p.permeateFlowOverrideM3h) && p.permeateFlowOverrideM3h <= 0) f.critical(S, 'override', 'Permeate flow override must be positive – ignored.');
  if (overridden) {
    permeate = p.permeateFlowOverrideM3h as number;
    if (valid && permeate < avg) f.critical(S, 'override_low', `Permeate override ${permeate} m³/h is below the average requirement ${round(avg, 2)} m³/h – daily production will not be met.`);
  }
  const r = valid ? recPct / 100 : 0.75;
  const feed = valid ? permeate / r : 0;
  const reject = feed - permeate;

  if (valid && permeate < 0.1) f.review(S, 'flow_small', `Permeate flow ${round(permeate, 3)} m³/h is very small – 8" industrial membranes are not suitable; consider 4" elements.`);
  if (valid && permeate > 1000) f.review(S, 'flow_large', `Permeate flow ${round(permeate, 0)} m³/h is very large for a single train – split into multiple trains.`);
  if (valid && permeate > 5000) f.critical(S, 'flow_unrealistic', `Permeate flow ${round(permeate, 0)} m³/h is unrealistic for this tool (single train).`);

  const steps: CalcStep[] = [
    { label: 'Average permeate flow', formula: 'Q_avg = Daily production ÷ Operating hours', value: round(avg, 2), unit: 'm³/h' },
    overridden
      ? { label: 'Design permeate flow (override)', formula: 'Q_p = user override', value: round(permeate, 2), unit: 'm³/h' }
      : { label: 'Design permeate flow', formula: 'Q_p = Q_avg × Peak factor', value: round(permeate, 2), unit: 'm³/h' },
    { label: 'Feed flow', formula: 'Q_f = Q_p ÷ Recovery', value: round(feed, 2), unit: 'm³/h' },
    { label: 'Reject (concentrate) flow', formula: 'Q_c = Q_f − Q_p', value: round(reject, 2), unit: 'm³/h' },
    { label: 'Daily production capacity', formula: 'Q_p × Operating hours', value: round(permeate * (valid ? hours : 0), 1), unit: 'm³/day' },
  ];

  return {
    averagePermeateM3h: avg,
    permeateM3h: permeate,
    permeateOverridden: overridden,
    dailyProductionM3d: permeate * (valid ? hours : 0),
    recoveryPct: valid ? recPct : 0,
    feedM3h: feed,
    rejectM3h: reject,
    steps,
    valid,
  };
}
