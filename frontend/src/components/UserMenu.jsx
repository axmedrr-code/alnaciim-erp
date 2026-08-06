import { useEffect, useRef, useState } from 'react';
import { ChevronDown, LogOut } from 'lucide-react';

function initials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase();
}

export default function UserMenu({ user, onLogout }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function handleClick(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  return (
    <div className="user-menu" ref={ref}>
      <button className="user-menu__trigger" onClick={() => setOpen((o) => !o)}>
        <div className="avatar">{initials(user?.fullName)}</div>
        <span className="user-menu__name">{user?.fullName}</span>
        <ChevronDown size={14} />
      </button>
      {open && (
        <div className="user-menu__dropdown">
          <div className="user-menu__info">
            <div className="avatar avatar--lg">{initials(user?.fullName)}</div>
            <div>
              <div className="user-menu__fullname">{user?.fullName}</div>
              <div className="user-menu__role">{user?.role}</div>
            </div>
          </div>
          <button className="user-menu__item" onClick={onLogout}><LogOut size={15} /> Log out</button>
        </div>
      )}
    </div>
  );
}
