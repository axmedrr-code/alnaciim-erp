import { useMemo, useState } from 'react';
import { Search, ChevronUp, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';

function getValue(row, key) {
  return key.split('.').reduce((v, k) => (v == null ? v : v[k]), row);
}

// Backward compatible: existing call sites that just pass `columns`/`rows`/`emptyText`
// keep working exactly as before. Passing `searchable`, `sortable`, or `pageSize` turns
// on the matching feature without any other call site needing to change.
export default function Table({
  columns, rows, emptyText = 'No records found.',
  searchable = false, searchPlaceholder = 'Search…',
  sortable = false, pageSize = 0
}) {
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState(null); // { key, dir }
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    if (!rows) return rows;
    if (!searchable || !search.trim()) return rows;
    const q = search.trim().toLowerCase();
    return rows.filter((row) =>
      columns.some((col) => {
        const raw = col.render ? col.render(row) : getValue(row, col.key);
        const text = typeof raw === 'object' && raw !== null ? '' : String(raw ?? '');
        return text.toLowerCase().includes(q);
      })
    );
  }, [rows, search, searchable, columns]);

  const sorted = useMemo(() => {
    if (!filtered || !sortable || !sort) return filtered;
    const copy = [...filtered];
    copy.sort((a, b) => {
      const av = getValue(a, sort.key);
      const bv = getValue(b, sort.key);
      if (av == null && bv == null) return 0;
      if (av == null) return -1;
      if (bv == null) return 1;
      const an = Number(av), bn = Number(bv);
      const bothNumeric = !Number.isNaN(an) && !Number.isNaN(bn) && av !== '' && bv !== '';
      const cmp = bothNumeric ? an - bn : String(av).localeCompare(String(bv));
      return sort.dir === 'asc' ? cmp : -cmp;
    });
    return copy;
  }, [filtered, sort, sortable]);

  const pageCount = pageSize > 0 && sorted ? Math.max(1, Math.ceil(sorted.length / pageSize)) : 1;
  const clampedPage = Math.min(page, pageCount - 1);
  const paged = pageSize > 0 && sorted ? sorted.slice(clampedPage * pageSize, clampedPage * pageSize + pageSize) : sorted;

  if (!rows) return <p className="muted">Loading…</p>;

  function toggleSort(col) {
    if (!sortable || col.sortable === false) return;
    setSort((prev) => {
      if (!prev || prev.key !== col.key) return { key: col.key, dir: 'asc' };
      if (prev.dir === 'asc') return { key: col.key, dir: 'desc' };
      return null;
    });
  }

  return (
    <div>
      {searchable && (
        <div className="table-toolbar">
          <div className="table-search">
            <Search size={14} />
            <input placeholder={searchPlaceholder} value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} />
          </div>
          {rows.length > 0 && <span className="table-meta">{sorted.length} of {rows.length} records</span>}
        </div>
      )}
      {!rows.length ? (
        <p className="muted">{emptyText}</p>
      ) : !sorted.length ? (
        <p className="muted">No records match your search.</p>
      ) : (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {columns.map((col) => {
                    const isSortable = sortable && col.sortable !== false;
                    const active = sort?.key === col.key;
                    return (
                      <th key={col.key} className={isSortable ? 'sortable' : ''} onClick={() => toggleSort(col)}>
                        {col.header}
                        {isSortable && (
                          <span className="sort-icon">
                            {active ? (sort.dir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />) : <ChevronDown size={12} style={{ opacity: 0.35 }} />}
                          </span>
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {paged.map((row, i) => (
                  <tr key={row.id ?? i}>
                    {columns.map((col) => (
                      <td key={col.key}>{col.render ? col.render(row) : row[col.key]}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pageSize > 0 && pageCount > 1 && (
            <div className="table-pagination">
              <span>Page {clampedPage + 1} of {pageCount}</span>
              <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={clampedPage === 0}><ChevronLeft size={14} /></button>
              <button onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))} disabled={clampedPage >= pageCount - 1}><ChevronRight size={14} /></button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
