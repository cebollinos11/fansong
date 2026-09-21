import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The web app is a thin client of the workspace engine packages, which are
// consumed straight from their TypeScript sources (see each package's "main").
// Vite/esbuild transpiles them, so no build step is needed for the packages.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
});
