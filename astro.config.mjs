import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwind from '@astrojs/tailwind';
import cloudflare from '@astrojs/cloudflare';

// SITE/BASE는 워크플로우별로 다르게 주입:
//  - Cloudflare Pages: SITE=https://kpcitpe-search.pages.dev, BASE=/
//  - GitHub Pages    : SITE=https://sujaekong.github.io, BASE=/kpcitpe-search
const SITE = process.env.SITE_URL ?? 'https://kpcitpe-search.pages.dev';
const BASE = process.env.BASE_PATH ?? '/';

export default defineConfig({
  site: SITE,
  base: BASE,
  output: 'hybrid',
  adapter: cloudflare({
    platformProxy: { enabled: true },
  }),
  trailingSlash: 'ignore',
  integrations: [react(), tailwind({ applyBaseStyles: false })],
  vite: {
    ssr: {
      noExternal: ['fuse.js'],
    },
  },
});
