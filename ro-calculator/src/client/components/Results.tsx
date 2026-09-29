import { Fragment, useState } from 'react';
import type { BomLine, DesignResult, PretreatmentItem } from '../../shared/engine';
import { PT_STATUS_LABEL } from '../../shared/engine';
import type { CostCategory, DesignInput } from '../../shared/types';
import { fmt, fmtFlow, fmtPower, fmtPressure, type DisplayUnits } from '../../shared/units';
import { useApp } from '../context';
import { Card, Counts, FindingsList, KV, LevelBadge, StepsTable } from './ui';

type Props = { result: DesignResult };

// ------------------------------------------------------------------ Summary
export function SummaryDashboard({ result, units }: Props & { units: DisplayUnits }) {
  const s = result.summary;
  const tile = (label: string, value: string, sub?: string) => (
    <div className="tile">
      <div className="tile-label">{label}</div>
      <div className="tile-value">{value}</div>
      {sub && <div className="tile-sub">{sub}</div>}
    </div>
  );
  const pipes = s.pipeSizes.filter((p) => p.dn != null);
  return (
    <div className="summary">
      <div className="summary-title">
        <h2>RO DESIGN SUMMARY</h2>
        <Counts counts={result.counts} />
      </div>
      <div className="tiles">
        {tile('Production', fmtFlow(s.permeateM3h, units), 'design permeate flow')}
        {tile('Daily production', fmt(s.dailyProductionM3d, 1, 'm³/day'))}
        {tile('Recovery', fmt(s.recoveryPct, 1, '%'))}
        {tile('Feed flow', fmtFlow(s.feedM3h, units))}
        {tile('Reject', fmtFlow(s.rejectM3h, units))}
        {tile('Membranes', `${s.membranes} pcs`, s.membrane)}
        {tile('Pressure vessels', `${s.vessels} pcs`, s.array)}
        {tile('Average flux', fmt(s.fluxLmh, 1, 'LMH'))}
        {tile('HP pump', `${fmtFlow(s.hpFlowM3h, units)} @ ${fmtPressure(s.hpPressureBar, units)}`, `head ${fmt(s.hpHeadM, 1, 'm')}`)}
        {tile('HP pump motor', fmtPower(s.hpMotorKw, units, 1))}
        {tile('Raw water pump', `${fmtFlow(s.rawFlowM3h, units)} @ ${fmt(s.rawHeadM, 1, 'm')}`, `motor ${fmtPower(s.rawMotorKw, units, 1)}`)}
        {tile('Estimated total electrical load', fmtPower(s.connectedKw, units, 1), `running ≈ ${fmtPower(s.runningKw, units, 1)}, ${fmt(s.specificEnergyKwhM3, 2, 'kWh/m³')}`)}
        {tile('Membrane feed pressure', fmtPressure(s.feedPressureBar, units), 'estimated')}
        {tile('Permeate TDS', fmt(s.permeateTdsMgL, 0, 'mg/L'), 'estimated')}
      </div>
      <div className="pipe-strip">
        <strong>Recommended pipe sizes:</strong> {pipes.length ? pipes.map((p) => `DN ${p.dn}`).join(' / ') : '–'}
        <div className="pipe-strip-detail">
          {s.pipeSizes.map((p) => (
            <span key={p.label}>
              {p.label}: <b>{p.dn ? `DN ${p.dn}` : '–'}</b>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Membranes
export function MembraneResults({ result, units }: Props & { units: DisplayUnits }) {
  const m = result.membrane;
  if (!m.available)
    return (
      <Card title="Membrane design">
        <FindingsList findings={result.findings} sections={['Membranes', 'Production']} showOk={false} empty="Membrane design not available." />
      </Card>
    );
  return (
    <>
      <Card title={`Membrane array – ${m.membraneLabel}`}>
        <KV
          items={[
            ['Elements required (calc.)', `${m.elementsRequired}`],
            ['Installed elements', `${m.elements}`],
            ['Pressure vessels', `${m.vessels} × ${m.elementsPerVessel} elements`],
            ['Array', m.arrayLabel],
            ['Average flux', `${fmt(m.actualFluxLmh, 1)} LMH (target ${m.designFluxTargetLmh}, max ${m.maxFluxLmh})`],
            ['Capacity at target flux', fmtFlow(m.capacityAtTargetFluxM3h, units)],
            ['Nominal capacity (test conditions)', fmtFlow(m.nominalCapacityM3h, units)],
            ['Avg. element recovery', fmt(m.averageElementRecoveryPct, 1, '%')],
            ['Required feed pressure', fmtPressure(m.feedPressureBar, units)],
            ['Concentrate pressure', fmtPressure(m.concentratePressureBar, units)],
            ['Net driving pressure', fmtPressure(m.ndpBar, units)],
            ['Avg. osmotic pressure', fmtPressure(m.avgOsmoticBar, units)],
            ['Approx. salt passage', fmt(m.saltPassagePct, 2, '%')],
            ['Permeate TDS (approx.)', fmt(m.permeateTdsMgL, 0, 'mg/L')],
            ['Concentrate TDS', fmt(m.concentrateTdsMgL, 0, 'mg/L')],
            ['Feed flow requirement', fmtFlow(result.production.feedM3h, units)],
          ]}
        />
      </Card>
      <Card title="Stage flows (equal flux per element assumed)">
        <table className="table">
          <thead>
            <tr>
              <th>Stage</th>
              <th className="num">Vessels</th>
              <th className="num">Elements</th>
              <th className="num">Feed m³/h</th>
              <th className="num">Permeate m³/h</th>
              <th className="num">Concentrate m³/h</th>
              <th className="num">Feed / vessel</th>
              <th className="num">Conc. / vessel</th>
              <th className="num">Stage recovery %</th>
            </tr>
          </thead>
          <tbody>
            {m.stageDetail.map((s) => (
              <tr key={s.stage}>
                <td>{s.stage}</td>
                <td className="num">{s.vessels}</td>
                <td className="num">{s.elements}</td>
                <td className="num">{s.feedM3h}</td>
                <td className="num">{s.permeateM3h}</td>
                <td className="num">{s.concentrateM3h}</td>
                <td className="num">{s.feedPerVesselM3h}</td>
                <td className="num">{s.concentratePerVesselM3h}</td>
                <td className="num">{s.recoveryPct}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card title="Calculation steps">
        <StepsTable steps={m.steps} />
      </Card>
      <Card title="Assumptions – read before using these results" className="card-warn">
        <ul className="bullets">
          {m.assumptions.map((a, i) => (
            <li key={i}>{a}</li>
          ))}
        </ul>
      </Card>
      <Card title="Membrane checks">
        <FindingsList findings={result.findings} sections={['Membranes']} />
      </Card>
    </>
  );
}

// ------------------------------------------------------------------ Pumps
export function PumpResults({ result, units }: Props & { units: DisplayUnits }) {
  return (
    <>
      {result.pumps.map((p) => (
        <Card
          key={p.id}
          title={p.name}
          actions={p.enabled ? <span className="pill">{fmtFlow(p.designFlowM3h, units)} · {fmtPressure(p.designPressureBar, units)} · {fmt(p.designHeadM, 1, 'm')} · {fmtPower(p.motorKw, units, 1)}</span> : <span className="pill muted">not included</span>}
        >
          {p.enabled ? (
            <div className="grid-2">
              <div>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Head component</th>
                      <th className="num">Head (m)</th>
                      <th className="num">bar</th>
                      <th>Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.components.map((c, i) => (
                      <tr key={i}>
                        <td>{c.label}</td>
                        <td className="num">{fmt(c.headM, 2)}</td>
                        <td className="num">{fmt(c.headM / 10.194, 2)}</td>
                        <td className="muted">{c.note}</td>
                      </tr>
                    ))}
                    <tr className="total">
                      <td>Total calculated head</td>
                      <td className="num">{fmt(p.calculatedHeadM, 1)}</td>
                      <td className="num">{fmt(p.calculatedHeadM / 10.194, 2)}</td>
                      <td />
                    </tr>
                  </tbody>
                </table>
                <KV
                  items={[
                    ['Flow', `${fmtFlow(p.designFlowM3h, units)} (process ${fmtFlow(p.processFlowM3h, units)})`],
                    ['Pressure (differential)', fmtPressure(p.designPressureBar, units)],
                    ['Head', fmt(p.designHeadM, 1, 'm')],
                    ...(p.suctionPressureBar != null ? ([['Suction / discharge pressure', `${fmtPressure(p.suctionPressureBar, units)} / ${fmtPressure(p.dischargePressureBar, units)}`]] as [string, string][]) : []),
                    ['Pump efficiency (assumed)', `${p.efficiencyPct} %`],
                    ['Motor efficiency (assumed)', `${p.motorEfficiencyPct} %`],
                    ['Shaft power', fmtPower(p.shaftKw, units)],
                    ['Electrical input', fmtPower(p.absorbedKw, units)],
                    ['Motor', fmtPower(p.motorKw, units, 1)],
                  ]}
                />
              </div>
              <div>
                <StepsTable steps={p.steps} />
                <p className="note">
                  <b>Pump library:</b> {p.libraryNote}
                </p>
                {p.notes.map((n, i) => (
                  <p key={i} className="note muted">
                    {n}
                  </p>
                ))}
              </div>
            </div>
          ) : (
            <p className="muted">{p.libraryNote}</p>
          )}
        </Card>
      ))}
      <Card title="Pump checks">
        {result.hpSuctionAvailableBar != null && <p>HP pump suction pressure: {fmtPressure(result.hpSuctionAvailableBar, units)}</p>}
        <FindingsList findings={result.findings} sections={['Pumps']} />
      </Card>
    </>
  );
}

// ------------------------------------------------------------------ Pipes
export function PipeResults({ result, units, onOverride, data }: Props & { units: DisplayUnits; data?: DesignInput; onOverride?: (id: string, field: string, value: string | number | undefined) => void }) {
  const { library } = useApp();
  const [open, setOpen] = useState<string | null>(null);
  return (
    <>
      <Card title="Pipe sizing schedule">
        <p className="muted small">
          Required ID d = √(4·Q ÷ (π·v<sub>max</sub>)); the smallest catalogue pipe with ID ≥ d is selected. Losses: Darcy–Weisbach with Swamee–Jain friction factor, water viscosity at feed temperature, plus fittings allowance.
          {onOverride && ' Click a row to edit material, velocity, length, elevation or design pressure.'}
        </p>
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Section</th>
                <th className="num">Flow</th>
                <th>Material</th>
                <th className="num">Req. ID mm</th>
                <th className="num">DN</th>
                <th className="num">ID mm</th>
                <th className="num">Velocity m/s</th>
                <th className="num">v max</th>
                <th className="num">Length m</th>
                <th className="num">Loss bar</th>
                <th className="num">Design / rating bar</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {result.pipes.map((p) => (
                <Fragment key={p.id}>
                  <tr className={onOverride ? 'clickable' : ''} onClick={() => onOverride && setOpen(open === p.id ? null : p.id)}>
                    <td>{p.label}</td>
                    <td className="num">{fmtFlow(p.flowM3h, units)}</td>
                    <td>{p.material}</td>
                    <td className="num">{p.requiredIdMm}</td>
                    <td className="num strong">{p.dn ?? '–'}</td>
                    <td className="num">{p.innerDiameterMm ?? '–'}</td>
                    <td className="num">{p.velocity}</td>
                    <td className="num">{p.maxVelocity}</td>
                    <td className="num">{p.lengthM}</td>
                    <td className="num">{fmt(p.totalLossBar, 3)}</td>
                    <td className="num">
                      {p.designPressureBar} / {p.pressureRatingBar ?? '–'}
                    </td>
                    <td>
                      <LevelBadge level={p.status} />
                    </td>
                  </tr>
                  {onOverride && data && open === p.id && (
                    <tr className="edit-row">
                      <td colSpan={12}>
                        <div className="inline-form">
                          <label>
                            Material
                            <select value={data.hydraulics.pipes[p.id]?.material ?? ''} onChange={(e) => onOverride(p.id, 'material', e.target.value || undefined)}>
                              <option value="">default ({p.material})</option>
                              {library?.pipeMaterials.map((m) => (
                                <option key={m.name} value={m.name}>
                                  {m.name}
                                </option>
                              ))}
                            </select>
                          </label>
                          {(
                            [
                              ['maxVelocity', 'Max velocity m/s'],
                              ['lengthM', 'Length m'],
                              ['elevationM', 'Elevation m'],
                              ['designPressureBar', 'Design pressure bar'],
                            ] as const
                          ).map(([k, l]) => (
                            <label key={k}>
                              {l}
                              <input
                                type="number"
                                step="any"
                                placeholder={String(k === 'maxVelocity' ? p.maxVelocity : k === 'lengthM' ? p.lengthM : k === 'elevationM' ? p.elevationM : p.designPressureBar)}
                                value={data.hydraulics.pipes[p.id]?.[k] ?? ''}
                                onChange={(e) => onOverride(p.id, k, e.target.value === '' ? undefined : Number(e.target.value))}
                              />
                            </label>
                          ))}
                          <span className="muted small">Empty = calculated default</span>
                        </div>
                        <details>
                          <summary>Calculation steps</summary>
                          <StepsTable steps={p.steps} />
                        </details>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card title="Pipe checks">
        <FindingsList findings={result.findings} sections={['Pipes']} />
      </Card>
    </>
  );
}

// ------------------------------------------------------------------ Pretreatment
const STATUS_CLASS: Record<string, string> = { required: 'st-req', recommended: 'st-rec', optional: 'st-opt', not_required: 'st-no', insufficient_data: 'st-ins' };

function Sizing({ it }: { it: PretreatmentItem }) {
  const s = it.sizing;
  if (!s || !it.inDesign) return null;
  if (s.kind === 'filter')
    return (
      <div className="sizing">
        <b>Sizing:</b> {s.vessels} × Ø{s.diameterMm} mm ({s.areaPerVesselM2} m² each), {s.actualRateMh} m/h at {s.flowM3h} m³/h (design ≤ {s.designRateMh} m/h)
        {s.backwashFlowM3h != null && <> · backwash {s.backwashFlowM3h} m³/h per vessel</>}
        <ul>
          {s.media.map((m) => (
            <li key={m.name}>
              {m.name}: {m.depthM} m bed, {m.volumeL.toLocaleString()} L, ≈ {m.massKg.toLocaleString()} kg
            </li>
          ))}
        </ul>
      </div>
    );
  if (s.kind === 'cartridge')
    return (
      <div className="sizing">
        <b>Sizing:</b> {s.housings} housing(s) × {s.roundsPerHousing} × 40" elements, {s.micron} µm, {s.flowM3h} m³/h. {s.notes.join(' ')}
      </div>
    );
  return (
    <div className="sizing">
      <b>Sizing:</b> {s.vessels} × Ø{s.diameterMm} mm, {s.resinPerVesselL} L resin each (bed {s.bedDepthM} m), service {s.serviceRateMh} m/h, hardness {s.hardnessMgL} mg/L CaCO3, salt {s.saltPerRegenKg} kg/regeneration. {s.notes.join(' ')}
    </div>
  );
}

export function PretreatmentResults({ result, onOverride, data }: Props & { data?: DesignInput; onOverride?: (id: string, v: 'auto' | 'include' | 'exclude') => void }) {
  const pt = result.pretreatment;
  const sc = pt.scaling;
  return (
    <>
      <Card title="Preliminary pretreatment recommendation">
        <p className="muted small">
          Each item states WHY it is (or is not) recommended and the data/assumptions used. Items marked <span className="status st-ins">INSUFFICIENT DATA — LAB ANALYSIS REQUIRED</span> need lab analysis before the decision is final.
        </p>
        <div className="pt-list">
          {pt.items.map((it) => (
            <div key={it.id} className={`pt-item ${it.inDesign ? 'in' : 'out'}`}>
              <div className="pt-head">
                <span className={`status ${STATUS_CLASS[it.status]}`}>{PT_STATUS_LABEL[it.status]}</span>
                <strong>{it.name}</strong>
                <span className={`pill ${it.inDesign ? 'pill-in' : ''}`}>{it.inDesign ? 'In design' : 'Not in design'}</span>
                {onOverride && data && (
                  <select className="pt-override" value={data.pretreatment.overrides[it.id] ?? 'auto'} onChange={(e) => onOverride(it.id, e.target.value as 'auto')}>
                    <option value="auto">Auto (recommendation)</option>
                    <option value="include">Force include</option>
                    <option value="exclude">Exclude</option>
                  </select>
                )}
              </div>
              <p className="pt-reason">{it.reason}</p>
              {it.basis.length > 0 && <p className="muted small">Basis: {it.basis.join(' ')}</p>}
              {it.dataRequired.length > 0 && <p className="small danger">Data required: {it.dataRequired.join(', ')}</p>}
              <Sizing it={it} />
            </div>
          ))}
        </div>
      </Card>
      <Card title="Scaling indices (screening estimate at design recovery)">
        {sc ? (
          <>
            <KV
              items={[
                ['Concentration factor', fmt(sc.concentrationFactor, 2)],
                ['Feed LSI', fmt(sc.feedLsi, 2)],
                ['Concentrate pH (approx.)', fmt(sc.concentratePh, 2)],
                ['Concentrate LSI', fmt(sc.concentrateLsi, 2)],
                ['Concentrate LSI after acid', pt.acidTargetPh != null ? `${fmt(pt.scalingAfterTreatment?.concentrateLsi, 2)} (feed pH ${pt.acidTargetPh})` : '–'],
                ['CaSO4 saturation', fmt(sc.caso4SatPct, 0, '%')],
                ['Silica in concentrate', `${fmt(sc.silicaConcMgL, 1, 'mg/L')} (${fmt(sc.silicaSatPct, 0, '%')} of ${fmt(sc.silicaSolubilityMgL, 0, 'mg/L')})`],
                ['Max recovery limited by silica', fmt(sc.maxRecoveryBySilicaPct, 1, '%')],
                ['BaSO4 saturation', fmt(sc.baso4SatPct, 0, '%')],
                ['SrSO4 saturation', fmt(sc.srso4SatPct, 0, '%')],
                ['Scale control strategy', pt.scaleStrategy],
              ]}
            />
            {sc.notes.length > 0 && (
              <ul className="bullets small">
                {sc.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            )}
            <p className="muted small">LSI (Langelier), Davies activity coefficients for sulfates, concentrate pH ≈ feed pH + log10(CF). Confirm with antiscalant supplier software.</p>
          </>
        ) : (
          <p className="muted">Not available.</p>
        )}
      </Card>
      <DosingResults result={result} />
      <Card title="Pretreatment checks">
        <FindingsList findings={result.findings} sections={['Pretreatment', 'Raw Water', 'Dosing']} />
      </Card>
    </>
  );
}

export function DosingResults({ result }: Props) {
  if (!result.dosing.length)
    return (
      <Card title="Chemical dosing">
        <p className="muted">No chemical dosing in this design.</p>
      </Card>
    );
  return (
    <Card title="Chemical dosing requirements">
      <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              <th>Chemical</th>
              <th>Dosing point</th>
              <th className="num">Dose mg/L</th>
              <th>Dose basis</th>
              <th className="num">Product kg/day</th>
              <th className="num">Solution L/h</th>
              <th className="num">Pump L/h</th>
              <th className="num">Tank L</th>
            </tr>
          </thead>
          <tbody>
            {result.dosing.map((d) => (
              <tr key={d.id}>
                <td>{d.chemical}</td>
                <td className="small">{d.dosingPoint}</td>
                <td className="num">{d.doseMgL}</td>
                <td className="small">{d.doseBasis}</td>
                <td className="num">{d.productKgDay}</td>
                <td className="num">{d.solutionLh}</td>
                <td className="num">{d.pumpCapacityLh}</td>
                <td className="num">{d.tankSelectedL}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {result.dosing.map((d) => (
        <details key={d.id}>
          <summary>{d.chemical} – calculation</summary>
          <StepsTable steps={d.steps} />
          <ul className="bullets small">
            {d.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </details>
      ))}
    </Card>
  );
}

// ------------------------------------------------------------------ Tanks
export function TankResults({ result }: Props) {
  return (
    <>
      <Card title="Tank sizing">
        <table className="table">
          <thead>
            <tr>
              <th>Tank</th>
              <th>Basis</th>
              <th className="num">Calculated m³</th>
              <th className="num">Recommended m³</th>
              <th className="num">Recommended L</th>
            </tr>
          </thead>
          <tbody>
            {result.tanks.map((t) => (
              <tr key={t.id}>
                <td>
                  {t.name}
                  {t.notes.map((n) => (
                    <div key={n} className="muted small">
                      {n}
                    </div>
                  ))}
                </td>
                <td className="small">
                  {t.basis}
                  <div className="formula">{t.formula}</div>
                </td>
                <td className="num">{fmt(t.calculatedM3, 3)}</td>
                <td className="num strong">{fmt(t.recommendedM3, 3)}</td>
                <td className="num">{t.recommendedL.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card title="Tank checks">
        <FindingsList findings={result.findings} sections={['Tanks']} empty="No tank warnings." />
      </Card>
    </>
  );
}

// ------------------------------------------------------------------ Electrical
export function ElectricalResults({ result, units }: Props & { units: DisplayUnits }) {
  const e = result.electrical;
  const max = Math.max(...e.loads.map((l) => l.ratedKw * l.qty), 1);
  return (
    <>
      <Card title="Estimated electrical load">
        <table className="table">
          <thead>
            <tr>
              <th>Load</th>
              <th className="num">Qty</th>
              <th className="num">Rated</th>
              <th className="num">Absorbed</th>
              <th className="num">h/day</th>
              <th style={{ width: '25%' }}>Share</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {e.loads.map((l) => (
              <tr key={l.name}>
                <td>{l.name}</td>
                <td className="num">{l.qty}</td>
                <td className="num">{fmtPower(l.ratedKw * l.qty, units)}</td>
                <td className="num">{fmtPower(l.absorbedKw * l.qty, units)}</td>
                <td className="num">{l.hoursPerDay}</td>
                <td>
                  <div className="bar">
                    <div style={{ width: `${((l.ratedKw * l.qty) / max) * 100}%` }} />
                  </div>
                </td>
                <td className="muted small">{l.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <StepsTable steps={e.steps} />
      </Card>
    </>
  );
}

// ------------------------------------------------------------------ BOM & cost
export function BomEditor({ result, data, update }: Props & { data: DesignInput; update: (fn: (d: DesignInput) => void) => void }) {
  const [showRemoved, setShowRemoved] = useState(false);
  const cats = [...new Set(result.bom.map((b) => b.category))];
  const setOv = (line: BomLine, field: string, value: unknown) =>
    update((d) => {
      if (line.custom) {
        const c = d.customBom.find((x) => x.id === line.id);
        if (c) (c as unknown as Record<string, unknown>)[field] = value;
        return;
      }
      const o = { ...(d.bomOverrides[line.id] ?? {}) } as Record<string, unknown>;
      if (value === undefined) delete o[field];
      else o[field] = value;
      d.bomOverrides[line.id] = o;
    });
  const currency = data.costing.currency || 'USD';
  return (
    <Card
      title={`Bill of Materials (preliminary) – ${result.bom.filter((b) => !b.removed).length} lines`}
      actions={
        <>
          <label className="checkbox small">
            <input type="checkbox" checked={showRemoved} onChange={(e) => setShowRemoved(e.target.checked)} /> show removed
          </label>
          <button
            className="btn btn-sm"
            onClick={() =>
              update((d) => {
                d.customBom.push({ id: `custom_${Date.now()}`, category: 'Additional items', item: 'New item', description: '', specification: '', quantity: 1, unit: 'pcs', notes: '', unitCost: 0, costCategory: 'equipment' });
              })
            }
          >
            + Add line
          </button>
          <button
            className="btn btn-sm btn-ghost"
            onClick={() => {
              if (confirm('Reset all BOM edits (quantities, specifications, costs) and remove custom lines?'))
                update((d) => {
                  d.bomOverrides = {};
                  d.customBom = [];
                });
            }}
          >
            Reset edits
          </button>
        </>
      }
    >
      <p className="muted small">Quantities and specifications are generated from the design. Edit any cell – edits are stored with the project and survive recalculation. Unit cost is optional (used by the cost estimate).</p>
      <div className="table-scroll">
        <table className="table bom">
          <thead>
            <tr>
              <th>Item</th>
              <th style={{ width: '17%' }}>Description</th>
              <th style={{ width: '22%' }}>Specification</th>
              <th className="num">Qty</th>
              <th>Unit</th>
              <th style={{ width: '18%' }}>Engineering notes</th>
              <th className="num">Unit cost ({currency})</th>
              <th className="num">Total</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {cats.map((cat) => (
              <Fragment key={cat}>
                <tr className="cat-row">
                  <td colSpan={9}>{cat}</td>
                </tr>
                {result.bom
                  .filter((b) => b.category === cat && (showRemoved || !b.removed))
                  .map((b) => (
                    <tr key={b.id} className={`${b.removed ? 'removed' : ''} ${b.edited ? 'edited' : ''}`}>
                      <td>{b.custom ? <input className="cell" value={b.item} onChange={(e) => setOv(b, 'item', e.target.value)} /> : b.item}</td>
                      <td>
                        <textarea className="cell wrap" rows={1} value={b.description} onChange={(e) => setOv(b, 'description', e.target.value)} />
                      </td>
                      <td>
                        <textarea className="cell wrap" rows={1} value={b.specification} onChange={(e) => setOv(b, 'specification', e.target.value)} />
                      </td>
                      <td className="num">
                        <input className="cell num" type="number" step="any" value={b.quantity} onChange={(e) => setOv(b, 'quantity', e.target.value === '' ? undefined : Number(e.target.value))} />
                      </td>
                      <td>
                        <input className="cell short" value={b.unit} onChange={(e) => setOv(b, 'unit', e.target.value)} />
                      </td>
                      <td>
                        <textarea className="cell wrap" rows={1} value={b.notes} onChange={(e) => setOv(b, 'notes', e.target.value)} />
                      </td>
                      <td className="num">
                        <input className="cell num" type="number" step="any" min={0} value={b.unitCost || ''} placeholder="0" onChange={(e) => setOv(b, 'unitCost', e.target.value === '' ? undefined : Number(e.target.value))} />
                        {b.custom && (
                          <select className="cell" value={b.costCategory} onChange={(e) => setOv(b, 'costCategory', e.target.value as CostCategory)}>
                            <option value="equipment">equipment</option>
                            <option value="piping">piping</option>
                            <option value="electrical">electrical</option>
                            <option value="instrumentation">instrumentation</option>
                          </select>
                        )}
                      </td>
                      <td className="num">{b.total ? b.total.toLocaleString('en-US', { maximumFractionDigits: 2 }) : '–'}</td>
                      <td className="nowrap">
                        {b.custom ? (
                          <button className="btn btn-xs btn-danger" title="Delete line" onClick={() => update((d) => void (d.customBom = d.customBom.filter((x) => x.id !== b.id)))}>
                            ✕
                          </button>
                        ) : b.removed ? (
                          <button className="btn btn-xs" onClick={() => setOv(b, 'removed', undefined)}>
                            restore
                          </button>
                        ) : (
                          <button className="btn btn-xs btn-ghost" title="Remove from BOM" onClick={() => setOv(b, 'removed', true)}>
                            ✕
                          </button>
                        )}
                        {b.edited && !b.custom && (
                          <button
                            className="btn btn-xs btn-ghost"
                            title="Revert to calculated values"
                            onClick={() =>
                              update((d) => {
                                const o = d.bomOverrides[b.id];
                                if (o) d.bomOverrides[b.id] = { unitCost: o.unitCost, removed: o.removed };
                              })
                            }
                          >
                            ↺
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export function CostPanel({ result, data, update }: Props & { data: DesignInput; update: (fn: (d: DesignInput) => void) => void }) {
  const c = result.cost;
  const cur = data.costing.currency || 'USD';
  const money = (v: number) => `${cur} ${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return (
    <Card title="Cost estimation (optional)">
      <div className="inline-form">
        <label className="checkbox">
          <input type="checkbox" checked={data.costing.enabled} onChange={(e) => update((d) => void (d.costing.enabled = e.target.checked))} /> Enable cost estimate
        </label>
        <label>
          Currency
          <select value={cur} onChange={(e) => update((d) => void (d.costing.currency = e.target.value))}>
            <option value="USD">USD</option>
          </select>
        </label>
        {(
          [
            ['installationPct', 'Installation %'],
            ['engineeringPct', 'Engineering %'],
            ['contingencyPct', 'Contingency %'],
          ] as const
        ).map(([k, l]) => (
          <label key={k}>
            {l}
            <input type="number" step="any" min={0} value={data.costing[k]} onChange={(e) => update((d) => void (d.costing[k] = Number(e.target.value) || 0))} />
          </label>
        ))}
      </div>
      {data.costing.enabled ? (
        <>
          <table className="table cost-table">
            <tbody>
              <tr>
                <td>Equipment subtotal</td>
                <td className="num">{money(c.byCategory.equipment)}</td>
              </tr>
              <tr>
                <td>Instrumentation</td>
                <td className="num">{money(c.byCategory.instrumentation)}</td>
              </tr>
              <tr>
                <td>Piping</td>
                <td className="num">{money(c.byCategory.piping)}</td>
              </tr>
              <tr>
                <td>Electrical</td>
                <td className="num">{money(c.byCategory.electrical)}</td>
              </tr>
              <tr className="total">
                <td>Subtotal</td>
                <td className="num">{money(c.subtotal)}</td>
              </tr>
              <tr>
                <td>Installation ({data.costing.installationPct} % of subtotal)</td>
                <td className="num">{money(c.installation)}</td>
              </tr>
              <tr>
                <td>Engineering ({data.costing.engineeringPct} % of subtotal)</td>
                <td className="num">{money(c.engineering)}</td>
              </tr>
              <tr>
                <td>Contingency ({data.costing.contingencyPct} % of above)</td>
                <td className="num">{money(c.contingency)}</td>
              </tr>
              <tr className="grand">
                <td>Total estimated project cost</td>
                <td className="num">{money(c.total)}</td>
              </tr>
            </tbody>
          </table>
          {c.linesWithoutCost > 0 && <p className="note warn">🟡 {c.linesWithoutCost} BOM line(s) have no unit cost – enter unit costs in the BOM table for a complete estimate.</p>}
        </>
      ) : (
        <p className="muted">Costing is optional and disabled for this project. Enable it and enter unit costs in the BOM.</p>
      )}
    </Card>
  );
}
