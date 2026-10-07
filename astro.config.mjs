import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// The hero spike pages (src/spike/pages) are reference material: they exist on the dev server only and are never
// part of `astro build`, so they cannot reach GitHub Pages. See docs/spike/hero-spike.md.
const spikeRoutes = {
  name: 'spike-routes-dev-only',
  hooks: {
    'astro:config:setup': ({ command, injectRoute }) => {
      if (command !== 'dev') return;
      injectRoute({ pattern: '/spike/raw', entrypoint: './src/spike/pages/raw.astro' });
      injectRoute({ pattern: '/spike/three', entrypoint: './src/spike/pages/three.astro' });
    },
  },
};

export default defineConfig({
  site: 'https://foundy.dev',
  output: 'static',
  integrations: [spikeRoutes, sitemap({ filter: (page) => !page.endsWith('/404/') && !page.includes('/spike/') })],
});
