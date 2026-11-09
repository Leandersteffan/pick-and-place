import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Web_App dev server and build config.
// - Binds to 127.0.0.1 only; /api is proxied to the Backend (uvicorn on 8765).
// - publicDir points at web/fixtures so the Fixture is served at /demo-v1/...
// - fs.allow '..' lets src import files from web/ (e.g. web/schema/spec.v1.schema.json).
export default defineConfig({
  plugins: [react()],
  publicDir: '../fixtures',
  server: {
    host: '127.0.0.1',
    proxy: {
      '/api': 'http://127.0.0.1:8765',
    },
    fs: {
      allow: ['..'],
    },
  },
  test: {
    environment: 'node',
    passWithNoTests: true,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
