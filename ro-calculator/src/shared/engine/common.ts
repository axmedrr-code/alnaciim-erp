export type Level = 'ok' | 'review' | 'critical';

export const LEVEL_ICON: Record<Level, string> = { ok: '🟢', review: '🟡', critical: '🔴' };
export const LEVEL_LABEL: Record<Level, string> = { ok: 'Acceptable', review: 'Review', critical: 'Critical' };

export interface Finding {
  level: Level;
  section: string;
  code: string;
  message: string;
}

/** One visible calculation step: label, the formula used, and the result. */
export interface CalcStep {
  label: string;
  formula: string;
  value: number | string;
  unit: string;
}

export class Findings {
  readonly items: Finding[] = [];
  add(level: Level, section: string, code: string, message: string) {
    this.items.push({ level, section, code, message });
  }
  ok(section: string, code: string, message: string) {
    this.add('ok', section, code, message);
  }
  review(section: string, code: string, message: string) {
    this.add('review', section, code, message);
  }
  critical(section: string, code: string, message: string) {
    this.add('critical', section, code, message);
  }
}

export const G = 9.81;
export const RHO = 1000;
/** metres of water column per bar */
export const M_PER_BAR = 1e5 / (RHO * G); // ≈ 10.19

export function barToM(bar: number) {
  return bar * M_PER_BAR;
}
export function mToBar(m: number) {
  return m / M_PER_BAR;
}

export function round(v: number, d = 2): number {
  if (!isFinite(v)) return v;
  const f = Math.pow(10, d);
  return Math.round(v * f) / f;
}

export function isNum(v: unknown): v is number {
  return typeof v === 'number' && isFinite(v);
}

/** Smallest value in a sorted list that is >= v, or null when v exceeds the list. */
export function nextStandard(v: number, list: number[]): number | null {
  const sorted = [...list].sort((a, b) => a - b);
  for (const s of sorted) if (s >= v - 1e-9) return s;
  return null;
}

export function ceilTo(v: number, step: number) {
  if (step <= 0) return v;
  return Math.ceil(v / step - 1e-9) * step;
}

/** Hydraulic power in kW for flow in m³/h and head in m. */
export function hydraulicKw(flowM3h: number, headM: number) {
  return (RHO * G * (flowM3h / 3600) * headM) / 1000;
}
