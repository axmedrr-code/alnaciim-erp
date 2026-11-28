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

describe('a 401 caused by a concurrent password change', () => {
  const reply = (config, status, data = {}) => {
    const response = { status, data, headers: {}, config };
    return status < 400 ? Promise.resolve(response) : Promise.reject(Object.assign(new Error(`HTTP ${status}`), { config, response, isAxiosError: true }));
  };

  it('a background request refused while the change is in flight is retried with the new token', async () => {
    let releaseChange;
    const seen = [];
    client.defaults.adapter = (config) => {
      if (/change-password$/.test(config.url)) return new Promise((resolve) => { releaseChange = () => resolve(reply(config, 200, { data: { token: 'NEW' } })); });
      seen.push(config.headers.Authorization);
      return config.headers.Authorization === 'Bearer T' ? reply(config, 401) : reply(config, 200, { ok: true });
    };
    const change = client.post('/auth/change-password', {});
    const background = client.get('/dashboard');
    await new Promise((r) => setTimeout(r, 10));
    releaseChange();
    await change;
    const res = await background;
    expect(res.data.ok).toBe(true);
    expect(seen).toEqual(['Bearer T', 'Bearer NEW']);
    expect(localStorage.getItem('token')).toBe('NEW');
    expect(window.location.href).toBe('/finance');
  });

  it('a late 401 that arrives after the new token is stored is retried once', async () => {
    client.defaults.adapter = (config) => (config.headers.Authorization === 'Bearer T' ? reply(config, 401) : reply(config, 200, { ok: true }));
    const request = client.get('/dashboard');
    localStorage.setItem('token', 'NEW');
    expect((await request).data.ok).toBe(true);
    expect(window.location.href).toBe('/finance');
  });

  it('a session that really ended still goes to the login page and is not retried forever', async () => {
    let calls = 0;
    client.defaults.adapter = (config) => { calls += 1; return reply(config, 401); };
    await expect(client.get('/dashboard')).rejects.toBeTruthy();
    expect(calls).toBe(1);
    expect(localStorage.getItem('token')).toBeNull();
    expect(window.location.href).toBe('/login');
  });
});
