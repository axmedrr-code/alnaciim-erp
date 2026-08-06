import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, X } from 'lucide-react';

// A lightweight "jump to module" search — no backend search endpoint exists (and
// building one is out of scope for a UI-only redesign), so this searches the list of
// modules/sections the signed-in user can actually see and navigates there. Honest
// about what it does: it's navigation, not a records search.
export default function QuickSearch({ items }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const navigate = useNavigate();
  const inputRef = useRef(null);
  const containerRef = useRef(null);

  const matches = query.trim()
    ? items.filter((i) => i.label.toLowerCase().includes(query.trim().toLowerCase()))
    : items;

  useEffect(() => {
    function handleClick(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  function go(to) {
    navigate(to);
    setOpen(false);
    setQuery('');
  }

  return (
    <div className="quick-search" ref={containerRef}>
      <div className="quick-search__input">
        <Search size={15} />
        <input
          ref={inputRef}
          placeholder="Search modules… (e.g. Finance, Orders)"
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onKeyDown={(e) => { if (e.key === 'Enter' && matches[0]) go(matches[0].to); if (e.key === 'Escape') setOpen(false); }}
        />
        {query && <button className="quick-search__clear" onClick={() => setQuery('')}><X size={13} /></button>}
      </div>
      {open && (
        <div className="quick-search__dropdown">
          {matches.length ? matches.map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.to} className="quick-search__item" onClick={() => go(item.to)}>
                <Icon size={15} /> {item.label}
              </button>
            );
          }) : <div className="quick-search__empty">No modules match "{query}"</div>}
        </div>
      )}
    </div>
  );
}
