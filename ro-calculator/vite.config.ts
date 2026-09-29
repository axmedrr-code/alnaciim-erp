import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  root: '.',
  build: { outDir: 'dist/client', emptyOutDir: true, chunkSizeWarningLimit: 1500 },
  server: {
    port: 5173,
    host: '127.0.0.1',
    proxy: { '/api': 'http://127.0.0.1:3000' },
  },
});
