import type { AssumptionReader } from '../assumptions';
import type { ItemOverride, PretreatmentInput, PretreatmentItemId, RawWaterInput, WaterSource } from '../types';
import { Findings, isNum, nextStandard, round } from './common';
import type { ProductionResult } from './production';
import { acidDemand, scaling, ScalingResult } from './water';

export const INSUFFICIENT = 'INSUFFICIENT DATA — LAB ANALYSIS REQUIRED';

export type PtStatus = 'required' | 'recommended' | 'optional' | 'not_required' | 'insufficient_data';

export const PT_STATUS_LABEL: Record<PtStatus, string> = {
  required: 'REQUIRED',
  recommended: 'RECOMMENDED',
  optional: 'OPTIONAL',
  not_required: 'NOT REQUIRED',
  insufficient_data: INSUFFICIENT,
};

export interface MediaLayer {
  name: string;
  depthM: number;
  volumeL: number;
  massKg: number;
}

export interface FilterSizing {
  kind: 'filter';
  flowM3h: number;
  designRateMh: number;
  vessels: number;
  diameterMm: number;
  areaPerVesselM2: number;
  actualRateMh: number;
  media: MediaLayer[];
  backwashFlowM3h: number | null;
  notes: string[];
}

export interface CartridgeSizing {
  kind: 'cartridge';
  flowM3h: number;
  micron: number;
  elements40in: number;
  housings: number;
  roundsPerHousing: number;
  notes: string[];
}

export interface SoftenerSizing {
  kind: 'softener';
  flowM3h: number;
  hardnessMgL: number;
  resinPerVesselL: number;
  vessels: number;
  diameterMm: number;
  serviceRateMh: number;
  bedDepthM: number;
  saltPerRegenKg: number;
  notes: string[];
}

export interface PretreatmentItem {
  id: PretreatmentItemId;
  name: string;
  category: 'Storage' | 'Physical' | 'Chemical' | 'Post-treatment';
  status: PtStatus;
  inDesign: boolean;
  override: ItemOverride;
  reason: string;
  basis: string[];
  dataRequired: string[];
  dpBar: number;
  sizing: FilterSizing | CartridgeSizing | SoftenerSizing | null;
}

export interface PretreatmentResult {
  items: PretreatmentItem[];
  scaling: ScalingResult | null;
  scalingAfterTreatment: ScalingResult | null;
  scaleStrategy: 'antiscalant' | 'antiscalant_acid' | 'softener' | 'none';
  acidTargetPh: number | null;
  acidDoseMeqL: number | null;
  totalDpBar: number;
  inDesignIds: PretreatmentItemId[];
}

export function ptIn(r: PretreatmentResult, id: PretreatmentItemId) {
  return r.inDesignIds.includes(id);
}

export function sizeFilter(flow: number, rate: number, A: AssumptionReader, layers: { name: string; depth: number; density: number }[], backwashRate: number | null): FilterSizing {
  const diams = A.list('std_vessel_diameters_mm');
  const maxD = A.n('max_vessel_diameter_mm');
  const usable = diams.filter((d) => d <= maxD);
  let n = 1;
  let d = usable[usable.length - 1] ?? maxD;
  for (; n <= 20; n++) {
    const areaReq = flow / (n * rate);
    const dReq = Math.sqrt((4 * areaReq) / Math.PI) * 1000;
    const std = nextStandard(dReq, usable);
    if (std !== null) {
      d = std;
      break;
    }
  }
  const area = (Math.PI * Math.pow(d / 1000, 2)) / 4;
  const media = layers.map((l) => {
    const vol = area * l.depth * n;
    return { name: l.name, depthM: l.depth, volumeL: round(vol * 1000, 0), massKg: round(vol * l.density, 0) };
  });
  return {
    kind: 'filter',
    flowM3h: round(flow, 2),
    designRateMh: rate,
    vessels: n,
    diameterMm: d,
    areaPerVesselM2: round(area, 3),
    actualRateMh: round(flow / (n * area), 1),
    media,
    backwashFlowM3h: backwashRate ? round(area * backwashRate, 1) : null,
    notes: [
      `Vessels in parallel, all in service (backwash one at a time). Consider n+1 for continuous production.`,
      `Diameter selected as the smallest standard diameter giving ≤ ${rate} m/h.`,
    ],
  };
}

function fmt(v: number | null | undefined, d = 2) {
  return isNum(v) ? String(round(v, d)) : '—';
}

export function calcPretreatment(
  input: PretreatmentInput,
  w: RawWaterInput,
  source: WaterSource,
  tds: number | null,
  tempC: number | null,
  prod: ProductionResult,
  A: AssumptionReader,
  f: Findings,
): PretreatmentResult {
  const S = 'Pretreatment';
  const items: PretreatmentItem[] = [];
  const flow = prod.feedM3h;
  const r = prod.recoveryPct / 100;
  const add = (it: Omit<PretreatmentItem, 'override' | 'inDesign'> & { inDesign: boolean }) => {
    const ov = input.overrides[it.id] ?? 'auto';
    let inDesign = it.inDesign;
    if (ov === 'include') inDesign = true;
    if (ov === 'exclude') {
      inDesign = false;
      if (it.status === 'required' || it.status === 'recommended')
        f.add(it.status === 'required' ? 'critical' : 'review', S, `excluded_${it.id}`, `${it.name} is ${it.status.toUpperCase()} but was excluded by the user. Reason it was recommended: ${it.reason}`);
    }
    if (it.status === 'insufficient_data') f.review(S, `insufficient_${it.id}`, `${it.name}: ${INSUFFICIENT} (${it.dataRequired.join(', ')}).`);
    items.push({ ...it, override: ov, inDesign });
    return inDesign;
  };

  // ---------------------------------------------------------------- Raw water tank
  add({
    id: 'raw_tank', name: 'Raw water tank', category: 'Storage', status: 'required', inDesign: true,
    reason: 'Buffers borehole/source flow against RO demand, allows air separation and iron oxidation, and supplies backwash water.',
    basis: [`Storage ${A.n('raw_storage_hours')} h default (Tanks section).`], dataRequired: [], dpBar: 0, sizing: null,
  });

  // ---------------------------------------------------------------- Solids
  const turb = w.turbidity;
  const sdi = w.sdi;
  const isSurface = source === 'surface' || source === 'seawater_open';
  if (isNum(sdi) && sdi > A.n('sdi_max_ro')) f.critical(S, 'sdi_high', `Raw water SDI ${sdi} exceeds ${A.n('sdi_max_ro')} – robust pretreatment is required and SDI after pretreatment must be verified < 3 before RO start-up.`);

  const coagNeeded = isNum(turb) && turb > A.n('turbidity_coagulation');
  add({
    id: 'coagulation', name: 'Coagulation / flocculation (+ clarification)', category: 'Chemical',
    status: !isNum(turb) ? 'insufficient_data' : coagNeeded ? 'recommended' : 'not_required',
    inDesign: coagNeeded,
    reason: !isNum(turb) ? 'Turbidity not analysed.' : coagNeeded ? `Turbidity ${turb} NTU > ${A.n('turbidity_coagulation')} NTU: media filters alone cannot reliably produce RO feed quality.` : `Turbidity ${turb} NTU ≤ ${A.n('turbidity_coagulation')} NTU.`,
    basis: [`Trigger: turbidity > ${A.n('turbidity_coagulation')} NTU.`, 'Coagulant type and dose must be determined by jar testing – not sized by this tool.'],
    dataRequired: isNum(turb) ? [] : ['Turbidity'], dpBar: 0, sizing: null,
  });

  const sandNeeded = isNum(turb) && turb > A.n('turbidity_roughing');
  add({
    id: 'sand_filter', name: 'Sand filter (roughing)', category: 'Physical',
    status: !isNum(turb) ? 'insufficient_data' : sandNeeded ? 'recommended' : 'not_required',
    inDesign: sandNeeded,
    reason: !isNum(turb) ? 'Turbidity not analysed.' : sandNeeded ? `Turbidity ${turb} NTU > ${A.n('turbidity_roughing')} NTU – roughing filtration protects the multimedia filter.` : `Turbidity ${turb} NTU ≤ ${A.n('turbidity_roughing')} NTU – roughing filter not needed.`,
    basis: [`Loading rate ${A.n('sand_rate')} m/h.`], dataRequired: isNum(turb) ? [] : ['Turbidity'], dpBar: A.n('sand_dp_bar'),
    sizing: sizeFilter(flow, A.n('sand_rate'), A, [{ name: 'Filter sand 0.5–1.0 mm', depth: 0.8, density: A.n('density_sand') }, { name: 'Support gravel', depth: 0.2, density: A.n('density_gravel') }], A.n('mmf_backwash_rate')),
  });

  let mmfStatus: PtStatus;
  let mmfReason: string;
  let mmfIn: boolean;
  if (!isNum(turb) && !isNum(sdi)) {
    mmfStatus = 'insufficient_data';
    mmfIn = true;
    mmfReason = 'Turbidity and SDI not analysed. Multimedia filter included AS A PRECAUTION until lab data confirms whether it is needed.';
  } else {
    const reasons: string[] = [];
    if (isNum(turb) && turb > A.n('turbidity_limit_mmf')) reasons.push(`turbidity ${turb} NTU > ${A.n('turbidity_limit_mmf')} NTU`);
    if (isNum(sdi) && sdi > A.n('sdi_limit_mmf')) reasons.push(`SDI ${sdi} > ${A.n('sdi_limit_mmf')}`);
    if (isSurface) reasons.push('surface/open-intake source');
    if (reasons.length) {
      mmfStatus = 'recommended';
      mmfIn = true;
      mmfReason = `Required to reduce suspended solids / colloids: ${reasons.join(', ')}.`;
    } else {
      mmfStatus = 'optional';
      mmfIn = false;
      mmfReason = `Turbidity ${fmt(turb)} NTU and SDI ${fmt(sdi)} are within RO feed limits. A multimedia filter is an optional safeguard against solids upsets.`;
      if (!isNum(turb) || !isNum(sdi)) mmfReason += ` (${!isNum(turb) ? 'turbidity' : 'SDI'} not analysed).`;
    }
  }
  add({
    id: 'mmf', name: 'Multimedia filter (anthracite / sand / gravel)', category: 'Physical', status: mmfStatus, inDesign: mmfIn, reason: mmfReason,
    basis: [`Triggers: turbidity > ${A.n('turbidity_limit_mmf')} NTU or SDI > ${A.n('sdi_limit_mmf')}.`, `Loading rate ${A.n('mmf_rate')} m/h, backwash ${A.n('mmf_backwash_rate')} m/h.`],
    dataRequired: [!isNum(turb) ? 'Turbidity' : '', !isNum(sdi) ? 'SDI' : ''].filter(Boolean), dpBar: A.n('mmf_dp_bar'),
    sizing: sizeFilter(flow, A.n('mmf_rate'), A, [
      { name: 'Anthracite 0.8–1.6 mm', depth: A.n('mmf_anthracite_depth'), density: A.n('density_anthracite') },
      { name: 'Filter sand 0.4–0.8 mm', depth: A.n('mmf_sand_depth'), density: A.n('density_sand') },
      { name: 'Support gravel 2–8 mm', depth: A.n('mmf_gravel_depth'), density: A.n('density_gravel') },
    ], A.n('mmf_backwash_rate')),
  });

  // ---------------------------------------------------------------- Iron / manganese
  const fe = w.iron;
  const mn = w.manganese;
  const feNeeded = isNum(fe) && fe > A.n('iron_limit');
  const mnNeeded = isNum(mn) && mn > A.n('manganese_limit');
  const ironSizing = sizeFilter(flow, A.n('iron_rate'), A, [
    { name: 'Catalytic iron/manganese media (e.g. MnO2 / greensand)', depth: A.n('iron_bed_depth'), density: A.n('density_iron_media') },
    { name: 'Support gravel', depth: 0.2, density: A.n('density_gravel') },
  ], A.n('mmf_backwash_rate'));
  const feIn = add({
    id: 'iron_removal', name: 'Iron removal (oxidation + catalytic filtration)', category: 'Physical',
    status: !isNum(fe) ? 'insufficient_data' : feNeeded ? 'recommended' : 'not_required', inDesign: feNeeded,
    reason: !isNum(fe) ? 'Iron not analysed – iron fouling is a common cause of RO failure on groundwater.' : feNeeded ? `Iron ${fe} mg/L > ${A.n('iron_limit')} mg/L: oxidised iron would foul the membranes.` : `Iron ${fe} mg/L ≤ ${A.n('iron_limit')} mg/L.`,
    basis: [`Trigger: Fe > ${A.n('iron_limit')} mg/L.`, `Loading rate ${A.n('iron_rate')} m/h.`, 'Media choice depends on pH, oxygen, H2S and Mn – confirm with media supplier.'],
    dataRequired: isNum(fe) ? [] : ['Iron'], dpBar: A.n('iron_dp_bar'), sizing: ironSizing,
  });
  const mnIn = add({
    id: 'manganese_removal', name: 'Manganese removal', category: 'Physical',
    status: !isNum(mn) ? 'insufficient_data' : mnNeeded ? 'recommended' : 'not_required', inDesign: mnNeeded,
    reason: !isNum(mn) ? 'Manganese not analysed.' : mnNeeded ? `Manganese ${mn} mg/L > ${A.n('manganese_limit')} mg/L. Combined with the iron filter (same catalytic media) where both are required.` : `Manganese ${mn} mg/L ≤ ${A.n('manganese_limit')} mg/L.`,
    basis: [`Trigger: Mn > ${A.n('manganese_limit')} mg/L.`, 'Mn oxidation requires pH > 7.5 or a strong oxidant (chlorine/KMnO4).'],
    dataRequired: isNum(mn) ? [] : ['Manganese'], dpBar: feIn ? 0 : A.n('iron_dp_bar'), sizing: feIn ? null : ironSizing,
  });

  // ---------------------------------------------------------------- Chlorine / oxidation / organics
  const oxidationNeeded = feIn || mnIn;
  const prechlorIn = add({
    id: 'prechlorination', name: 'Pre-chlorination (NaOCl) – oxidation', category: 'Chemical',
    status: oxidationNeeded ? 'recommended' : isSurface ? 'optional' : 'not_required', inDesign: oxidationNeeded,
    reason: oxidationNeeded ? 'Oxidant is required ahead of the iron/manganese filter to oxidise Fe²⁺/Mn²⁺.' : isSurface ? 'Optional for biofouling control on surface water (must be removed before RO).' : 'No oxidation requirement identified.',
    basis: [`Dose = 0.63×Fe + 0.77×Mn + ${A.n('prechlor_residual')} mg/L residual.`], dataRequired: [], dpBar: 0, sizing: null,
  });
  const cl = w.freeChlorine;
  const chlorinePresent = (isNum(cl) && cl > A.n('chlorine_limit')) || prechlorIn;
  const toc = w.toc;
  const tocHigh = isNum(toc) && toc > A.n('toc_limit_acf');
  const clUnknownMunicipal = !isNum(cl) && source === 'municipal';
  let acfStatus: PtStatus = 'not_required';
  let acfReason = 'No free chlorine and no elevated organics identified.';
  let acfIn = false;
  if (chlorinePresent || tocHigh) {
    acfStatus = 'recommended';
    acfIn = true;
    const rs: string[] = [];
    if (isNum(cl) && cl > A.n('chlorine_limit')) rs.push(`free chlorine ${cl} mg/L > ${A.n('chlorine_limit')} mg/L`);
    if (prechlorIn) rs.push('pre-chlorination is used');
    if (tocHigh) rs.push(`TOC ${toc} mg/L > ${A.n('toc_limit_acf')} mg/L`);
    acfReason = `Polyamide membranes are destroyed by chlorine; carbon removes chlorine and organics: ${rs.join(', ')}.`;
  } else if (clUnknownMunicipal) {
    acfStatus = 'insufficient_data';
    acfIn = true;
    acfReason = 'Municipal water is normally chlorinated but free chlorine was not measured – carbon filter included AS A PRECAUTION.';
  }
  const acfFinal = add({
    id: 'acf', name: 'Activated carbon filter (dechlorination / organics)', category: 'Physical', status: acfStatus, inDesign: acfIn, reason: acfReason,
    basis: [`Triggers: free chlorine > ${A.n('chlorine_limit')} mg/L, pre-chlorination, or TOC > ${A.n('toc_limit_acf')} mg/L.`, `Loading rate ${A.n('acf_rate')} m/h, bed ${A.n('acf_bed_depth')} m.`],
    dataRequired: [clUnknownMunicipal ? 'Free chlorine' : '', !isNum(toc) ? 'TOC' : ''].filter(Boolean), dpBar: A.n('acf_dp_bar'),
    sizing: sizeFilter(flow, A.n('acf_rate'), A, [{ name: 'Granular activated carbon 8×30 mesh', depth: A.n('acf_bed_depth'), density: A.n('density_gac') }, { name: 'Support gravel', depth: 0.2, density: A.n('density_gravel') }], A.n('acf_backwash_rate')),
  });
  let smbsStatus: PtStatus = 'not_required';
  let smbsIn = false;
  let smbsReason = 'No chlorine source identified.';
  if (chlorinePresent && !acfFinal) {
    smbsStatus = 'required';
    smbsIn = true;
    smbsReason = 'Chlorine is present and no carbon filter is in the design – SMBS dechlorination is mandatory to protect polyamide membranes.';
  } else if (chlorinePresent && acfFinal) {
    smbsStatus = 'optional';
    smbsReason = 'Chlorine is removed by the carbon filter. SMBS dosing is an optional back-up (recommended with ORP monitoring).';
  } else if (clUnknownMunicipal) {
    smbsStatus = 'insufficient_data';
    smbsReason = 'Free chlorine not measured on a municipal supply.';
  }
  add({
    id: 'smbs', name: 'Sodium metabisulfite (SMBS) dosing', category: 'Chemical', status: smbsStatus, inDesign: smbsIn, reason: smbsReason,
    basis: [`Dose = ${A.n('smbs_ratio')} mg/mg × free chlorine + ${A.n('smbs_margin')} mg/L.`], dataRequired: clUnknownMunicipal ? ['Free chlorine'] : [], dpBar: 0, sizing: null,
  });

  // ---------------------------------------------------------------- Scaling / softening / acid
  const sc = prod.valid ? scaling(w, tds, tempC, r, A) : null;
  const lsiLim = A.n('lsi_limit_antiscalant');
  const caso4Lim = A.n('caso4_limit_pct');
  const lsiHigh = sc?.concentrateLsi != null && sc.concentrateLsi > lsiLim;
  const caso4High = sc?.caso4SatPct != null && sc.caso4SatPct > caso4Lim;
  let strategy: PretreatmentResult['scaleStrategy'] = 'antiscalant';
  if (input.scaleControl !== 'auto') strategy = input.scaleControl;
  else if (lsiHigh || caso4High) strategy = prod.permeateM3h <= A.n('softener_max_permeate_m3h') || caso4High ? 'softener' : 'antiscalant_acid';

  // Softener
  const hard = w.hardness ?? (isNum(w.calcium) && isNum(w.magnesium) ? w.calcium * 2.497 + w.magnesium * 4.118 : null);
  let softSizing: SoftenerSizing | null = null;
  if (isNum(hard) && hard > 0 && flow > 0) {
    const resin = (hard * flow * A.n('softener_cycle_h')) / A.n('softener_capacity_g_l');
    const areaReq = flow / A.n('softener_rate');
    const dReq = Math.sqrt((4 * areaReq) / Math.PI) * 1000;
    const diams = A.list('std_vessel_diameters_mm');
    let d = nextStandard(dReq, diams) ?? diams[diams.length - 1];
    // bed depth at least 0.75 m
    let depth = resin / 1000 / ((Math.PI * Math.pow(d / 1000, 2)) / 4);
    while (depth > 2.0) {
      const bigger = diams.find((x) => x > d);
      if (!bigger) break;
      d = bigger;
      depth = resin / 1000 / ((Math.PI * Math.pow(d / 1000, 2)) / 4);
    }
    const area = (Math.PI * Math.pow(d / 1000, 2)) / 4;
    const resinFinal = Math.max(resin, area * 0.75 * 1000);
    softSizing = {
      kind: 'softener', flowM3h: round(flow, 2), hardnessMgL: round(hard, 0), resinPerVesselL: round(resinFinal, 0), vessels: 2, diameterMm: d,
      serviceRateMh: round(flow / area, 1), bedDepthM: round(resinFinal / 1000 / area, 2), saltPerRegenKg: round((resinFinal * A.n('softener_salt_g_l')) / 1000, 0),
      notes: ['Duplex (duty/regenerating) with volume-controlled alternating valve.', `Resin sized for ${A.n('softener_cycle_h')} h service at ${A.n('softener_capacity_g_l')} g CaCO3/L; minimum bed depth 0.75 m.`],
    };
  }
  const softData = sc?.concentrateLsi == null && sc?.caso4SatPct == null;
  const softIn = add({
    id: 'softener', name: 'Water softener (ion exchange)', category: 'Physical',
    status: softData ? 'insufficient_data' : strategy === 'softener' ? 'recommended' : lsiHigh || caso4High ? 'optional' : 'not_required',
    inDesign: strategy === 'softener' && !softData,
    reason: softData
      ? 'Scaling potential cannot be evaluated without calcium, alkalinity, pH, sulfate and TDS.'
      : strategy === 'softener'
        ? `${caso4High ? `CaSO4 saturation ${sc?.caso4SatPct} % exceeds the antiscalant limit ${caso4Lim} % (acid does not help). ` : ''}${lsiHigh ? `Concentrate LSI ${sc?.concentrateLsi} exceeds the antiscalant limit ${lsiLim}. ` : ''}${input.scaleControl === 'softener' ? 'Softening selected by user.' : `Softening selected because permeate flow ≤ ${A.n('softener_max_permeate_m3h')} m³/h or sulfate scaling governs.`}`
        : lsiHigh || caso4High ? 'Alternative to acid dosing for scale control.' : 'Concentrate scaling is controllable with antiscalant alone.',
    basis: [`Service rate ${A.n('softener_rate')} m/h, capacity ${A.n('softener_capacity_g_l')} g/L, cycle ${A.n('softener_cycle_h')} h.`],
    dataRequired: softData ? ['Calcium', 'Alkalinity', 'pH', 'Sulfate'] : [], dpBar: A.n('softener_dp_bar'), sizing: softSizing,
  });

  // Acid
  let acidTargetPh: number | null = null;
  let acidMeq: number | null = null;
  let scAfter: ScalingResult | null = sc;
  const acidWanted = strategy === 'antiscalant_acid';
  if (acidWanted && sc?.concentrateLsi != null && isNum(w.ph) && isNum(w.alkalinity)) {
    if (sc.concentrateLsi > lsiLim) {
      let lo = 4.5;
      let hi = w.ph;
      for (let i = 0; i < 50; i++) {
        const mid = (lo + hi) / 2;
        const ad = acidDemand(w.ph, mid, w.alkalinity);
        const s2 = scaling(w, tds, tempC, r, A, mid, ad.newAlkAsCaCO3);
        if ((s2.concentrateLsi ?? 0) > lsiLim - 0.05) hi = mid;
        else lo = mid;
      }
      acidTargetPh = round(lo, 2);
      const ad = acidDemand(w.ph, acidTargetPh, w.alkalinity);
      acidMeq = ad.meq;
      scAfter = scaling(w, tds, tempC, r, A, acidTargetPh, ad.newAlkAsCaCO3);
    } else {
      acidTargetPh = w.ph;
      acidMeq = 0;
    }
  }
  const acidData = sc?.concentrateLsi == null;
  add({
    id: 'acid', name: 'Acid dosing (HCl) – pH adjustment', category: 'Chemical',
    status: acidData ? 'insufficient_data' : acidWanted && (acidMeq ?? 0) > 0 ? 'recommended' : lsiHigh ? 'optional' : 'not_required',
    inDesign: acidWanted && !acidData && (acidMeq ?? 0) > 0,
    reason: acidData
      ? 'Concentrate LSI cannot be calculated (pH, calcium, alkalinity, TDS required).'
      : acidWanted && (acidMeq ?? 0) > 0
        ? `Concentrate LSI ${sc?.concentrateLsi} > antiscalant limit ${lsiLim}. Lowering feed pH from ${w.ph} to ≈ ${acidTargetPh} converts bicarbonate to CO2 and brings concentrate LSI to ≈ ${scAfter?.concentrateLsi}.`
        : lsiHigh ? 'Alternative to softening for CaCO3 scale control.' : `Concentrate LSI ${sc?.concentrateLsi} ≤ ${lsiLim}: acid not needed.`,
    basis: ['Carbonate equilibrium pKa1 = 6.35; HCl preferred over H2SO4 (no added sulfate).', 'Concentrate pH ≈ feed pH + log10(CF). Screening estimate – confirm with antiscalant supplier software.'],
    dataRequired: acidData ? ['pH', 'Calcium', 'Alkalinity'] : [], dpBar: 0, sizing: null,
  });

  // Antiscalant
  const scaleData = sc && (sc.concentrateLsi != null || sc.caso4SatPct != null || sc.silicaSatPct != null);
  const anySat = sc && ((sc.concentrateLsi ?? -9) > 0 || (sc.caso4SatPct ?? 0) > 100 || (sc.silicaSatPct ?? 0) > 80 || (sc.baso4SatPct ?? 0) > 100 || (sc.srso4SatPct ?? 0) > 100);
  add({
    id: 'antiscalant', name: 'Antiscalant dosing', category: 'Chemical',
    status: !scaleData ? 'insufficient_data' : anySat ? 'recommended' : 'optional',
    inDesign: !scaleData || !!anySat || strategy !== 'softener',
    reason: !scaleData
      ? 'Scaling cannot be evaluated. Antiscalant is included AS A PRECAUTION – almost all brackish RO systems at > 50 % recovery require it.'
      : anySat
        ? `Concentrate is supersaturated (LSI ${fmt(sc?.concentrateLsi)}, CaSO4 ${fmt(sc?.caso4SatPct, 0)} %, SiO2 ${fmt(sc?.silicaSatPct, 0)} %${sc?.baso4SatPct != null ? `, BaSO4 ${fmt(sc.baso4SatPct, 0)} %` : ''}) at ${prod.recoveryPct} % recovery.`
        : 'Concentrate is below saturation for the evaluated scalants; antiscalant is optional.',
    basis: [`Dose ${A.n('antiscalant_dose')} mg/L as product (confirm with supplier projection).`, `Limits with antiscalant: LSI ≤ ${lsiLim}, CaSO4 ≤ ${caso4Lim} %, SiO2 ≤ ${A.n('silica_limit_pct')} %.`],
    dataRequired: !scaleData ? ['pH', 'Calcium', 'Alkalinity', 'Sulfate', 'Silica'] : [], dpBar: 0, sizing: null,
  });

  // Scaling warnings
  if (sc) {
    const scNow = softIn ? null : scAfter;
    if (scNow?.concentrateLsi != null) {
      if (scNow.concentrateLsi > lsiLim) f.critical(S, 'lsi', `Concentrate LSI ${scNow.concentrateLsi} exceeds the antiscalant limit ${lsiLim} with the selected scale control – CaCO3 scaling expected. Add acid dosing / softener or reduce recovery.`);
      else f.ok(S, 'lsi', `Concentrate LSI ${scNow.concentrateLsi} is within the antiscalant limit ${lsiLim}.`);
    }
    if (!softIn && sc.caso4SatPct != null) {
      if (sc.caso4SatPct > caso4Lim) f.critical(S, 'caso4', `CaSO4 saturation ${sc.caso4SatPct} % exceeds ${caso4Lim} % – softening or lower recovery required.`);
      else f.ok(S, 'caso4', `CaSO4 saturation ${sc.caso4SatPct} % is within the antiscalant limit ${caso4Lim} %.`);
    }
    if (sc.silicaSatPct != null) {
      if (sc.silicaSatPct > 2 * A.n('silica_limit_pct')) f.critical(S, 'silica', `Silica in concentrate ${sc.silicaConcMgL} mg/L = ${sc.silicaSatPct} % of solubility. Reduce recovery to ≤ ${sc.maxRecoveryBySilicaPct} % or use a silica-specific antiscalant.`);
      else if (sc.silicaSatPct > A.n('silica_limit_pct')) f.review(S, 'silica', `Silica in concentrate ${sc.silicaConcMgL} mg/L = ${sc.silicaSatPct} % of solubility – silica-specific antiscalant needed or reduce recovery to ≤ ${sc.maxRecoveryBySilicaPct} %.`);
      else f.ok(S, 'silica', `Silica in concentrate ${sc.silicaConcMgL} mg/L (${sc.silicaSatPct} % of solubility).`);
    }
    if (sc.baso4SatPct != null && sc.baso4SatPct > A.n('baso4_limit_pct')) f.critical(S, 'baso4', `BaSO4 saturation ${sc.baso4SatPct} % exceeds the antiscalant limit.`);
  }

  // ---------------------------------------------------------------- Cartridge
  const n40 = Math.max(1, Math.ceil(flow / A.n('cartridge_flow_per_40in') - 1e-9));
  const housings = A.list('std_cartridge_housings');
  const maxH = housings[housings.length - 1];
  const nh = Math.max(1, Math.ceil(n40 / maxH));
  const rounds = nextStandard(Math.ceil(n40 / nh), housings) ?? maxH;
  add({
    id: 'cartridge', name: `Cartridge filter ${A.n('cartridge_micron')} µm`, category: 'Physical', status: 'required', inDesign: true,
    reason: 'Mandatory last barrier protecting the HP pump and membranes from particles and media fines.',
    basis: [`${A.n('cartridge_flow_per_40in')} m³/h per 40" element, ${A.n('cartridge_micron')} µm nominal.`, `Replace at ΔP ${A.n('cartridge_dp_bar')} bar.`],
    dataRequired: [], dpBar: A.n('cartridge_dp_bar'),
    sizing: { kind: 'cartridge', flowM3h: round(flow, 2), micron: A.n('cartridge_micron'), elements40in: nh * rounds, housings: nh, roundsPerHousing: rounds, notes: [`Minimum elements required: ${n40} × 40".`, 'SS316 or FRP housing rated ≥ 6 bar.'] },
  });

  // ---------------------------------------------------------------- Post-treatment
  const uvSel = input.postDisinfection === 'uv' || input.postDisinfection === 'uv_chlorination';
  const clSel = input.postDisinfection === 'chlorination' || input.postDisinfection === 'uv_chlorination';
  add({
    id: 'uv', name: 'UV disinfection (permeate)', category: 'Post-treatment', status: uvSel ? 'recommended' : 'optional', inDesign: uvSel,
    reason: uvSel ? 'Selected: product water is stored in a tank – UV inactivates bacteria before storage/distribution.' : 'Recommended for potable water. Select under post-disinfection.',
    basis: ['Design dose 40 mJ/cm², UVT of RO permeate > 95 %.'], dataRequired: [], dpBar: A.n('uv_dp_bar'), sizing: null,
  });
  add({
    id: 'post_chlorination', name: 'Post-chlorination (NaOCl)', category: 'Post-treatment', status: clSel ? 'recommended' : 'optional', inDesign: clSel,
    reason: clSel ? 'Selected: residual disinfectant protects the product tank and distribution network.' : 'Provides residual disinfection in storage/distribution. Select under post-disinfection.',
    basis: [`Dose ${A.n('postchlor_dose')} mg/L.`], dataRequired: [], dpBar: 0, sizing: null,
  });
  add({
    id: 'remineralization', name: 'Remineralisation / pH correction', category: 'Post-treatment', status: 'optional', inDesign: false,
    reason: 'RO permeate is low in hardness and alkalinity (corrosive, negative LSI). For drinking water, a calcite filter or blending is commonly used – decide per local drinking-water standard.',
    basis: [], dataRequired: [], dpBar: 0, sizing: null,
  });

  const inDesignSet = new Set(items.filter((i) => i.inDesign).map((i) => i.id));
  const ptDp = items.filter((i) => i.inDesign && i.category === 'Physical' && i.id !== 'cartridge').reduce((s, i) => s + i.dpBar, 0);

  return {
    items,
    scaling: sc,
    scalingAfterTreatment: scAfter,
    scaleStrategy: softIn ? 'softener' : acidWanted ? 'antiscalant_acid' : inDesignSet.has('antiscalant') ? 'antiscalant' : 'none',
    acidTargetPh,
    acidDoseMeqL: acidMeq === null ? null : round(acidMeq, 3),
    totalDpBar: round(ptDp, 2),
    inDesignIds: [...inDesignSet],
  };
}
