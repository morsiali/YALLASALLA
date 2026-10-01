import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': { target: process.env.VITE_API_TARGET ?? 'http://localhost:4000', changeOrigin: true } },
  },
  preview: {
    proxy: { '/api': { target: process.env.VITE_API_TARGET ?? 'http://localhost:4000', changeOrigin: true } },
  },
  build: { sourcemap: false, chunkSizeWarningLimit: 700 },
  test: { include: ['src/**/*.test.ts'] },
});
