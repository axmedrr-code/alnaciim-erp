import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../App';
import { ROUTES, EXPECTED } from '../test/accessMatrix';

// No network: every API call resolves to "no data".
vi.mock('../api/client', () => {
  const ok = () => Promise.resolve({ data: { data: null } });
  return { default: { get: vi.fn(ok), post: vi.fn(ok), put: vi.fn(ok), delete: vi.fn(ok), interceptors: { request: { use() {} }, response: { use() {} } } } };
});
// Pages are replaced by one-word stubs: these tests are about routing and access, not page content.
const { page } = vi.hoisted(() => ({ page: (name) => () => ({ default: () => `PAGE:${name}` }) }));
vi.mock('../pages/Dashboard', page('Dashboard'));
vi.mock('../pages/inventory/InventoryPage', page('Inventory'));
vi.mock('../pages/production/ProductionPage', page('Production'));
vi.mock('../pages/sales/SalesPage', page('Sales'));
vi.mock('../pages/procurement/ProcurementPage', page('Procurement'));
vi.mock('../pages/maintenance/MaintenancePage', page('Maintenance'));
vi.mock('../pages/finance/FinancePage', page('Finance'));
vi.mock('../pages/reports/ReportsPage', page('Reports'));
vi.mock('../pages/settings/SettingsPage', page('Settings'));
vi.mock('../pages/driver/DriverPage', page('Driver'));
vi.mock('../pages/procurement/RequisitionsPage', page('Requisitions'));
vi.mock('../pages/OperationsDashboard', page('Operations'));
vi.mock('../pages/LogisticsExceptionsPage', page('Logistics'));
vi.mock('../pages/TankerLoadingPage', page('TankerLoading'));
vi.mock('../pages/CollectionsPage', page('Collections'));
vi.mock('../components/QuickSearch', () => ({ default: () => null }));
vi.mock('../components/NotificationsBell', () => ({ default: () => null }));
vi.mock('../components/UserMenu', () => ({ default: () => null }));

const STUB = {
  '/operations': 'Operations', '/logistics': 'Logistics', '/tanker-loading': 'TankerLoading', '/collections': 'Collections',
  '/inventory': 'Inventory', '/production': 'Production', '/sales': 'Sales', '/requisitions': 'Requisitions', '/procurement': 'Procurement',
  '/maintenance': 'Maintenance', '/finance': 'Finance', '/reports': 'Reports', '/settings': 'Settings', '/driver': 'Driver'
};

function signIn(role) {
  localStorage.setItem('token', 'test-token');
  localStorage.setItem('user', JSON.stringify({ id: 1, fullName: `Test ${role}`, role, assignedWarehouseId: null }));
}
function open(path) {
  return render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
}

describe('signed out', () => {
  it('a protected URL sends the visitor to the login form', async () => {
    open('/finance');
    expect(await screen.findByRole('button', { name: /sign in/i })).toBeInTheDocument();
    expect(screen.queryByText('PAGE:Finance')).not.toBeInTheDocument();
  });
});

describe('signed in', () => {
  it('opening /login while signed in goes to the dashboard', async () => {
    signIn('Cashier');
    open('/login');
    expect(await screen.findByText('PAGE:Dashboard')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /sign in/i })).not.toBeInTheDocument();
  });

  it('an unknown URL shows "Page not found" inside the app shell', async () => {
    signIn('Admin');
    open('/does-not-exist');
    expect(await screen.findByText('Page not found')).toBeInTheDocument();
  });
});

// Every role x every page: allowed pages render, the others show the access message and never the page.
describe.each(['Admin', 'Finance Officer', 'Cashier', 'Collector', 'Storekeeper', 'Data Entry Operator', 'Sales Manager', 'Driver'])('%s', (role) => {
  const allowed = new Set(EXPECTED[role]);
  it.each(ROUTES)('%s', async (path) => {
    signIn(role);
    open(path);
    if (allowed.has(path)) {
      expect(await screen.findByText(`PAGE:${STUB[path]}`)).toBeInTheDocument();
    } else {
      expect(await screen.findByText('You do not have access to this page')).toBeInTheDocument();
      expect(screen.queryByText(`PAGE:${STUB[path]}`)).not.toBeInTheDocument();
    }
  });
});

describe('the sidebar shows exactly the pages the role may open', () => {
  it.each(['Admin', 'Finance Officer', 'Cashier', 'Collector', 'Storekeeper', 'Data Entry Operator', 'Sales Manager'])('%s', async (role) => {
    signIn(role);
    const { container } = open('/requisitions');
    await screen.findByText('PAGE:Requisitions');
    const links = [...container.querySelectorAll('aside nav a')].map((a) => a.getAttribute('href')).sort();
    const expected = ['/', ...EXPECTED[role].filter((p) => p !== '/driver')].sort();
    expect(links).toEqual(expected);
  });

  it('a Driver gets the minimal shell without the sidebar', async () => {
    signIn('Driver');
    const { container } = open('/driver');
    await screen.findByText('PAGE:Driver');
    expect(container.querySelector('aside')).toBeNull();
  });
});
