import type { Assumptions } from './assumptions';

/** Optional numeric value – null means "not measured / not entered". */
export type Num = number | null;

export type WaterSource = 'well' | 'surface' | 'municipal' | 'seawater_well' | 'seawater_open';

export const WATER_SOURCE_LABELS: Record<WaterSource, string> = {
  well: 'Well / borehole (groundwater)',
  surface: 'Surface water (river, lake, dam)',
  municipal: 'Municipal / treated supply',
  seawater_well: 'Seawater – beach well',
  seawater_open: 'Seawater – open intake',
};

export interface ProjectInfo {
  name: string;
  customer: string;
  location: string;
  designer: string;
  date: string;
  reference: string;
  notes: string;
}

export interface ProductionInput {
  dailyProductionM3d: number;
  operatingHours: number;
  peakFactor: number;
  recoveryPct: number;
  /** Optional manual override of the design permeate flow. */
  permeateFlowOverrideM3h: Num;
}

export interface RawWaterInput {
  source: WaterSource;
  tds: Num;
  temperature: Num;
  ph: Num;
  hardness: Num;
  alkalinity: Num;
  calcium: Num;
  magnesium: Num;
  sodium: Num;
  potassium: Num;
  chloride: Num;
  sulfate: Num;
  nitrate: Num;
  fluoride: Num;
  silica: Num;
  iron: Num;
  manganese: Num;
  barium: Num;
  strontium: Num;
  turbidity: Num;
  sdi: Num;
  conductivity: Num;
  freeChlorine: Num;
  toc: Num;
  feedPressureBar: Num;
  boreholeDepth: Num;
  staticLevel: Num;
  dynamicLevel: Num;
  distanceToPlant: Num;
  elevationDifference: Num;
}

export interface WaterParamDef {
  key: keyof RawWaterInput;
  label: string;
  unit: string;
  /** 'required' = needed for a reliable design; 'recommended' = improves design; 'optional'. */
  importance: 'required' | 'recommended' | 'optional';
  group: 'Chemistry' | 'Physical' | 'Site / Hydraulic';
}

export const WATER_PARAMS: WaterParamDef[] = [
  { key: 'tds', label: 'TDS', unit: 'mg/L', importance: 'required', group: 'Chemistry' },
  { key: 'conductivity', label: 'Conductivity', unit: 'µS/cm', importance: 'recommended', group: 'Chemistry' },
  { key: 'temperature', label: 'Temperature', unit: '°C', importance: 'required', group: 'Physical' },
  { key: 'ph', label: 'pH', unit: '–', importance: 'required', group: 'Chemistry' },
  { key: 'hardness', label: 'Total hardness', unit: 'mg/L as CaCO3', importance: 'required', group: 'Chemistry' },
  { key: 'alkalinity', label: 'Alkalinity (M)', unit: 'mg/L as CaCO3', importance: 'required', group: 'Chemistry' },
  { key: 'calcium', label: 'Calcium (Ca)', unit: 'mg/L', importance: 'required', group: 'Chemistry' },
  { key: 'magnesium', label: 'Magnesium (Mg)', unit: 'mg/L', importance: 'required', group: 'Chemistry' },
  { key: 'sodium', label: 'Sodium (Na)', unit: 'mg/L', importance: 'recommended', group: 'Chemistry' },
  { key: 'potassium', label: 'Potassium (K)', unit: 'mg/L', importance: 'optional', group: 'Chemistry' },
  { key: 'chloride', label: 'Chloride (Cl)', unit: 'mg/L', importance: 'required', group: 'Chemistry' },
  { key: 'sulfate', label: 'Sulfate (SO4)', unit: 'mg/L', importance: 'required', group: 'Chemistry' },
  { key: 'nitrate', label: 'Nitrate (NO3)', unit: 'mg/L', importance: 'optional', group: 'Chemistry' },
  { key: 'fluoride', label: 'Fluoride (F)', unit: 'mg/L', importance: 'optional', group: 'Chemistry' },
  { key: 'silica', label: 'Silica (SiO2)', unit: 'mg/L', importance: 'required', group: 'Chemistry' },
  { key: 'iron', label: 'Iron (Fe)', unit: 'mg/L', importance: 'required', group: 'Chemistry' },
  { key: 'manganese', label: 'Manganese (Mn)', unit: 'mg/L', importance: 'required', group: 'Chemistry' },
  { key: 'barium', label: 'Barium (Ba)', unit: 'mg/L', importance: 'recommended', group: 'Chemistry' },
  { key: 'strontium', label: 'Strontium (Sr)', unit: 'mg/L', importance: 'recommended', group: 'Chemistry' },
  { key: 'freeChlorine', label: 'Free chlorine', unit: 'mg/L', importance: 'recommended', group: 'Chemistry' },
  { key: 'toc', label: 'TOC', unit: 'mg/L', importance: 'recommended', group: 'Chemistry' },
  { key: 'turbidity', label: 'Turbidity', unit: 'NTU', importance: 'required', group: 'Physical' },
  { key: 'sdi', label: 'SDI15', unit: '–', importance: 'required', group: 'Physical' },
  { key: 'feedPressureBar', label: 'Available feed pressure at source', unit: 'bar', importance: 'optional', group: 'Site / Hydraulic' },
  { key: 'boreholeDepth', label: 'Borehole depth', unit: 'm', importance: 'optional', group: 'Site / Hydraulic' },
  { key: 'staticLevel', label: 'Static water level (below ground)', unit: 'm', importance: 'optional', group: 'Site / Hydraulic' },
  { key: 'dynamicLevel', label: 'Dynamic (pumping) water level', unit: 'm', importance: 'optional', group: 'Site / Hydraulic' },
  { key: 'distanceToPlant', label: 'Distance borehole → plant', unit: 'm', importance: 'optional', group: 'Site / Hydraulic' },
  { key: 'elevationDifference', label: 'Elevation difference (plant above wellhead)', unit: 'm', importance: 'optional', group: 'Site / Hydraulic' },
];

export interface MembraneDesignInput {
  membraneId: number | null;
  elementsPerVessel: number | null;
  /** null = use the design-flux assumption for the selected water source */
  designFluxLmh: Num;
  /** null = automatic staging from recovery */
  stages: number | null;
  /** Manual array: number of vessels in each stage, e.g. [5, 2]. null = automatic. */
  vesselsPerStage: number[] | null;
}

export type PipeSectionId =
  | 'borehole_to_raw_tank'
  | 'raw_tank_to_pretreatment'
  | 'pretreatment_to_cartridge'
  | 'cartridge_to_hp'
  | 'hp_to_ro'
  | 'permeate_to_tank'
  | 'reject_to_drain'
  | 'product_to_distribution';

export type FittingType =
  | 'elbow90' | 'elbow45' | 'tee_line' | 'tee_branch' | 'gate_valve' | 'ball_valve' | 'butterfly_valve' | 'globe_valve' | 'check_valve' | 'strainer' | 'entrance' | 'exit';

export const FITTING_LABELS: Record<FittingType, string> = {
  elbow90: '90° elbow', elbow45: '45° elbow', tee_line: 'Tee (run)', tee_branch: 'Tee (branch)', gate_valve: 'Gate valve', ball_valve: 'Ball valve',
  butterfly_valve: 'Butterfly valve', globe_valve: 'Globe valve', check_valve: 'Check valve', strainer: 'Strainer / foot valve', entrance: 'Entrance', exit: 'Exit',
};

export interface PipeSectionOverride {
  material?: string;
  maxVelocity?: number;
  lengthM?: number;
  elevationM?: number;
  designPressureBar?: number;
  /** Force a nominal diameter instead of sizing from velocity. */
  dn?: number;
  /** Fitting counts – replaces the default fitting set of the section when given. */
  fittings?: Partial<Record<FittingType, number>>;
}

export type PumpDutyId = 'raw' | 'feed' | 'hp' | 'product' | 'cip';

export interface PumpDutyOverride {
  /** Pump selected from the Pump Library (with manufacturer curve) for operating-point check. */
  libraryPumpId?: number | null;
  /** Pump efficiency at duty point, % (overrides the assumption). */
  efficiencyPct?: number;
  /** Design flow override, m³/h. */
  flowM3h?: number;
  /** Additional equipment/valve loss, bar (e.g. flow meter, control valve, strainer). */
  extraLossBar?: number;
}

export interface HydraulicsInput {
  feedPumpEnabled: boolean;
  productPumpEnabled: boolean;
  distributionFlowM3h: Num;
  distributionHeadM: number;
  frictionMethod: 'darcy' | 'hazen';
  pipes: Partial<Record<PipeSectionId, PipeSectionOverride>>;
  pumps: Partial<Record<PumpDutyId, PumpDutyOverride>>;
}

export type PretreatmentItemId =
  | 'raw_tank'
  | 'coagulation'
  | 'sand_filter'
  | 'mmf'
  | 'iron_removal'
  | 'manganese_removal'
  | 'acf'
  | 'softener'
  | 'antiscalant'
  | 'acid'
  | 'smbs'
  | 'prechlorination'
  | 'cartridge'
  | 'uv'
  | 'post_chlorination'
  | 'remineralization';

export type ItemOverride = 'auto' | 'include' | 'exclude';

export interface PretreatmentInput {
  overrides: Partial<Record<PretreatmentItemId, ItemOverride>>;
  scaleControl: 'auto' | 'antiscalant' | 'antiscalant_acid' | 'softener';
  postDisinfection: 'none' | 'uv' | 'chlorination' | 'uv_chlorination';
  cip: boolean;
  /** Antiscalant dose from the supplier's projection, mg/L as product. null = not yet confirmed. */
  antiscalantDoseMgL: Num;
}

export interface TankInput {
  rawStorageHours: Num;
  permeateStorageHours: Num;
  peakDemandM3h: Num;
  peakDurationH: number;
  rejectRecovery: boolean;
  rejectStorageHours: Num;
}

export interface BomOverride {
  description?: string;
  specification?: string;
  quantity?: number;
  unit?: string;
  notes?: string;
  unitCost?: number;
  removed?: boolean;
}

export interface CustomBomLine {
  id: string;
  category: string;
  item: string;
  description: string;
  specification: string;
  quantity: number;
  unit: string;
  notes: string;
  unitCost: number;
  costCategory: CostCategory;
}

export type CostCategory = 'equipment' | 'piping' | 'electrical' | 'instrumentation';

export interface CostingInput {
  enabled: boolean;
  currency: string;
  installationPct: number;
  engineeringPct: number;
  contingencyPct: number;
}

/** Full project design input as stored in the local database. */
export interface DesignInput {
  project: ProjectInfo;
  production: ProductionInput;
  water: RawWaterInput;
  membrane: MembraneDesignInput;
  hydraulics: HydraulicsInput;
  pretreatment: PretreatmentInput;
  tanks: TankInput;
  bomOverrides: Record<string, BomOverride>;
  customBom: CustomBomLine[];
  costing: CostingInput;
  assumptions: Assumptions;
}

// ------------------------------------------------------------------ Library records

export interface MembraneSpec {
  id: number;
  manufacturer: string;
  model: string;
  membraneType: string;
  diameterIn: number;
  activeAreaM2: Num;
  nominalFlowM3d: Num;
  saltRejectionPct: Num;
  maxPressureBar: Num;
  maxTempC: Num;
  phMin: Num;
  phMax: Num;
  testPressureBar: Num;
  testTdsMgL: Num;
  testRecoveryPct: Num;
  maxFeedFlowM3h: Num;
  /** Recommended operating range */
  recFluxMinLmh: Num;
  recFluxMaxLmh: Num;
  maxElementRecoveryPct: Num;
  minConcentrateM3h: Num;
  maxElementDpBar: Num;
  /** DEMO = sample values, not a manufacturer datasheet */
  isDemo: boolean;
  dataSource: string;
  notes: string;
}

export type PumpType = 'borehole' | 'feed' | 'high_pressure' | 'product' | 'cip' | 'dosing';

export interface PumpCurvePoint {
  flowM3h: number;
  headM: number;
  efficiencyPct: number | null;
  npshrM: number | null;
}

export interface PumpSpec {
  id: number;
  pumpType: PumpType;
  manufacturer: string;
  model: string;
  ratedFlowM3h: number;
  ratedHeadM: number;
  minFlowM3h: number;
  maxFlowM3h: number;
  shutoffHeadM: number;
  motorKw: number;
  efficiencyPct: number;
  /** Manufacturer curve entered by the user (flow, head, efficiency, NPSHr). */
  curve: PumpCurvePoint[];
  isDemo: boolean;
  notes: string;
}

export interface PipeSize {
  id: number;
  material: string;
  dn: number;
  outerDiameterMm: number;
  wallMm: number;
  innerDiameterMm: number;
  pressureRatingBar: number;
}

export interface PipeMaterial {
  name: string;
  roughnessMm: number;
  hazenC: number;
  description: string;
}

export interface DesignContext {
  membrane: MembraneSpec | null;
  pipeSizes: PipeSize[];
  pipeMaterials: PipeMaterial[];
  pumps: PumpSpec[];
}
