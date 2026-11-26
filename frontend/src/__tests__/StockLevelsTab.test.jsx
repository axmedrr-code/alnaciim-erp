import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AuthProvider } from '../context/AuthContext';
import StockLevelsTab from '../pages/inventory/StockLevelsTab';
import client from '../api/client';

vi.mock('../api/client', () => ({ default: { get: vi.fn(), interceptors: { request: { use() {} }, response: { use() {} } } } }));

const WAREHOUSES = [{ id: 1, name: 'Raw Store' }, { id: 5, name: 'Finished Water' }, { id: 9, name: 'Spare Store' }];
beforeEach(() => {
  client.get.mockReset();
  client.get.mockImplementation((url) => Promise.resolve({ data: { data: url.startsWith('/warehouses') ? WAREHOUSES : [] } }));
});

function renderAs(user) {
  localStorage.setItem('user', JSON.stringify({ id: 1, fullName: 'T', ...user }));
  return render(<AuthProvider><StockLevelsTab /></AuthProvider>);
}

describe('Stock Levels warehouse filter', () => {
  it('a Storekeeper sees only the assigned warehouse and never "All warehouses"', async () => {
    renderAs({ role: 'Storekeeper', assignedWarehouseId: 5 });
    await screen.findByRole('option', { name: 'Finished Water' });
    expect(screen.queryByRole('option', { name: 'All warehouses' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Raw Store' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Spare Store' })).not.toBeInTheDocument();
    await waitFor(() => expect(client.get).toHaveBeenCalledWith('/inventory/stock-levels?warehouse_id=5'));
    expect(client.get).not.toHaveBeenCalledWith('/inventory/stock-levels');
  });

  it('an Inventory Manager can pick any warehouse or all of them', async () => {
    renderAs({ role: 'Inventory Manager', assignedWarehouseId: null });
    expect(await screen.findByRole('option', { name: 'All warehouses' })).toBeInTheDocument();
    for (const n of ['Raw Store', 'Finished Water', 'Spare Store']) expect(screen.getByRole('option', { name: n })).toBeInTheDocument();
    await waitFor(() => expect(client.get).toHaveBeenCalledWith('/inventory/stock-levels'));
  });
});
