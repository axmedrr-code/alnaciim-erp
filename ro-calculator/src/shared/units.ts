/** Unit conversion helpers. Internal calculations are always SI: m³/h, bar, m, kW, mm. */

export type FlowUnit = 'm3/h' | 'm3/day' | 'L/h' | 'L/min' | 'gpm';
export type PressureUnit = 'bar' | 'psi' | 'kPa' | 'm';
export type PowerUnit = 'kW' | 'HP';
export type LengthUnit = 'mm' | 'inch';

export const FLOW_UNITS: FlowUnit[] = ['m3/h', 'm3/day', 'L/h', 'L/min', 'gpm'];
export const PRESSURE_UNITS: PressureUnit[] = ['bar', 'psi', 'kPa', 'm'];
export const POWER_UNITS: PowerUnit[] = ['kW', 'HP'];

export const UNIT_LABEL: Record<string, string> = { 'm3/h': 'm³/h', 'm3/day': 'm³/day', 'L/h': 'L/h', 'L/min': 'L/min', gpm: 'US gpm', bar: 'bar', psi: 'psi', kPa: 'kPa', m: 'm head', kW: 'kW', HP: 'HP', mm: 'mm', inch: 'inch' };

const FLOW_TO_M3H: Record<FlowUnit, number> = { 'm3/h': 1, 'm3/day': 1 / 24, 'L/h': 1 / 1000, 'L/min': 60 / 1000, gpm: 0.227124 };
const PRESSURE_TO_BAR: Record<PressureUnit, number> = { bar: 1, psi: 0.0689476, kPa: 0.01, m: 0.0980665 };
const POWER_TO_KW: Record<PowerUnit, number> = { kW: 1, HP: 0.7457 };

/** Metres of fresh water per bar (ρ = 1000 kg/m³, g = 9.81) – consistent with the engine. */
export const M_HEAD_PER_BAR = 1e5 / (1000 * 9.81);

export function convertFlow(v: number, from: FlowUnit, to: FlowUnit) {
  return (v * FLOW_TO_M3H[from]) / FLOW_TO_M3H[to];
}
export function convertPressure(v: number, from: PressureUnit, to: PressureUnit) {
  const bar = from === 'm' ? v / M_HEAD_PER_BAR : v * PRESSURE_TO_BAR[from];
  return to === 'm' ? bar * M_HEAD_PER_BAR : bar / PRESSURE_TO_BAR[to];
}
export function convertPower(v: number, from: PowerUnit, to: PowerUnit) {
  return (v * POWER_TO_KW[from]) / POWER_TO_KW[to];
}
export function convertLength(v: number, from: LengthUnit, to: LengthUnit) {
  const mm = from === 'inch' ? v * 25.4 : v;
  return to === 'inch' ? mm / 25.4 : mm;
}

export interface DisplayUnits {
  flow: FlowUnit;
  pressure: PressureUnit;
  power: PowerUnit;
}

export const DEFAULT_UNITS: DisplayUnits = { flow: 'm3/h', pressure: 'bar', power: 'kW' };

function fmtNum(v: number, digits: number) {
  if (!isFinite(v)) return '–';
  const abs = Math.abs(v);
  const d = abs >= 1000 ? 0 : abs >= 100 ? Math.min(digits, 1) : digits;
  return v.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: 0 });
}

export function fmtFlow(v: number | null | undefined, u: DisplayUnits = DEFAULT_UNITS, digits = 2) {
  if (v == null || !isFinite(v)) return '–';
  return `${fmtNum(convertFlow(v, 'm3/h', u.flow), digits)} ${UNIT_LABEL[u.flow]}`;
}
export function fmtPressure(v: number | null | undefined, u: DisplayUnits = DEFAULT_UNITS, digits = 1) {
  if (v == null || !isFinite(v)) return '–';
  return `${fmtNum(convertPressure(v, 'bar', u.pressure), digits)} ${UNIT_LABEL[u.pressure]}`;
}
export function fmtPower(v: number | null | undefined, u: DisplayUnits = DEFAULT_UNITS, digits = 2) {
  if (v == null || !isFinite(v)) return '–';
  return `${fmtNum(convertPower(v, 'kW', u.power), digits)} ${UNIT_LABEL[u.power]}`;
}
export function fmt(v: number | null | undefined, digits = 2, unit = '') {
  if (v == null || !isFinite(v)) return '–';
  return `${fmtNum(v, digits)}${unit ? ' ' + unit : ''}`;
}
