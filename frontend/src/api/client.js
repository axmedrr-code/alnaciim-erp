import axios from 'axios';

// In dev, Vite's own proxy (vite.config.js) forwards the relative '/api/v1'
// path to the local backend — that proxy doesn't exist once this is a static
// production build, so a real deployment must set VITE_API_URL to the
// deployed backend's full base URL (e.g. https://api.alnaciim.com/api/v1).
const client = axios.create({ baseURL: import.meta.env.VITE_API_URL || '/api/v1' });

client.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

client.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      if (!location.pathname.startsWith('/login')) location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export default client;
