/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // Listen on all interfaces so other devices on the LAN can open the dev server.
    host: true,
    port: 5175,
    // Allow your custom local domain
    // Plus ngrok tunnels, for sharing the dev app with remote testers.
    allowedHosts: ['www.grateful-solutions.com', '.ngrok-free.app', '.ngrok-free.dev'],
    // Same-origin in development: the refresh cookie works without CORS.
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY ?? 'http://localhost:4000',
        changeOrigin: false,
      },
    },
  },
  build: { sourcemap: true, chunkSizeWarningLimit: 900 },
  test: { environment: 'jsdom', setupFiles: ['src/test/setup.ts'], css: false },
});