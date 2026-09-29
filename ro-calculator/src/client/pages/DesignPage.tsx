import { useEffect } from 'react';
import { useBlocker, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { defaultAssumptions } from '../../shared/assumptions';
import { PIPE_SECTIONS } from '../../shared/engine';
import type { DesignInput, PipeSectionId, PretreatmentItemId, RawWaterInput, WaterSource } from '../../shared/types';
import { WATER_PARAMS, WATER_SOURCE_LABELS } from '../../shared/types';
import { fmt, fmtFlow } from '../../shared/units';
import { api } from '../api';
import { AssumptionsEditor } from '../components/AssumptionsEditor';
import { PfdDiagram } from '../components/PfdDiagram';
import { BomEditor, CostPanel, ElectricalResults, MembraneResults, PipeResults, PretreatmentResults, PumpResults, SummaryDashboard, TankResults } from '../components/Results';
import { Card, Checkbox, Counts, Disclaimer, Empty, FindingsList, NumField, PageHeader, SelectField, StepsTable, Tabs, TextField } from '../components/ui';
import { useApp, useProjectDesign } from '../context';

type TabId =
  | 'project' | 'production' | 'water' | 'membrane' | 'hydraulics' | 'treatment' | 'tanks' | 'assumptions'
  | 'summary' | 'r_membrane' | 'r_pumps' | 'r_pipes' | 'r_pretreatment' | 'r_tanks' | 'r_electrical' | 'r_pfd' | 'r_bom' | 'r_warnings';

const TABS: { id: TabId; label: string; group: string }[] = [
  { id: 'project', label: 'Project', group: 'Inputs' },
  { id: 'production', label: 'Production', group: 'Inputs' },
  { id: 'water', label: 'Raw Water', group: 'Inputs' },
  { id: 'membrane', label: 'Membrane', group: 'Inputs' },
  { id: 'hydraulics', label: 'Pumps & Site', group: 'Inputs' },
  { id: 'treatment', label: 'Treatment options', group: 'Inputs' },
  { id: 'tanks', label: 'Tanks', group: 'Inputs' },
  { id: 'assumptions', label: 'Assumptions', group: 'Inputs' },
  { id: 'summary', label: 'Summary', group: 'Results' },
  { id: 'r_membrane', label: 'RO / Membranes', group: 'Results' },
  { id: 'r_pumps', label: 'Pumps', group: 'Results' },
  { id: 'r_pipes', label: 'Pipes', group: 'Results' },
  { id: 'r_pretreatment', label: 'Pretreatment & Dosing', group: 'Results' },
  { id: 'r_tanks', label: 'Tanks', group: 'Results' },
  { id: 'r_electrical', label: 'Electrical', group: 'Results' },
  { id: 'r_pfd', label: 'Process Flow', group: 'Results' },
  { id: 'r_bom', label: 'BOM & Cost', group: 'Results' },
  { id: 'r_warnings', label: 'Warnings', group: 'Results' },
];

export function DesignPage() {
  const { id } = useParams();
  const [search, setSearch] = useSearchParams();
  const navigate = useNavigate();
  const { library, units, settings, toast } = useApp();
  const { project, data, update, result, dirty, save, saving, loading, loadError } = useProjectDesign(id ? Number(id) : null);
  const tab = (search.get('tab') as TabId) || 'project';
  const setTab = (t: TabId) => setSearch({ tab: t }, { replace: true });

  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (blocker.state === 'blocked') {
      if (confirm('You have unsaved changes. Leave without saving?')) blocker.proceed();
      else blocker.reset();
    }
  }, [blocker]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void save();
      }
    };
    const onUnload = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('beforeunload', onUnload);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('beforeunload', onUnload);
    };
  }, [save, dirty]);

  if (loadError) return <Empty>Could not load project: {loadError}</Empty>;
  if (loading || !data || !project || !library) return <Empty>Loading project…</Empty>;

  const W = (k: keyof RawWaterInput) => (v: number | null) => update((d) => void ((d.water as unknown as Record<string, unknown>)[k] = v));

  return (
    <div className="design">
      <PageHeader
        title={data.project.name || 'Untitled'}
        subtitle={
          <>
            {data.project.reference && <span className="pill">{data.project.reference}</span>} {data.project.customer} {data.project.location && `· ${data.project.location}`} · last saved {new Date(project.updatedAt).toLocaleString()}
          </>
        }
        actions={
          <>
            {dirty && <span className="dirty">● unsaved changes</span>}
            <button className="btn btn-primary" onClick={() => void save()} disabled={saving || !dirty}>
              {saving ? 'Saving…' : 'Save (Ctrl+S)'}
            </button>
            <button
              className="btn"
              onClick={async () => {
                if (dirty && !(await save())) return;
                window.open(api.reportUrl(project.id), '_blank');
              }}
            >
              PDF report
            </button>
            <button className="btn btn-ghost" onClick={() => navigate('/projects')}>
              Projects
            </button>
          </>
        }
      />

      {result && (
        <div className="live-bar">
          <span>
            <b>{fmtFlow(result.summary.permeateM3h, units)}</b> permeate
          </span>
          <span>
            Feed <b>{fmtFlow(result.summary.feedM3h, units)}</b>
          </span>
          <span>
            Recovery <b>{fmt(result.summary.recoveryPct, 1, '%')}</b>
          </span>
          <span>
            <b>{result.summary.membranes}</b> membranes / <b>{result.summary.vessels}</b> PV
          </span>
          <span>
            HP <b>{fmt(result.summary.hpPressureBar, 1, 'bar')}</b>, <b>{fmt(result.summary.hpMotorKw, 1, 'kW')}</b>
          </span>
          <span>
            Load <b>{fmt(result.summary.connectedKw, 1, 'kW')}</b>
          </span>
          <button className="linklike" onClick={() => setTab('r_warnings')}>
            <Counts counts={result.counts} />
          </button>
        </div>
      )}

      <Tabs tabs={TABS} value={tab} onChange={setTab} />

      <div className="tab-body">
        {/* ------------------------------------------------ INPUTS */}
        {tab === 'project' && (
          <Card title="Project information">
            <div className="form-grid">
              <TextField label="Project name" value={data.project.name} onChange={(v) => update((d) => void (d.project.name = v))} />
              <TextField label="Customer" value={data.project.customer} onChange={(v) => update((d) => void (d.project.customer = v))} />
              <TextField label="Location" value={data.project.location} onChange={(v) => update((d) => void (d.project.location = v))} />
              <TextField label="Designer" value={data.project.designer} onChange={(v) => update((d) => void (d.project.designer = v))} />
              <TextField label="Date" type="date" value={data.project.date} onChange={(v) => update((d) => void (d.project.date = v))} />
              <TextField label="Design reference number" value={data.project.reference} onChange={(v) => update((d) => void (d.project.reference = v))} />
            </div>
            <label className="field">
              <span className="field-label">Engineering notes (appear in the report)</span>
              <textarea rows={4} value={data.project.notes} onChange={(e) => update((d) => void (d.project.notes = e.target.value))} />
            </label>
          </Card>
        )}

        {tab === 'production' && (
          <>
            <Card title="Production requirement">
              <div className="form-grid">
                <NumField label="Required production" unit="m³/day" allowNull={false} value={data.production.dailyProductionM3d} onChange={(v) => update((d) => void (d.production.dailyProductionM3d = v ?? 0))} />
                <NumField label="Operating hours per day" unit="h/day" allowNull={false} value={data.production.operatingHours} onChange={(v) => update((d) => void (d.production.operatingHours = v ?? 0))} />
                <NumField label="Peak factor" unit="×" allowNull={false} value={data.production.peakFactor} onChange={(v) => update((d) => void (d.production.peakFactor = v ?? 1))} hint="Design permeate = average × peak factor" />
                <NumField label="Desired recovery" unit="%" allowNull={false} value={data.production.recoveryPct} onChange={(v) => update((d) => void (d.production.recoveryPct = v ?? 0))} />
                <NumField
                  label="Required permeate flow (override)"
                  unit="m³/h"
                  value={data.production.permeateFlowOverrideM3h}
                  onChange={(v) => update((d) => void (d.production.permeateFlowOverrideM3h = v))}
                  placeholder="calculated automatically"
                  hint="Leave empty to calculate from m³/day ÷ hours × peak factor"
                />
              </div>
            </Card>
            {result && (
              <Card title="Automatic calculation">
                <StepsTable steps={result.production.steps} />
                <FindingsList findings={result.findings} sections={['Production']} />
              </Card>
            )}
          </>
        )}

        {tab === 'water' && (
          <>
            <Card title="Water source">
              <div className="form-grid">
                <SelectField<WaterSource>
                  label="Source type"
                  value={data.water.source}
                  options={(Object.keys(WATER_SOURCE_LABELS) as WaterSource[]).map((k) => ({ value: k, label: WATER_SOURCE_LABELS[k] }))}
                  onChange={(v) => update((d) => void (d.water.source = v))}
                  hint="Selects the design-flux assumption and recovery limits."
                />
              </div>
              <p className="muted small">
                Fields marked <span className="imp imp-required">required</span> are needed for a reliable design; missing ones are flagged <b>INSUFFICIENT DATA — LAB ANALYSIS REQUIRED</b>. Leave a field empty if it was not measured – never enter 0 for an unmeasured value.
              </p>
            </Card>
            {(['Chemistry', 'Physical', 'Site / Hydraulic'] as const).map((g) => (
              <Card key={g} title={g === 'Chemistry' ? 'Raw water chemistry' : g === 'Physical' ? 'Physical parameters' : 'Borehole & site data (raw water pump)'}>
                <div className="form-grid">
                  {WATER_PARAMS.filter((p) => p.group === g).map((p) => (
                    <NumField key={p.key} label={p.label} unit={p.unit} importance={p.importance} value={data.water[p.key] as number | null} onChange={W(p.key)} warnNegative={p.key !== 'elevationDifference'} />
                  ))}
                </div>
              </Card>
            ))}
            {result && (
              <Card title="Water analysis checks">
                {result.water.ionBalance && (
                  <p>
                    Ion balance: cations {result.water.ionBalance.cationsMeq} meq/L, anions {result.water.ionBalance.anionsMeq} meq/L, error {result.water.ionBalance.errorPct} %
                  </p>
                )}
                <FindingsList findings={result.findings} sections={['Raw Water']} />
              </Card>
            )}
          </>
        )}

        {tab === 'membrane' && (
          <>
            <Card title="Membrane selection">
              <div className="form-grid">
                <SelectField<number>
                  label="Membrane model (Membrane Library)"
                  value={data.membrane.membraneId ?? 0}
                  options={[{ value: 0, label: '– select –' }, ...library.membranes.map((m) => ({ value: m.id, label: `${m.manufacturer} ${m.model} (${m.membraneType}, ${m.diameterIn}")` }))]}
                  onChange={(v) => update((d) => void (d.membrane.membraneId = v || null))}
                />
                <NumField
                  label="Elements per pressure vessel"
                  unit="pcs"
                  value={data.membrane.elementsPerVessel}
                  onChange={(v) => update((d) => void (d.membrane.elementsPerVessel = v == null ? null : Math.round(v)))}
                  placeholder={`default ${data.assumptions.elements_per_vessel}`}
                />
                <NumField label="Design flux" unit="LMH" value={data.membrane.designFluxLmh} onChange={(v) => update((d) => void (d.membrane.designFluxLmh = v))} placeholder="assumption for source type" hint="Empty = design-flux assumption for the selected water source" />
                <SelectField<number>
                  label="Number of stages"
                  value={data.membrane.stages ?? 0}
                  options={[{ value: 0, label: 'Automatic (from recovery)' }, { value: 1, label: '1 stage' }, { value: 2, label: '2 stages' }, { value: 3, label: '3 stages' }]}
                  onChange={(v) => update((d) => void (d.membrane.stages = v || null))}
                />
              </div>
              {(() => {
                const m = library.membranes.find((x) => x.id === data.membrane.membraneId);
                if (!m) return <p className="danger">No membrane selected.</p>;
                return (
                  <p className="muted small">
                    {m.manufacturer} {m.model}: {m.activeAreaM2 ?? '–'} m², {m.nominalFlowM3d ?? '–'} m³/d, {m.saltRejectionPct ?? '–'} % rejection at {m.testPressureBar ?? '–'} bar / {m.testTdsMgL ?? '–'} mg/L; max {m.maxPressureBar ?? '–'} bar, {m.maxTempC ?? '–'} °C, pH {m.phMin ?? '–'}–{m.phMax ?? '–'}. {m.notes}
                  </p>
                );
              })()}
            </Card>
            {result && <MembraneResults result={result} units={units} />}
          </>
        )}

        {tab === 'hydraulics' && (
          <>
            <Card title="Pump configuration">
              <div className="form-grid">
                <Checkbox label="Feed / booster pump (raw tank → pretreatment → HP pump suction)" checked={data.hydraulics.feedPumpEnabled} onChange={(v) => update((d) => void (d.hydraulics.feedPumpEnabled = v))} hint="Required to push water through filters and provide HP pump suction pressure." />
                <Checkbox label="Product / distribution pump" checked={data.hydraulics.productPumpEnabled} onChange={(v) => update((d) => void (d.hydraulics.productPumpEnabled = v))} />
                <NumField label="Distribution flow" unit="m³/h" value={data.hydraulics.distributionFlowM3h} onChange={(v) => update((d) => void (d.hydraulics.distributionFlowM3h = v))} placeholder="= peak demand or permeate flow" />
                <NumField label="Required distribution head" unit="m" allowNull={false} value={data.hydraulics.distributionHeadM} onChange={(v) => update((d) => void (d.hydraulics.distributionHeadM = v ?? 0))} hint="Static + residual pressure needed at the point of use" />
              </div>
              <p className="muted small">Borehole depth, water levels, distance and elevation are entered on the Raw Water tab. Pump efficiencies, safety margins and losses are in Assumptions.</p>
            </Card>
            <Card title="Pipe sections">
              <p className="muted small">Override material, maximum velocity, length, elevation or design pressure per section (empty = default).</p>
              <div className="table-scroll">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Section</th>
                      <th>Material</th>
                      <th>Max v (m/s)</th>
                      <th>Length (m)</th>
                      <th>Elevation (m)</th>
                      <th>Design P (bar)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {PIPE_SECTIONS.map((s) => {
                      const o = data.hydraulics.pipes[s.id] ?? {};
                      const r = result?.pipes.find((p) => p.id === s.id);
                      const set = (k: string, v: string | number | undefined) =>
                        update((d) => {
                          const cur = { ...(d.hydraulics.pipes[s.id as PipeSectionId] ?? {}) } as Record<string, unknown>;
                          if (v === undefined || v === '') delete cur[k];
                          else cur[k] = v;
                          d.hydraulics.pipes[s.id as PipeSectionId] = cur;
                        });
                      return (
                        <tr key={s.id}>
                          <td>{s.label}</td>
                          <td>
                            <select className="cell" value={o.material ?? ''} onChange={(e) => set('material', e.target.value || undefined)}>
                              <option value="">default ({s.defaultMaterial})</option>
                              {library.pipeMaterials.map((m) => (
                                <option key={m.name} value={m.name}>
                                  {m.name}
                                </option>
                              ))}
                            </select>
                          </td>
                          {(['maxVelocity', 'lengthM', 'elevationM', 'designPressureBar'] as const).map((k) => (
                            <td key={k}>
                              <input
                                className="cell num"
                                type="number"
                                step="any"
                                value={o[k] ?? ''}
                                placeholder={r ? String(k === 'maxVelocity' ? r.maxVelocity : k === 'lengthM' ? r.lengthM : k === 'elevationM' ? r.elevationM : r.designPressureBar) : ''}
                                onChange={(e) => set(k, e.target.value === '' ? undefined : Number(e.target.value))}
                              />
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        )}

        {tab === 'treatment' && (
          <Card title="Treatment options">
            <div className="form-grid">
              <SelectField
                label="Scale control strategy"
                value={data.pretreatment.scaleControl}
                options={[
                  { value: 'auto', label: 'Automatic (from scaling indices)' },
                  { value: 'antiscalant', label: 'Antiscalant only' },
                  { value: 'antiscalant_acid', label: 'Antiscalant + acid (pH adjustment)' },
                  { value: 'softener', label: 'Softener (+ antiscalant as required)' },
                ]}
                onChange={(v) => update((d) => void (d.pretreatment.scaleControl = v))}
              />
              <SelectField
                label="Post-disinfection"
                value={data.pretreatment.postDisinfection}
                options={[
                  { value: 'none', label: 'None' },
                  { value: 'uv', label: 'UV' },
                  { value: 'chlorination', label: 'Chlorination' },
                  { value: 'uv_chlorination', label: 'UV + chlorination' },
                ]}
                onChange={(v) => update((d) => void (d.pretreatment.postDisinfection = v))}
              />
              <Checkbox label="Include CIP (clean-in-place) system" checked={data.pretreatment.cip} onChange={(v) => update((d) => void (d.pretreatment.cip = v))} />
            </div>
            <p className="muted small">Individual pretreatment items can be forced in/out on the Results → Pretreatment tab. The recommendation logic and its reasons are always shown.</p>
          </Card>
        )}

        {tab === 'tanks' && (
          <Card title="Tank sizing inputs">
            <div className="form-grid">
              <NumField label="Raw water storage time" unit="h" value={data.tanks.rawStorageHours} onChange={(v) => update((d) => void (d.tanks.rawStorageHours = v))} placeholder={`default ${data.assumptions.raw_storage_hours} h`} />
              <NumField label="Product (permeate) storage time" unit="h" value={data.tanks.permeateStorageHours} onChange={(v) => update((d) => void (d.tanks.permeateStorageHours = v))} placeholder={`default ${data.assumptions.permeate_storage_hours} h`} />
              <NumField label="Peak demand" unit="m³/h" value={data.tanks.peakDemandM3h} onChange={(v) => update((d) => void (d.tanks.peakDemandM3h = v))} hint="Product tank must cover demand above RO production" />
              <NumField label="Peak duration" unit="h" allowNull={false} value={data.tanks.peakDurationH} onChange={(v) => update((d) => void (d.tanks.peakDurationH = v ?? 0))} />
              <Checkbox label="Reject recovery / reuse tank" checked={data.tanks.rejectRecovery} onChange={(v) => update((d) => void (d.tanks.rejectRecovery = v))} />
              {data.tanks.rejectRecovery && <NumField label="Reject storage time" unit="h" value={data.tanks.rejectStorageHours} onChange={(v) => update((d) => void (d.tanks.rejectStorageHours = v))} placeholder={`default ${data.assumptions.reject_storage_hours} h`} />}
            </div>
            {result && <TankResults result={result} />}
          </Card>
        )}

        {tab === 'assumptions' && (
          <Card
            title="Design assumptions for this project"
            actions={
              <>
                <button
                  className="btn btn-sm"
                  onClick={() => {
                    if (settings && confirm('Replace this project’s assumptions with the current global defaults (Settings)?')) update((d) => void (d.assumptions = structuredClone(settings.assumptions)));
                  }}
                >
                  Load global defaults
                </button>
                <button
                  className="btn btn-sm btn-ghost"
                  onClick={() => {
                    if (confirm('Reset all assumptions of this project to factory defaults?')) update((d) => void (d.assumptions = defaultAssumptions()));
                  }}
                >
                  Factory defaults
                </button>
              </>
            }
          >
            <p className="muted small">Every engineering assumption used by the calculation is listed here and editable. Changes apply to this project only; global defaults for new projects are in Settings. Rows that differ from the global default are highlighted.</p>
            <AssumptionsEditor value={data.assumptions} compareTo={settings?.assumptions} onChange={(k, v) => update((d) => void (d.assumptions[k] = v))} />
          </Card>
        )}

        {/* ------------------------------------------------ RESULTS */}
        {result && tab === 'summary' && (
          <>
            <Disclaimer />
            <SummaryDashboard result={result} units={units} />
            <Card title="Critical items and items to review">
              <FindingsList findings={result.findings} showOk={false} empty="🟢 No critical or review items." />
            </Card>
          </>
        )}
        {result && tab === 'r_membrane' && <MembraneResults result={result} units={units} />}
        {result && tab === 'r_pumps' && <PumpResults result={result} units={units} />}
        {result && tab === 'r_pipes' && (
          <PipeResults
            result={result}
            units={units}
            data={data}
            onOverride={(pid, field, value) =>
              update((d) => {
                const cur = { ...(d.hydraulics.pipes[pid as PipeSectionId] ?? {}) } as Record<string, unknown>;
                if (value === undefined || value === '') delete cur[field];
                else cur[field] = value;
                d.hydraulics.pipes[pid as PipeSectionId] = cur;
              })
            }
          />
        )}
        {result && tab === 'r_pretreatment' && <PretreatmentResults result={result} data={data} onOverride={(pid, v) => update((d) => void (d.pretreatment.overrides[pid as PretreatmentItemId] = v))} />}
        {result && tab === 'r_tanks' && <TankResults result={result} />}
        {result && tab === 'r_electrical' && <ElectricalResults result={result} units={units} />}
        {result && tab === 'r_pfd' && (
          <Card title="Process flow diagram (generated from the current configuration)">
            <PfdDiagram main={result.pfd.main} reject={result.pfd.reject} />
          </Card>
        )}
        {result && tab === 'r_bom' && (
          <>
            <BomEditor result={result} data={data} update={update} />
            <CostPanel result={result} data={data} update={update} />
          </>
        )}
        {result && tab === 'r_warnings' && (
          <>
            <Card title="Warnings & validation" actions={<Counts counts={result.counts} />}>
              <FindingsList findings={result.findings} />
            </Card>
          </>
        )}
        {!result && tab.startsWith('r_') && (
          <Empty>
            Calculation failed – check inputs.{' '}
            <button className="btn btn-sm" onClick={() => toast('See browser console for details', 'info')}>
              Details
            </button>
          </Empty>
        )}
      </div>
    </div>
  );
}

export type { DesignInput };
