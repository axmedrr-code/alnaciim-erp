import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../App';

// No network; the two real pages are replaced by one-word stubs: these tests are about routing and the sign-in state.
vi.mock('../api/client', () => {
  const ok = () => Promise.resolve({ data: { data: null } });
  return { default: { get: vi.fn(ok), post: vi.fn(ok), put: vi.fn(ok), interceptors: { request: { use() {} }, response: { use() {} } } } };
});
vi.mock('../pages/RoutePlanning', () => ({ default: () => 'PAGE:Routes' }));
vi.mock('../pages/BulkImport', () => ({ default: () => 'PAGE:Import' }));

function signIn() {
  localStorage.setItem('pos_token', 'test-token');
  localStorage.setItem('pos_user', JSON.stringify({ id: 1, fullName: 'Test Supervisor', role: 'Route Supervisor' }));
}
function open(path) {
  return render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
}

describe('POS routing', () => {
  it('signed out: the home page, a protected page and an unknown URL all end at the login form', async () => {
    for (const path of ['/', '/routes', '/import', '/does-not-exist']) {
      const { unmount } = open(path);
      expect(await screen.findByRole('button', { name: /sign in/i })).toBeInTheDocument();
      unmount();
    }
  });

  it('signed in: the home page goes to Routes', async () => {
    signIn();
    open('/');
    expect(await screen.findByText('PAGE:Routes')).toBeInTheDocument();
  });

  it('signed in: Import opens', async () => {
    signIn();
    open('/import');
    expect(await screen.findByText('PAGE:Import')).toBeInTheDocument();
  });

  it('signed in: /login goes back to the app instead of showing the form', async () => {
    signIn();
    open('/login');
    expect(await screen.findByText('PAGE:Routes')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /sign in/i })).not.toBeInTheDocument();
  });

  it('signed in: an unknown URL goes to the app', async () => {
    signIn();
    open('/does-not-exist');
    expect(await screen.findByText('PAGE:Routes')).toBeInTheDocument();
  });

  it('logging out removes the session and shows the login form', async () => {
    signIn();
    open('/routes');
    await screen.findByText('PAGE:Routes');
    fireEvent.click(screen.getByRole('button', { name: /logout/i }));
    expect(await screen.findByRole('button', { name: /sign in/i })).toBeInTheDocument();
    expect(localStorage.getItem('pos_token')).toBeNull();
    expect(localStorage.getItem('pos_user')).toBeNull();
  });
});
