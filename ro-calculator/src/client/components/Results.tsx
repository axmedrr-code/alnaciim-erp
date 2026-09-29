import { Fragment, useState } from 'react';
import type { BomLine, DesignResult, PretreatmentItem, PumpResult, StageResult } from '../../shared/engine';
import { HEAD_CATEGORY_LABEL, LAB_REQUIRED, PT_STATUS_LABEL } from '../../shared/engine';
import type { CostCategory, DesignInput, FittingType, PumpDutyId } from '../../shared/types';
import { FITTING_LABELS } from '../../shared/types';
import { fmt, fmtFlow, fmtPower, fmtPressure, type DisplayUnits } from '../../shared/units';
import { useApp } from '../context';
import { PumpCurveChart } from './PumpCurveChart';
import { Card, Counts, FindingsList, HowCalc, KV, LevelBadge, StepsTable } from './ui';

type Props = { result: DesignResult };
type Upd = (fn: (d: DesignInput) => void) => void;

// ------------------------------------------------------------------ Summary
export function SummaryDashboard({ result, units }: Props & { units: DisplayUnits }) {
  const s = result.summary;
  const t = result.trace;
  const tile = (label: string, value: string, sub?: string, trace?: string) => (
    <div className="tile">
      <div className="tile-label">{label}</div>
      <div className="tile-value">{value}</div>
      {sub && <div className="tile-sub">{sub}</div>}
      {trace && <HowCalc steps={t[trace]} title="How?" />}
    </div>
  );
  const pipes = s.pipeSizes.filter((p) => p.dn != null);
  const na = 'INSUFFICIENT DATA';
  return (
    <div className="summary">
      <div className="summary-title">
        <h2>RO DESIGN SUMMARY</h2>
        <Counts counts={result.counts} />
      </div>
      <div className="tiles">
        {tile('Production', fmtFlow(s.permeateM3h, units), 'design permeate flow', 'production')}
        {tile('Daily production', fmt(s.dailyProductionM3d, 1, 'm³/day'), undefined, 'daily')}
        {tile('Recovery', fmt(s.recoveryPct, 1, '%'), undefined, 'recovery')}
        {tile('Feed flow', fmtFlow(s.feedM3h, units), undefined, 'feed')}
        {tile('Reject', fmtFlow(s.rejectM3h, units), undefined, 'reject')}
        {tile('Membranes', `${s.membranes} pcs`, s.membrane, 'membranes')}
        {tile('Pressure vessels', `${s.vessels} pcs`, s.array, 'membranes')}
        {tile('Average flux', fmt(s.fluxLmh, 1, 'LMH'), undefined, 'flux')}
        {tile('Membrane feed pressure', s.feedPressureBar == null ? na : fmtPressure(s.feedPressureBar, units), 'solved element-by-element', 'feedPressure')}
        {tile('Permeate TDS', s.permeateTdsMgL == null ? na : fmt(s.permeateTdsMgL, 0, 'mg/L'), 'estimate', 'permeateTds')}
        {tile('HP pump', s.hpPressureBar == null ? na : `${fmtFlow(s.hpFlowM3h, units)} @ ${fmtPressure(s.hpPressureBar, units)}`, `TDH ${fmt(s.hpHeadM, 1, 'm')}`, 'hpPump')}
        {tile('HP pump motor', s.hpPressureBar == null ? na : `${fmtPower(s.hpMotorKw, units, 1)} standard`, `calculated requirement ${fmtPower(s.hpRequiredMotorKw, units, 2)}`, 'hpPump')}
        {tile('Raw water pump', `${fmtFlow(s.rawFlowM3h, units)} @ ${fmt(s.rawHeadM, 1, 'm')}`, `motor ${fmtPower(s.rawMotorKw, units, 1)} (req. ${fmtPower(s.rawRequiredMotorKw, units, 2)})`, 'rawPump')}
        {tile('Estimated total electrical load', fmtPower(s.connectedKw, units, 1), `running ≈ ${fmtPower(s.runningKw, units, 1)}, ${fmt(s.specificEnergyKwhM3, 2, 'kWh/m³')}`, 'electrical')}
        {tile('Feed osmotic pressure', s.osmoticFeedBar == null ? LAB_REQUIRED : fmtPressure(s.osmoticFeedBar, units, 2), result.chemistry.osmoticMethod, 'osmotic')}
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
        <HowCalc steps={t.pipes} />
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Membranes
function StageCard({ s, units }: { s: StageResult; units: DisplayUnits }) {
  return (
    <div className="stage-card">
      <h4>
        Stage {s.stage}: {s.vessels} vessels × {s.elementsPerVessel} membranes = {s.elements} membranes
      </h4>
      <KV
        items={[
          ['Feed → permeate + concentrate', `${fmtFlow(s.feedM3h, units)} → ${fmtFlow(s.permeateM3h, units)} + ${fmtFlow(s.concentrateM3h, units)}`],
          ['Stage recovery', fmt(s.recoveryPct, 1, '%')],
          ['Feed / concentrate per vessel', `${fmt(s.feedPerVesselM3h, 2)} / ${fmt(s.concentratePerVesselM3h, 2)} m³/h`],
          ['Pressure in → out (ΔP)', s.feedPressureBar == null ? 'INSUFFICIENT DATA' : `${fmt(s.feedPressureBar, 2)} → ${fmt(s.concentratePressureBar, 2)} bar (${fmt(s.dpBar, 2)})`],
          ['TDS feed / concentrate / permeate', s.feedTds == null ? 'INSUFFICIENT DATA' : `${fmt(s.feedTds, 0)} / ${fmt(s.concentrateTds, 0)} / ${fmt(s.permeateTds, 1)} mg/L`],
          ['Average flux', fmt(s.avgFluxLmh, 1, 'LMH')],
        ]}
      />
      {s.elementsDetail.length > 0 && (
        <div className="table-scroll">
          <table className="table el-table">
            <thead>
              <tr>
                <th>El.</th>
                <th className="num">Feed m³/h</th>
                <th className="num">Perm. m³/h</th>
                <th className="num">Conc. m³/h</th>
                <th className="num">Rec. %</th>
                <th className="num">Flux LMH</th>
                <th className="num">P feed bar</th>
                <th className="num">P avg bar</th>
                <th className="num">ΔP bar</th>
                <th className="num">π feed bar</th>
                <th className="num">π wall bar</th>
                <th className="num">π perm bar</th>
                <th className="num">NDP bar</th>
                <th className="num">β (CP)</th>
                <th className="num">Perm. TDS</th>
                <th className="num">Rej. %</th>
                <th className="num">TCF</th>
                <th className="num">PCF</th>
              </tr>
            </thead>
            <tbody>
              {s.elementsDetail.map((e) => (
                <tr key={e.position}>
                  <td>{e.position}</td>
                  <td className="num">{e.feedM3h}</td>
                  <td className="num">{e.permeateM3h}</td>
                  <td className="num">{e.concentrateM3h}</td>
                  <td className="num">{e.recoveryPct}</td>
                  <td className="num">{e.fluxLmh}</td>
                  <td className="num">{e.feedPressureBar}</td>
                  <td className="num">{e.avgPressureBar}</td>
                  <td className="num">{e.dpBar}</td>
                  <td className="num">{e.osmoticFeedBar}</td>
                  <td className="num">{e.osmoticMembraneBar}</td>
                  <td className="num">{e.osmoticPermeateBar}</td>
                  <td className="num strong">{e.ndpBar}</td>
                  <td className="num">{e.beta}</td>
                  <td className="num">{e.permeateTds}</td>
                  <td className="num">{e.rejectionPct}</td>
                  <td className="num">{e.tcf}</td>
                  <td className="num">{e.pressureCorrection}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

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
      <Card title={<>Membrane array – {m.membraneLabel}{m.isDemoData && <span className="demo-badge">DEMO DATA</span>}</>}>
        {!m.simulated && <div className="alert">{m.simulationMessage}</div>}
        <KV
          items={[
            ['Array', m.arrayLabel],
            ['Elements required for target flux', `${m.elementsRequired}`],
            ['Installed', `${m.vessels} vessels × ${m.elementsPerVessel} = ${m.elements} elements`],
            ['Average flux', `${fmt(m.actualFluxLmh, 1)} LMH (target ${m.designFluxTargetLmh}, max ${m.maxFluxLmh}${m.minFluxLmh ? `, min ${m.minFluxLmh}` : ''})`],
            ['Required feed pressure', m.feedPressureBar == null ? 'INSUFFICIENT DATA' : fmtPressure(m.feedPressureBar, units, 2)],
            ['Concentrate pressure', m.concentratePressureBar == null ? '–' : fmtPressure(m.concentratePressureBar, units, 2)],
            ['Array pressure drop', fmt(m.arrayDpBar, 2, 'bar')],
            ['Average NDP', fmt(m.ndpBar, 2, 'bar')],
            ['Osmotic pressure feed / concentrate', m.osmoticFeedBar == null ? '–' : `${fmt(m.osmoticFeedBar, 2)} / ${fmt(m.osmoticConcentrateBar, 2)} bar`],
            ['Average wall osmotic pressure', fmt(m.avgOsmoticBar, 2, 'bar')],
            ['TCF water / salt', m.tcf == null ? '–' : `${m.tcf} / ${m.tcfSalt}`],
            ['Permeability A / B (25 °C)', m.permeabilityLmhBar == null ? '–' : `${m.permeabilityLmhBar} LMH/bar / ${m.saltPermeabilityLmh} LMH`],
            ['Permeate TDS (estimate)', m.permeateTdsMgL == null ? 'INSUFFICIENT DATA' : fmt(m.permeateTdsMgL, 1, 'mg/L')],
            ['System salt rejection', fmt(m.rejectionPct, 2, '%')],
            ['Concentrate TDS', fmt(m.concentrateTdsMgL, 0, 'mg/L')],
            ['Capacity at target flux', fmtFlow(m.capacityAtTargetFluxM3h, units)],
          ]}
        />
      </Card>
      <Card title="Stage-by-stage calculation (one representative vessel per stage)">
        {m.stageDetail.map((s) => (
          <StageCard key={s.stage} s={s} units={units} />
        ))}
        <p>
          <b>
            Total: {m.elements} membranes in {m.vessels} pressure vessels ({m.vesselsPerStage.join(':')}).
          </b>
        </p>
        <p className="muted small">π = osmotic pressure; β = concentration polarisation; NDP = net driving pressure; TCF = temperature correction; PCF = pressure correction (element NDP ÷ datasheet test NDP).</p>
      </Card>
      <Card title="How was this calculated?">
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
function PumpCard({ p, units, data, update }: { p: PumpResult; units: DisplayUnits; data?: DesignInput; update?: Upd }) {
  const { library } = useApp();
  const id = p.id as PumpDutyId;
  const ov = data?.hydraulics.pumps[id] ?? {};
  const setOv = (k: string, v: number | null | undefined) =>
    update?.((d) => {
      const cur = { ...(d.hydraulics.pumps[id] ?? {}) } as Record<string, unknown>;
      if (v === undefined || v === null || (typeof v === 'number' && !isFinite(v))) delete cur[k];
      else cur[k] = v;
      d.hydraulics.pumps[id] = cur;
    });
  const cats = ['static', 'friction', 'minor', 'equipment', 'terminal', 'suction'] as const;
  const op = p.operatingPoint;
  return (
    <Card
      title={p.name}
      actions={p.enabled ? <span className="pill">{fmtFlow(p.designFlowM3h, units)} · TDH {fmt(p.designHeadM, 1, 'm')} · {fmtPressure(p.designPressureBar, units, 2)} · motor {fmtPower(p.standardMotorKw, units, 1)}</span> : <span className="pill muted">not included / not calculable</span>}
    >
      {!p.enabled ? (
        <p className="muted">This pump is not included or cannot be calculated (see warnings).</p>
      ) : (
        <div className="grid-2">
          <div>
            <table className="table">
              <thead>
                <tr>
                  <th>Head component</th>
                  <th className="num">m</th>
                  <th className="num">bar</th>
                  <th>Basis</th>
                </tr>
              </thead>
              <tbody>
                {cats.map((c) => {
                  const rows = p.components.filter((x) => x.category === c);
                  if (!rows.length) return null;
                  return (
                    <Fragment key={c}>
                      <tr className="cat-row">
                        <td colSpan={4}>{HEAD_CATEGORY_LABEL[c]}</td>
                      </tr>
                      {rows.map((x, i) => (
                        <tr key={i}>
                          <td>{x.label}</td>
                          <td className="num">{fmt(x.headM, 2)}</td>
                          <td className="num">{fmt(x.headM / 10.194, 3)}</td>
                          <td className="muted small">{x.note}</td>
                        </tr>
                      ))}
                    </Fragment>
                  );
                })}
                <tr className="total">
                  <td>Total Dynamic Head (calculated)</td>
                  <td className="num">{fmt(p.calculatedHeadM, 2)}</td>
                  <td className="num">{fmt(p.calculatedHeadM / 10.194, 3)}</td>
                  <td />
                </tr>
              </tbody>
            </table>
            <table className="table" style={{ marginTop: 10 }}>
              <tbody>
                <tr><td>Flow</td><td className="num">{fmtFlow(p.designFlowM3h, units)}</td></tr>
                <tr><td>Static head</td><td className="num">{fmt(p.staticHeadM, 2, 'm')}</td></tr>
                <tr><td>Pipe friction loss</td><td className="num">{fmt(p.frictionHeadM, 2, 'm')}</td></tr>
                <tr><td>Minor losses</td><td className="num">{fmt(p.minorHeadM, 2, 'm')}</td></tr>
                <tr><td>Equipment pressure loss</td><td className="num">{fmt(p.equipmentHeadM, 2, 'm')}</td></tr>
                <tr><td>Required operating pressure</td><td className="num">{fmt(p.terminalHeadM, 2, 'm')}</td></tr>
                {p.suctionCreditM !== 0 && <tr><td>Less suction pressure</td><td className="num">− {fmt(p.suctionCreditM, 2, 'm')}</td></tr>}
                <tr className="total"><td>Total Dynamic Head (design, incl. margin)</td><td className="num">{fmt(p.designHeadM, 1, 'm')} = {fmtPressure(p.designPressureBar, units, 2)}</td></tr>
                {p.dischargePressureBar != null && <tr><td>Suction / discharge pressure</td><td className="num">{fmtPressure(p.suctionPressureBar, units, 2)} / {fmtPressure(p.dischargePressureBar, units, 2)}</td></tr>}
                <tr><td>Hydraulic power ρ·g·Q·H</td><td className="num">{fmtPower(p.hydraulicKw, units, 2)}</td></tr>
                <tr><td>Pump efficiency ({p.efficiencySource})</td><td className="num">{p.efficiencyPct} %</td></tr>
                <tr><td>Shaft power = P_h ÷ η</td><td className="num">{fmtPower(p.shaftKw, units, 2)}</td></tr>
                <tr><td>Safety factor</td><td className="num">× {p.safetyFactor}</td></tr>
                <tr className="grand"><td>CALCULATED required motor power</td><td className="num">{fmtPower(p.requiredMotorKw, units, 2)}</td></tr>
                <tr className="grand"><td>RECOMMENDED standard motor size</td><td className="num">{fmtPower(p.standardMotorKw, units, 1)}</td></tr>
                <tr><td>Electrical input at duty</td><td className="num">{fmtPower(p.absorbedKw, units, 2)}</td></tr>
                <tr><td>NPSH available</td><td className="num">{p.npshAvailableM == null ? p.npshNote : fmt(p.npshAvailableM, 2, 'm')}</td></tr>
              </tbody>
            </table>
            <HowCalc steps={p.steps} />
          </div>
          <div>
            {data && update && (
              <div className="inline-form">
                <label>
                  Selected pump (curve)
                  <select value={ov.libraryPumpId ?? ''} onChange={(e) => setOv('libraryPumpId', e.target.value ? Number(e.target.value) : undefined)}>
                    <option value="">– none (operating point not confirmed) –</option>
                    {library?.pumps
                      .filter((x) => x.pumpType === p.pumpType)
                      .map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.manufacturer} {x.model} {x.isDemo ? '(DEMO)' : ''} {x.curve.length < 2 ? '– no curve' : ''}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  Efficiency %
                  <input type="number" step="any" placeholder={String(p.efficiencyPct)} value={ov.efficiencyPct ?? ''} onChange={(e) => setOv('efficiencyPct', e.target.value === '' ? undefined : Number(e.target.value))} />
                </label>
                <label>
                  Flow override m³/h
                  <input type="number" step="any" placeholder={String(p.designFlowM3h)} value={ov.flowM3h ?? ''} onChange={(e) => setOv('flowM3h', e.target.value === '' ? undefined : Number(e.target.value))} />
                </label>
                <label>
                  Extra valve/equipment loss bar
                  <input type="number" step="any" placeholder="0" value={ov.extraLossBar ?? ''} onChange={(e) => setOv('extraLossBar', e.target.value === '' ? undefined : Number(e.target.value))} />
                </label>
              </div>
            )}
            {p.selectedPump && op ? (
              <>
                <p className="small">
                  <b>
                    {p.selectedPump.manufacturer} {p.selectedPump.model}
                  </b>
                  {p.selectedPump.isDemo && <span className="demo-badge">DEMO CURVE</span>}
                </p>
                <PumpCurveChart curve={op.pumpCurve} op={op} dutyFlow={p.designFlowM3h} dutyHead={p.designHeadM} />
                <KV
                  items={[
                    ['Head at design flow', op.headAtDesignFlowM == null ? 'outside curve' : fmt(op.headAtDesignFlowM, 1, 'm')],
                    ['Excess head at design flow', fmt(op.excessHeadPct, 1, '%')],
                    ['Efficiency at duty (curve)', fmt(op.efficiencyAtDesignPct, 1, '%')],
                    ['NPSHr at duty', fmt(op.npshrAtDesignM, 2, 'm')],
                    ['Duty / BEP flow', op.bepRatio == null ? '–' : `${Math.round(op.bepRatio * 100)} % (BEP ${op.bepFlowM3h} m³/h)`],
                    ['Natural operating point (no throttling)', op.intersectFlowM3h == null ? '–' : `${op.intersectFlowM3h} m³/h @ ${op.intersectHeadM} m`],
                    ['Power at duty (curve)', fmt(op.powerAtDesignKw, 2, 'kW')],
                    ['Pump motor (library)', fmt(p.selectedPump.motorKw, 1, 'kW')],
                  ]}
                />
              </>
            ) : (
              <p className="note warn">🟡 Pump operating point requires confirmation – select a pump with its manufacturer curve (Pump Library).</p>
            )}
            {p.candidates.length > 0 && (
              <p className="small muted">
                Curves in the library that cover this duty: {p.candidates.map((c) => `${c.label} (${c.headAtFlowM} m at duty${c.bepRatio ? `, ${Math.round(c.bepRatio * 100)} % BEP` : ''})`).join('; ')}
              </p>
            )}
            {p.notes.map((n, i) => (
              <p key={i} className="note muted">
                {n}
              </p>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

export function PumpResults({ result, units, data, update }: Props & { units: DisplayUnits; data?: DesignInput; update?: Upd }) {
  return (
    <>
      {result.pumps.map((p) => (
        <PumpCard key={p.id} p={p} units={units} data={data} update={update} />
      ))}
      <Card title="Pump checks">
        {result.hpSuctionAvailableBar != null && <p>HP pump suction pressure: {fmtPressure(result.hpSuctionAvailableBar, units)}</p>}
        <FindingsList findings={result.findings} sections={['Pumps']} />
      </Card>
    </>
  );
}

// ------------------------------------------------------------------ Pipes
export function PipeResults({ result, units, update, data }: Props & { units: DisplayUnits; data?: DesignInput; update?: Upd }) {
  const { library } = useApp();
  const [open, setOpen] = useState<string | null>(null);
  const setOv = (pid: string, field: string, value: unknown) =>
    update?.((d) => {
      const cur = { ...((d.hydraulics.pipes as Record<string, object | undefined>)[pid] ?? {}) } as Record<string, unknown>;
      if (value === undefined || value === '') delete cur[field];
      else cur[field] = value;
      (d.hydraulics.pipes as Record<string, unknown>)[pid] = cur;
    });
  const method = result.pipes[0]?.method ?? 'darcy';
  return (
    <>
      <Card
        title="Pipe hydraulic calculation"
        actions={
          data &&
          update && (
            <label className="picker">
              Friction method
              <select value={data.hydraulics.frictionMethod} onChange={(e) => update((d) => void (d.hydraulics.frictionMethod = e.target.value as 'darcy'))}>
                <option value="darcy">Darcy–Weisbach (Swamee–Jain)</option>
                <option value="hazen">Hazen–Williams</option>
              </select>
            </label>
          )
        }
      >
        <p className="muted small">
          d = √(4·Q ÷ (π·v<sub>max</sub>)) → smallest catalogue ID ≥ d (or forced DN). Friction: {method === 'hazen' ? 'Hazen–Williams (Darcy–Weisbach shown as cross-check)' : 'Darcy–Weisbach, Swamee–Jain friction factor, viscosity at feed temperature (Hazen–Williams shown as cross-check)'}. Minor losses h = ΣK·v²/2g.
          {update && ' Click a row to edit material, max velocity, DN, length, elevation, design pressure and fittings.'}
        </p>
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Section</th>
                <th className="num">Flow</th>
                <th>Material</th>
                <th className="num">DN</th>
                <th className="num">ID mm</th>
                <th className="num">v m/s</th>
                <th className="num">v max</th>
                <th className="num">Re</th>
                <th className="num">f</th>
                <th className="num">L m</th>
                <th className="num">h_f m</th>
                <th className="num">per 100 m</th>
                <th className="num">{method === 'hazen' ? 'D-W m' : 'H-W m'}</th>
                <th className="num">ΣK</th>
                <th className="num">h_m m</th>
                <th className="num">Total bar</th>
                <th className="num">P / rating</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {result.pipes.map((p) => (
                <Fragment key={p.id}>
                  <tr className={update ? 'clickable' : ''} onClick={() => update && setOpen(open === p.id ? null : p.id)}>
                    <td>{p.label}</td>
                    <td className="num">{fmtFlow(p.flowM3h, units)}</td>
                    <td className="small">{p.material}</td>
                    <td className="num strong">
                      {p.dn ?? '–'}
                      {p.dnForced ? '*' : ''}
                    </td>
                    <td className="num">{p.innerDiameterMm ?? '–'}</td>
                    <td className="num">{p.velocity}</td>
                    <td className="num">{p.maxVelocity}</td>
                    <td className="num">{p.reynolds.toLocaleString()}</td>
                    <td className="num">{p.frictionFactor}</td>
                    <td className="num">{p.lengthM}</td>
                    <td className="num">{fmt(p.frictionLossM, 3)}</td>
                    <td className="num">{fmt(p.lossPer100m, 3)}</td>
                    <td className="num muted">{fmt(method === 'hazen' ? p.darcyLossM : p.hazenLossM, 3)}</td>
                    <td className="num">{p.sumK}</td>
                    <td className="num">{fmt(p.minorLossM, 3)}</td>
                    <td className="num">{fmt(p.totalLossBar, 3)}</td>
                    <td className="num">
                      {p.designPressureBar} / {p.pressureRatingBar ?? '–'}
                    </td>
                    <td>
                      <LevelBadge level={p.status} />
                    </td>
                  </tr>
                  {open === p.id && (
                    <tr className="edit-row">
                      <td colSpan={18}>
                        {data && update && (
                          <>
                            <div className="inline-form">
                              <label>
                                Material
                                <select value={data.hydraulics.pipes[p.id]?.material ?? ''} onChange={(e) => setOv(p.id, 'material', e.target.value || undefined)}>
                                  <option value="">default ({p.material})</option>
                                  {library?.pipeMaterials.map((m) => (
                                    <option key={m.name} value={m.name}>
                                      {m.name}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <label>
                                Forced DN
                                <select value={data.hydraulics.pipes[p.id]?.dn ?? ''} onChange={(e) => setOv(p.id, 'dn', e.target.value ? Number(e.target.value) : undefined)}>
                                  <option value="">calculated</option>
                                  {library?.pipeSizes
                                    .filter((s) => s.material === p.material)
                                    .map((s) => (
                                      <option key={s.id} value={s.dn}>
                                        DN {s.dn} (ID {s.innerDiameterMm})
                                      </option>
                                    ))}
                                </select>
                              </label>
                              {(
                                [
                                  ['maxVelocity', 'Max velocity m/s', p.maxVelocity],
                                  ['lengthM', 'Length m', p.lengthM],
                                  ['elevationM', 'Elevation m', p.elevationM],
                                  ['designPressureBar', 'Design pressure bar', p.designPressureBar],
                                ] as const
                              ).map(([k, l, ph]) => (
                                <label key={k}>
                                  {l}
                                  <input type="number" step="any" placeholder={String(ph)} value={(data.hydraulics.pipes[p.id] as Record<string, number> | undefined)?.[k] ?? ''} onChange={(e) => setOv(p.id, k, e.target.value === '' ? undefined : Number(e.target.value))} />
                                </label>
                              ))}
                            </div>
                            <div className="inline-form">
                              <span className="cat-label">Fittings & valves (count):</span>
                              {(Object.keys(FITTING_LABELS) as FittingType[]).map((ft) => {
                                const cur = data.hydraulics.pipes[p.id]?.fittings ?? Object.fromEntries(p.fittings.map((x) => [x.type, x.count]));
                                return (
                                  <label key={ft} style={{ minWidth: 90 }}>
                                    {FITTING_LABELS[ft]}
                                    <input
                                      type="number"
                                      min={0}
                                      step={1}
                                      value={(cur as Record<string, number>)[ft] ?? 0}
                                      onChange={(e) => setOv(p.id, 'fittings', { ...cur, [ft]: Math.max(0, Number(e.target.value) || 0) })}
                                    />
                                  </label>
                                );
                              })}
                              <button className="btn btn-xs btn-ghost" onClick={() => setOv(p.id, 'fittings', undefined)}>
                                default fittings
                              </button>
                            </div>
                          </>
                        )}
                        <StepsTable steps={p.steps} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small">* DN forced by user. Pressure loss per 100 m refers to straight-pipe friction.</p>
      </Card>
      <Card title="Pipe checks">
        <FindingsList findings={result.findings} sections={['Pipes']} />
      </Card>
    </>
  );
}

// ------------------------------------------------------------------ Water chemistry
export function ChemistryResults({ result }: Props) {
  const c = result.chemistry;
  const w = result.water;
  return (
    <>
      <Card title="Ions and ionic balance">
        {!c.majorIonsComplete && (
          <p className="lab-required">
            {LAB_REQUIRED}: {c.missingMajorIons.join(', ')}
          </p>
        )}
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Ion</th>
                <th>Type</th>
                <th className="num">mg/L</th>
                <th className="num">mmol/L</th>
                <th className="num">meq/L</th>
              </tr>
            </thead>
            <tbody>
              {c.ions.map((i) => (
                <tr key={i.ion}>
                  <td>
                    {i.ion}
                    {i.major && <span className="imp imp-required" style={{ marginLeft: 6 }}>major</span>}
                  </td>
                  <td className="small">{i.kind}</td>
                  <td className="num">{i.mgL == null ? <span className={i.major ? 'lab-required' : 'muted'}>{i.major ? 'LAB DATA REQUIRED' : '–'}</span> : fmt(i.mgL, 2)}</td>
                  <td className="num">{fmt(i.mmolL, 3)}</td>
                  <td className="num">{fmt(i.meqL, 3)}</td>
                </tr>
              ))}
              <tr className="total">
                <td>Σ cations / Σ anions</td>
                <td />
                <td />
                <td />
                <td className="num">{c.cationsMeqL == null ? LAB_REQUIRED : `${c.cationsMeqL} / ${c.anionsMeqL}`}</td>
              </tr>
              <tr className="total">
                <td>Ionic balance error</td>
                <td />
                <td />
                <td />
                <td className="num">{c.balanceErrorPct == null ? LAB_REQUIRED : `${c.balanceErrorPct} %`}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>
      <Card title="Total dissolved solids and osmotic pressure">
        <KV
          items={[
            ['TDS measured', c.tdsMeasured == null ? LAB_REQUIRED : fmt(c.tdsMeasured, 0, 'mg/L')],
            ['TDS – sum of ions', c.tdsFromIons == null ? LAB_REQUIRED : fmt(c.tdsFromIons, 0, 'mg/L')],
            ['TDS – from conductivity', c.tdsFromConductivity == null ? '–' : fmt(c.tdsFromConductivity, 0, 'mg/L')],
            ['TDS used for design', c.tdsUsed == null ? LAB_REQUIRED : `${fmt(c.tdsUsed, 0, 'mg/L')} (${c.tdsBasis})`],
            ['Temperature', w.temperature == null ? LAB_REQUIRED : `${w.temperature} °C`],
            ['Feed osmotic pressure', c.osmoticFeedBar == null ? LAB_REQUIRED : `${fmt(c.osmoticFeedBar, 3)} bar – ${c.osmoticMethod}`],
          ]}
        />
        <StepsTable steps={c.steps} />
      </Card>
      <Card title="Scaling indicators (feed and concentrate at design recovery)">
        <table className="table">
          <thead>
            <tr>
              <th>Indicator</th>
              <th className="num">Feed</th>
              <th className="num">Concentrate</th>
              <th>Status</th>
              <th>Interpretation</th>
            </tr>
          </thead>
          <tbody>
            {c.indicators.map((i) => (
              <tr key={i.name}>
                <td>{i.name}</td>
                <td className="num">{i.feed == null ? '–' : `${i.feed}${i.unit === '%' ? ' %' : ''}`}</td>
                <td className="num">{i.concentrate == null ? '–' : `${i.concentrate}${i.unit === '%' ? ' %' : ''}`}</td>
                <td>{i.status === 'insufficient' ? <span className="status st-ins">LAB DATA REQUIRED</span> : <LevelBadge level={i.status} />}</td>
                <td className="small">
                  {i.interpretation}
                  {i.dataRequired.length > 0 && <div className="danger">Required: {i.dataRequired.join(', ')}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small">LSI/RSI (Langelier/Ryznar); sulfate saturation with Davies activity coefficients; silica solubility vs temperature (pH effect not modelled). Screening indicators – confirm with antiscalant supplier software.</p>
      </Card>
      <Card title="Water-quality warnings">
        <FindingsList findings={result.findings} sections={['Water Chemistry', 'Water Quality', 'Raw Water']} />
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
              <th>Dose status</th>
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
                <td className="small">{d.doseStatus === 'indicative' ? <span className="dose-indicative">INDICATIVE – supplier confirmation required</span> : d.doseStatus === 'supplier' ? 'supplier projection' : 'calculated'}</td>
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
