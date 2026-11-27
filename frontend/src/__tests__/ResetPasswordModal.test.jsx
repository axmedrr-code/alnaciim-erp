import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { AuthProvider } from '../context/AuthContext';
import ResetPasswordModal from '../components/ResetPasswordModal';
import UsersTab from '../pages/settings/UsersTab';
import client from '../api/client';

vi.mock('../api/client', () => ({ default: { get: vi.fn(), put: vi.fn(), post: vi.fn(), interceptors: { request: { use() {} }, response: { use() {} } } } }));

const TARGET = { id: 42, full_name: 'Test Cashier', email: 'uat.cashier@alnaciim.test', role_name: 'Cashier' };
const GOOD = 'Tamarind-River-92';

function fill(p, c) {
  fireEvent.change(screen.getByLabelText(/New password/), { target: { value: p } });
  fireEvent.change(screen.getByLabelText('Repeat the new password'), { target: { value: c } });
  fireEvent.submit(screen.getByLabelText(/New password/).closest('form'));
}

beforeEach(() => { client.put.mockReset(); client.get.mockReset(); });

describe('Admin reset password modal', () => {
  it('sends the password and its confirmation once, then shows no password anywhere', async () => {
    client.put.mockResolvedValue({ data: { data: { id: 42, password_reset: true } } });
    const { container } = render(<ResetPasswordModal user={TARGET} onClose={() => {}} />);
    fill(GOOD, GOOD);
    await screen.findByRole('status');
    expect(client.put).toHaveBeenCalledTimes(1);
    expect(client.put).toHaveBeenCalledWith('/users/42/password', { password: GOOD, password_confirmation: GOOD });
    expect(container.innerHTML).not.toContain(GOOD);
    expect(screen.queryByLabelText(/New password/)).not.toBeInTheDocument();
  });

  it('refuses fewer than 12 characters or mismatching entries without calling the server', async () => {
    render(<ResetPasswordModal user={TARGET} onClose={() => {}} />);
    fill('Short-pw-11', 'Short-pw-11');
    expect(await screen.findByText(/at least 12 characters/)).toBeInTheDocument();
    fill(GOOD, 'Tamarind-River-93');
    expect(await screen.findByText(/do not match/)).toBeInTheDocument();
    expect(client.put).not.toHaveBeenCalled();
  });

  it('shows the server policy message and clears both fields after a refused reset', async () => {
    client.put.mockRejectedValue({ response: { status: 400, data: { error: 'password: Password is too common or easy to guess' } } });
    const { container } = render(<ResetPasswordModal user={TARGET} onClose={() => {}} />);
    fill('Password-2026-ok', 'Password-2026-ok');
    expect(await screen.findByText(/too common/)).toBeInTheDocument();
    expect(screen.getByLabelText(/New password/)).toHaveValue('');
    expect(screen.getByLabelText('Repeat the new password')).toHaveValue('');
    expect(container.innerHTML).not.toContain('Password-2026-ok');
  });
});

describe('Settings → Users reset button', () => {
  const USERS = [
    { id: 1, full_name: 'Me Admin', email: 'me@alnaciim.test', role_name: 'Admin', is_active: true },
    { id: 2, full_name: 'Other Admin', email: 'other@alnaciim.test', role_name: 'Admin', is_active: true },
    { ...TARGET, is_active: true }
  ];

  it('is offered for non-Admin users only, never for my own account or another Admin', async () => {
    client.get.mockImplementation((url) => Promise.resolve({ data: { data: url === '/users' ? USERS : [] } }));
    localStorage.setItem('user', JSON.stringify({ id: 1, fullName: 'Me Admin', role: 'Admin' }));
    render(<AuthProvider><UsersTab /></AuthProvider>);
    const btn = await screen.findByRole('button', { name: `Reset password for ${TARGET.email}` });
    expect(screen.getAllByRole('button', { name: /^Reset password for/ })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Reset password for me@alnaciim.test' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reset password for other@alnaciim.test' })).not.toBeInTheDocument();
    fireEvent.click(btn);
    expect(within(screen.getByRole('dialog', { name: 'Reset password' })).getByText(/uat.cashier@alnaciim.test/)).toBeInTheDocument();
  });
});
