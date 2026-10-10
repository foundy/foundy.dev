import { defineConfig } from 'vite';

// Dev-only experiment: served at /experiments/liquid/ . Not part of the root build.
export default defineConfig({
  base: '/experiments/liquid/',
  build: { target: 'es2022', cssMinify: true, assetsInlineLimit: 0 },
  server: { host: true },
});
