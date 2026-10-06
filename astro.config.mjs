import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://foundy.dev',
  output: 'static',
  integrations: [sitemap({ filter: (page) => !page.endsWith('/404/') && !page.includes('/spike/') })],
});
