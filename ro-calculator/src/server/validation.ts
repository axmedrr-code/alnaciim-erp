import { z } from 'zod';

const num = z.number().finite();
const nnum = num.nullable();

const water = z.object({
  source: z.enum(['well', 'surface', 'municipal', 'seawater_well', 'seawater_open']),
  tds: nnum, temperature: nnum, ph: nnum, hardness: nnum, alkalinity: nnum, calcium: nnum, magnesium: nnum, sodium: nnum, potassium: nnum,
  chloride: nnum, sulfate: nnum, nitrate: nnum, fluoride: nnum, silica: nnum, iron: nnum, manganese: nnum, barium: nnum, strontium: nnum,
  turbidity: nnum, sdi: nnum, conductivity: nnum, freeChlorine: nnum, toc: nnum, feedPressureBar: nnum, boreholeDepth: nnum, staticLevel: nnum,
  dynamicLevel: nnum, distanceToPlant: nnum, elevationDifference: nnum,
});

const fittingType = z.enum(['elbow90', 'elbow45', 'tee_line', 'tee_branch', 'gate_valve', 'ball_valve', 'butterfly_valve', 'globe_valve', 'check_valve', 'strainer', 'entrance', 'exit']);
const pipeOverride = z.object({
  material: z.string().optional(), maxVelocity: num.optional(), lengthM: num.optional(), elevationM: num.optional(), designPressureBar: num.optional(),
  dn: num.optional(), fittings: z.partialRecord(fittingType, num.nonnegative()).optional(),
});
const pumpOverride = z.object({ libraryPumpId: z.number().int().nullable().optional(), efficiencyPct: num.optional(), flowM3h: num.optional(), extraLossBar: num.optional() });

const override = z.enum(['auto', 'include', 'exclude']);

export const designInputSchema = z.object({
  project: z.object({
    name: z.string().trim().min(1, 'Project name is required').max(200),
    customer: z.string().max(200), location: z.string().max(200), designer: z.string().max(200), date: z.string().max(40), reference: z.string().max(100),
    notes: z.string().max(5000),
  }),
  production: z.object({ dailyProductionM3d: num, operatingHours: num, peakFactor: num, recoveryPct: num, permeateFlowOverrideM3h: nnum }),
  water,
  membrane: z.object({ membraneId: z.number().int().nullable(), elementsPerVessel: z.number().int().nullable(), designFluxLmh: nnum, stages: z.number().int().nullable(), vesselsPerStage: z.array(z.number().int()).nullable().default(null) }),
  hydraulics: z.object({
    feedPumpEnabled: z.boolean(), productPumpEnabled: z.boolean(), distributionFlowM3h: nnum, distributionHeadM: num,
    frictionMethod: z.enum(['darcy', 'hazen']).default('darcy'),
    pipes: z.record(z.string(), pipeOverride),
    pumps: z.record(z.string(), pumpOverride).default({}),
  }),
  pretreatment: z.object({
    overrides: z.record(z.string(), override),
    scaleControl: z.enum(['auto', 'antiscalant', 'antiscalant_acid', 'softener']),
    postDisinfection: z.enum(['none', 'uv', 'chlorination', 'uv_chlorination']),
    cip: z.boolean(),
    antiscalantDoseMgL: nnum.default(null),
  }),
  tanks: z.object({ rawStorageHours: nnum, permeateStorageHours: nnum, peakDemandM3h: nnum, peakDurationH: num, rejectRecovery: z.boolean(), rejectStorageHours: nnum }),
  bomOverrides: z.record(
    z.string(),
    z.object({ description: z.string().optional(), specification: z.string().optional(), quantity: num.optional(), unit: z.string().optional(), notes: z.string().optional(), unitCost: num.optional(), removed: z.boolean().optional() }),
  ),
  customBom: z.array(
    z.object({
      id: z.string(), category: z.string(), item: z.string(), description: z.string(), specification: z.string(), quantity: num, unit: z.string(), notes: z.string(),
      unitCost: num, costCategory: z.enum(['equipment', 'piping', 'electrical', 'instrumentation']),
    }),
  ),
  costing: z.object({ enabled: z.boolean(), currency: z.string().max(10), installationPct: num, engineeringPct: num, contingencyPct: num }),
  assumptions: z.record(z.string(), z.union([num, z.array(num)])),
});

export const membraneSchema = z.object({
  manufacturer: z.string().trim().min(1), model: z.string().trim().min(1), membraneType: z.string().trim().min(1), diameterIn: num.positive(),
  activeAreaM2: nnum, nominalFlowM3d: nnum, saltRejectionPct: nnum, maxPressureBar: nnum, maxTempC: nnum, phMin: nnum, phMax: nnum,
  testPressureBar: nnum, testTdsMgL: nnum, testRecoveryPct: nnum, maxFeedFlowM3h: nnum,
  recFluxMinLmh: nnum.default(null), recFluxMaxLmh: nnum.default(null), maxElementRecoveryPct: nnum.default(null), minConcentrateM3h: nnum.default(null), maxElementDpBar: nnum.default(null),
  isDemo: z.boolean().default(false), dataSource: z.string().default(''), notes: z.string().default(''),
});

export const pumpSchema = z.object({
  pumpType: z.enum(['borehole', 'feed', 'high_pressure', 'product', 'cip', 'dosing']), manufacturer: z.string().trim().min(1), model: z.string().trim().min(1),
  ratedFlowM3h: num.positive(), ratedHeadM: num.positive(), minFlowM3h: num.nonnegative(), maxFlowM3h: num.positive(), shutoffHeadM: num.positive(),
  motorKw: num.positive(), efficiencyPct: num.positive().max(100), notes: z.string().default(''),
  isDemo: z.boolean().default(false),
  curve: z.array(z.object({ flowM3h: num.nonnegative(), headM: num.nonnegative(), efficiencyPct: nnum.default(null), npshrM: nnum.default(null) })).default([]),
}).refine((p) => p.curve.every((c, i, a) => i === 0 || c.flowM3h > a[i - 1].flowM3h), { message: 'Curve points must be in increasing flow order' }).refine((p) => p.shutoffHeadM >= p.ratedHeadM, { message: 'Shut-off head must be ≥ rated head' }).refine((p) => p.minFlowM3h <= p.ratedFlowM3h && p.ratedFlowM3h <= p.maxFlowM3h, { message: 'Flow range must satisfy min ≤ rated ≤ max' });

export const pipeSizeSchema = z.object({
  material: z.string().trim().min(1), dn: z.number().int().positive(), outerDiameterMm: num.positive(), wallMm: num.positive(), innerDiameterMm: num.positive(), pressureRatingBar: num.positive(),
}).refine((p) => p.innerDiameterMm < p.outerDiameterMm, { message: 'Inner diameter must be smaller than outer diameter' });

export const pipeMaterialSchema = z.object({ name: z.string().trim().min(1), roughnessMm: num.nonnegative(), hazenC: num.positive().default(140), description: z.string().default('') });

export const settingsSchema = z.object({
  assumptions: z.record(z.string(), z.union([num, z.array(num)])).optional(),
  units: z.object({ flow: z.enum(['m3/h', 'm3/day', 'L/h', 'L/min', 'gpm']), pressure: z.enum(['bar', 'psi', 'kPa', 'm']), power: z.enum(['kW', 'HP']) }).optional(),
  company: z.object({ name: z.string(), address: z.string(), phone: z.string(), email: z.string() }).optional(),
});

export const exportFileSchema = z.object({
  format: z.literal('ro-calculator-project'),
  version: z.number(),
  exportedAt: z.string().optional(),
  project: designInputSchema,
  membrane: membraneSchema.nullable().optional(),
});
