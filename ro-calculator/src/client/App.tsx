import { createBrowserRouter, NavLink, Outlet, RouterProvider, useRouteError } from 'react-router-dom';
import { AppProvider, useApp } from './context';
import { DesignPage } from './pages/DesignPage';
import { MembraneLibraryPage, PumpLibraryPage } from './pages/LibraryPages';
import { DashboardPage, NewDesignPage, ProjectsPage } from './pages/ProjectPages';
import { BomPage, ChemistryPage, PipeCalculatorPage, PretreatmentPage, ReportsPage, SettingsPage } from './pages/ToolPages';

const NAV = [
  { to: '/', label: 'Dashboard', icon: '▦', end: true },
  { to: '/projects', label: 'Projects', icon: '🗂' },
  { to: '/new', label: 'New RO Design', icon: '＋' },
  { to: '/membranes', label: 'Membrane Library', icon: '≣' },
  { to: '/pumps', label: 'Pump Library', icon: '⚙' },
  { to: '/pipes', label: 'Pipe Calculator', icon: '⌀' },
  { to: '/chemistry', label: 'Water Chemistry', icon: '⚗' },
  { to: '/pretreatment', label: 'Pretreatment', icon: '▥' },
  { to: '/bom', label: 'BOM', icon: '☰' },
  { to: '/reports', label: 'Reports', icon: '🖶' },
  { to: '/settings', label: 'Settings', icon: '⚙︎' },
];

function Layout() {
  const { activeProjectId } = useApp();
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="logo">💧</span>
          <div>
            <div className="brand-name">RO System</div>
            <div className="brand-sub">Engineering Calculator</div>
          </div>
        </div>
        <nav>
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive ? 'active' : '')}>
              <span className="nav-icon">{n.icon}</span>
              {n.label}
            </NavLink>
          ))}
          {activeProjectId && (
            <NavLink to={`/design/${activeProjectId}?tab=summary`} className={({ isActive }) => `nav-active-project ${isActive ? 'active' : ''}`}>
              <span className="nav-icon">★</span>Active design
            </NavLink>
          )}
        </nav>
        <div className="sidebar-foot">
          Local · offline · SQLite
          <br />
          Preliminary engineering tool
        </div>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}

function ErrorPage() {
  const err = useRouteError() as Error;
  return (
    <div className="empty">
      <h2>Something went wrong</h2>
      <p>{err?.message ?? String(err)}</p>
      <a href="/">Back to dashboard</a>
    </div>
  );
}

const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    errorElement: <ErrorPage />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'projects', element: <ProjectsPage /> },
      { path: 'new', element: <NewDesignPage /> },
      { path: 'design/:id', element: <DesignPage /> },
      { path: 'membranes', element: <MembraneLibraryPage /> },
      { path: 'pumps', element: <PumpLibraryPage /> },
      { path: 'pipes', element: <PipeCalculatorPage /> },
      { path: 'chemistry', element: <ChemistryPage /> },
      { path: 'pretreatment', element: <PretreatmentPage /> },
      { path: 'bom', element: <BomPage /> },
      { path: 'reports', element: <ReportsPage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: '*', element: <div className="empty">Page not found.</div> },
    ],
  },
]);

export function App() {
  return (
    <AppProvider>
      <RouterProvider router={router} />
    </AppProvider>
  );
}
