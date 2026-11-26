import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.js',
    css: false
  },
  server: {
    port: 5174,
    proxy: {
      // E2E_API_TARGET lets the Playwright suite (e2e/) point the dev proxy at its own throwaway backend.
      '/api': process.env.E2E_API_TARGET || 'http://localhost:4000'
    }
  }
});
