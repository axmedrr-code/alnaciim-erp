import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AssumptionReader } from '../../shared/assumptions';
import { sizePipe } from '../../shared/engine';
import { convertFlow, convertLength, convertPower, convertPressure, FLOW_UNITS, fmt, POWER_UNITS, PRESSURE_UNITS, UNIT_LABEL, type DisplayUnits, type FlowUnit, type PowerUnit, type PressureUnit } from '../../shared/units';
import { api } from '../api';
import { AssumptionsEditor } from '../components/AssumptionsEditor';
import { PfdDiagram } from '../components/PfdDiagram';
import { BomEditor, CostPanel, PretreatmentResults, SummaryDashboard } from '../components/Results';
import { Card, Counts, Disclaimer, Empty, FindingsList, KV, LevelBadge, NumField, PageHeader, ProjectPicker, SelectField, StepsTable, TextField } from '../components/ui';
import { useApp, useProjectDesign } from '../context';
import type { PretreatmentItemId } from '../../shared/types';

// ------------------------------------------------------------------ Pipe calculator
export function PipeCalculatorPage() {
  const { library, settings, reloadLibrary, toast } = useApp();
  const [flow, setFlow] = useState<number | null>(30);
  const [flowUnit, setFlowUnit] = useState<FlowUnit>('m3/h');
  const [material, setMaterial] = useState('PVC-U PN16');
  const [vmax, setVmax] = useState<number | null>(1.5);
  const [length, setLength] = useState<number | null>(100);
  const [elev, setElev] = useState<number | null>(0);
  const [pressure, setPressure] = useState<number | null>(6);
  const [temp, setTemp] = useState<number | null>(25);
  const [catMat, setCatMat] = useState('');
  const [newSize, setNewSize] = useState({ dn: '', od: '', wall: '', rating: '' });
  const [newMat, setNewMat] = useState({ name: '', roughness: '', description: '' });

  const res = useMemo(() => {
    if (!library || !settings || flow == null) return null;
    const A = new AssumptionReader(settings.assumptions);
    return sizePipe(
      { flowM3h: convertFlow(flow, flowUnit, 'm3/h'), material, maxVelocity: vmax ?? 0, lengthM: length ?? 0, elevationM: elev ?? 0, designPressureBar: pressure ?? 0, temperatureC: temp ?? 25, fittingsPct: A.n('fittings_allowance') },
      library.pipeSizes,
      library.pipeMaterials,
      A,
    );
  }, [library, settings, flow, flowUnit, material, vmax, length, elev, pressure, temp]);

  if (!library || !settings) return <p className="muted">Loading…</p>;
  const cat = library.pipeSizes.filter((p) => p.material === (catMat || library.pipeMaterials[0]?.name));
  return (
    <>
      <PageHeader title="Pipe Calculator" subtitle="Nominal diameter is calculated from flow and maximum velocity, then the next catalogue size is selected. The catalogue below is editable." />
      <div className="grid-2">
        <Card title="Inputs">
          <div className="form-grid">
            <NumField label="Flow" value={flow} onChange={setFlow} allowNull={false} />
            <SelectField label="Flow unit" value={flowUnit} options={FLOW_UNITS.map((u) => ({ value: u, label: UNIT_LABEL[u] }))} onChange={setFlowUnit} />
            <SelectField label="Pipe material" value={material} options={library.pipeMaterials.map((m) => ({ value: m.name, label: m.name }))} onChange={setMaterial} />
            <NumField label="Maximum design velocity" unit="m/s" value={vmax} onChange={setVmax} allowNull={false} />
            <NumField label="Pipe length" unit="m" value={length} onChange={setLength} allowNull={false} />
            <NumField label="Elevation (rise)" unit="m" value={elev} onChange={setElev} allowNull={false} warnNegative={false} />
            <NumField label="Design pressure" unit="bar" value={pressure} onChange={setPressure} allowNull={false} />
            <NumField label="Water temperature" unit="°C" value={temp} onChange={setTemp} allowNull={false} />
          </div>
          <p className="muted small">Fittings allowance {String(settings.assumptions.fittings_allowance)} % (Settings → assumptions).</p>
        </Card>
        <Card title="Result" actions={res && <LevelBadge level={res.status} />}>
          {res ? (
            <>
              <KV
                items={[
                  ['Flow', fmt(res.flowM3h, 2, 'm³/h')],
                  ['Required internal diameter', fmt(res.requiredIdMm, 1, 'mm')],
                  ['Recommended DN', res.dn ? `DN ${res.dn}` : '–'],
                  ['Outer / internal diameter', `${res.outerDiameterMm ?? '–'} / ${res.innerDiameterMm ?? '–'} mm`],
                  ['Velocity', fmt(res.velocity, 2, 'm/s')],
                  ['Friction loss', `${fmt(res.frictionLossM, 2, 'm')} (${fmt(res.lossPer100m, 2, 'm/100 m')})`],
                  ['Total loss incl. fittings', `${fmt(res.totalLossM, 2, 'm')} = ${fmt(res.totalLossBar, 3, 'bar')}`],
                  ['Static head (elevation)', fmt(res.staticHeadM, 1, 'm')],
                  ['Total head required', fmt(res.totalLossM + res.staticHeadM, 2, 'm')],
                  ['Pressure rating', res.pressureRatingBar ? `${res.pressureRatingBar} bar` : '–'],
                ]}
              />
              {res.messages.map((m, i) => (
                <p key={i} className={m.level === 'critical' ? 'danger' : 'warn'}>
                  {m.level === 'critical' ? '🔴' : '🟡'} {m.text}
                </p>
              ))}
              <StepsTable steps={res.steps} />
            </>
          ) : (
            <p className="muted">Enter a flow.</p>
          )}
        </Card>
      </div>
      <UnitConverter />
      <Card
        title="Pipe catalogue (local database)"
        actions={
          <select value={catMat || library.pipeMaterials[0]?.name} onChange={(e) => setCatMat(e.target.value)}>
            {library.pipeMaterials.map((m) => (
              <option key={m.name}>{m.name}</option>
            ))}
          </select>
        }
      >
        <p className="muted small">{library.pipeMaterials.find((m) => m.name === (catMat || library.pipeMaterials[0]?.name))?.description} Roughness {library.pipeMaterials.find((m) => m.name === (catMat || library.pipeMaterials[0]?.name))?.roughnessMm} mm.</p>
        <table className="table">
          <thead>
            <tr>
              <th className="num">DN</th>
              <th className="num">OD mm</th>
              <th className="num">Wall mm</th>
              <th className="num">ID mm</th>
              <th className="num">Rating bar</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {cat.map((p) => (
              <tr key={p.id}>
                <td className="num">{p.dn}</td>
                <td className="num">{p.outerDiameterMm}</td>
                <td className="num">{p.wallMm}</td>
                <td className="num">{p.innerDiameterMm}</td>
                <td className="num">{p.pressureRatingBar}</td>
                <td>
                  <button
                    className="btn btn-xs btn-danger"
                    onClick={async () => {
                      if (!confirm(`Delete DN ${p.dn} (${p.material})?`)) return;
                      await api.deletePipeSize(p.id);
                      await reloadLibrary();
                    }}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            <tr className="edit-row">
              {(['dn', 'od', 'wall', 'rating'] as const).map((k) => (
                <td key={k} className="num" colSpan={k === 'wall' ? 2 : 1}>
                  <input className="cell num" placeholder={k === 'dn' ? 'DN' : k === 'od' ? 'OD mm' : k === 'wall' ? 'wall mm (ID = OD − 2·wall)' : 'bar'} value={newSize[k]} onChange={(e) => setNewSize({ ...newSize, [k]: e.target.value })} />
                </td>
              ))}
              <td>
                <button
                  className="btn btn-xs btn-primary"
                  onClick={async () => {
                    const od = Number(newSize.od);
                    const wall = Number(newSize.wall);
                    try {
                      await api.savePipeSize({ material: catMat || library.pipeMaterials[0].name, dn: Number(newSize.dn), outerDiameterMm: od, wallMm: wall, innerDiameterMm: Math.round((od - 2 * wall) * 10) / 10, pressureRatingBar: Number(newSize.rating) });
                      setNewSize({ dn: '', od: '', wall: '', rating: '' });
                      await reloadLibrary();
                      toast('Pipe size added');
                    } catch (e) {
                      toast((e as Error).message, 'error');
                    }
                  }}
                >
                  Add size
                </button>
              </td>
            </tr>
          </tbody>
        </table>
        <h4>Add / update material</h4>
        <div className="inline-form">
          <label>
            Name
            <input value={newMat.name} onChange={(e) => setNewMat({ ...newMat, name: e.target.value })} />
          </label>
          <label>
            Roughness mm
            <input type="number" step="any" value={newMat.roughness} onChange={(e) => setNewMat({ ...newMat, roughness: e.target.value })} />
          </label>
          <label>
            Description
            <input value={newMat.description} onChange={(e) => setNewMat({ ...newMat, description: e.target.value })} />
          </label>
          <button
            className="btn btn-sm"
            onClick={async () => {
              try {
                await api.savePipeMaterial({ name: newMat.name, roughnessMm: Number(newMat.roughness), description: newMat.description });
                setNewMat({ name: '', roughness: '', description: '' });
                await reloadLibrary();
                toast('Material saved – now add its sizes');
              } catch (e) {
                toast((e as Error).message, 'error');
              }
            }}
          >
            Save material
          </button>
        </div>
      </Card>
    </>
  );
}

export function UnitConverter() {
  const [fv, setFv] = useState<number | null>(30);
  const [fu, setFu] = useState<FlowUnit>('m3/h');
  const [pv, setPv] = useState<number | null>(15);
  const [pu, setPu] = useState<PressureUnit>('bar');
  const [wv, setWv] = useState<number | null>(22);
  const [wu, setWu] = useState<PowerUnit>('kW');
  const [lv, setLv] = useState<number | null>(100);
  return (
    <Card title="Unit converter">
      <div className="grid-4">
        <div>
          <div className="inline-form">
            <NumField label="Flow" value={fv} onChange={setFv} />
            <SelectField label="from" value={fu} options={FLOW_UNITS.map((u) => ({ value: u, label: UNIT_LABEL[u] }))} onChange={setFu} />
          </div>
          <ul className="conv">{fv != null && FLOW_UNITS.map((u) => <li key={u}>{fmt(convertFlow(fv, fu, u), 3)} {UNIT_LABEL[u]}</li>)}</ul>
        </div>
        <div>
          <div className="inline-form">
            <NumField label="Pressure / head" value={pv} onChange={setPv} />
            <SelectField label="from" value={pu} options={PRESSURE_UNITS.map((u) => ({ value: u, label: UNIT_LABEL[u] }))} onChange={setPu} />
          </div>
          <ul className="conv">{pv != null && PRESSURE_UNITS.map((u) => <li key={u}>{fmt(convertPressure(pv, pu, u), 3)} {UNIT_LABEL[u]}</li>)}</ul>
        </div>
        <div>
          <div className="inline-form">
            <NumField label="Power" value={wv} onChange={setWv} />
            <SelectField label="from" value={wu} options={POWER_UNITS.map((u) => ({ value: u, label: UNIT_LABEL[u] }))} onChange={setWu} />
          </div>
          <ul className="conv">{wv != null && POWER_UNITS.map((u) => <li key={u}>{fmt(convertPower(wv, wu, u), 3)} {UNIT_LABEL[u]}</li>)}</ul>
        </div>
        <div>
          <NumField label="Diameter mm" value={lv} onChange={setLv} />
          <ul className="conv">
            {lv != null && (
              <>
                <li>{fmt(convertLength(lv, 'mm', 'inch'), 3)} inch</li>
                <li>≈ DN {lv} (DN is a nominal size – see pipe catalogue for real ID)</li>
              </>
            )}
          </ul>
        </div>
      </div>
      <p className="muted small">Head ↔ pressure uses ρ = 1000 kg/m³, g = 9.81 m/s² (1 bar = 10.19 m).</p>
    </Card>
  );
}

// ------------------------------------------------------------------ Active project pages
function useActive() {
  const { activeProjectId } = useApp();
  return useProjectDesign(activeProjectId);
}

function ActiveHeader({ title, subtitle, dirty, save, saving, extra }: { title: string; subtitle: string; dirty?: boolean; save?: () => void; saving?: boolean; extra?: React.ReactNode }) {
  return (
    <PageHeader
      title={title}
      subtitle={subtitle}
      actions={
        <>
          <ProjectPicker />
          {dirty && <span className="dirty">● unsaved</span>}
          {save && (
            <button className="btn btn-primary" disabled={!dirty || saving} onClick={save}>
              Save
            </button>
          )}
          {extra}
        </>
      }
    />
  );
}

export function PretreatmentPage() {
  const { project, data, result, update, dirty, save, saving } = useActive();
  return (
    <>
      <ActiveHeader title="Pretreatment" subtitle="Water-analysis-based pretreatment recommendation with reasons, assumptions and sizing for the selected project." dirty={dirty} save={() => void save()} saving={saving} />
      {!project || !data || !result ? (
        <Empty>Select a project above.</Empty>
      ) : (
        <>
          <p>
            <Link to={`/design/${project.id}?tab=water`}>Edit water analysis →</Link>
          </p>
          <PretreatmentResults result={result} data={data} onOverride={(id, v) => update((d) => void (d.pretreatment.overrides[id as PretreatmentItemId] = v))} />
        </>
      )}
    </>
  );
}

export function BomPage() {
  const { project, data, result, update, dirty, save, saving } = useActive();
  return (
    <>
      <ActiveHeader title="Bill of Materials" subtitle="Preliminary BOM generated from the design. Edit quantities, specifications and unit costs." dirty={dirty} save={() => void save()} saving={saving} />
      {!project || !data || !result ? (
        <Empty>Select a project above.</Empty>
      ) : (
        <>
          <BomEditor result={result} data={data} update={update} />
          <CostPanel result={result} data={data} update={update} />
        </>
      )}
    </>
  );
}

export function ReportsPage() {
  const { units } = useApp();
  const { project, result, dirty } = useActive();
  return (
    <>
      <ActiveHeader
        title="Reports"
        subtitle="Professional PDF design report generated locally from the saved project."
        extra={
          project && (
            <>
              <a className="btn btn-primary" href={api.reportUrl(project.id)} target="_blank" rel="noreferrer">
                Open PDF
              </a>
              <a className="btn" href={api.reportUrl(project.id, true)}>
                Download PDF
              </a>
              <button className="btn btn-ghost" onClick={() => window.print()}>
                Print this page
              </button>
            </>
          )
        }
      />
      {!project || !result ? (
        <Empty>Select a project above.</Empty>
      ) : (
        <div className="printable">
          {dirty && <div className="alert">This project has unsaved changes – the PDF is generated from the last saved version.</div>}
          <Disclaimer />
          <Card title="Report contents">
            <ol className="report-toc">
              {['Project information', 'Design basis', 'Raw water analysis', 'Production requirement', 'RO calculation', 'Membrane selection', 'Pump calculation', 'Pipe sizing', 'Pretreatment', 'Tank sizing', 'Process flow diagram', 'Electrical load', 'Bill of Materials', 'Cost estimate', 'Assumptions', 'Warnings', 'Engineering notes'].map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
          </Card>
          <SummaryDashboard result={result} units={units} />
          <Card title="Process flow diagram">
            <PfdDiagram main={result.pfd.main} reject={result.pfd.reject} />
          </Card>
          <Card title="Warnings" actions={<Counts counts={result.counts} />}>
            <FindingsList findings={result.findings} showOk={false} empty="No critical or review items." />
          </Card>
        </div>
      )}
    </>
  );
}

// ------------------------------------------------------------------ Settings
export function SettingsPage() {
  const { settings, reloadSettings, toast } = useApp();
  const [draft, setDraft] = useState<typeof settings>(null);
  const s = draft ?? settings;
  if (!s) return <p className="muted">Loading…</p>;
  const dirty = draft !== null;
  const set = (fn: (d: NonNullable<typeof settings>) => void) => {
    const next = structuredClone(s);
    fn(next);
    setDraft(next);
  };
  const save = async () => {
    try {
      await api.saveSettings(s);
      await reloadSettings();
      setDraft(null);
      toast('Settings saved');
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };
  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="Stored locally in the SQLite database."
        actions={
          <>
            {dirty && <span className="dirty">● unsaved</span>}
            <button className="btn btn-primary" disabled={!dirty} onClick={save}>
              Save settings
            </button>
            {dirty && (
              <button className="btn btn-ghost" onClick={() => setDraft(null)}>
                Discard
              </button>
            )}
          </>
        }
      />
      <div className="grid-2">
        <Card title="Display units">
          <div className="form-grid">
            <SelectField<DisplayUnits['flow']> label="Flow" value={s.units.flow} options={FLOW_UNITS.map((u) => ({ value: u, label: UNIT_LABEL[u] }))} onChange={(v) => set((d) => void (d.units.flow = v))} />
            <SelectField<DisplayUnits['pressure']> label="Pressure" value={s.units.pressure} options={PRESSURE_UNITS.map((u) => ({ value: u, label: UNIT_LABEL[u] }))} onChange={(v) => set((d) => void (d.units.pressure = v))} />
            <SelectField<DisplayUnits['power']> label="Power" value={s.units.power} options={POWER_UNITS.map((u) => ({ value: u, label: UNIT_LABEL[u] }))} onChange={(v) => set((d) => void (d.units.power = v))} />
          </div>
          <p className="muted small">Inputs and calculations are always SI (m³/h, bar, m, kW, mm); display units apply to result screens.</p>
        </Card>
        <Card title="Company (report header)">
          <div className="form-grid">
            <TextField label="Company name" value={s.company.name} onChange={(v) => set((d) => void (d.company.name = v))} />
            <TextField label="Address" value={s.company.address} onChange={(v) => set((d) => void (d.company.address = v))} />
            <TextField label="Phone" value={s.company.phone} onChange={(v) => set((d) => void (d.company.phone = v))} />
            <TextField label="Email" value={s.company.email} onChange={(v) => set((d) => void (d.company.email = v))} />
          </div>
        </Card>
      </div>
      <Card
        title="Global design assumptions (defaults for NEW projects)"
        actions={
          <button
            className="btn btn-sm btn-ghost"
            onClick={async () => {
              if (!confirm('Reset global assumptions to factory defaults?')) return;
              const { defaultAssumptions } = await import('../../shared/assumptions');
              set((d) => void (d.assumptions = defaultAssumptions()));
            }}
          >
            Factory defaults
          </button>
        }
      >
        <p className="muted small">Existing projects keep their own copy – use “Load global defaults” inside a project to apply changes to it.</p>
        <AssumptionsEditor value={s.assumptions} onChange={(k, v) => set((d) => void (d.assumptions[k] = v))} />
      </Card>
      <Card title="Data & privacy">
        <p>
          All data is stored in a local SQLite file (default <code>data/ro-calculator.db</code> in the application folder). No cloud service, account or internet connection is used. Back up the application by copying that file while the application is stopped, or export individual projects from the Projects page.
        </p>
      </Card>
    </>
  );
}
