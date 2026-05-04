import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwind from '@astrojs/tailwind';

// GitHub Pages 배포 기준.
const SITE = process.env.SITE_URL ?? 'https://sujaekong.github.io';
const BASE = process.env.BASE_PATH ?? '/kpcitpe-search';

export default defineConfig({
  site: SITE,
  base: BASE,
  trailingSlash: 'ignore',
  integrations: [react(), tailwind({ applyBaseStyles: false })],
  vite: {
    ssr: {
      noExternal: ['fuse.js'],
    },
  },
});
