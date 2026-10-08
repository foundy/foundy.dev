import { defineConfig } from 'vitest/config';

// Served from https://foundy.dev/bonnet/ for now. Standalone (bonnet.foundy.dev) builds with BONNET_BASE=/.
export default defineConfig({
  base: process.env.BONNET_BASE ?? '/bonnet/',
  build: { target: 'es2022', cssMinify: true, assetsInlineLimit: 0 },
  test: { include: ['tests/**/*.test.ts'] },
});
