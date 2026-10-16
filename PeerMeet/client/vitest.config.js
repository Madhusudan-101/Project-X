import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Component tests only (*.test.jsx). The plain *.test.js files run with `node --test`.
export default defineConfig({
  plugins: [react()],
  test: { environment: 'jsdom', include: ['tests/**/*.test.jsx'], globals: true },
});
