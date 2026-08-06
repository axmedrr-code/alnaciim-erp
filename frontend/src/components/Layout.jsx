import { useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Package, Factory, Truck, ShoppingCart, Wrench,
  Landmark, BarChart3, Settings as SettingsIcon, Menu, LogOut, Droplets,
  PanelLeftClose, PanelLeftOpen, Sun, Moon, Building2
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import QuickSearch from './QuickSearch';
import NotificationsBell from './NotificationsBell';
import UserMenu from './UserMenu';

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, roles: null },
  { to: '/inventory', label: 'Inventory', icon: Package, roles: ['Admin', 'Inventory Manager', 'Storekeeper'] },
  { to: '/production', label: 'Production', icon: Factory, roles: ['Admin', 'Production Manager', 'Technician'] },
  { to: '/sales', label: 'Sales & Distribution', icon: Truck, roles: ['Admin', 'Sales Manager'] },
  { to: '/procurement', label: 'Procurement', icon: ShoppingCart, roles: ['Admin', 'Procurement Officer', 'Storekeeper'] },
  { to: '/maintenance', label: 'Maintenance', icon: Wrench, roles: ['Admin', 'Production Manager', 'Technician'] },
  { to: '/finance', label: 'Finance', icon: Landmark, roles: ['Admin', 'Finance Officer'] },
  { to: '/reports', label: 'Reports', icon: BarChart3, roles: null },
  { to: '/settings', label: 'Settings', icon: SettingsIcon, roles: ['Admin'] }
];

// Drivers get a minimal, mobile-first shell — just their delivery list and logout,
// not the full back-office console the rest of the team uses.
function DriverLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="app-shell app-shell--driver">
      <header className="topbar">
        <div className="topbar__left"><strong>Alnaciim ERP — Driver</strong></div>
        <div className="topbar__user">
          <span>{user?.fullName}</span>
          <button onClick={() => { logout(); navigate('/login'); }}><LogOut size={14} /> Log out</button>
        </div>
      </header>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}

export default function Layout() {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('sidebarCollapsed') === 'true');

  if (user?.role === 'Driver') return <DriverLayout />;

  const visible = NAV_ITEMS.filter((item) => !item.roles || item.roles.includes(user?.role));
  const currentLabel = visible.find((item) => (item.to === '/' ? location.pathname === '/' : location.pathname.startsWith(item.to)))?.label || 'Alnaciim ERP';

  function toggleCollapsed() {
    setCollapsed((c) => {
      localStorage.setItem('sidebarCollapsed', String(!c));
      return !c;
    });
  }

  return (
    <div className={`app-shell ${collapsed ? 'app-shell--collapsed' : ''}`}>
      <aside className={`sidebar ${menuOpen ? 'sidebar--open' : ''} ${collapsed ? 'sidebar--collapsed' : ''}`}>
        <div className="sidebar__brand">
          <div className="sidebar__brand-icon"><Droplets size={18} color="#fff" /></div>
          {!collapsed && (
            <div>
              Alnaciim Water Co.
              <small>Inventory & Manufacturing ERP</small>
            </div>
          )}
        </div>
        <nav>
          {visible.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink key={item.to} to={item.to} end={item.to === '/'} onClick={() => setMenuOpen(false)} title={collapsed ? item.label : undefined}>
                <Icon size={17} />
                {!collapsed && item.label}
              </NavLink>
            );
          })}
        </nav>
        <button className="sidebar__collapse-btn" onClick={toggleCollapsed} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
          {collapsed ? <PanelLeftOpen size={17} /> : <><PanelLeftClose size={17} /> Collapse</>}
        </button>
        {!collapsed && <div className="sidebar__footer">© {new Date().getFullYear()} Alnaciim Water Company</div>}
      </aside>
      {menuOpen && <div className="sidebar-backdrop" onClick={() => setMenuOpen(false)} />}
      <div className="main">
        <header className="topbar">
          <div className="topbar__left">
            <button className="menu-toggle" aria-label="Toggle menu" onClick={() => setMenuOpen((o) => !o)}><Menu size={17} /></button>
            <strong className="topbar__page-title">{currentLabel}</strong>
            <div className="company-badge"><Building2 size={13} /> Alnaciim Water Company</div>
          </div>
          <div className="topbar__center">
            <QuickSearch items={visible} />
          </div>
          <div className="topbar__user">
            <button className="icon-btn" onClick={toggleTheme} aria-label="Toggle dark mode" title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
              {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
            </button>
            <NotificationsBell />
            <UserMenu user={user} onLogout={() => { logout(); navigate('/login'); }} />
          </div>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
