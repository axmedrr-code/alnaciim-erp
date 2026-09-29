import { useState } from 'react';
import type { MembraneSpec, PumpSpec, PumpType } from '../../shared/types';
import { api } from '../api';
import { Card, NumField, PageHeader, SelectField, TextField } from '../components/ui';
import { useApp } from '../context';

type MembraneDraft = Omit<MembraneSpec, 'id'>;
const EMPTY_MEMBRANE: MembraneDraft = {
  manufacturer: '', model: '', membraneType: 'BWRO', diameterIn: 8, activeAreaM2: null, nominalFlowM3d: null, saltRejectionPct: null, maxPressureBar: null, maxTempC: 45,
  phMin: 2, phMax: 11, testPressureBar: 15.5, testTdsMgL: 2000, testRecoveryPct: 15, maxFeedFlowM3h: null, notes: '',
};

export function MembraneLibraryPage() {
  const { library, reloadLibrary, toast } = useApp();
  const [edit, setEdit] = useState<{ id?: number; d: MembraneDraft } | null>(null);
  const [q, setQ] = useState('');
  if (!library) return <p className="muted">Loading…</p>;
  const set = <K extends keyof MembraneDraft>(k: K, v: MembraneDraft[K]) => setEdit((e) => (e ? { ...e, d: { ...e.d, [k]: v } } : e));
  const save = async () => {
    if (!edit) return;
    try {
      await api.saveMembrane(edit.d, edit.id);
      await reloadLibrary();
      toast(edit.id ? 'Membrane updated' : 'Membrane added');
      setEdit(null);
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };
  const rows = library.membranes.filter((m) => `${m.manufacturer} ${m.model} ${m.membraneType}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <PageHeader
        title="Membrane Library"
        subtitle="Local membrane database. Values are typical datasheet values – verify against current manufacturer datasheets. Missing specifications are flagged in designs."
        actions={
          <>
            <input className="search" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
            <button className="btn btn-primary" onClick={() => setEdit({ d: { ...EMPTY_MEMBRANE } })}>
              + Add membrane
            </button>
          </>
        }
      />
      {edit && (
        <Card title={edit.id ? `Edit ${edit.d.manufacturer} ${edit.d.model}` : 'New membrane'} className="card-edit">
          <div className="form-grid">
            <TextField label="Manufacturer" value={edit.d.manufacturer} onChange={(v) => set('manufacturer', v)} />
            <TextField label="Model" value={edit.d.model} onChange={(v) => set('model', v)} />
            <SelectField label="Membrane type" value={edit.d.membraneType} options={['BWRO', 'BWRO-LE', 'BWRO-LF', 'SWRO', 'NF'].map((v) => ({ value: v, label: v }))} onChange={(v) => set('membraneType', v)} />
            <SelectField<number> label="Diameter" value={edit.d.diameterIn} options={[{ value: 8, label: '8 inch' }, { value: 4, label: '4 inch' }]} onChange={(v) => set('diameterIn', v)} />
            <NumField label="Active area" unit="m²" importance="required" value={edit.d.activeAreaM2} onChange={(v) => set('activeAreaM2', v)} />
            <NumField label="Nominal permeate flow" unit="m³/day" importance="required" value={edit.d.nominalFlowM3d} onChange={(v) => set('nominalFlowM3d', v)} />
            <NumField label="Salt rejection (stabilised)" unit="%" importance="required" value={edit.d.saltRejectionPct} onChange={(v) => set('saltRejectionPct', v)} />
            <NumField label="Maximum pressure" unit="bar" importance="required" value={edit.d.maxPressureBar} onChange={(v) => set('maxPressureBar', v)} />
            <NumField label="Maximum temperature" unit="°C" value={edit.d.maxTempC} onChange={(v) => set('maxTempC', v)} />
            <NumField label="pH min (continuous)" value={edit.d.phMin} onChange={(v) => set('phMin', v)} />
            <NumField label="pH max (continuous)" value={edit.d.phMax} onChange={(v) => set('phMax', v)} />
            <NumField label="Test pressure" unit="bar" importance="required" value={edit.d.testPressureBar} onChange={(v) => set('testPressureBar', v)} />
            <NumField label="Test solution TDS (NaCl)" unit="mg/L" importance="required" value={edit.d.testTdsMgL} onChange={(v) => set('testTdsMgL', v)} />
            <NumField label="Test recovery" unit="%" value={edit.d.testRecoveryPct} onChange={(v) => set('testRecoveryPct', v)} />
            <NumField label="Max feed flow per vessel" unit="m³/h" value={edit.d.maxFeedFlowM3h} onChange={(v) => set('maxFeedFlowM3h', v)} />
          </div>
          <TextField label="Notes" value={edit.d.notes} onChange={(v) => set('notes', v)} />
          <div className="btn-row">
            <button className="btn btn-primary" onClick={save}>
              Save
            </button>
            <button className="btn btn-ghost" onClick={() => setEdit(null)}>
              Cancel
            </button>
          </div>
        </Card>
      )}
      <Card>
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Manufacturer</th>
                <th>Model</th>
                <th>Type</th>
                <th className="num">Ø in</th>
                <th className="num">Area m²</th>
                <th className="num">Flow m³/d</th>
                <th className="num">Rejection %</th>
                <th className="num">Max bar</th>
                <th className="num">Max °C</th>
                <th>pH</th>
                <th>Test conditions</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id}>
                  <td>{m.manufacturer}</td>
                  <td>
                    <b>{m.model}</b> {m.builtin ? <span className="pill small">seed</span> : <span className="pill pill-in small">user</span>}
                  </td>
                  <td>{m.membraneType}</td>
                  <td className="num">{m.diameterIn}</td>
                  <td className="num">{m.activeAreaM2 ?? <span className="danger">missing</span>}</td>
                  <td className="num">{m.nominalFlowM3d ?? <span className="danger">missing</span>}</td>
                  <td className="num">{m.saltRejectionPct ?? <span className="danger">missing</span>}</td>
                  <td className="num">{m.maxPressureBar ?? <span className="danger">missing</span>}</td>
                  <td className="num">{m.maxTempC ?? '–'}</td>
                  <td>
                    {m.phMin ?? '–'}–{m.phMax ?? '–'}
                  </td>
                  <td className="small">
                    {m.testPressureBar ?? '–'} bar, {m.testTdsMgL ?? '–'} mg/L, {m.testRecoveryPct ?? '–'} %
                  </td>
                  <td className="nowrap">
                    <button className="btn btn-xs" onClick={() => setEdit({ id: m.id, d: { ...m } })}>
                      Edit
                    </button>
                    <button className="btn btn-xs" onClick={() => setEdit({ d: { ...m, model: `${m.model} (copy)` } })}>
                      Copy
                    </button>
                    <button
                      className="btn btn-xs btn-danger"
                      onClick={async () => {
                        if (!confirm(`Delete ${m.manufacturer} ${m.model}?`)) return;
                        try {
                          await api.deleteMembrane(m.id);
                          await reloadLibrary();
                          toast('Membrane deleted');
                        } catch (e) {
                          toast((e as Error).message, 'error');
                        }
                      }}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

type PumpDraft = Omit<PumpSpec, 'id'>;
const PUMP_TYPES: { value: PumpType; label: string }[] = [
  { value: 'borehole', label: 'Borehole / raw water' },
  { value: 'feed', label: 'Feed / booster' },
  { value: 'high_pressure', label: 'High pressure' },
  { value: 'product', label: 'Product / distribution' },
  { value: 'cip', label: 'CIP' },
  { value: 'dosing', label: 'Dosing' },
];

export function PumpLibraryPage() {
  const { library, reloadLibrary, toast } = useApp();
  const [edit, setEdit] = useState<{ id?: number; d: PumpDraft } | null>(null);
  const [type, setType] = useState<PumpType | ''>('');
  if (!library) return <p className="muted">Loading…</p>;
  const set = <K extends keyof PumpDraft>(k: K, v: PumpDraft[K]) => setEdit((e) => (e ? { ...e, d: { ...e.d, [k]: v } } : e));
  const save = async () => {
    if (!edit) return;
    try {
      await api.savePump(edit.d, edit.id);
      await reloadLibrary();
      toast(edit.id ? 'Pump updated' : 'Pump added');
      setEdit(null);
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };
  const rows = library.pumps.filter((p) => !type || p.pumpType === type);
  return (
    <>
      <PageHeader
        title="Pump Library"
        subtitle="Duty points used to pre-select pumps. The simplified curve H(Q) = H₀ − (H₀ − H_rated)·(Q/Q_rated)² is used – always confirm with the published pump curve."
        actions={
          <>
            <select value={type} onChange={(e) => setType(e.target.value as PumpType)}>
              <option value="">All types</option>
              {PUMP_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
            <button
              className="btn btn-primary"
              onClick={() => setEdit({ d: { pumpType: 'high_pressure', manufacturer: '', model: '', ratedFlowM3h: 10, ratedHeadM: 100, minFlowM3h: 3, maxFlowM3h: 13, shutoffHeadM: 125, motorKw: 5.5, efficiencyPct: 70, notes: '' } })}
            >
              + Add pump
            </button>
          </>
        }
      />
      {edit && (
        <Card title={edit.id ? `Edit ${edit.d.model}` : 'New pump'} className="card-edit">
          <div className="form-grid">
            <SelectField label="Pump type" value={edit.d.pumpType} options={PUMP_TYPES} onChange={(v) => set('pumpType', v)} />
            <TextField label="Manufacturer" value={edit.d.manufacturer} onChange={(v) => set('manufacturer', v)} />
            <TextField label="Model" value={edit.d.model} onChange={(v) => set('model', v)} />
            <NumField label="Rated flow (BEP)" unit="m³/h" allowNull={false} value={edit.d.ratedFlowM3h} onChange={(v) => set('ratedFlowM3h', v ?? 0)} />
            <NumField label="Rated head" unit="m" allowNull={false} value={edit.d.ratedHeadM} onChange={(v) => set('ratedHeadM', v ?? 0)} />
            <NumField label="Shut-off head" unit="m" allowNull={false} value={edit.d.shutoffHeadM} onChange={(v) => set('shutoffHeadM', v ?? 0)} />
            <NumField label="Min flow" unit="m³/h" allowNull={false} value={edit.d.minFlowM3h} onChange={(v) => set('minFlowM3h', v ?? 0)} />
            <NumField label="Max flow" unit="m³/h" allowNull={false} value={edit.d.maxFlowM3h} onChange={(v) => set('maxFlowM3h', v ?? 0)} />
            <NumField label="Motor" unit="kW" allowNull={false} value={edit.d.motorKw} onChange={(v) => set('motorKw', v ?? 0)} />
            <NumField label="Efficiency at BEP" unit="%" allowNull={false} value={edit.d.efficiencyPct} onChange={(v) => set('efficiencyPct', v ?? 0)} />
          </div>
          <TextField label="Notes" value={edit.d.notes} onChange={(v) => set('notes', v)} />
          <div className="btn-row">
            <button className="btn btn-primary" onClick={save}>
              Save
            </button>
            <button className="btn btn-ghost" onClick={() => setEdit(null)}>
              Cancel
            </button>
          </div>
        </Card>
      )}
      <Card>
        <table className="table">
          <thead>
            <tr>
              <th>Type</th>
              <th>Manufacturer</th>
              <th>Model</th>
              <th className="num">Rated Q m³/h</th>
              <th className="num">Rated H m</th>
              <th className="num">Shut-off m</th>
              <th className="num">Range m³/h</th>
              <th className="num">Motor kW</th>
              <th className="num">η %</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id}>
                <td>{PUMP_TYPES.find((t) => t.value === p.pumpType)?.label}</td>
                <td>{p.manufacturer}</td>
                <td>
                  <b>{p.model}</b>
                </td>
                <td className="num">{p.ratedFlowM3h}</td>
                <td className="num">{p.ratedHeadM}</td>
                <td className="num">{p.shutoffHeadM}</td>
                <td className="num">
                  {p.minFlowM3h}–{p.maxFlowM3h}
                </td>
                <td className="num">{p.motorKw}</td>
                <td className="num">{p.efficiencyPct}</td>
                <td className="nowrap">
                  <button className="btn btn-xs" onClick={() => setEdit({ id: p.id, d: { ...p } })}>
                    Edit
                  </button>
                  <button
                    className="btn btn-xs btn-danger"
                    onClick={async () => {
                      if (!confirm(`Delete ${p.model}?`)) return;
                      try {
                        await api.deletePump(p.id);
                        await reloadLibrary();
                        toast('Pump deleted');
                      } catch (e) {
                        toast((e as Error).message, 'error');
                      }
                    }}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}
