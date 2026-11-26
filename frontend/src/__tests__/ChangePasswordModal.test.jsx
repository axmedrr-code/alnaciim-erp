import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ChangePasswordModal from '../components/ChangePasswordModal';
import client from '../api/client';

vi.mock('../api/client', () => ({ default: { post: vi.fn(), interceptors: { request: { use() {} }, response: { use() {} } } } }));

function fill(current, next, confirm) {
  fireEvent.change(screen.getByLabelText('Current password'), { target: { value: current } });
  fireEvent.change(screen.getByLabelText(/New password/), { target: { value: next } });
  fireEvent.change(screen.getByLabelText('Repeat the new password'), { target: { value: confirm } });
  fireEvent.submit(screen.getByLabelText('Current password').closest('form'));
}

beforeEach(() => { client.post.mockReset(); localStorage.setItem('token', 'OLD-TOKEN'); });

describe('Change password', () => {
  it('stores the fresh token the server returns so this session stays signed in', async () => {
    client.post.mockResolvedValue({ data: { data: { password_changed: true, token: 'NEW-TOKEN' } } });
    render(<ChangePasswordModal onClose={() => {}} />);
    fill('old-pass-123', 'new-pass-456', 'new-pass-456');
    await screen.findByText(/Your password was changed/);
    expect(client.post).toHaveBeenCalledWith('/auth/change-password', { current_password: 'old-pass-123', new_password: 'new-pass-456' });
    expect(localStorage.getItem('token')).toBe('NEW-TOKEN');
  });

  it('a wrong current password shows the server message and keeps the session', async () => {
    client.post.mockRejectedValue({ response: { status: 401, data: { error: 'The current password is incorrect' } } });
    render(<ChangePasswordModal onClose={() => {}} />);
    fill('wrong', 'new-pass-456', 'new-pass-456');
    expect(await screen.findByText('The current password is incorrect')).toBeInTheDocument();
    expect(localStorage.getItem('token')).toBe('OLD-TOKEN');
  });

  it('refuses a short or mismatching new password without calling the server', async () => {
    render(<ChangePasswordModal onClose={() => {}} />);
    fill('old-pass-123', 'short', 'short');
    expect(await screen.findByText(/at least 8 characters/)).toBeInTheDocument();
    fill('old-pass-123', 'new-pass-456', 'different-789');
    expect(await screen.findByText(/do not match/)).toBeInTheDocument();
    await waitFor(() => expect(client.post).not.toHaveBeenCalled());
  });
});
