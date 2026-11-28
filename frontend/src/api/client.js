import axios from 'axios';

// In dev, Vite's own proxy (vite.config.js) forwards the relative '/api/v1'
// path to the local backend — that proxy doesn't exist once this is a static
// production build, so a real deployment must set VITE_API_URL to the
// deployed backend's full base URL (e.g. https://api.alnaciim.com/api/v1).
const client = axios.create({ baseURL: import.meta.env.VITE_API_URL || '/api/v1' });

// A password change makes the server end every older token. While the change call is in flight, other requests of this same
// page (dashboards refreshing in the background) can be refused with 401 even though this session is fine: the change call
// returns a fresh token. So a 401 waits for an in-flight change, and a request sent with an out-of-date token is retried once
// with the stored one. Only a 401 that stays a 401 ends the session.
let credentialChange = null;

client.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  if (/\/auth\/change-password$/.test(String(config.url || ''))) {
    credentialChange = new Promise((resolve) => { config._credentialChangeDone = resolve; });
  }
  return config;
});

client.interceptors.response.use(
  (res) => {
    if (res.config?._credentialChangeDone && res.data?.data?.token) localStorage.setItem('token', res.data.data.token);
    res.config?._credentialChangeDone?.();
    return res;
  },
  async (err) => {
    err.config?._credentialChangeDone?.();
    // A 401 from the login or change-password call means "wrong credentials", not "your session ended": show the message, keep the session.
    const credentialCheck = /\/auth\/(login|change-password)$/.test(String(err.config?.url || ''));
    if (err.response?.status === 401 && !credentialCheck) {
      if (err.config && !err.config._retriedWithNewToken) {
        if (credentialChange) await credentialChange;
        const now = localStorage.getItem('token');
        if (now && err.config.headers?.Authorization !== `Bearer ${now}`) {
          err.config._retriedWithNewToken = true;
          return client.request(err.config);
        }
      }
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      if (!location.pathname.startsWith('/login')) location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export default client;
