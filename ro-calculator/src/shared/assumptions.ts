/**
 * Central register of engineering design assumptions.
 *
 * Every number the calculation engine uses that is NOT a user input or a
 * physical constant lives here, with a label, unit and explanation.
 * Global defaults are stored in the local database (Settings) and every
 * project keeps its own editable copy, so nothing is hidden inside code.
 */

export type AssumptionGroup =
  | 'Production & Recovery'
  | 'Membrane Design'
  | 'Pumps'
  | 'Pressure Losses'
  | 'Pipe Velocities'
  | 'Pretreatment Triggers'
  | 'Filter Design'
  | 'Chemical Dosing'
  | 'Tanks'
  | 'Electrical'
  | 'Water Chemistry'
  | 'Standard Sizes';

export interface AssumptionDef {
  key: string;
  label: string;
  unit: string;
  group: AssumptionGroup;
  default: number | number[];
  description: string;
  min?: number;
  max?: number;
}

export const ASSUMPTION_DEFS: AssumptionDef[] = [
  // ---------------- Production & Recovery ----------------
  { key: 'recovery_max_1stage', label: 'Max recovery for 1-stage array', unit: '%', group: 'Production & Recovery', default: 50, description: 'Above this recovery the auto-array design uses 2 stages (6-element vessels).' },
  { key: 'recovery_max_2stage', label: 'Max recovery for 2-stage array', unit: '%', group: 'Production & Recovery', default: 75, description: 'Above this recovery the auto-array design uses 3 stages.' },
  { key: 'recovery_limit_brackish', label: 'Absolute recovery limit – brackish/fresh water', unit: '%', group: 'Production & Recovery', default: 85, description: 'Recovery above this is flagged critical for well, surface or municipal water.' },
  { key: 'recovery_limit_seawater', label: 'Absolute recovery limit – seawater', unit: '%', group: 'Production & Recovery', default: 50, description: 'Recovery above this is flagged critical for seawater sources (osmotic pressure limit).' },
  { key: 'raw_flow_factor', label: 'Raw water flow factor (backwash/flush allowance)', unit: '×', group: 'Production & Recovery', default: 1.1, description: 'Raw water pump flow = RO feed flow × this factor, to cover filter backwash, rinse and RO flushing water.' },

  // ---------------- Membrane Design ----------------
  { key: 'flux_well_design', label: 'Design flux – well water (SDI < 3)', unit: 'LMH', group: 'Membrane Design', default: 22, description: 'Typical conservative average flux for groundwater. Industry guideline range 20–28 LMH.' },
  { key: 'flux_well_max', label: 'Max flux – well water', unit: 'LMH', group: 'Membrane Design', default: 28, description: 'Flux above this is flagged critical for well water.' },
  { key: 'flux_surface_design', label: 'Design flux – surface water', unit: 'LMH', group: 'Membrane Design', default: 17, description: 'Surface water with conventional pretreatment (SDI < 5). Guideline 15–20 LMH.' },
  { key: 'flux_surface_max', label: 'Max flux – surface water', unit: 'LMH', group: 'Membrane Design', default: 21, description: 'Flux above this is flagged critical for surface water.' },
  { key: 'flux_municipal_design', label: 'Design flux – municipal / treated water', unit: 'LMH', group: 'Membrane Design', default: 24, description: 'Treated municipal supply. Guideline 21–30 LMH.' },
  { key: 'flux_municipal_max', label: 'Max flux – municipal water', unit: 'LMH', group: 'Membrane Design', default: 30, description: 'Flux above this is flagged critical for municipal water.' },
  { key: 'flux_seawater_well_design', label: 'Design flux – seawater beach well', unit: 'LMH', group: 'Membrane Design', default: 14, description: 'Seawater from beach wells. Guideline 13–17 LMH.' },
  { key: 'flux_seawater_well_max', label: 'Max flux – seawater beach well', unit: 'LMH', group: 'Membrane Design', default: 17, description: 'Flux above this is flagged critical.' },
  { key: 'flux_seawater_open_design', label: 'Design flux – seawater open intake', unit: 'LMH', group: 'Membrane Design', default: 12, description: 'Open intake seawater. Guideline 11–14 LMH.' },
  { key: 'flux_seawater_open_max', label: 'Max flux – seawater open intake', unit: 'LMH', group: 'Membrane Design', default: 14, description: 'Flux above this is flagged critical.' },
  { key: 'elements_per_vessel', label: 'Default elements per pressure vessel', unit: 'pcs', group: 'Membrane Design', default: 6, description: 'Used when the project does not specify elements per vessel. Common: 6 (large), 3–4 (small systems).' },
  { key: 'tcf_constant', label: 'Temperature correction constant K', unit: 'K', group: 'Membrane Design', default: 2640, description: 'TCF = exp(K·(1/298.15 − 1/(273.15+T))). Typical polyamide value 2640–3020.' },
  { key: 'fouling_factor', label: 'Fouling / flux decline factor', unit: '×', group: 'Membrane Design', default: 0.85, description: 'Permeability multiplier for membrane ageing and fouling (1.0 = new clean membrane).' },
  { key: 'concentration_polarization', label: 'Concentration polarisation factor β', unit: '×', group: 'Membrane Design', default: 1.1, description: 'Increase of salt concentration at the membrane surface vs. bulk.' },
  { key: 'element_dp_bar', label: 'Pressure drop per element (average)', unit: 'bar', group: 'Membrane Design', default: 0.2, description: 'Feed–concentrate pressure drop per 8" element in series. Typical 0.1–0.3 bar.' },
  { key: 'test_element_dp_bar', label: 'Pressure drop of single element at test conditions', unit: 'bar', group: 'Membrane Design', default: 0.15, description: 'Used to derive water permeability from datasheet test conditions.' },
  { key: 'salt_passage_aging_factor', label: 'Salt passage ageing factor', unit: '×', group: 'Membrane Design', default: 1.15, description: 'Multiplier on estimated salt passage for membrane ageing (≈ 3 years at 5 %/yr).' },
  { key: 'max_feed_per_vessel', label: 'Max feed flow per 8" vessel', unit: 'm³/h', group: 'Membrane Design', default: 16, description: 'Upper limit of feed flow into one 8" pressure vessel (manufacturer guideline ≈ 14–17 m³/h).' },
  { key: 'min_concentrate_per_vessel', label: 'Min concentrate flow per 8" vessel', unit: 'm³/h', group: 'Membrane Design', default: 3.0, description: 'Minimum concentrate flow leaving one 8" vessel to limit polarisation (guideline 2.7–3.6 m³/h).' },
  { key: 'max_element_recovery', label: 'Max average element recovery', unit: '%', group: 'Membrane Design', default: 18, description: 'Average single-element recovery limit (guideline 15–18 %).' },
  { key: 'permeate_backpressure_bar', label: 'Permeate back-pressure', unit: 'bar', group: 'Membrane Design', default: 0.5, description: 'Pressure in the permeate line (lifting to product tank, instruments).' },

  // ---------------- Pumps ----------------
  { key: 'raw_pump_eff', label: 'Raw water (borehole) pump efficiency', unit: '%', group: 'Pumps', default: 65, description: 'Hydraulic efficiency of the submersible borehole pump at duty point.' },
  { key: 'feed_pump_eff', label: 'Feed / booster pump efficiency', unit: '%', group: 'Pumps', default: 65, description: 'Hydraulic efficiency of the pretreatment feed pump.' },
  { key: 'hp_pump_eff', label: 'High-pressure pump efficiency', unit: '%', group: 'Pumps', default: 75, description: 'Hydraulic efficiency of the multistage HP pump.' },
  { key: 'product_pump_eff', label: 'Product / distribution pump efficiency', unit: '%', group: 'Pumps', default: 65, description: 'Hydraulic efficiency of the product transfer pump.' },
  { key: 'cip_pump_eff', label: 'CIP pump efficiency', unit: '%', group: 'Pumps', default: 60, description: 'Hydraulic efficiency of the cleaning pump.' },
  { key: 'motor_eff', label: 'Motor efficiency', unit: '%', group: 'Pumps', default: 92, description: 'Electric motor efficiency (IE3 typical 88–95 %).' },
  { key: 'motor_service_factor', label: 'Motor sizing factor', unit: '×', group: 'Pumps', default: 1.15, description: 'Motor rated power ≥ pump shaft power × this factor, then next standard IEC size.' },
  { key: 'head_safety_margin', label: 'Pump head safety margin', unit: '%', group: 'Pumps', default: 10, description: 'Added to calculated total dynamic head / differential pressure.' },
  { key: 'flow_safety_margin', label: 'Pump flow safety margin', unit: '%', group: 'Pumps', default: 5, description: 'Added to design flow for pump rating.' },
  { key: 'well_submergence_m', label: 'Pump setting below dynamic water level', unit: 'm', group: 'Pumps', default: 10, description: 'Submersible pump is installed this far below the dynamic level (used for riser pipe length).' },
  { key: 'raw_tank_inlet_height_m', label: 'Raw water tank inlet height above ground', unit: 'm', group: 'Pumps', default: 4, description: 'Static lift at the plant end of the borehole line.' },
  { key: 'hp_min_suction_bar', label: 'Required HP pump suction pressure', unit: 'bar', group: 'Pumps', default: 1.5, description: 'Minimum positive pressure required at the HP pump inlet (NPSH / low-pressure switch).' },
  { key: 'cip_head_m', label: 'CIP pump head', unit: 'm', group: 'Pumps', default: 40, description: 'Typical CIP pump head (≈ 4 bar at vessel inlet).' },
  { key: 'cip_flow_per_vessel', label: 'CIP flow per 8" vessel', unit: 'm³/h', group: 'Pumps', default: 8, description: 'Cleaning flow per 8" pressure vessel (guideline 6.8–9.1 m³/h).' },
  { key: 'pump_eff_min_reasonable', label: 'Lowest reasonable pump efficiency', unit: '%', group: 'Pumps', default: 40, description: 'Efficiencies below this are flagged for review.' },
  { key: 'pump_eff_max_reasonable', label: 'Highest reasonable pump efficiency', unit: '%', group: 'Pumps', default: 88, description: 'Efficiencies above this are flagged for review (unrealistically optimistic).' },
  { key: 'pump_bep_min_ratio', label: 'Min duty flow / rated flow (library pumps)', unit: '×', group: 'Pumps', default: 0.7, description: 'Library pump is outside its reasonable range if duty flow / rated flow is below this.' },
  { key: 'pump_bep_max_ratio', label: 'Max duty flow / rated flow (library pumps)', unit: '×', group: 'Pumps', default: 1.2, description: 'Library pump is outside its reasonable range if duty flow / rated flow is above this.' },

  // ---------------- Pressure Losses ----------------
  { key: 'wellhead_strainer_loss_bar', label: 'Wellhead strainer / sand separator loss', unit: 'bar', group: 'Pressure Losses', default: 0.2, description: 'Filter loss on the raw water (borehole) pump line.' },
  { key: 'cartridge_dp_bar', label: 'Cartridge filter design pressure drop', unit: 'bar', group: 'Pressure Losses', default: 1.0, description: 'Design (dirty) pressure drop – replace cartridges at this value. Clean ≈ 0.2 bar.' },
  { key: 'mmf_dp_bar', label: 'Multimedia filter pressure drop', unit: 'bar', group: 'Pressure Losses', default: 0.5, description: 'Design pressure drop before backwash.' },
  { key: 'sand_dp_bar', label: 'Sand filter pressure drop', unit: 'bar', group: 'Pressure Losses', default: 0.5, description: 'Design pressure drop before backwash.' },
  { key: 'acf_dp_bar', label: 'Activated carbon filter pressure drop', unit: 'bar', group: 'Pressure Losses', default: 0.5, description: 'Design pressure drop.' },
  { key: 'iron_dp_bar', label: 'Iron / manganese filter pressure drop', unit: 'bar', group: 'Pressure Losses', default: 0.6, description: 'Design pressure drop.' },
  { key: 'softener_dp_bar', label: 'Softener pressure drop', unit: 'bar', group: 'Pressure Losses', default: 0.8, description: 'Design pressure drop incl. control valve.' },
  { key: 'uv_dp_bar', label: 'UV reactor pressure drop', unit: 'bar', group: 'Pressure Losses', default: 0.1, description: 'Pressure drop of UV unit on permeate line.' },
  { key: 'fittings_allowance', label: 'Fittings & valves allowance', unit: '%', group: 'Pressure Losses', default: 25, description: 'Minor losses (bends, tees, valves) as a percentage of straight-pipe friction loss.' },

  // ---------------- Pipe Velocities ----------------
  { key: 'vel_borehole', label: 'Max velocity: Borehole → Raw water tank', unit: 'm/s', group: 'Pipe Velocities', default: 1.5, description: 'Long transfer line – limited to control friction and surge.' },
  { key: 'vel_raw_to_pt', label: 'Max velocity: Raw tank → Pretreatment', unit: 'm/s', group: 'Pipe Velocities', default: 1.5, description: 'Includes feed pump suction side.' },
  { key: 'vel_pt_to_cf', label: 'Max velocity: Pretreatment → Cartridge filter', unit: 'm/s', group: 'Pipe Velocities', default: 2.0, description: 'Low-pressure pumped line.' },
  { key: 'vel_cf_to_hp', label: 'Max velocity: Cartridge filter → HP pump', unit: 'm/s', group: 'Pipe Velocities', default: 1.2, description: 'HP pump suction – kept low for NPSH.' },
  { key: 'vel_hp_to_ro', label: 'Max velocity: HP pump → RO', unit: 'm/s', group: 'Pipe Velocities', default: 2.5, description: 'High-pressure stainless line.' },
  { key: 'vel_permeate', label: 'Max velocity: Permeate → Product tank', unit: 'm/s', group: 'Pipe Velocities', default: 1.5, description: 'Low back-pressure required on permeate.' },
  { key: 'vel_reject', label: 'Max velocity: Reject → Drain/recovery', unit: 'm/s', group: 'Pipe Velocities', default: 2.0, description: 'After concentrate control valve.' },
  { key: 'vel_distribution', label: 'Max velocity: Product tank → Distribution', unit: 'm/s', group: 'Pipe Velocities', default: 1.5, description: 'Distribution/transfer line.' },
  { key: 'vel_critical', label: 'Critical velocity (any pipe)', unit: 'm/s', group: 'Pipe Velocities', default: 3.0, description: 'Velocities above this are flagged critical (erosion, water hammer).' },
  { key: 'vel_min', label: 'Minimum recommended velocity', unit: 'm/s', group: 'Pipe Velocities', default: 0.3, description: 'Velocities below this are flagged for review (oversized pipe, sedimentation).' },

  // ---------------- Pretreatment Triggers ----------------
  { key: 'turbidity_limit_mmf', label: 'Turbidity above which media filtration is required', unit: 'NTU', group: 'Pretreatment Triggers', default: 1, description: 'RO feed turbidity should be < 1 NTU.' },
  { key: 'sdi_limit_mmf', label: 'SDI above which media filtration is required', unit: '–', group: 'Pretreatment Triggers', default: 3, description: 'RO feed SDI15 should be < 3 (well) / < 5 absolute limit.' },
  { key: 'sdi_max_ro', label: 'Maximum SDI tolerated by RO', unit: '–', group: 'Pretreatment Triggers', default: 5, description: 'Raw SDI above this requires robust pretreatment; flagged critical.' },
  { key: 'turbidity_coagulation', label: 'Turbidity above which coagulation/clarification is required', unit: 'NTU', group: 'Pretreatment Triggers', default: 20, description: 'Above this, filters alone are not sufficient.' },
  { key: 'turbidity_roughing', label: 'Turbidity above which a roughing sand filter is recommended', unit: 'NTU', group: 'Pretreatment Triggers', default: 10, description: 'A sand filter ahead of the multimedia filter protects it from high solids load.' },
  { key: 'iron_limit', label: 'Iron limit in RO feed', unit: 'mg/L', group: 'Pretreatment Triggers', default: 0.1, description: 'Above this, iron removal is recommended (oxidised iron fouls membranes).' },
  { key: 'manganese_limit', label: 'Manganese limit in RO feed', unit: 'mg/L', group: 'Pretreatment Triggers', default: 0.05, description: 'Above this, manganese removal is recommended.' },
  { key: 'chlorine_limit', label: 'Free chlorine tolerated by polyamide RO', unit: 'mg/L', group: 'Pretreatment Triggers', default: 0.05, description: 'Polyamide membranes are chlorine intolerant; above this dechlorination is mandatory.' },
  { key: 'toc_limit_acf', label: 'TOC above which activated carbon is recommended', unit: 'mg/L', group: 'Pretreatment Triggers', default: 3, description: 'Organic load reduction.' },
  { key: 'lsi_limit_antiscalant', label: 'Max concentrate LSI with antiscalant', unit: '–', group: 'Pretreatment Triggers', default: 1.8, description: 'Typical antiscalant limit for CaCO3 (check your antiscalant supplier software).' },
  { key: 'caso4_limit_pct', label: 'Max CaSO4 saturation with antiscalant', unit: '%', group: 'Pretreatment Triggers', default: 230, description: 'Typical antiscalant limit for calcium sulfate.' },
  { key: 'silica_limit_pct', label: 'Max silica saturation in concentrate', unit: '%', group: 'Pretreatment Triggers', default: 100, description: 'Without silica-specific antiscalant.' },
  { key: 'baso4_limit_pct', label: 'Max BaSO4 saturation with antiscalant', unit: '%', group: 'Pretreatment Triggers', default: 6000, description: 'Typical antiscalant limit for barium sulfate (×60).' },
  { key: 'softener_max_permeate_m3h', label: 'Prefer softener (over acid) below permeate flow', unit: 'm³/h', group: 'Pretreatment Triggers', default: 10, description: 'Scale control strategy "auto": small plants use a softener, larger plants acid + antiscalant.' },

  // ---------------- Filter Design ----------------
  { key: 'mmf_rate', label: 'Multimedia filter loading rate', unit: 'm/h', group: 'Filter Design', default: 10, description: 'Filtration velocity (guideline 8–12 m/h).' },
  { key: 'sand_rate', label: 'Sand filter loading rate', unit: 'm/h', group: 'Filter Design', default: 10, description: 'Filtration velocity.' },
  { key: 'acf_rate', label: 'Activated carbon loading rate', unit: 'm/h', group: 'Filter Design', default: 10, description: 'Filtration velocity (guideline 8–12 m/h; EBCT ≥ 6 min).' },
  { key: 'iron_rate', label: 'Iron/manganese filter loading rate', unit: 'm/h', group: 'Filter Design', default: 8, description: 'Filtration velocity for catalytic media (guideline 5–12 m/h).' },
  { key: 'softener_rate', label: 'Softener service rate', unit: 'm/h', group: 'Filter Design', default: 20, description: 'Service velocity (guideline 15–30 m/h).' },
  { key: 'mmf_backwash_rate', label: 'Multimedia filter backwash rate', unit: 'm/h', group: 'Filter Design', default: 35, description: 'Backwash velocity.' },
  { key: 'acf_backwash_rate', label: 'Carbon filter backwash rate', unit: 'm/h', group: 'Filter Design', default: 25, description: 'Backwash velocity.' },
  { key: 'mmf_anthracite_depth', label: 'MMF anthracite depth', unit: 'm', group: 'Filter Design', default: 0.4, description: 'Top layer.' },
  { key: 'mmf_sand_depth', label: 'MMF sand depth', unit: 'm', group: 'Filter Design', default: 0.4, description: 'Middle layer.' },
  { key: 'mmf_gravel_depth', label: 'MMF gravel support depth', unit: 'm', group: 'Filter Design', default: 0.2, description: 'Support layer.' },
  { key: 'acf_bed_depth', label: 'Activated carbon bed depth', unit: 'm', group: 'Filter Design', default: 1.0, description: 'GAC bed depth.' },
  { key: 'iron_bed_depth', label: 'Iron/Mn media bed depth', unit: 'm', group: 'Filter Design', default: 0.8, description: 'Catalytic media depth.' },
  { key: 'softener_capacity_g_l', label: 'Softener resin operating capacity', unit: 'g CaCO3/L', group: 'Filter Design', default: 45, description: 'Operating exchange capacity at moderate salt dose.' },
  { key: 'softener_salt_g_l', label: 'Softener regeneration salt dose', unit: 'g NaCl/L resin', group: 'Filter Design', default: 150, description: 'Salt consumption per regeneration.' },
  { key: 'softener_cycle_h', label: 'Softener service cycle', unit: 'h', group: 'Filter Design', default: 24, description: 'Resin volume sized for this run length between regenerations.' },
  { key: 'max_vessel_diameter_mm', label: 'Maximum single filter vessel diameter', unit: 'mm', group: 'Filter Design', default: 2000, description: 'Above this multiple vessels in parallel are used.' },
  { key: 'cartridge_flow_per_40in', label: 'Cartridge loading per 40" element', unit: 'm³/h', group: 'Filter Design', default: 2.0, description: 'Flow per 40" long × 2.5" wound/melt-blown cartridge (≈ 0.5 m³/h per 10" equivalent).' },
  { key: 'cartridge_micron', label: 'Cartridge rating', unit: 'µm', group: 'Filter Design', default: 5, description: 'Nominal cartridge filtration rating before RO.' },
  { key: 'density_anthracite', label: 'Anthracite bulk density', unit: 'kg/m³', group: 'Filter Design', default: 750, description: 'For media weight.' },
  { key: 'density_sand', label: 'Filter sand bulk density', unit: 'kg/m³', group: 'Filter Design', default: 1500, description: 'For media weight.' },
  { key: 'density_gravel', label: 'Gravel bulk density', unit: 'kg/m³', group: 'Filter Design', default: 1600, description: 'For media weight.' },
  { key: 'density_gac', label: 'Activated carbon bulk density', unit: 'kg/m³', group: 'Filter Design', default: 480, description: 'For media weight.' },
  { key: 'density_iron_media', label: 'Catalytic iron media bulk density', unit: 'kg/m³', group: 'Filter Design', default: 1400, description: 'E.g. greensand / MnO2 media.' },
  { key: 'density_resin', label: 'Softener resin bulk density', unit: 'kg/m³', group: 'Filter Design', default: 820, description: 'Strong-acid cation resin.' },

  // ---------------- Chemical Dosing ----------------
  { key: 'antiscalant_dose', label: 'Antiscalant dose (as product)', unit: 'mg/L', group: 'Chemical Dosing', default: 3, description: 'Confirm with antiscalant supplier projection (typ. 2–5 mg/L).' },
  { key: 'antiscalant_density', label: 'Antiscalant product density', unit: 'kg/L', group: 'Chemical Dosing', default: 1.1, description: '' },
  { key: 'antiscalant_dilution', label: 'Antiscalant dilution in day tank', unit: '% v/v', group: 'Chemical Dosing', default: 10, description: 'Product fraction in dosing tank solution (100 = neat).' },
  { key: 'smbs_ratio', label: 'SMBS per mg/L free chlorine', unit: 'mg/mg', group: 'Chemical Dosing', default: 3, description: 'Stoichiometric 1.34; 3.0 used in practice.' },
  { key: 'smbs_margin', label: 'SMBS safety dose', unit: 'mg/L', group: 'Chemical Dosing', default: 1, description: 'Additional dose above chlorine demand.' },
  { key: 'smbs_purity', label: 'SMBS powder purity', unit: '%', group: 'Chemical Dosing', default: 97, description: '' },
  { key: 'smbs_solution', label: 'SMBS solution strength', unit: '% w/v', group: 'Chemical Dosing', default: 10, description: 'Prepared solution strength in the dosing tank.' },
  { key: 'acid_strength', label: 'Hydrochloric acid product strength', unit: '% w/w', group: 'Chemical Dosing', default: 33, description: 'HCl is preferred over H2SO4 to avoid increasing sulfate scaling.' },
  { key: 'acid_density', label: 'Hydrochloric acid product density', unit: 'kg/L', group: 'Chemical Dosing', default: 1.16, description: '' },
  { key: 'acid_dilution', label: 'Acid dilution in dosing tank', unit: '% v/v', group: 'Chemical Dosing', default: 100, description: '100 = dosed neat from the tank.' },
  { key: 'naocl_strength', label: 'Sodium hypochlorite strength', unit: '% w/w', group: 'Chemical Dosing', default: 12.5, description: 'Available chlorine in commercial product.' },
  { key: 'naocl_density', label: 'Sodium hypochlorite density', unit: 'kg/L', group: 'Chemical Dosing', default: 1.2, description: '' },
  { key: 'naocl_dilution', label: 'Hypochlorite dilution in dosing tank', unit: '% v/v', group: 'Chemical Dosing', default: 20, description: 'Product fraction in dosing tank solution.' },
  { key: 'prechlor_residual', label: 'Pre-chlorination residual target', unit: 'mg/L', group: 'Chemical Dosing', default: 0.5, description: 'Free chlorine residual after oxidation demand.' },
  { key: 'postchlor_dose', label: 'Post-chlorination dose', unit: 'mg/L', group: 'Chemical Dosing', default: 0.5, description: 'Permeate disinfection residual.' },
  { key: 'chemical_autonomy_days', label: 'Chemical tank autonomy', unit: 'days', group: 'Chemical Dosing', default: 7, description: 'Dosing tanks sized for this many operating days.' },
  { key: 'dosing_pump_margin', label: 'Dosing pump capacity factor', unit: '×', group: 'Chemical Dosing', default: 1.5, description: 'Dosing pump capacity ≥ required flow × this factor (stroke at ~65 %).' },

  // ---------------- Tanks ----------------
  { key: 'raw_storage_hours', label: 'Raw water tank storage time', unit: 'h', group: 'Tanks', default: 2, description: 'Default, can be changed per project.' },
  { key: 'permeate_storage_hours', label: 'Product (permeate) tank storage time', unit: 'h', group: 'Tanks', default: 4, description: 'Default, can be changed per project.' },
  { key: 'reject_storage_hours', label: 'Reject tank storage time', unit: 'h', group: 'Tanks', default: 2, description: 'Only when reject recovery/reuse is selected.' },
  { key: 'tank_freeboard', label: 'Tank freeboard / dead volume allowance', unit: '%', group: 'Tanks', default: 10, description: 'Added to calculated working volume.' },
  { key: 'tank_round_step_m3', label: 'Water tank size rounding step', unit: 'm³', group: 'Tanks', default: 1, description: 'Recommended volumes rounded up to this step.' },
  { key: 'cip_volume_per_element', label: 'CIP solution volume per 8" element', unit: 'L', group: 'Tanks', default: 38, description: 'Guideline ≈ 38 L (10 gal) per 8" element, plus piping.' },
  { key: 'cip_piping_allowance', label: 'CIP piping volume allowance', unit: '%', group: 'Tanks', default: 30, description: 'Added for hoses, filter housing and pipe volume.' },

  // ---------------- Electrical ----------------
  { key: 'supply_voltage', label: 'Supply voltage (3-phase)', unit: 'V', group: 'Electrical', default: 400, description: 'Line-to-line voltage.' },
  { key: 'power_factor', label: 'Power factor', unit: '–', group: 'Electrical', default: 0.85, description: 'Average motor power factor.' },
  { key: 'control_panel_kw', label: 'Control panel / PLC / instruments load', unit: 'kW', group: 'Electrical', default: 0.5, description: '' },
  { key: 'dosing_pump_kw', label: 'Load per dosing pump', unit: 'kW', group: 'Electrical', default: 0.06, description: 'Electronic diaphragm dosing pump.' },
  { key: 'uv_kw_per_m3h', label: 'UV power per m³/h', unit: 'kW/(m³/h)', group: 'Electrical', default: 0.03, description: 'Typical low-pressure UV at 40 mJ/cm².' },
  { key: 'incomer_factor', label: 'Main incomer sizing factor', unit: '×', group: 'Electrical', default: 1.25, description: 'Main breaker ≥ full load current × this factor.' },

  // ---------------- Water Chemistry ----------------
  { key: 'osmotic_coeff', label: 'Osmotic pressure per 1000 mg/L TDS', unit: 'bar', group: 'Water Chemistry', default: 0.77, description: 'NaCl-equivalent approximation (≈ 0.7–0.8 bar per 1000 mg/L).' },
  { key: 'tds_ec_factor', label: 'TDS / conductivity factor', unit: '(mg/L)/(µS/cm)', group: 'Water Chemistry', default: 0.65, description: 'Used to estimate TDS from conductivity when TDS is missing (range 0.55–0.75).' },
  { key: 'silica_solubility_25c', label: 'Silica solubility at 25 °C', unit: 'mg/L', group: 'Water Chemistry', default: 120, description: 'Amorphous silica, pH 7–7.8. Temperature-corrected linearly by 2.4 mg/L per °C.' },
  { key: 'ion_balance_tolerance', label: 'Ion balance tolerance', unit: '%', group: 'Water Chemistry', default: 10, description: 'Cation/anion imbalance above this flags the water analysis for review.' },

  // ---------------- Standard Sizes ----------------
  { key: 'std_motors_kw', label: 'Standard IEC motor ratings', unit: 'kW', group: 'Standard Sizes', default: [0.37, 0.55, 0.75, 1.1, 1.5, 2.2, 3, 4, 5.5, 7.5, 11, 15, 18.5, 22, 30, 37, 45, 55, 75, 90, 110, 132, 160, 200, 250, 315], description: 'Motor rated power is selected from this list.' },
  { key: 'std_vessel_diameters_mm', label: 'Standard filter vessel diameters', unit: 'mm', group: 'Standard Sizes', default: [254, 305, 330, 356, 406, 457, 533, 610, 762, 914, 1067, 1219, 1372, 1524, 1600, 1829, 2000, 2200, 2400, 2500, 3000], description: 'FRP (10"–72") and steel vessel diameters.' },
  { key: 'std_chemical_tanks_l', label: 'Standard chemical tank sizes', unit: 'L', group: 'Standard Sizes', default: [60, 100, 200, 300, 500, 1000, 1500, 2000, 3000, 5000], description: 'PE dosing tank sizes.' },
  { key: 'std_dosing_pumps_lh', label: 'Standard dosing pump capacities', unit: 'L/h', group: 'Standard Sizes', default: [1, 2, 5, 10, 15, 20, 30, 50, 80, 120, 200], description: 'Electronic diaphragm dosing pump capacities.' },
  { key: 'std_cartridge_housings', label: 'Standard cartridge housing sizes', unit: 'rounds (40")', group: 'Standard Sizes', default: [1, 3, 5, 7, 9, 12, 15, 21, 31, 40, 52], description: 'Number of 40" elements per housing.' },
  { key: 'std_breakers_a', label: 'Standard breaker ratings', unit: 'A', group: 'Standard Sizes', default: [16, 20, 25, 32, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800], description: 'Main incomer selection.' },
];

export type Assumptions = Record<string, number | number[]>;

export function defaultAssumptions(): Assumptions {
  const out: Assumptions = {};
  for (const d of ASSUMPTION_DEFS) out[d.key] = Array.isArray(d.default) ? [...d.default] : d.default;
  return out;
}

/** Merge stored values over defaults, so new assumptions added in later versions get their default. */
export function mergeAssumptions(stored: Partial<Assumptions> | null | undefined): Assumptions {
  const base = defaultAssumptions();
  if (!stored) return base;
  for (const d of ASSUMPTION_DEFS) {
    const v = stored[d.key];
    if (Array.isArray(d.default)) {
      if (Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'number' && isFinite(x))) base[d.key] = [...v].sort((a, b) => a - b);
    } else if (typeof v === 'number' && isFinite(v)) {
      base[d.key] = v;
    }
  }
  return base;
}

export const ASSUMPTION_BY_KEY: Record<string, AssumptionDef> = Object.fromEntries(ASSUMPTION_DEFS.map((d) => [d.key, d]));

export class AssumptionReader {
  constructor(private readonly a: Assumptions) {}
  n(key: string): number {
    const v = this.a[key];
    if (typeof v === 'number') return v;
    const d = ASSUMPTION_BY_KEY[key];
    if (!d || Array.isArray(d.default)) throw new Error(`Unknown numeric assumption ${key}`);
    return d.default;
  }
  list(key: string): number[] {
    const v = this.a[key];
    if (Array.isArray(v)) return v;
    const d = ASSUMPTION_BY_KEY[key];
    if (!d || !Array.isArray(d.default)) throw new Error(`Unknown list assumption ${key}`);
    return d.default;
  }
  /** Percentage assumption as fraction (e.g. 65 → 0.65) */
  pct(key: string): number {
    return this.n(key) / 100;
  }
}
