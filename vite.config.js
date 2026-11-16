import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  // The preview hostname is provided per-run by the environment, never hard-coded.
  server: {
    host: '0.0.0.0',
    port: 3000,
    strictPort: false,
    allowedHosts: process.env.KA_ALLOWED_HOST ? [process.env.KA_ALLOWED_HOST] : undefined,
  },
  build: {
    target: 'es2020',
    outDir: 'dist',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 2000,
  },
});
