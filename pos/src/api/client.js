import axios from 'axios';

// Talks to the exact same ERP backend as frontend/ — same auth, same
// accounting engine, same everything. This app never has its own API.
// In dev, Vite's proxy (vite.config.js) forwards '/api/v1' to the local
// backend; a production deployment must set VITE_API_URL to the deployed
// backend's full base URL (e.g. https://api.alnaciim.com/api/v1).
const client = axios.create({ baseURL: import.meta.env.VITE_API_URL || '/api/v1' });

client.interceptors.request.use((config) => {
  const token = localStorage.getItem('pos_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

client.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('pos_token');
      localStorage.removeItem('pos_user');
      if (!location.pathname.startsWith('/login')) location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export default client;
