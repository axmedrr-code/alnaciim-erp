import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { CalcStep, Finding, Level } from '../../shared/engine';
import { LEVEL_ICON, LEVEL_LABEL } from '../../shared/engine';
import { useApp } from '../context';
import { api, type ProjectRow } from '../api';

export function Card({ title, actions, children, className = '' }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="card-head">
          {title && <h3>{title}</h3>}
          {actions && <div className="card-actions">{actions}</div>}
        </header>
      )}
      <div className="card-body">{children}</div>
    </section>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

function parseNum(s: string): number | null | 'invalid' {
  const t = s.trim().replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  return isFinite(n) ? n : 'invalid';
}

export type Importance = 'required' | 'recommended' | 'optional';

export function NumField(props: {
  label: ReactNode;
  value: number | null | undefined;
  onChange: (v: number | null) => void;
  unit?: string;
  importance?: Importance;
  hint?: ReactNode;
  placeholder?: string;
  allowNull?: boolean;
  disabled?: boolean;
  warnNegative?: boolean;
}) {
  const { value, onChange, allowNull = true } = props;
  const [text, setText] = useState(value == null ? '' : String(value));
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    const p = parseNum(text);
    if (p === 'invalid' || p !== (value ?? null)) setText(value == null ? '' : String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const missing = value == null && props.importance === 'required';
  const negative = props.warnNegative !== false && value != null && value < 0;
  return (
    <label className={`field ${missing ? 'field-missing' : ''} ${invalid || negative ? 'field-invalid' : ''}`}>
      <span className="field-label">
        {props.label}
        {props.importance && <ImportanceTag v={props.importance} />}
      </span>
      <span className="field-input">
        <input
          type="text"
          inputMode="decimal"
          value={text}
          disabled={props.disabled}
          placeholder={props.placeholder ?? (allowNull ? 'not measured' : '')}
          onChange={(e) => {
            setText(e.target.value);
            const p = parseNum(e.target.value);
            if (p === 'invalid') setInvalid(true);
            else if (p === null && !allowNull) setInvalid(true);
            else {
              setInvalid(false);
              onChange(p);
            }
          }}
        />
        {props.unit && <span className="unit">{props.unit}</span>}
      </span>
      {invalid && <span className="field-error">Enter a valid number</span>}
      {negative && !invalid && <span className="field-error">Negative value</span>}
      {props.hint && <span className="field-hint">{props.hint}</span>}
    </label>
  );
}

export function ImportanceTag({ v }: { v: Importance }) {
  return <span className={`imp imp-${v}`}>{v === 'required' ? 'required' : v === 'recommended' ? 'recommended' : 'optional'}</span>;
}

export function TextField({ label, value, onChange, hint, type = 'text', placeholder }: { label: ReactNode; value: string; onChange: (v: string) => void; hint?: ReactNode; type?: string; placeholder?: string }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <span className="field-input">
        <input type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      </span>
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function SelectField<T extends string | number>({ label, value, options, onChange, hint }: { label: ReactNode; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; hint?: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <span className="field-input">
        <select
          value={String(value)}
          onChange={(e) => {
            const o = options.find((x) => String(x.value) === e.target.value);
            if (o) onChange(o.value);
          }}
        >
          {options.map((o) => (
            <option key={String(o.value)} value={String(o.value)}>
              {o.label}
            </option>
          ))}
        </select>
      </span>
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function Checkbox({ label, checked, onChange, hint }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; hint?: ReactNode }) {
  return (
    <label className="checkbox">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        {label}
        {hint && <span className="field-hint block">{hint}</span>}
      </span>
    </label>
  );
}

export function LevelBadge({ level, text }: { level: Level; text?: string }) {
  return (
    <span className={`badge badge-${level}`}>
      {LEVEL_ICON[level]} {text ?? LEVEL_LABEL[level]}
    </span>
  );
}

export function Counts({ counts }: { counts: Record<Level, number> }) {
  return (
    <span className="counts">
      <span className="badge badge-critical">🔴 {counts.critical}</span>
      <span className="badge badge-review">🟡 {counts.review}</span>
      <span className="badge badge-ok">🟢 {counts.ok}</span>
    </span>
  );
}

export function FindingsList({ findings, sections, showOk = true, empty = 'No findings.' }: { findings: Finding[]; sections?: string[]; showOk?: boolean; empty?: string }) {
  const list = findings.filter((f) => (!sections || sections.includes(f.section)) && (showOk || f.level !== 'ok'));
  if (!list.length) return <p className="muted">{empty}</p>;
  return (
    <ul className="findings">
      {list.map((f, i) => (
        <li key={i} className={`finding finding-${f.level}`}>
          <span className="finding-icon">{LEVEL_ICON[f.level]}</span>
          <span className="finding-section">{f.section}</span>
          <span className="finding-msg">{f.message}</span>
        </li>
      ))}
    </ul>
  );
}

export function StepsTable({ steps }: { steps: CalcStep[] }) {
  return (
    <table className="table formula-table">
      <thead>
        <tr>
          <th>Parameter</th>
          <th>Formula</th>
          <th className="num">Value</th>
          <th>Unit</th>
        </tr>
      </thead>
      <tbody>
        {steps.map((s, i) => (
          <tr key={i}>
            <td>{s.label}</td>
            <td className="formula">{s.formula}</td>
            <td className="num strong">{typeof s.value === 'number' ? s.value.toLocaleString('en-US', { maximumFractionDigits: 4 }) : s.value}</td>
            <td>{s.unit}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function KV({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <dl className="kv">
      {items.map(([k, v], i) => (
        <div key={i}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: ReactNode; group?: string }[]; value: T; onChange: (v: T) => void }) {
  const groups: { name: string; tabs: typeof tabs }[] = [];
  for (const t of tabs) {
    const g = t.group ?? '';
    let grp = groups.find((x) => x.name === g);
    if (!grp) groups.push((grp = { name: g, tabs: [] }));
    grp.tabs.push(t);
  }
  return (
    <div className="tabs">
      {groups.map((g) => (
        <div key={g.name} className="tab-group">
          {g.name && <span className="tab-group-label">{g.name}</span>}
          {g.tabs.map((t) => (
            <button key={t.id} className={`tab ${value === t.id ? 'active' : ''}`} onClick={() => onChange(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

/** Selects the "active project" used by the Pretreatment, BOM and Reports pages. */
export function ProjectPicker() {
  const { activeProjectId, setActiveProjectId } = useApp();
  const [rows, setRows] = useState<ProjectRow[] | null>(null);
  useEffect(() => {
    api.projects().then(setRows).catch(() => setRows([]));
  }, []);
  if (!rows) return <span className="muted">Loading projects…</span>;
  if (!rows.length)
    return (
      <span className="muted">
        No projects yet – <Link to="/new">create one</Link>.
      </span>
    );
  return (
    <label className="picker">
      <span>Project:</span>
      <select value={activeProjectId ?? ''} onChange={(e) => setActiveProjectId(e.target.value ? Number(e.target.value) : null)}>
        <option value="">– select project –</option>
        {rows.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
            {r.reference ? ` (${r.reference})` : ''}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Disclaimer() {
  return (
    <div className="disclaimer">
      <strong>PRELIMINARY ENGINEERING DESIGN.</strong> Results are simplified engineering estimates – NOT a manufacturer-certified projection. Final equipment selection must be verified against a complete water analysis and manufacturer data/design software.
    </div>
  );
}
