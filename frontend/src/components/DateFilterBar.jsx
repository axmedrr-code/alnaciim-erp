import { useEffect, useMemo, useRef, useState } from 'react';
import { Calendar, ChevronDown, FileText, FileSpreadsheet, FileDown, GitCompare, X } from 'lucide-react';
import { useApi } from './useApi';
import { quickFilters, rollingPeriods, accountingPeriods, comparisonRange, todayISO } from '../utils/dateRanges';

// exportUtils pulls in xlsx + jspdf, which together are several hundred KB — loaded
// on demand only when someone actually clicks an export button, so pages that never
// touch export (which is most of them, most of the time) don't pay for it upfront.
async function loadExportUtils() { return import('../utils/exportUtils'); }

function fmt(iso) {
  if (!iso) return '';
  return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

// The one global date filter every module (Finance, Sales, Inventory, Production,
// Procurement, Maintenance, Reports) shares. Consuming a screen means: read
// `value.from`/`value.to` (and optionally `value.compare`) to build your query —
// server-side if the endpoint already accepts from/to (most reports do), or
// client-side by filtering an already-fetched list's date field otherwise. Either
// way this component doesn't care which; it just hands back plain ISO date strings.
//
// Props:
//   value    — current { key, from, to, label, compare } (compare is null or { mode, from, to })
//   onChange — (nextValue) => void
//   columns/rows — optional; when given, an Export button group (PDF/Excel/CSV) appears
//   title    — used as the export filename / PDF header
export default function DateFilterBar({ value, onChange, columns, rows, title = 'Report' }) {
  const [open, setOpen] = useState(false);
  const [fromInput, setFromInput] = useState(value?.from || todayISO());
  const [toInput, setToInput] = useState(value?.to || todayISO());
  const [compareMode, setCompareMode] = useState(value?.compare?.mode || 'off');
  const containerRef = useRef(null);
  const { rows: fiscalYears } = useApi('/finance/fiscal-years');

  useEffect(() => {
    setFromInput(value?.from || todayISO());
    setToInput(value?.to || todayISO());
    setCompareMode(value?.compare?.mode || 'off');
  }, [value?.from, value?.to, value?.compare?.mode]);

  useEffect(() => {
    function handleClick(e) { if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const quick = useMemo(() => quickFilters(), []);
  const rolling = useMemo(() => rollingPeriods(), []);
  const accounting = useMemo(() => accountingPeriods(fiscalYears), [fiscalYears]);

  function applyRange(preset) {
    const compare = compareMode !== 'off' ? { mode: compareMode, ...comparisonRange(preset.from, preset.to, compareMode) } : null;
    onChange({ key: preset.key, from: preset.from, to: preset.to, label: preset.label, compare });
    setOpen(false);
  }

  function applyCustom() {
    if (!fromInput || !toInput) return;
    const compare = compareMode !== 'off' ? { mode: compareMode, ...comparisonRange(fromInput, toInput) } : null;
    onChange({ key: 'custom', from: fromInput, to: toInput, label: 'Custom Range', compare });
    setOpen(false);
  }

  function changeCompareMode(mode) {
    setCompareMode(mode);
    const compare = mode !== 'off' ? { mode, ...comparisonRange(value.from, value.to, mode) } : null;
    onChange({ ...value, compare });
  }

  const label = value?.label || 'Select period';
  const rangeText = value?.from ? `${fmt(value.from)} – ${fmt(value.to)}` : '';

  return (
    <div className="date-filter" ref={containerRef}>
      <button className="date-filter__trigger" onClick={() => setOpen((o) => !o)}>
        <Calendar size={15} />
        <span>
          <strong>{label}</strong>
          {rangeText && <em>{rangeText}</em>}
        </span>
        <ChevronDown size={14} />
      </button>

      {value?.compare && (
        <span className="date-filter__compare-chip">
          <GitCompare size={12} /> vs {value.compare.mode === 'previous_period' ? 'Previous Period' : 'Same Period Last Year'}
          <button onClick={() => changeCompareMode('off')}><X size={11} /></button>
        </span>
      )}

      {columns && rows && (
        <div className="date-filter__export">
          <button className="btn-icon" title="Export PDF" onClick={async () => (await loadExportUtils()).exportToPDF(columns, rows, title.replace(/\s+/g, '_'), title, rangeText)}><FileText size={15} /></button>
          <button className="btn-icon" title="Export Excel" onClick={async () => (await loadExportUtils()).exportToExcel(columns, rows, title.replace(/\s+/g, '_'))}><FileSpreadsheet size={15} /></button>
          <button className="btn-icon" title="Export CSV" onClick={async () => (await loadExportUtils()).exportToCSV(columns, rows, title.replace(/\s+/g, '_'))}><FileDown size={15} /></button>
        </div>
      )}

      {open && (
        <div className="date-filter__panel">
          <div className="date-filter__col">
            <div className="date-filter__col-title">Quick Filters</div>
            {quick.map((p) => (
              <button key={p.key} className={`date-filter__option ${value?.key === p.key ? 'active' : ''}`} onClick={() => applyRange(p)}>{p.label}</button>
            ))}
          </div>

          <div className="date-filter__col">
            <div className="date-filter__col-title">Rolling Periods</div>
            {rolling.map((p) => (
              <button key={p.key} className={`date-filter__option ${value?.key === p.key ? 'active' : ''}`} onClick={() => applyRange(p)}>{p.label}</button>
            ))}
            <div className="date-filter__col-title" style={{ marginTop: 16 }}>Accounting Periods</div>
            {accounting.map((p) => (
              <button key={p.key} className={`date-filter__option ${value?.key === p.key ? 'active' : ''}`} onClick={() => applyRange(p)}>
                {p.label}{p.sub && <em> ({p.sub})</em>}
              </button>
            ))}
          </div>

          <div className="date-filter__col date-filter__col--custom">
            <div className="date-filter__col-title">Custom Date Range</div>
            <label className="date-filter__field">From<input type="date" value={fromInput} onChange={(e) => setFromInput(e.target.value)} /></label>
            <label className="date-filter__field">To<input type="date" value={toInput} onChange={(e) => setToInput(e.target.value)} /></label>
            <button className="btn" onClick={applyCustom} style={{ marginTop: 6 }}>Apply</button>

            <div className="date-filter__col-title" style={{ marginTop: 20 }}>Compare</div>
            <label className="date-filter__radio"><input type="radio" checked={compareMode === 'off'} onChange={() => changeCompareMode('off')} /> No comparison</label>
            <label className="date-filter__radio"><input type="radio" checked={compareMode === 'previous_period'} onChange={() => changeCompareMode('previous_period')} /> Previous Period</label>
            <label className="date-filter__radio"><input type="radio" checked={compareMode === 'same_period_last_year'} onChange={() => changeCompareMode('same_period_last_year')} /> Same Period Last Year</label>
          </div>
        </div>
      )}
    </div>
  );
}

// Convenience for screens that just want a sensible starting value (defaults to
// "This Month", matching the ERP's normal reporting cadence).
export function defaultDateRange() {
  const preset = quickFilters().find((p) => p.key === 'this_month');
  return { key: preset.key, from: preset.from, to: preset.to, label: preset.label, compare: null };
}

// Drop-in comparison readout for a single KPI number — every screen wired to the
// comparison mode uses this same small component so "vs previous period" reads
// identically everywhere instead of each report inventing its own delta format.
export function ComparisonNote({ current, previous }) {
  if (previous == null) return null;
  const cur = Number(current) || 0;
  const prev = Number(previous) || 0;
  if (prev === 0) return null;
  const pct = ((cur - prev) / Math.abs(prev)) * 100;
  const up = pct >= 0;
  return (
    <div className={`kpi-card__trend kpi-card__trend--${up ? 'up' : 'down'}`}>
      {up ? '▲' : '▼'} {Math.abs(pct).toFixed(1)}% vs prior period (${prev.toFixed(2)})
    </div>
  );
}
