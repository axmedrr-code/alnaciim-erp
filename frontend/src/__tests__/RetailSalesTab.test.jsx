import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AuthProvider } from '../context/AuthContext';
import RetailSalesTab from '../pages/sales/RetailSalesTab';

vi.mock('../api/client', () => {
  const ok = () => Promise.resolve({ data: { data: [] } });
  return { default: { get: vi.fn(ok), post: vi.fn(ok), put: vi.fn(ok), interceptors: { request: { use() {} }, response: { use() {} } } } };
});

function renderAs(role) {
  localStorage.setItem('user', JSON.stringify({ id: 1, fullName: 'T', role }));
  return render(<AuthProvider><RetailSalesTab /></AuthProvider>);
}

// Regression for the Cashier case: the Reports endpoints are 403 for a Cashier, so the tab must not be offered at all.
describe('Retail Sales & Billing tabs', () => {
  it('a Cashier gets the four sales tabs and no Reports tab', async () => {
    renderAs('Cashier');
    for (const name of ['Sales Screen', 'Sales List', 'Receive Payment', 'Customer Statement']) expect(await screen.findByText(name)).toBeInTheDocument();
    expect(screen.queryByText('Reports')).not.toBeInTheDocument();
  });

  it.each(['Admin', 'Sales Manager', 'Finance Officer'])('%s also gets the Reports tab', async (role) => {
    renderAs(role);
    expect(await screen.findByText('Reports')).toBeInTheDocument();
  });
});
