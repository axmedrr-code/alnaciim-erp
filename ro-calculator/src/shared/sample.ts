import { defaultAssumptions, type Assumptions } from './assumptions';
import type { DesignInput, RawWaterInput } from './types';

export const EMPTY_WATER: RawWaterInput = {
  source: 'well', tds: null, temperature: null, ph: null, hardness: null, alkalinity: null, calcium: null, magnesium: null, sodium: null, potassium: null,
  chloride: null, sulfate: null, nitrate: null, fluoride: null, silica: null, iron: null, manganese: null, barium: null, strontium: null, turbidity: null,
  sdi: null, conductivity: null, freeChlorine: null, toc: null, feedPressureBar: null, boreholeDepth: null, staticLevel: null, dynamicLevel: null,
  distanceToPlant: null, elevationDifference: null,
};

export function blankDesign(assumptions: Assumptions = defaultAssumptions(), membraneId: number | null = null): DesignInput {
  return {
    project: { name: 'New RO design', customer: '', location: '', designer: '', date: new Date().toISOString().slice(0, 10), reference: '', notes: '' },
    production: { dailyProductionM3d: 240, operatingHours: 20, peakFactor: 1, recoveryPct: 75, permeateFlowOverrideM3h: null },
    water: { ...EMPTY_WATER },
    membrane: { membraneId, elementsPerVessel: null, designFluxLmh: null, stages: null, vesselsPerStage: null },
    hydraulics: { feedPumpEnabled: true, productPumpEnabled: true, distributionFlowM3h: null, distributionHeadM: 30, frictionMethod: 'darcy', pipes: {}, pumps: {} },
    pretreatment: { overrides: {}, scaleControl: 'auto', postDisinfection: 'uv', cip: true, antiscalantDoseMgL: null },
    tanks: { rawStorageHours: null, permeateStorageHours: null, peakDemandM3h: null, peakDurationH: 0, rejectRecovery: false, rejectStorageHours: null },
    bomOverrides: {},
    customBom: [],
    costing: { enabled: false, currency: 'USD', installationPct: 15, engineeringPct: 8, contingencyPct: 10 },
    assumptions,
  };
}

/** Sample project: 30 m³/h brackish borehole RO system. */
export function sample30m3h(assumptions: Assumptions = defaultAssumptions(), membraneId: number | null = null): DesignInput {
  const d = blankDesign(assumptions, membraneId);
  d.project = {
    name: 'Sample – 30 m³/h RO System',
    customer: 'Sample Customer',
    location: 'Example site',
    designer: 'RO Calculator (sample)',
    date: new Date().toISOString().slice(0, 10),
    reference: 'RO-SAMPLE-030',
    notes: 'Sample project for testing. Water analysis values are illustrative.',
  };
  d.production = { dailyProductionM3d: 600, operatingHours: 20, peakFactor: 1, recoveryPct: 75, permeateFlowOverrideM3h: null };
  d.water = {
    source: 'well', tds: 2550, temperature: 28, ph: 7.4, hardness: 448, alkalinity: 250, calcium: 120, magnesium: 36, sodium: 706, potassium: 10,
    chloride: 900, sulfate: 450, nitrate: 10, fluoride: 0.8, silica: 25, iron: 0.25, manganese: 0.08, barium: 0.05, strontium: 1.5, turbidity: 2.5, sdi: 4.2,
    conductivity: 3900, freeChlorine: 0, toc: 1.2, feedPressureBar: null, boreholeDepth: 150, staticLevel: 35, dynamicLevel: 55, distanceToPlant: 250, elevationDifference: 5,
  };
  d.membrane = { membraneId, elementsPerVessel: 6, designFluxLmh: null, stages: null, vesselsPerStage: null };
  d.hydraulics = { feedPumpEnabled: true, productPumpEnabled: true, distributionFlowM3h: null, distributionHeadM: 30, frictionMethod: 'darcy', pipes: {}, pumps: {} };
  d.pretreatment = { overrides: {}, scaleControl: 'auto', postDisinfection: 'uv_chlorination', cip: true, antiscalantDoseMgL: null };
  d.tanks = { rawStorageHours: 2, permeateStorageHours: 4, peakDemandM3h: 40, peakDurationH: 3, rejectRecovery: false, rejectStorageHours: null };
  return d;
}

/**
 * Fill fields added in later versions so that projects saved by older versions
 * load and calculate. Never changes values the user entered.
 */
export function normalizeDesign(d: DesignInput): DesignInput {
  const b = blankDesign(d.assumptions ?? defaultAssumptions(), d.membrane?.membraneId ?? null);
  return {
    ...b,
    ...d,
    project: { ...b.project, ...d.project },
    production: { ...b.production, ...d.production },
    water: { ...EMPTY_WATER, ...d.water },
    membrane: { ...b.membrane, ...d.membrane, vesselsPerStage: d.membrane?.vesselsPerStage ?? null },
    hydraulics: { ...b.hydraulics, ...d.hydraulics, frictionMethod: d.hydraulics?.frictionMethod ?? 'darcy', pipes: d.hydraulics?.pipes ?? {}, pumps: d.hydraulics?.pumps ?? {} },
    pretreatment: { ...b.pretreatment, ...d.pretreatment, overrides: d.pretreatment?.overrides ?? {}, antiscalantDoseMgL: d.pretreatment?.antiscalantDoseMgL ?? null },
    tanks: { ...b.tanks, ...d.tanks },
    bomOverrides: d.bomOverrides ?? {},
    customBom: d.customBom ?? [],
    costing: { ...b.costing, ...d.costing },
    assumptions: d.assumptions ?? b.assumptions,
  };
}
