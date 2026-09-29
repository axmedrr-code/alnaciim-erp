import { useMemo, useState } from 'react';
import { ASSUMPTION_DEFS, type AssumptionGroup, type Assumptions } from '../../shared/assumptions';

function ListInput({ value, onChange }: { value: number[]; onChange: (v: number[]) => void }) {
  const [text, setText] = useState(value.join(', '));
  const [bad, setBad] = useState(false);
  return (
    <input
      className={`cell ${bad ? 'bad' : ''}`}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const parts = e.target.value.split(/[,;\s]+/).filter(Boolean).map(Number);
        if (parts.length && parts.every((n) => isFinite(n) && n > 0)) {
          setBad(false);
          onChange(parts.sort((a, b) => a - b));
        } else setBad(true);
      }}
    />
  );
}

/** Editable table of all engineering assumptions (nothing hidden in code). */
export function AssumptionsEditor({ value, onChange, compareTo, compareLabel = 'Global default' }: { value: Assumptions; onChange: (key: string, v: number | number[]) => void; compareTo?: Assumptions; compareLabel?: string }) {
  const [filter, setFilter] = useState('');
  const groups = useMemo(() => {
    const g = new Map<AssumptionGroup, typeof ASSUMPTION_DEFS>();
    for (const d of ASSUMPTION_DEFS) {
      if (filter && !`${d.label} ${d.description} ${d.group}`.toLowerCase().includes(filter.toLowerCase())) continue;
      if (!g.has(d.group)) g.set(d.group, []);
      g.get(d.group)!.push(d);
    }
    return [...g.entries()];
  }, [filter]);

  return (
    <div className="assumptions">
      <input className="search" placeholder="Search assumptions…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      {groups.map(([group, defs]) => (
        <details key={group} open={!!filter || group === 'Membrane Design' || group === 'Pumps'}>
          <summary>
            {group} <span className="muted">({defs.length})</span>
          </summary>
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: '32%' }}>Assumption</th>
                <th style={{ width: '16%' }}>Value</th>
                <th style={{ width: '8%' }}>Unit</th>
                {compareTo && <th style={{ width: '10%' }}>{compareLabel}</th>}
                <th>Explanation</th>
              </tr>
            </thead>
            <tbody>
              {defs.map((d) => {
                const v = value[d.key] ?? d.default;
                const cmp = compareTo?.[d.key];
                const changed = cmp !== undefined && JSON.stringify(cmp) !== JSON.stringify(v);
                return (
                  <tr key={d.key} className={changed ? 'edited' : ''}>
                    <td>{d.label}</td>
                    <td>
                      {Array.isArray(d.default) ? (
                        <ListInput key={JSON.stringify(v)} value={v as number[]} onChange={(nv) => onChange(d.key, nv)} />
                      ) : (
                        <input
                          className="cell num"
                          type="number"
                          step="any"
                          value={v as number}
                          onChange={(e) => {
                            const n = Number(e.target.value);
                            if (e.target.value !== '' && isFinite(n)) onChange(d.key, n);
                          }}
                        />
                      )}
                    </td>
                    <td className="small">{d.unit}</td>
                    {compareTo && <td className="small muted">{cmp === undefined ? '–' : Array.isArray(cmp) ? `${cmp.length} values` : String(cmp)}</td>}
                    <td className="small muted">{d.description}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </details>
      ))}
    </div>
  );
}
