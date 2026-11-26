import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import client from '../api/client';

// The real client with a fake network: checks what a 401 does to the session.
const realLocation = window.location;
beforeEach(() => {
  localStorage.setItem('token', 'T');
  localStorage.setItem('user', '{"id":1}');
  Object.defineProperty(window, 'location', { value: { pathname: '/finance', href: '/finance' }, writable: true, configurable: true });
});
afterEach(() => { Object.defineProperty(window, 'location', { value: realLocation, writable: true, configurable: true }); });

function respond(status, data = {}) {
  client.defaults.adapter = (config) => {
    const response = { status, data, headers: {}, config };
    return status < 400 ? Promise.resolve(response) : Promise.reject(Object.assign(new Error(`HTTP ${status}`), { config, response, isAxiosError: true }));
  };
}

describe('API client session handling', () => {
  it('sends the stored token as a bearer header', async () => {
    let seen;
    client.defaults.adapter = (config) => { seen = config.headers.Authorization; return Promise.resolve({ status: 200, data: {}, headers: {}, config }); };
    await client.get('/anything');
    expect(seen).toBe('Bearer T');
  });

  it('a 401 on a normal call ends the session and goes to the login page', async () => {
    respond(401);
    await expect(client.get('/inventory/stock-levels')).rejects.toBeTruthy();
    expect(localStorage.getItem('token')).toBeNull();
    expect(localStorage.getItem('user')).toBeNull();
    expect(window.location.href).toBe('/login');
  });

  it.each(['/auth/login', '/auth/change-password'])('a 401 from %s means wrong credentials: the session is kept', async (url) => {
    respond(401);
    await expect(client.post(url, {})).rejects.toBeTruthy();
    expect(localStorage.getItem('token')).toBe('T');
    expect(window.location.href).toBe('/finance');
  });

  it('a 403 is an access problem, not a session problem: nothing is cleared', async () => {
    respond(403);
    await expect(client.get('/finance/chart-of-accounts')).rejects.toBeTruthy();
    expect(localStorage.getItem('token')).toBe('T');
  });
});
