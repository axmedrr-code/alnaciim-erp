import { Link, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Layout() {
  const { user, logout } = useAuth();

  return (
    <div className="app-shell">
      <div className="topbar">
        <strong>Alnaciim Water — Route Operations</strong>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <Link to="/routes" style={{ color: '#fff', fontSize: 13 }}>Routes</Link>
          <Link to="/import" style={{ color: '#fff', fontSize: 13 }}>Import</Link>
          <span className="who">{user?.fullName} · {user?.role}</span>
          <button className="btn secondary" onClick={logout} style={{ padding: '5px 12px', fontSize: 12.5 }}>Logout</button>
        </div>
      </div>
      <div className="content">
        <Outlet />
      </div>
    </div>
  );
}
