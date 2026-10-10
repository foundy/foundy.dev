import { defineConfig } from 'vite';
// Dev-only experiment. Not part of the root build.
export default defineConfig({ base: process.env.PROJECTOR_BASE ?? '/experiments/projector/', build: { target: 'es2022', assetsInlineLimit: 0 } });
