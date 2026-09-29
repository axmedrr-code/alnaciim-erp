import { integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const projects = sqliteTable('projects', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  customer: text('customer').notNull().default(''),
  location: text('location').notNull().default(''),
  reference: text('reference').notNull().default(''),
  /** Full DesignInput as JSON */
  data: text('data').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const membranes = sqliteTable('membranes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  manufacturer: text('manufacturer').notNull(),
  model: text('model').notNull(),
  membraneType: text('membrane_type').notNull().default('BWRO'),
  diameterIn: real('diameter_in').notNull().default(8),
  activeAreaM2: real('active_area_m2'),
  nominalFlowM3d: real('nominal_flow_m3d'),
  saltRejectionPct: real('salt_rejection_pct'),
  maxPressureBar: real('max_pressure_bar'),
  maxTempC: real('max_temp_c'),
  phMin: real('ph_min'),
  phMax: real('ph_max'),
  testPressureBar: real('test_pressure_bar'),
  testTdsMgL: real('test_tds_mg_l'),
  testRecoveryPct: real('test_recovery_pct'),
  maxFeedFlowM3h: real('max_feed_flow_m3h'),
  recFluxMinLmh: real('rec_flux_min_lmh'),
  recFluxMaxLmh: real('rec_flux_max_lmh'),
  maxElementRecoveryPct: real('max_element_recovery_pct'),
  minConcentrateM3h: real('min_concentrate_m3h'),
  maxElementDpBar: real('max_element_dp_bar'),
  isDemo: integer('is_demo', { mode: 'boolean' }).notNull().default(false),
  dataSource: text('data_source').notNull().default(''),
  notes: text('notes').notNull().default(''),
  builtin: integer('builtin', { mode: 'boolean' }).notNull().default(false),
});

export const pumps = sqliteTable('pumps', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  pumpType: text('pump_type').notNull(),
  manufacturer: text('manufacturer').notNull(),
  model: text('model').notNull(),
  ratedFlowM3h: real('rated_flow_m3h').notNull(),
  ratedHeadM: real('rated_head_m').notNull(),
  minFlowM3h: real('min_flow_m3h').notNull(),
  maxFlowM3h: real('max_flow_m3h').notNull(),
  shutoffHeadM: real('shutoff_head_m').notNull(),
  motorKw: real('motor_kw').notNull(),
  efficiencyPct: real('efficiency_pct').notNull(),
  /** JSON array of {flowM3h, headM, efficiencyPct, npshrM} */
  curve: text('curve', { mode: 'json' }).$type<{ flowM3h: number; headM: number; efficiencyPct: number | null; npshrM: number | null }[]>().notNull().default([]),
  isDemo: integer('is_demo', { mode: 'boolean' }).notNull().default(false),
  notes: text('notes').notNull().default(''),
  builtin: integer('builtin', { mode: 'boolean' }).notNull().default(false),
});

export const pipeMaterials = sqliteTable('pipe_materials', {
  name: text('name').primaryKey(),
  roughnessMm: real('roughness_mm').notNull(),
  hazenC: real('hazen_c').notNull().default(140),
  description: text('description').notNull().default(''),
});

export const pipeSizes = sqliteTable(
  'pipe_sizes',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    material: text('material').notNull(),
    dn: integer('dn').notNull(),
    outerDiameterMm: real('outer_diameter_mm').notNull(),
    wallMm: real('wall_mm').notNull(),
    innerDiameterMm: real('inner_diameter_mm').notNull(),
    pressureRatingBar: real('pressure_rating_bar').notNull(),
  },
  (t) => [uniqueIndex('pipe_sizes_material_dn').on(t.material, t.dn)],
);

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});
