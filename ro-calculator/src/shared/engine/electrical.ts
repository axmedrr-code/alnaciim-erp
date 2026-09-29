import type { AssumptionReader } from '../assumptions';
import { CalcStep, Findings, nextStandard, round } from './common';
import type { DosingLine } from './dosing';
import type { PumpResult } from './pumps';

export interface ElectricalLoad {
  name: string;
  qty: number;
  ratedKw: number;
  absorbedKw: number;
  hoursPerDay: number;
  continuous: boolean;
  note: string;
}

export interface ElectricalResult {
  loads: ElectricalLoad[];
  connectedKw: number;
  runningKw: number;
  energyKwhDay: number;
  specificEnergyKwhM3: number;
  fullLoadCurrentA: number;
  incomerA: number | null;
  steps: CalcStep[];
}

export function calcElectrical(pumps: PumpResult[], dosing: DosingLine[], uvKw: number, hours: number, dailyM3: number, A: AssumptionReader, f: Findings): ElectricalResult {
  const loads: ElectricalLoad[] = [];
  for (const p of pumps) {
    if (!p.enabled) continue;
    const cont = p.id !== 'cip';
    loads.push({ name: p.name, qty: 1, ratedKw: p.motorKw, absorbedKw: p.absorbedKw, hoursPerDay: cont ? hours : 0, continuous: cont, note: cont ? 'Duty' : 'Intermittent (cleaning only) – excluded from running load' });
  }
  if (dosing.length) loads.push({ name: 'Dosing pumps', qty: dosing.length, ratedKw: A.n('dosing_pump_kw'), absorbedKw: A.n('dosing_pump_kw'), hoursPerDay: hours, continuous: true, note: dosing.map((d) => d.chemical).join(', ') });
  if (uvKw > 0) loads.push({ name: 'UV disinfection', qty: 1, ratedKw: round(uvKw, 2), absorbedKw: round(uvKw, 2), hoursPerDay: hours, continuous: true, note: '' });
  loads.push({ name: 'Control panel, PLC, instruments', qty: 1, ratedKw: A.n('control_panel_kw'), absorbedKw: A.n('control_panel_kw'), hoursPerDay: 24, continuous: true, note: '' });

  const connected = loads.reduce((s, l) => s + l.ratedKw * l.qty, 0);
  const running = loads.filter((l) => l.continuous).reduce((s, l) => s + l.absorbedKw * l.qty, 0);
  const energy = loads.reduce((s, l) => s + l.absorbedKw * l.qty * l.hoursPerDay, 0);
  const V = A.n('supply_voltage');
  const pf = A.n('power_factor');
  const I = (connected * 1000) / (Math.sqrt(3) * V * pf);
  const incomer = nextStandard(I * A.n('incomer_factor'), A.list('std_breakers_a'));
  const sec = dailyM3 > 0 ? energy / dailyM3 : 0;
  if (dailyM3 > 0 && sec > 0) {
    if (sec > 6) f.review('Electrical', 'sec_high', `Specific energy ${round(sec, 2)} kWh/m³ is high – check pump heads (seawater RO without energy recovery is typically 5–8 kWh/m³).`);
    else f.ok('Electrical', 'sec', `Specific energy consumption ≈ ${round(sec, 2)} kWh/m³.`);
  }
  return {
    loads,
    connectedKw: round(connected, 2),
    runningKw: round(running, 2),
    energyKwhDay: round(energy, 1),
    specificEnergyKwhM3: round(sec, 2),
    fullLoadCurrentA: round(I, 1),
    incomerA: incomer,
    steps: [
      { label: 'Connected load', formula: 'Σ motor rated kW × qty', value: round(connected, 2), unit: 'kW' },
      { label: 'Running (absorbed) load', formula: 'Σ electrical input of continuous loads', value: round(running, 2), unit: 'kW' },
      { label: 'Energy per day', formula: 'Σ absorbed kW × hours/day', value: round(energy, 1), unit: 'kWh/day' },
      { label: 'Specific energy', formula: 'kWh/day ÷ m³/day', value: round(sec, 2), unit: 'kWh/m³' },
      { label: 'Full-load current', formula: `I = P ÷ (√3 × ${V} V × ${pf})`, value: round(I, 1), unit: 'A' },
      { label: 'Main incomer', formula: `next standard ≥ I × ${A.n('incomer_factor')}`, value: incomer ?? '> list', unit: 'A' },
    ],
  };
}
