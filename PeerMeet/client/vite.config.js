import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // simple-peer relies on Node.js built-ins (events, util, process).
    // This plugin shims them so they work in the browser.
    nodePolyfills({
      include: ['events', 'util', 'process', 'buffer'],
      globals: { process: true, Buffer: true, global: true },
    }),
  ],
  server: {
    port: 5173,
    // Proxy API calls to the backend in development
    proxy: {
      '/socket.io': {
        target: 'http://localhost:5001',
        ws: true,
        changeOrigin: true,
      },
    },
  },
  optimizeDeps: {
    include: ['simple-peer'],
  },
});
